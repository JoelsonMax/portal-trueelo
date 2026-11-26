// Edge Function "google-oauth": conecta a conta Google da True Elo ao portal
// (uma vez só), para o portal ler Google Ads e Google Analytics.
//
//  POST (com login do Proprietário) { action: "start", siteUrl }  -> devolve o link do Google
//  GET  ?code=...&state=...  (o Google volta aqui depois da autorização)
//  POST { action: "disconnect" } -> remove a conexão
//
// Guarda o refresh token em integration_secrets (google_refresh_token).
// No Google Cloud, o "URI de redirecionamento autorizado" deve ser:
//   https://luoxfwuhcqlhwsxoxykf.supabase.co/functions/v1/google-oauth

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");
const DEFAULT_SITE = "https://joelsonmax.github.io/portal-trueelo/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth`;
  const getSecret = async (key: string) =>
    (await admin.from("integration_secrets").select("value").eq("key", key).maybeSingle()).data?.value ?? "";
  const setSecret = (key: string, value: string) =>
    admin.from("integration_secrets").upsert({ key, value, updated_at: new Date().toISOString() });

  // ---------------- volta do Google ----------------
  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const saved = await getSecret("google_oauth_state");
    const [savedState, expires, site] = saved.split("|");
    const back = (status: string) => Response.redirect(`${site || DEFAULT_SITE}#integracoes-google-${status}`, 302);

    if (!savedState || state !== savedState || Date.now() > Number(expires)) return back("expirado");
    await admin.from("integration_secrets").delete().eq("key", "google_oauth_state");
    if (!code) return back("cancelado");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: await getSecret("google_client_id"),
        client_secret: await getSecret("google_client_secret"),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.refresh_token) {
      console.error("google token", data);
      return back("erro");
    }
    await setSecret("google_refresh_token", data.refresh_token);
    return back("ok");
  }

  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  // ---------------- pedidos do portal (só Proprietário) ----------------
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return json({ error: "Sessão expirada" }, 401);
  const { data: me } = await admin.from("profiles").select("role").eq("id", auth.user.id).single();
  if (me?.role !== "proprietario") return json({ error: "Acesso negado" }, 403);

  const body = await req.json().catch(() => ({}));

  if (body.action === "disconnect") {
    await admin.from("integration_secrets").delete().eq("key", "google_refresh_token");
    return json({ ok: true });
  }

  if (body.action === "start") {
    const clientId = await getSecret("google_client_id");
    if (!clientId || !(await getSecret("google_client_secret"))) {
      return json({ error: "Preencha e salve o Client ID e o Client Secret do Google primeiro." }, 400);
    }
    const origin = req.headers.get("Origin") ?? "";
    const site = typeof body.siteUrl === "string" && origin && body.siteUrl.startsWith(origin + "/") ? body.siteUrl : DEFAULT_SITE;
    const state = crypto.randomUUID().replace(/-/g, "");
    await setSecret("google_oauth_state", `${state}|${Date.now() + 15 * 60 * 1000}|${site}`);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  return json({ error: "Ação desconhecida" }, 400);
});
