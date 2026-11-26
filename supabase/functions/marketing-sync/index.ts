// Edge Function "marketing-sync": busca os números das campanhas de cada cliente
// (Meta Ads, Google Ads e Google Analytics 4) e guarda em campaign_metrics_daily.
//
// Quem pode chamar:
//  - o agendador do banco (cabeçalho x-cron-secret), todo dia de manhã;
//  - Moderador para cima, pelo botão "Sincronizar agora" no portal.
//
// Segredos usados (tabela integration_secrets, nunca expostos ao navegador):
//  meta_api_token, google_client_id, google_client_secret, google_refresh_token,
//  google_developer_token, google_login_customer_id
// Versões das APIs (tabela settings, opcionais): int_meta_api_version, int_google_ads_api_version

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const LEVEL: Record<string, number> = { proprietario: 6, administrador: 5, moderador: 4, editor: 3, equipe: 2, usuario: 1 };
const DEFAULT_META_VERSION = "v23.0";
const DEFAULT_GOOGLE_ADS_VERSION = "v21";

type Row = {
  client_id: string; source: string; day: string;
  spend?: number; impressions?: number; reach?: number; clicks?: number;
  leads?: number; purchases?: number; conversions?: number; conversion_value?: number;
  sessions?: number; users?: number; pageviews?: number; raw?: unknown;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------- quem está chamando? ----------
  const secrets = await loadSecrets(admin);
  const cronHeader = req.headers.get("x-cron-secret");
  let trigger = "manual";
  if (cronHeader) {
    if (!secrets.cron_secret || cronHeader !== secrets.cron_secret) return json({ error: "Acesso negado" }, 403);
    trigger = "agendado";
  } else {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(jwt);
    if (!data?.user) return json({ error: "Sessão expirada" }, 401);
    const { data: me } = await admin.from("profiles").select("role").eq("id", data.user.id).single();
    if (!me || (LEVEL[me.role] ?? 0) < 4) return json({ error: "Acesso negado" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(parseInt(body.days ?? "30", 10) || 30, 1), 400);
  const onlyClient = typeof body.client_id === "string" ? body.client_id : null;

  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  const range = { since: isoDay(since), until: isoDay(until) };

  const settings = await loadSettings(admin);
  const metaVersion = settings.int_meta_api_version || DEFAULT_META_VERSION;
  const adsVersion = settings.int_google_ads_api_version || DEFAULT_GOOGLE_ADS_VERSION;

  let q = admin.from("client_marketing").select("client_id, meta_ad_account_id, google_ads_customer_id, ga4_property_id");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: clients, error: cErr } = await q;
  if (cErr) return json({ error: "Não foi possível ler as contas dos clientes" }, 500);

  const { data: run } = await admin.from("sync_runs").insert({ trigger }).select("id").single();

  // Token do Google (um só para Google Ads e Analytics)
  let googleToken: string | null = null;
  let googleTokenError: string | null = null;
  const needsGoogle = (clients ?? []).some((c) => c.google_ads_customer_id || c.ga4_property_id);
  if (needsGoogle) {
    try { googleToken = await googleAccessToken(secrets); }
    catch (e) { googleTokenError = (e as Error).message; }
  }

  const summary: Record<string, Record<string, string>> = {};
  let allOk = true;

  for (const c of clients ?? []) {
    const s: Record<string, string> = {};
    summary[c.client_id] = s;

    if (c.meta_ad_account_id) {
      try {
        if (!secrets.meta_api_token) throw new Error("Token da Meta não configurado");
        const rows = await fetchMeta(c.client_id, c.meta_ad_account_id, secrets.meta_api_token, metaVersion, range);
        await upsert(admin, rows);
        s.meta = `ok (${rows.length} dias)`;
      } catch (e) { s.meta = `erro: ${(e as Error).message}`; allOk = false; }
    }

    if (c.google_ads_customer_id) {
      try {
        if (!googleToken) throw new Error(googleTokenError ?? "Google não conectado");
        if (!secrets.google_developer_token) throw new Error("Developer token do Google Ads não configurado");
        const rows = await fetchGoogleAds(c.client_id, c.google_ads_customer_id, googleToken, secrets, adsVersion, range);
        await upsert(admin, rows);
        s.google_ads = `ok (${rows.length} dias)`;
      } catch (e) { s.google_ads = `erro: ${(e as Error).message}`; allOk = false; }
    }

    if (c.ga4_property_id) {
      try {
        if (!googleToken) throw new Error(googleTokenError ?? "Google não conectado");
        const rows = await fetchGa4(c.client_id, c.ga4_property_id, googleToken, range);
        await upsert(admin, rows);
        s.ga4 = `ok (${rows.length} dias)`;
      } catch (e) { s.ga4 = `erro: ${(e as Error).message}`; allOk = false; }
    }
  }

  if (run?.id) {
    await admin.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: allOk, summary: { range, clients: summary } }).eq("id", run.id);
  }
  return json({ ok: allOk, range, clients: summary });
});

