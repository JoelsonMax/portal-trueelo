// Edge Function "relatorio-mensal": monta o relatório do mês de um cliente com os números
// de Meta Ads, Google Ads e Google Analytics, salva na Central de Relatórios e envia por e-mail.
//
// Ações:
//  preview  { client_id, month: "AAAA-MM" }                      -> devolve os números (não salva)
//  salvar   { client_id, month, comment, publish: bool, resend }  -> salva rascunho ou publica + e-mail
//  publicar { report_id, resend }                                 -> publica um rascunho + e-mail
//  rascunhos_do_mes (agendador, dia 1)                            -> rascunho do mês anterior p/ cada cliente
//
// Quem pode: Editor para cima (portal) ou o agendador (x-cron-secret).
// E-mail ao cliente só sai se ele aceita e-mails informativos (profiles.email_updates).

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

const LEVEL: Record<string, number> = { proprietario: 6, administrador: 5, moderador: 4, editor: 3, equipe: 2, usuario: 1 };
const DEFAULT_SITE = "https://portal.trueelo.com.br/";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");

type Totals = Record<string, number>;
const FIELDS = ["spend", "impressions", "reach", "clicks", "leads", "purchases", "conversions", "conversion_value", "sessions", "users", "pageviews"];

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return { start, end, label: `${MESES[m - 1]} de ${y}`, prev: `${py}-${String(pm).padStart(2, "0")}` };
}

function sum(rows: any[]): Totals {
  const t: Totals = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const r of rows) for (const f of FIELDS) t[f] += Number(r[f] ?? 0);
  return t;
}
function derived(t: Totals) {
  return {
    ...t,
    ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
    cpc: t.clicks ? t.spend / t.clicks : 0,
    cpa: t.conversions ? t.spend / t.conversions : 0,
    roas: t.spend ? t.conversion_value / t.spend : 0,
  };
}

async function buildData(admin: any, clientId: string, month: string) {
  const b = monthBounds(month);
  const pb = monthBounds(b.prev);
  const { data: rows, error } = await admin.from("campaign_metrics_daily").select("*")
    .eq("client_id", clientId).gte("day", pb.start).lte("day", b.end).order("day");
  if (error) throw new Error("Não foi possível ler os números do cliente");
  const cur = (rows ?? []).filter((r: any) => r.day >= b.start);
  const prev = (rows ?? []).filter((r: any) => r.day <= pb.end);

  const sources: Record<string, unknown> = {};
  for (const src of ["meta", "google_ads", "ga4"]) {
    const c = cur.filter((r: any) => r.source === src);
    const p = prev.filter((r: any) => r.source === src);
    if (!c.length && !p.length) continue;
    sources[src] = { ...derived(sum(c)), prev: derived(sum(p)) };
  }
  const ads = (list: any[]) => list.filter((r: any) => r.source !== "ga4");
  const totals = { ...derived(sum(ads(cur))), prev: derived(sum(ads(prev))) };

  const byDay: Record<string, any> = {};
  for (const r of cur) {
    const d = byDay[r.day] ??= { day: r.day, spend: 0, clicks: 0, conversions: 0, sessions: 0 };
    if (r.source !== "ga4") { d.spend += Number(r.spend); d.clicks += Number(r.clicks); d.conversions += Number(r.conversions); }
    else d.sessions += Number(r.sessions);
  }
  return {
    month, label: b.label, start: b.start, end: b.end,
    has_data: cur.length > 0,
    sources, totals,
    daily: Object.values(byDay).sort((a: any, z: any) => a.day.localeCompare(z.day)),
    generated_at: new Date().toISOString(),
  };
}

async function sendEmail(to: { email: string; name?: string }, subject: string, html: string) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return false;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: Deno.env.get("BREVO_SENDER_EMAIL") || "agenciatrueelo@gmail.com", name: Deno.env.get("BREVO_SENDER_NAME") ?? "True Elo" },
      to: [to], subject, htmlContent: html,
    }),
  });
  if (!res.ok) console.error("brevo", res.status, await res.text());
  return res.ok;
}

