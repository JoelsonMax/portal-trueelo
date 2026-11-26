// Edge Function "solicitar-extensao": o cliente pede para estender o contrato.
// 1) registra o pedido (aparece em "Solicitações" no painel da True Elo);
// 2) envia e-mail para o Administrador Proprietário e uma confirmação para o cliente,
//    se o serviço de e-mail (Brevo) estiver configurado nos segredos da função:
//    BREVO_API_KEY, BREVO_SENDER_EMAIL (e opcional BREVO_SENDER_NAME, NOTIFY_EMAIL).

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sendEmail(to: { email: string; name?: string }, subject: string, html: string) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_SENDER_EMAIL");
  if (!apiKey || !sender) return false;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: sender, name: Deno.env.get("BREVO_SENDER_NAME") ?? "True Elo" },
      to: [to],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) console.error("brevo", res.status, await res.text());
  return res.ok;
}

const layout = (title: string, body: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#00001b;padding:32px 16px">
    <div style="max-width:560px;margin:0 auto;background:#060b3a;border-radius:14px;padding:28px;color:#f1f4fa">
      <p style="margin:0 0 18px;font-size:22px;font-weight:bold"><span style="color:#389cb6">True</span><span style="color:#c0904d">Elo</span></p>
      <h2 style="margin:0 0 14px;font-size:20px;color:#ffffff">${title}</h2>
      ${body}
      <p style="margin:26px 0 0;font-size:12px;color:#9aa3bd">Portal do Cliente True Elo · Onde o digital se conecta com humano</p>
    </div>
  </div>`;

const fmtDay = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido", 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !authData?.user) return fail("Sessão expirada", 401);

    const { data: me } = await admin.from("profiles").select("id, name, email, phone, role").eq("id", authData.user.id).single();
    if (!me || me.role !== "usuario") return fail("Somente clientes podem solicitar extensão", 403);

    const body = await req.json().catch(() => ({}));
    const months = Number(body.months);
    const message = String(body.message ?? "").trim().slice(0, 1000);
    if (!Number.isInteger(months) || months < 1 || months > 120) return fail("Escolha por quantos meses deseja estender");

    // Evita pedidos repetidos em sequência (1 pendente a cada 10 minutos).
    const { data: recent } = await admin
      .from("extension_requests")
      .select("id, created_at")
      .eq("client_id", me.id)
      .eq("status", "pendente")
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);
    if (recent?.length) return fail("Você acabou de enviar uma solicitação. Aguarde alguns minutos.", 429);

    const { data: request, error: insErr } = await admin
      .from("extension_requests")
      .insert({ client_id: me.id, months, message: message || null })
      .select("id, created_at")
      .single();
    if (insErr || !request) {
      console.error(insErr);
      return fail("Não foi possível registrar a solicitação", 500);
    }

    const { data: service } = await admin.from("services").select("start_date, total_months").eq("client_id", me.id).maybeSingle();
    const contrato = service
      ? `Contrato atual: ${service.total_months} meses, iniciado em ${fmtDay(service.start_date)}.`
      : "Cliente ainda sem linha do tempo cadastrada.";

    // E-mail para a True Elo
    const { data: owner } = await admin.from("profiles").select("name, email").eq("role", "proprietario").maybeSingle();
    const notifyTo = Deno.env.get("NOTIFY_EMAIL") || owner?.email;
    const site = Deno.env.get("SITE_URL") || req.headers.get("Origin") || "";
    let sent = false;
    if (notifyTo) {
      sent = await sendEmail(
        { email: notifyTo, name: owner?.name ?? "True Elo" },
        `Solicitação de extensão: ${me.name} (${months} meses)`,
        layout("Nova solicitação de extensão", `
          <p style="margin:0 0 10px;line-height:1.6"><strong>${esc(me.name)}</strong> solicitou estender o serviço por <strong>${months} meses</strong>.</p>
          <p style="margin:0 0 10px;line-height:1.6;color:#cdd3e3">E-mail: ${esc(me.email)}${me.phone ? `<br>Celular: ${esc(me.phone)}` : ""}<br>${esc(contrato)}</p>
          ${message ? `<p style="margin:0 0 10px;line-height:1.6;color:#cdd3e3">Mensagem do cliente:<br><em>${esc(message)}</em></p>` : ""}
          ${site ? `<p style="margin:18px 0 0"><a href="${esc(site)}" style="background:#389cb6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Abrir o portal</a></p>` : ""}`),
      );
    }

    // Confirmação para o cliente
    await sendEmail(
      { email: me.email, name: me.name },
      "Recebemos sua solicitação de extensão",
      layout("Solicitação recebida!", `
        <p style="margin:0 0 10px;line-height:1.6">Olá, ${esc(String(me.name).split(" ")[0])}! Recebemos seu pedido para estender o serviço por <strong>${months} meses</strong>.</p>
        <p style="margin:0;line-height:1.6;color:#cdd3e3">A equipe da True Elo vai entrar em contato em breve para combinar os detalhes.</p>`),
    );

    if (sent) await admin.from("extension_requests").update({ email_sent: true }).eq("id", request.id);
    return json({ ok: true, id: request.id, email_sent: sent });
  } catch (e) {
    console.error(e);
    return fail("Erro interno", 500);
  }
});