// ---------------------------------------------------------------------
async function loadSecrets(admin: any): Promise<Record<string, string>> {
  const { data } = await admin.from("integration_secrets").select("key, value");
  return Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
}
async function loadSettings(admin: any): Promise<Record<string, string>> {
  const { data } = await admin.from("settings").select("key, value").like("key", "int_%");
  return Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value ?? ""]));
}
async function upsert(admin: any, rows: Row[]) {
  if (!rows.length) return;
  const stamped = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  for (let i = 0; i < stamped.length; i += 500) {
    const { error } = await admin.from("campaign_metrics_daily").upsert(stamped.slice(i, i + 500), { onConflict: "client_id,source,day" });
    if (error) throw new Error("Falha ao gravar no banco: " + error.message);
  }
}

// ---------------------------------------------------------------------
// Meta Ads (Marketing API: insights diários da conta de anúncio)
// ---------------------------------------------------------------------
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"];
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"];

function pickAction(list: any[] | undefined, types: string[]) {
  if (!Array.isArray(list)) return 0;
  // usa o primeiro tipo encontrado na ordem de preferência (evita somar o mesmo evento duas vezes)
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

async function fetchMeta(clientId: string, accountId: string, token: string, version: string, range: { since: string; until: string }): Promise<Row[]> {
  const act = accountId.trim().startsWith("act_") ? accountId.trim() : `act_${accountId.trim().replace(/\D/g, "")}`;
  const params = new URLSearchParams({
    fields: "spend,impressions,reach,clicks,actions,action_values",
    level: "account",
    time_increment: "1",
    time_range: JSON.stringify(range),
    limit: "500",
    access_token: token,
  });
  let url: string | null = `https://graph.facebook.com/${version}/${act}/insights?${params}`;
  const rows: Row[] = [];
  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    for (const d of data.data ?? []) {
      const leads = pickAction(d.actions, LEAD_TYPES);
      const purchases = pickAction(d.actions, PURCHASE_TYPES);
      rows.push({
        client_id: clientId, source: "meta", day: d.date_start,
        spend: num(d.spend), impressions: num(d.impressions), reach: num(d.reach), clicks: num(d.clicks),
        leads, purchases, conversions: leads + purchases,
        conversion_value: pickAction(d.action_values, PURCHASE_TYPES),
        raw: { actions: d.actions ?? [] },
      });
    }
    url = data.paging?.next ?? null;
  }
  return rows;
}

// ---------------------------------------------------------------------
// Google (token de acesso a partir do refresh token salvo na conexão)
// ---------------------------------------------------------------------
async function googleAccessToken(secrets: Record<string, string>) {
  if (!secrets.google_client_id || !secrets.google_client_secret) throw new Error("Credenciais do Google não configuradas");
  if (!secrets.google_refresh_token) throw new Error("Google não conectado (clique em Conectar Google)");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: secrets.google_client_id,
      client_secret: secrets.google_client_secret,
      refresh_token: secrets.google_refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? "Falha ao obter acesso ao Google");
  return data.access_token as string;
}

// Google Ads: métricas diárias da conta do cliente
async function fetchGoogleAds(clientId: string, customerId: string, token: string, secrets: Record<string, string>, version: string, range: { since: string; until: string }): Promise<Row[]> {
  const cid = customerId.replace(/\D/g, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": secrets.google_developer_token,
    "Content-Type": "application/json",
  };
  if (secrets.google_login_customer_id) headers["login-customer-id"] = secrets.google_login_customer_id.replace(/\D/g, "");
  const query = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
                 FROM customer WHERE segments.date BETWEEN '${range.since}' AND '${range.until}'`;
  const res = await fetch(`https://googleads.googleapis.com/${version}/customers/${cid}/googleAds:searchStream`, {
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = Array.isArray(data) ? data[0]?.error?.message : data?.error?.message;
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  const chunks = Array.isArray(data) ? data : [data];
  const rows: Row[] = [];
  for (const chunk of chunks) {
    for (const r of chunk.results ?? []) {
      const m = r.metrics ?? {};
      const conv = num(m.conversions);
      rows.push({
        client_id: clientId, source: "google_ads", day: r.segments?.date,
        spend: Math.round(num(m.costMicros) / 10000) / 100,
        impressions: num(m.impressions), clicks: num(m.clicks),
        conversions: conv, leads: 0, purchases: 0,
        conversion_value: num(m.conversionsValue),
      });
    }
  }
  return rows.filter((r) => r.day);
}

// Google Analytics 4: sessões, usuários, visualizações e eventos-chave por dia
async function fetchGa4(clientId: string, propertyId: string, token: string, range: { since: string; until: string }): Promise<Row[]> {
  const pid = propertyId.replace(/\D/g, "");
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: range.since, endDate: range.until }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }, { name: "keyEvents" }],
      limit: 1000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return (data.rows ?? []).map((r: any) => {
    const d = r.dimensionValues?.[0]?.value ?? "";
    const v = (r.metricValues ?? []).map((x: any) => num(x.value));
    return {
      client_id: clientId, source: "ga4", day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      sessions: v[0] ?? 0, users: v[1] ?? 0, pageviews: v[2] ?? 0, conversions: v[3] ?? 0,
    } as Row;
  });
}