function pct(cur: number, prev: number) {
  if (!prev) return "";
  const v = ((cur - prev) / prev) * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}% vs. mês anterior`;
}

function reportEmail(name: string, data: any, comment: string, site: string) {
  const t = data.totals ?? {};
  const ga = data.sources?.ga4;
  const card = (label: string, value: string, change: string) => `
    <td style="padding:6px;width:50%;vertical-align:top">
      <div style="background:#0a0f3d;border:1px solid #1d2366;border-radius:10px;padding:14px">
        <div style="font-size:12px;color:#9aa3bd">${label}</div>
        <div style="font-size:20px;font-weight:bold;color:#fff;margin-top:4px">${value}</div>
        ${change ? `<div style="font-size:12px;color:#e0aa62;margin-top:2px">${change}</div>` : ""}
      </div>
    </td>`;
  const rows = [
    [card("Investimento", brl(t.spend ?? 0), pct(t.spend, t.prev?.spend)), card("Resultados (conversões)", int(t.conversions ?? 0), pct(t.conversions, t.prev?.conversions))],
    [card("Cliques", int(t.clicks ?? 0), pct(t.clicks, t.prev?.clicks)), card("Custo por resultado", t.conversions ? brl(t.cpa) : "—", "")],
  ];
  if (ga) rows.push([card("Visitas ao site", int(ga.sessions ?? 0), pct(ga.sessions, ga.prev?.sessions)), card("Pessoas no site", int(ga.users ?? 0), pct(ga.users, ga.prev?.users))]);
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#00001b;padding:32px 16px">
    <div style="max-width:560px;margin:0 auto;background:#060b3a;border-radius:14px;padding:28px;color:#f1f4fa">
      <p style="margin:0 0 18px;font-size:22px;font-weight:bold"><span style="color:#389cb6">True</span><span style="color:#c0904d">Elo</span></p>
      <h2 style="margin:0 0 12px;font-size:20px;color:#fff">Olá, ${esc(name)}! Seu relatório de ${esc(data.label)} está pronto</h2>
      <p style="margin:0 0 16px;line-height:1.6;color:#cdd3e3">Aqui está um resumo dos resultados do mês. O relatório completo, com gráficos e detalhes por canal, está no seu portal.</p>
      ${data.has_data ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 12px">${rows.map((r) => `<tr>${r.join("")}</tr>`).join("")}</table>` : ""}
      ${comment ? `<div style="border-left:3px solid #c0904d;padding:4px 0 4px 14px;margin:8px 0 18px;line-height:1.6;color:#f1f4fa"><div style="font-size:12px;color:#e0aa62;margin-bottom:4px">Comentário da equipe True Elo</div>${esc(comment).replace(/\n/g, "<br>")}</div>` : ""}
      <p style="margin:18px 0 22px;text-align:center"><a href="${esc(site)}#relatorios" style="display:inline-block;background:#389cb6;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold">Ver relatório completo</a></p>
      <p style="margin:0;line-height:1.6">Um abraço,<br><strong>Equipe True Elo</strong></p>
      <p style="margin:24px 0 0;font-size:12px;color:#6b7391;line-height:1.6">Onde o digital se conecta com humano<br>
        Você recebe este e-mail porque é cliente da True Elo. <a href="${esc(site)}#emails" style="color:#6b7391">Não quer mais receber e-mails informativos? Clique aqui.</a></p>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido", 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => ({}));

    // ---------- quem chama ----------
    let actorId: string | null = null;
    const cronHeader = req.headers.get("x-cron-secret");
    if (cronHeader) {
      const { data: s } = await admin.from("integration_secrets").select("value").eq("key", "cron_secret").maybeSingle();
      if (!s?.value || s.value !== cronHeader) return fail("Acesso negado", 403);
    } else {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = await admin.auth.getUser(jwt);
      if (!data?.user) return fail("Sessão expirada", 401);
      const { data: me } = await admin.from("profiles").select("id, role").eq("id", data.user.id).single();
      if (!me || (LEVEL[me.role] ?? 0) < 3) return fail("Acesso negado", 403);
      actorId = me.id;
    }

    const origin = req.headers.get("Origin") ?? "";
    const site = Deno.env.get("SITE_URL")
      || (typeof body.siteUrl === "string" && origin && body.siteUrl.startsWith(origin + "/") ? body.siteUrl : DEFAULT_SITE);

    const loadClient = async (id: string) => {
      const { data } = await admin.from("profiles").select("id, name, email, role, email_updates").eq("id", id).maybeSingle();
      if (!data || data.role !== "usuario") throw new Error("Cliente não encontrado");
      return data;
    };

    const publishAndEmail = async (reportId: string, resend = false) => {
      const { data: rep } = await admin.from("reports").select("*").eq("id", reportId).single();
      if (!rep) throw new Error("Relatório não encontrado");
      const client = await loadClient(rep.client_id);
      await admin.from("reports").update({ status: "publicado" }).eq("id", rep.id);
      let emailed = false;
      if (client.email_updates !== false && (!rep.emailed_at || resend)) {
        emailed = await sendEmail(
          { email: client.email, name: client.name },
          `${client.name}, seu relatório de ${rep.data?.label ?? "resultados"} está pronto`,
          reportEmail(client.name, rep.data ?? {}, rep.comment ?? "", site),
        );
        if (emailed) await admin.from("reports").update({ emailed_at: new Date().toISOString() }).eq("id", rep.id);
      }
      return { emailed, email_updates: client.email_updates !== false };
    };

    const saveReport = async (clientId: string, month: string, comment: string, status: string) => {
      const data = await buildData(admin, clientId, month);
      const b = monthBounds(month);
      const row = {
        client_id: clientId, kind: "gerado", status, period_month: b.start,
        title: `Relatório Mensal — ${b.label}`, report_date: b.end,
        data, comment: comment || null, uploaded_by: actorId,
      };
      const { data: existing } = await admin.from("reports").select("id").eq("client_id", clientId).eq("kind", "gerado").eq("period_month", b.start).maybeSingle();
      if (existing) {
        const { error } = await admin.from("reports").update(row).eq("id", existing.id);
        if (error) throw new Error("Não foi possível salvar o relatório");
        return existing.id as string;
      }
      const { data: ins, error } = await admin.from("reports").insert(row).select("id").single();
      if (error || !ins) throw new Error("Não foi possível salvar o relatório");
      return ins.id as string;
    };

    const validMonth = (m: unknown) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

    switch (body.action) {
      case "preview": {
        if (!validMonth(body.month)) return fail("Mês inválido");
        await loadClient(body.client_id);
        return json({ data: await buildData(admin, body.client_id, body.month) });
      }
      case "salvar": {
        if (!validMonth(body.month)) return fail("Mês inválido");
        await loadClient(body.client_id);
        const comment = String(body.comment ?? "").slice(0, 4000);
        const id = await saveReport(body.client_id, body.month, comment, body.publish ? "publicado" : "rascunho");
        const mail = body.publish ? await publishAndEmail(id, !!body.resend) : null;
        return json({ ok: true, id, ...(mail ?? {}) });
      }
      case "publicar": {
        if (typeof body.report_id !== "string") return fail("Relatório inválido");
        return json({ ok: true, ...(await publishAndEmail(body.report_id, !!body.resend)) });
      }
      case "rascunhos_do_mes": {
        const now = new Date();
        const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
        const { data: accounts } = await admin.from("client_marketing").select("client_id, meta_ad_account_id, google_ads_customer_id, ga4_property_id");
        let created = 0;
        for (const a of accounts ?? []) {
          if (!a.meta_ad_account_id && !a.google_ads_customer_id && !a.ga4_property_id) continue;
          const { data: existing } = await admin.from("reports").select("id, status").eq("client_id", a.client_id).eq("kind", "gerado").eq("period_month", `${month}-01`).maybeSingle();
          if (existing?.status === "publicado") continue;
          try { await saveReport(a.client_id, month, "", "rascunho"); created++; } catch (e) { console.error(e); }
        }
        if (created) {
          const { data: owner } = await admin.from("profiles").select("name, email").eq("role", "proprietario").maybeSingle();
          if (owner) {
            await sendEmail({ email: owner.email, name: owner.name },
              `${created} rascunho${created > 1 ? "s" : ""} de relatório mensal pronto${created > 1 ? "s" : ""}`,
              `<div style="font-family:Arial,sans-serif;background:#00001b;padding:32px 16px"><div style="max-width:560px;margin:0 auto;background:#060b3a;border-radius:14px;padding:28px;color:#f1f4fa">
                <p style="margin:0 0 18px;font-size:22px;font-weight:bold"><span style="color:#389cb6">True</span><span style="color:#c0904d">Elo</span></p>
                <h2 style="margin:0 0 12px;font-size:20px;color:#fff">Os rascunhos de ${esc(monthBounds(month).label)} estão prontos</h2>
                <p style="line-height:1.6;color:#cdd3e3">O portal montou ${created} relatório${created > 1 ? "s" : ""} com os números do mês. Revise, escreva o comentário da equipe e publique com um clique.</p>
                <p style="margin:20px 0;text-align:center"><a href="${esc(site)}#relatorio-mensal" style="background:#389cb6;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold">Revisar rascunhos</a></p>
              </div></div>`);
          }
        }
        return json({ ok: true, month, created });
      }
      default:
        return fail("Ação desconhecida");
    }
  } catch (e) {
    console.error(e);
    return fail((e as Error).message || "Erro interno", 500);
  }
});
