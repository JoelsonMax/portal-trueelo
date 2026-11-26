-- =====================================================================
-- PORTAL DO CLIENTE TRUE ELO — Estrutura do banco de dados (Supabase)
-- Rode este arquivo inteiro no SQL Editor do Supabase, uma única vez.
-- Todas as regras de acesso ficam AQUI, no servidor. Esconder botões na
-- tela é só conveniência: quem decide o que cada pessoa vê é o banco.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Papéis
-- ---------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum
    ('proprietario', 'administrador', 'moderador', 'editor', 'equipe', 'usuario');
exception when duplicate_object then null; end $$;

create or replace function public.role_level(r public.app_role)
returns int language sql immutable as $$
  select case r
    when 'proprietario'  then 6
    when 'administrador' then 5
    when 'moderador'     then 4
    when 'editor'        then 3
    when 'equipe'        then 2
    else 1
  end
$$;

-- ---------------------------------------------------------------------
-- 2. Perfis (um para cada login do Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  email       text not null unique,
  phone       text,
  role        public.app_role not null default 'usuario',
  created_at  timestamptz not null default now(),
  last_login  timestamptz
);

-- Só pode existir UM Administrador Proprietário.
create unique index if not exists profiles_one_owner
  on public.profiles ((role)) where role = 'proprietario';

-- Funções auxiliares (security definer evita recursão nas regras RLS)
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_level()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select public.role_level(role) from public.profiles where id = auth.uid()), 0)
$$;

-- Todo novo login ganha um perfil "usuario". O papel real é definido
-- pela Edge Function admin-users (servidor), nunca pelo navegador.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, phone, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    'usuario'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_last_login()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_login = now() where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 3. Conteúdo dos clientes
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  storage_path  text not null,            -- bucket "documentos": <client_id>/<arquivo>
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists documents_client_idx on public.documents (client_id);

create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  report_date   date not null,
  storage_path  text not null,            -- bucket "documentos": <client_id>/relatorios/<arquivo>
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists reports_client_idx on public.reports (client_id, report_date desc);

create table if not exists public.services (
  client_id         uuid primary key references public.profiles(id) on delete cascade,
  total_months      int not null check (total_months > 0),
  completed_months  int not null default 0 check (completed_months >= 0),
  updated_at        timestamptz not null default now(),
  check (completed_months <= total_months)
);

create table if not exists public.settings (
  key         text primary key,           -- ex.: 'logo_path'
  value       text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.ownership_transfers (
  id            uuid primary key default gen_random_uuid(),
  from_user     uuid not null references public.profiles(id) on delete cascade,
  to_user       uuid not null references public.profiles(id) on delete cascade,
  started_at    timestamptz not null default now(),
  completes_at  timestamptz not null,
  status        text not null default 'pendente'
                check (status in ('pendente', 'concluida', 'cancelada'))
);
create unique index if not exists one_pending_transfer
  on public.ownership_transfers ((status)) where status = 'pendente';

-- ---------------------------------------------------------------------
-- 4. Regras de acesso (Row Level Security)
--    Níveis: 6 Proprietário · 5 Administrador · 4 Moderador
--            3 Editor · 2 Equipe · 1 Usuário (cliente)
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.documents           enable row level security;
alter table public.reports             enable row level security;
alter table public.services            enable row level security;
alter table public.settings            enable row level security;
alter table public.ownership_transfers enable row level security;

-- Perfis: cada um vê o próprio; Equipe para cima vê todos.
-- Alterações de perfil/papel só pela Edge Function (sem policy de escrita).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_level() >= 2);

-- Documentos e relatórios: o cliente vê só os seus; Equipe+ vê todos;
-- Editor+ envia, altera e exclui.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (client_id = auth.uid() or public.my_level() >= 2);
drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated
  using (public.my_level() >= 3) with check (public.my_level() >= 3);

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (client_id = auth.uid() or public.my_level() >= 2);
drop policy if exists reports_write on public.reports;
create policy reports_write on public.reports for all to authenticated
  using (public.my_level() >= 3) with check (public.my_level() >= 3);

-- Linha do tempo: cliente vê a sua; Moderador+ gerencia.
drop policy if exists services_select on public.services;
create policy services_select on public.services for select to authenticated
  using (client_id = auth.uid() or public.my_level() >= 2);
drop policy if exists services_write on public.services;
create policy services_write on public.services for all to authenticated
  using (public.my_level() >= 4) with check (public.my_level() >= 4);

-- Marca: todos leem (o logo aparece na tela de login); só o Proprietário altera.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to anon, authenticated
  using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (public.my_level() = 6) with check (public.my_level() = 6);

-- Transferências: Administrador+ acompanha; mudanças só pelas funções abaixo.
drop policy if exists transfers_select on public.ownership_transfers;
create policy transfers_select on public.ownership_transfers for select to authenticated
  using (public.my_level() >= 5);

