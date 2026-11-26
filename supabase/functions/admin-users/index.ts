// Edge Function "admin-users" — gerenciamento de usuários do Portal True Elo.
// Roda no servidor do Supabase com a chave de serviço, que NUNCA vai para o navegador.
// Cada ação confere o papel de quem está pedindo antes de fazer qualquer coisa.
//
// Regra geral: uma pessoa só gerencia quem tem papel ABAIXO do seu e só
// atribui papéis abaixo do seu. Ninguém vira Proprietário por aqui — só
// pela transferência de propriedade.

import { createClient } from "npm:@supabase/supabase-js@2";

const LEVEL: Record<string, number> = {
  proprietario: 6,
  administrador: 5,
  moderador: 4,
  editor: 3,
  equipe: 2,
  usuario: 1,
};
const MANAGE_MIN_LEVEL = 4; // Moderador para cima

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método não permitido", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Endereço do portal para onde os links de e-mail levam. Se SITE_URL não
    // estiver configurado, usa o endereço de onde o pedido veio.
    const siteUrl = Deno.env.get("SITE_URL") || req.headers.get("Origin") || undefined;

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Quem está pedindo?
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !authData?.user) return fail("Sessão expirada", 401);

    const { data: me } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", authData.user.id)
      .single();
    if (!me) return fail("Acesso negado", 403);

    const myLevel = LEVEL[me.role] ?? 0;
    if (myLevel < MANAGE_MIN_LEVEL) return fail("Acesso negado", 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // Carrega o usuário-alvo e confere se quem pede pode mexer nele.
    const loadTarget = async (userId: unknown) => {
      if (typeof userId !== "string" || !userId) return { error: fail("Usuário inválido") };
      if (userId === me.id) return { error: fail("Você não pode fazer isso com a sua própria conta") };
      const { data: target } = await admin
        .from("profiles")
        .select("id, name, email, role")
        .eq("id", userId)
        .single();
      if (!target) return { error: fail("Usuário não encontrado", 404) };
      if ((LEVEL[target.role] ?? 0) >= myLevel) return { error: fail("Acesso negado", 403) };
      return { target };
    };

    const canAssign = (role: unknown): role is string =>
      typeof role === "string" && role in LEVEL && role !== "proprietario" && LEVEL[role] < myLevel;

    switch (action) {
      // ---------------------------------------------------------------
      // Adicionar usuário: envia o convite por e-mail ("Crie sua senha")
      // ---------------------------------------------------------------
      case "invite": {
        const name = String(body.name ?? "").trim();
        const email = String(body.email ?? "").trim().toLowerCase();
        const phone = String(body.phone ?? "").trim();
        const role = body.role;

        if (name.length < 2) return fail("Informe o nome completo");
        if (!EMAIL_RE.test(email)) return fail("E-mail inválido");
        if (!canAssign(role)) return fail("Você não pode atribuir esta função", 403);

        const { data: exists } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
        if (exists) return fail("E-mail já cadastrado");

        const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { name, phone },
          redirectTo: siteUrl,
        });
        if (error || !invited?.user) {
          console.error("invite", error);
          return fail("Não foi possível enviar o convite. Verifique o e-mail e tente novamente.", 500);
        }

        // O gatilho do banco cria o perfil como "usuario"; aqui aplicamos o papel escolhido.
        await admin
          .from("profiles")
          .update({ role, name, phone: phone || null })
          .eq("id", invited.user.id);

        return json({ ok: true, id: invited.user.id });
      }

      // ---------------------------------------------------------------
      // Editar permissões
      // ---------------------------------------------------------------
      case "update_role": {
        const { target, error } = await loadTarget(body.userId);
        if (error) return error;
        if (!canAssign(body.role)) return fail("Você não pode atribuir esta função", 403);

        const { error: upErr } = await admin.from("profiles").update({ role: body.role }).eq("id", target!.id);
        if (upErr) return fail("Não foi possível atualizar as permissões", 500);
        return json({ ok: true });
      }

      // ---------------------------------------------------------------
      // Redefinir senha do usuário (somente Proprietário):
      // envia ao usuário um link para ele mesmo criar a nova senha.
      // Ninguém — nem o Proprietário — vê ou define a senha de outra pessoa.
      // ---------------------------------------------------------------
      case "send_password_reset": {
        if (me.role !== "proprietario") return fail("Acesso negado", 403);
        const { target, error } = await loadTarget(body.userId);
        if (error) return error;

        const { error: rErr } = await admin.auth.resetPasswordForEmail(target!.email, { redirectTo: siteUrl });
        if (rErr) {
          console.error("reset", rErr);
          return fail("Não foi possível enviar o e-mail de redefinição", 500);
        }
        return json({ ok: true });
      }

      // ---------------------------------------------------------------
      // Excluir usuário (apaga também os arquivos dele)
      // ---------------------------------------------------------------
      case "delete": {
        const { target, error } = await loadTarget(body.userId);
        if (error) return error;

        await removeFolder(admin, "documentos", target!.id);

        const { error: dErr } = await admin.auth.admin.deleteUser(target!.id);
        if (dErr) {
          console.error("delete", dErr);
          return fail("Não foi possível excluir o usuário", 500);
        }
        return json({ ok: true });
      }

      default:
        return fail("Ação desconhecida");
    }
  } catch (e) {
    console.error(e);
    return fail("Erro interno", 500);
  }
});

// Remove todos os arquivos de uma pasta (inclusive subpastas) de um bucket.
// deno-lint-ignore no-explicit-any
async function removeFolder(admin: any, bucket: string, prefix: string) {
  const { data: items } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!items?.length) return;
  const files: string[] = [];
  for (const item of items) {
    const path = `${prefix}/${item.name}`;
    if (item.id === null) await removeFolder(admin, bucket, path); // é uma pasta
    else files.push(path);
  }
  if (files.length) await admin.storage.from(bucket).remove(files);
}
