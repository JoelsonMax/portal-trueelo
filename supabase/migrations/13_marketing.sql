-- =====================================================================
-- 13. Marketing: integrações (Meta, Google), contas dos clientes,
--     métricas diárias, relatórios gerados e agendamentos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configurações públicas das integrações (IDs que o navegador precisa
-- para carregar Pixel/GA/Google Ads). Nada secreto aqui.
-- Ficam na tabela settings já existente (leitura pública, escrita só do
-- Proprietário), com chaves começando em "int_".
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Segredos (tokens). NINGUÉM lê pelo navegador: nem o Proprietário.
-- Só as funções do servidor (chave de serviço) acessam.
-- ---------------------------------------------------------------------
create table if not exists public.integration_secrets (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
alter table public.integration_secrets enable row level security;
-- (sem nenhuma policy = bloqueado para anon e authenticated)

create index if not exists integration_secrets_updated_by_idx on public.integration_secrets (updated_by);

-- Proprietário grava/apaga um segredo, sem nunca poder lê-lo de volta.
create or replace function public.set_integration_secret(secret_key text, secret_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'proprietario' then
    raise exception 'Acesso negado';
  end if;
  if secret_key not in ('meta_capi_token', 'meta_api_token', 'google_client_id', 'google_client_secret',
                        'google_developer_token', 'google_login_customer_id') then
    raise exception 'Chave desconhecida';
  end if;
  if coalesce(trim(secret_value), '') = '' then
    delete from public.integration_secrets where key = secret_key;
  else
    insert into public.integration_secrets (key, value, updated_at, updated_by)
    values (secret_key, trim(secret_value), now(), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;

-- Quais segredos existem (sem os valores). Para a tela de Integrações.
create or replace function public.integration_status()
returns table (key text, configured boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.key, true, s.updated_at
    from public.integration_secrets s
   where public.my_level() >= 5
     and s.key in ('meta_capi_token', 'meta_api_token', 'google_client_id', 'google_client_secret',
                   'google_developer_token', 'google_login_customer_id', 'google_refresh_token')
$$;

revoke execute on function public.set_integration_secret(text, text) from public, anon;
revoke execute on function public.integration_status() from public, anon;
grant execute on function public.set_integration_secret(text, text) to authenticated;
grant execute on function public.integration_status() to authenticated;

-- ---------------------------------------------------------------------
-- Contas de marketing de cada cliente
-- ---------------------------------------------------------------------
create table if not exists public.client_marketing (
  client_id               uuid primary key references public.profiles(id) on delete cascade,
  website                 text,
  meta_ad_account_id      text,     -- ex.: act_1234567890
  meta_pixel_id           text,
  google_ads_customer_id  text,     -- ex.: 123-456-7890
  ga4_property_id         text,     -- ex.: 345678901
  updated_at              timestamptz not null default now()
);
alter table public.client_marketing enable row level security;

drop policy if exists cm_select on public.client_marketing;
create policy cm_select on public.client_marketing for select to authenticated
  using (client_id = (select auth.uid()) or public.my_level() >= 2);
drop policy if exists cm_write on public.client_marketing;
create policy cm_write on public.client_marketing for all to authenticated
  using (public.my_level() >= 4) with check (public.my_level() >= 4);

drop trigger if exists client_marketing_client_check on public.client_marketing;
create trigger client_marketing_client_check before insert or update of client_id on public.client_marketing
  for each row execute function public.ensure_client_target();

-- ---------------------------------------------------------------------
-- Métricas diárias (preenchidas pela função marketing-sync)
-- ---------------------------------------------------------------------
create table if not exists public.campaign_metrics_daily (
  client_id         uuid not null references public.profiles(id) on delete cascade,
  source            text not null check (source in ('meta', 'google_ads', 'ga4')),
  day               date not null,
  spend             numeric(14, 2) not null default 0,
  impressions       bigint not null default 0,
  reach             bigint not null default 0,
  clicks            bigint not null default 0,
  leads             numeric(14, 2) not null default 0,
  purchases         numeric(14, 2) not null default 0,
  conversions       numeric(14, 2) not null default 0,
  conversion_value  numeric(14, 2) not null default 0,
  sessions          bigint not null default 0,
  users             bigint not null default 0,
  pageviews         bigint not null default 0,
  raw               jsonb,
  synced_at         timestamptz not null default now(),
  primary key (client_id, source, day)
);
create index if not exists cmd_client_day_idx on public.campaign_metrics_daily (client_id, day desc);
alter table public.campaign_metrics_daily enable row level security;

drop policy if exists cmd_select on public.campaign_metrics_daily;
create policy cmd_select on public.campaign_metrics_daily for select to authenticated
  using (client_id = (select auth.uid()) or public.my_level() >= 2);
-- escrita: só pela função do servidor (chave de serviço)

-- Registro das sincronizações
create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text not null default 'manual',
  ok          boolean,
  summary     jsonb
);
alter table public.sync_runs enable row level security;
drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (public.my_level() >= 4);

-- ---------------------------------------------------------------------
-- Relatórios gerados pelo portal (além dos enviados como arquivo/link)
-- ---------------------------------------------------------------------
alter table public.reports add column if not exists kind text not null default 'arquivo';
alter table public.reports add column if not exists status text not null default 'publicado';
alter table public.reports add column if not exists period_month date;
alter table public.reports add column if not exists data jsonb;
alter table public.reports add column if not exists comment text;
alter table public.reports add column if not exists emailed_at timestamptz;

alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check check (kind in ('arquivo', 'gerado'));
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('rascunho', 'publicado'));
alter table public.reports drop constraint if exists reports_file_or_link;
alter table public.reports add constraint reports_file_or_link
  check ((storage_path is not null) or (url is not null and url ~* '^https?://') or kind = 'gerado');

create unique index if not exists reports_one_generated_per_month
  on public.reports (client_id, period_month) where kind = 'gerado';

-- Cliente só vê relatórios publicados; equipe vê rascunhos também.
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using ((client_id = (select auth.uid()) and status = 'publicado') or public.my_level() >= 2);

-- ---------------------------------------------------------------------
-- Agendamentos (sincronização diária e rascunhos mensais)
-- A função confere este segredo para aceitar chamadas do agendador.
-- ---------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

insert into public.integration_secrets (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

create or replace function public.call_edge_function(fn text, body jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare secret text;
begin
  select value into secret from public.integration_secrets where key = 'cron_secret';
  perform net.http_post(
    url := 'https://luoxfwuhcqlhwsxoxykf.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := body,
    timeout_milliseconds := 120000
  );
end $$;
revoke execute on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('sincronizar-marketing');
exception when others then null; end $$;
do $$ begin
  perform cron.unschedule('rascunhos-relatorio-mensal');
exception when others then null; end $$;

-- Todo dia às 06:10 (Fortaleza) = 09:10 UTC
select cron.schedule('sincronizar-marketing', '10 9 * * *',
  $$select public.call_edge_function('marketing-sync', '{"trigger":"agendado","days":7}'::jsonb)$$);
-- Dia 1 de cada mês às 08:20 (Fortaleza) = 11:20 UTC: rascunhos do mês anterior
select cron.schedule('rascunhos-relatorio-mensal', '20 11 1 * *',
  $$select public.call_edge_function('relatorio-mensal', '{"action":"rascunhos_do_mes"}'::jsonb)$$);