-- ---------------------------------------------------------------------
-- 5. Transferência de propriedade (prazo de 3 dias)
-- ---------------------------------------------------------------------
create or replace function public.start_ownership_transfer(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'proprietario' then
    raise exception 'Acesso negado';
  end if;
  if not exists (select 1 from public.profiles where id = target and role = 'administrador') then
    raise exception 'O novo proprietário precisa ser um Administrador';
  end if;
  if exists (select 1 from public.ownership_transfers where status = 'pendente') then
    raise exception 'Já existe uma transferência em andamento';
  end if;
  insert into public.ownership_transfers (from_user, to_user, completes_at)
  values (auth.uid(), target, now() + interval '3 days');
end $$;

create or replace function public.cancel_ownership_transfer()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'proprietario' then
    raise exception 'Acesso negado';
  end if;
  update public.ownership_transfers set status = 'cancelada' where status = 'pendente';
end $$;

-- Conclui transferências vencidas. Seguro para qualquer um chamar:
-- só age quando o prazo de 3 dias já passou.
create or replace function public.complete_due_transfers()
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  for t in
    select * from public.ownership_transfers
    where status = 'pendente' and completes_at <= now()
    for update
  loop
    if exists (select 1 from public.profiles where id = t.to_user) then
      update public.profiles set role = 'administrador' where id = t.from_user;  -- antigo dono vira Administrador
      update public.profiles set role = 'proprietario'  where id = t.to_user;    -- novo dono
      update public.ownership_transfers set status = 'concluida' where id = t.id;
    else
      update public.ownership_transfers set status = 'cancelada' where id = t.id;
    end if;
  end loop;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.start_ownership_transfer(uuid) to authenticated;
grant execute on function public.cancel_ownership_transfer()     to authenticated;
grant execute on function public.complete_due_transfers()        to authenticated;
grant execute on function public.touch_last_login()              to authenticated;

-- ---------------------------------------------------------------------
-- 6. Armazenamento de arquivos
--    "documentos": privado (documentos e relatórios dos clientes)
--    "marca":      público (logo)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 52428800)          -- até 50 MB por arquivo
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists docs_files_select on storage.objects;
create policy docs_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documentos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.my_level() >= 2)
  );

drop policy if exists docs_files_write on storage.objects;
create policy docs_files_write on storage.objects for all to authenticated
  using (bucket_id = 'documentos' and public.my_level() >= 3)
  with check (bucket_id = 'documentos' and public.my_level() >= 3);

drop policy if exists brand_files_write on storage.objects;
create policy brand_files_write on storage.objects for all to authenticated
  using (bucket_id = 'marca' and public.my_level() = 6)
  with check (bucket_id = 'marca' and public.my_level() = 6);

-- ---------------------------------------------------------------------
-- 7. (Opcional, recomendado) Concluir transferências automaticamente
--    Ative antes a extensão pg_cron em Database → Extensions e depois
--    rode a linha abaixo separadamente:
--
--    select cron.schedule('concluir-transferencias', '*/15 * * * *',
--                         'select public.complete_due_transfers()');
--
--    Sem isso, a transferência é concluída na próxima vez que alguém
--    abrir o portal depois do prazo.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 8. Ajustes aplicados no projeto (26/11/2026)
-- ---------------------------------------------------------------------
revoke execute on function public.my_level() from public, anon;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_level() to authenticated;
grant execute on function public.my_role() to authenticated;

-- ---------------------------------------------------------------------
-- 9. Documentos e relatórios aceitam arquivo OU link; só clientes recebem
-- ---------------------------------------------------------------------
alter table public.documents add column if not exists url text;
alter table public.documents alter column storage_path drop not null;
alter table public.documents drop constraint if exists documents_file_or_link;
alter table public.documents add constraint documents_file_or_link
  check ((storage_path is not null) or (url is not null and url ~* '^https?://'));

alter table public.reports add column if not exists url text;
alter table public.reports alter column storage_path drop not null;
alter table public.reports drop constraint if exists reports_file_or_link;
alter table public.reports add constraint reports_file_or_link
  check ((storage_path is not null) or (url is not null and url ~* '^https?://'));

create or replace function public.ensure_client_target()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.client_id and role = 'usuario') then
    raise exception 'Selecione um cliente válido';
  end if;
  return new;
end $$;
revoke execute on function public.ensure_client_target() from public, anon, authenticated;

drop trigger if exists documents_client_check on public.documents;
create trigger documents_client_check before insert or update of client_id on public.documents
  for each row execute function public.ensure_client_target();
drop trigger if exists reports_client_check on public.reports;
create trigger reports_client_check before insert or update of client_id on public.reports
  for each row execute function public.ensure_client_target();
drop trigger if exists services_client_check on public.services;
create trigger services_client_check before insert or update of client_id on public.services
  for each row execute function public.ensure_client_target();

-- Conclusão automática das transferências (pg_cron)
-- create extension if not exists pg_cron with schema pg_catalog;
-- select cron.schedule('concluir-transferencias', '*/15 * * * *', 'select public.complete_due_transfers()');
