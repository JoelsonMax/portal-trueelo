// Edge Function "rastreamento": envia eventos do portal para a API de Conversões da Meta
// (servidor -> Meta), complementando o Pixel no navegador.
//
// O portal só chama esta função se a pessoa ACEITOU os cookies de medição.
// Dados pessoais (e-mail, celular, id) vão criptografados em SHA-256, como a Meta exige.
// O mesmo event_id é usado no Pixel e aqui, para a Meta não contar o evento duas vezes.
//
// Configuração (tela Integrações): settings.int_meta_pixel_id, settings.int_meta_test_event_code (opcional),
// segredo integration_secrets.meta_capi_token

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ALLOWED = new Set(["PageView", "ViewContent", "Lead", "CompleteRegistration", "Contact", "Login", "Search"]);
const STANDARD = new Set(["PageView", "ViewContent", "Lead", "CompleteRegistration", "Contact", "Search"]);
const DEFAULT_META_VERSION = "v23.0";

async function sha256(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const normPhone = (p: string) => {
  let d = p.replace(/\D/g, "");
  if (d.length >= 10 && d.length <= 11) d = "55" + d; // número brasileiro sem DDI
  return d;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const eventName = String(body.event_name ?? "");
    if (!ALLOWED.has(eventName)) return json({ error: "Evento não permitido" }, 400);

    const { data: settings } = await admin.from("settings").select("key, value")
      .in("key", ["int_meta_pixel_id", "int_meta_test_event_code", "int_meta_api_version"]);
    const s = Object.fromEntries((settings ?? []).map((r: any) => [r.key, r.value ?? ""]));
    const pixelId = String(s.int_meta_pixel_id ?? "").replace(/\D/g, "");
    const { data: tok } = await admin.from("integration_secrets").select("value").eq("key", "meta_capi_token").maybeSingle();
    if (!pixelId || !tok?.value) return json({ skipped: "API de Conversões não configurada" });

    // Dados do usuário logado (se houver), criptografados
    const userData: Record<string, unknown> = {
      client_ip_address: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined,
      client_user_agent: req.headers.get("user-agent") ?? undefined,
    };
    if (typeof body.fbp === "string" && body.fbp.startsWith("fb.")) userData.fbp = body.fbp;
    if (typeof body.fbc === "string" && body.fbc.startsWith("fb.")) userData.fbc = body.fbc;

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (jwt && jwt.split(".").length === 3) {
      const { data: auth } = await admin.auth.getUser(jwt);
      if (auth?.user) {
        const { data: p } = await admin.from("profiles").select("id, name, email, phone").eq("id", auth.user.id).maybeSingle();
        if (p) {
          userData.external_id = [await sha256(p.id)];
          if (p.email) userData.em = [await sha256(p.email.trim().toLowerCase())];
          if (p.phone) userData.ph = [await sha256(normPhone(p.phone))];
          const first = String(p.name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
          if (first) userData.fn = [await sha256(first)];
          userData.country = [await sha256("br")];
        }
      }
    }

    const sourceUrl = typeof body.event_source_url === "string" ? body.event_source_url.slice(0, 500) : undefined;
    const event: Record<string, unknown> = {
      event_name: STANDARD.has(eventName) ? eventName : eventName, // eventos personalizados (ex.: Login) também são aceitos
      event_time: Math.floor(Date.now() / 1000),
      event_id: typeof body.event_id === "string" ? body.event_id.slice(0, 100) : crypto.randomUUID(),
      action_source: "website",
      event_source_url: sourceUrl,
      user_data: userData,
    };
    if (body.custom_data && typeof body.custom_data === "object") {
      const cd = body.custom_data as Record<string, unknown>;
      event.custom_data = Object.fromEntries(Object.entries(cd).filter(([k]) =>
        ["value", "currency", "content_name", "content_category", "months"].includes(k)));
    }

    const payload: Record<string, unknown> = { data: [event] };
    if (s.int_meta_test_event_code) payload.test_event_code = s.int_meta_test_event_code;

    const version = s.int_meta_api_version || DEFAULT_META_VERSION;
    const res = await fetch(`https://graph.facebook.com/${version}/${pixelId}/events?access_token=${encodeURIComponent(tok.value)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    if (!res.ok) {
      console.error("capi", out);
      return json({ error: out?.error?.message ?? "Falha ao enviar para a Meta" }, 502);
    }
    return json({ ok: true, received: out.events_received ?? 0 });
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno" }, 500);
  }
});
