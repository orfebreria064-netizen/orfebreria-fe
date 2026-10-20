-- =====================================================================
-- 0015_estados_de_cuenta.sql
-- Correos automáticos al cierre del día (Edge Function daily-statements):
--   * Estado de cuenta al cliente que tuvo pagos, adelantos o anulaciones
--     ese día: movimientos del día y saldo de sus pedidos.
--   * Cierre de caja a los ADMIN y GERENTE: cobrado por método y moneda,
--     adelantos, anulaciones y pagos a joyeros.
-- Se activa por empresa (settings.daily_statements_enabled) a la hora
-- elegida (hora de Lima). pg_cron llama a la función cada hora en punto.
-- El cliente puede quedar fuera con customers.statement_email = false.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.settings
  add column daily_statements_enabled boolean not null default false,
  add column daily_statements_hour integer not null default 20
    check (daily_statements_hour between 0 and 23);

alter table public.customers
  add column statement_email boolean not null default true;

-- Registro de envíos (evita duplicados si la tarea se reintenta y queda como constancia)
create table public.statement_sends (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  kind            text not null check (kind in ('CLIENTE', 'CIERRE')),
  statement_date  date not null,
  customer_id     uuid references public.customers (id) on delete set null,
  recipients      text[] not null default '{}',
  status          text not null check (status in ('ENVIADO', 'ERROR')),
  detail          text,
  created_at      timestamptz not null default now()
);
create index statement_sends_org_idx on public.statement_sends (org_id, created_at desc);
create unique index statement_sends_once_uidx on public.statement_sends
  (org_id, kind, statement_date, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'ENVIADO';

alter table public.statement_sends enable row level security;
-- Escritura solo desde la Edge Function (service_role).
create policy statement_sends_select on public.statement_sends for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'));

-- ---------------------------------------------------------------------
-- Secreto compartido entre pg_cron y la Edge Function (Vault)
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'statements_cron_secret',
                           'Encabezado x-cron-secret de la Edge Function daily-statements')
 where not exists (select 1 from vault.secrets where name = 'statements_cron_secret');

create or replace function public.check_statements_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from vault.decrypted_secrets
                  where name = 'statements_cron_secret' and decrypted_secret = p_secret);
$$;

-- ---------------------------------------------------------------------
-- Datos para la Edge Function
-- ---------------------------------------------------------------------
-- Empresas a procesar ahora (hora de Lima). p_org fuerza una empresa (prueba manual).
create or replace function public.statement_orgs_due(p_org uuid default null)
returns table (org_id uuid, statement_date date)
language sql
stable
security definer
set search_path = public
as $$
  select s.org_id, (now() at time zone 'America/Lima')::date
    from public.settings s
   where case when p_org is not null then s.org_id = p_org
              else s.daily_statements_enabled
                   and s.daily_statements_hour = extract(hour from now() at time zone 'America/Lima')::integer
                   and public.org_access_state(s.org_id) not in ('SUSPENDED', 'CANCELLED') end;
$$;

-- Estados de cuenta pendientes de enviar y cierre de caja de una empresa en una fecha
create or replace function public.daily_statement_data(p_org uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with pays as (
    select p.*, o.number as order_number, o.title as order_title, o.customer_id
      from public.payments p
      join public.orders o on o.id = p.order_id
     where p.org_id = p_org
       and (p.payment_date = p_date
            or (p.voided and (p.voided_at at time zone 'America/Lima')::date = p_date))
  ),
  cust as (
    select c.id, c.full_name, c.email
      from public.customers c
     where c.id in (select customer_id from pays)
       and c.statement_email
       and nullif(trim(c.email), '') is not null
       and not exists (select 1 from public.statement_sends ss
                        where ss.org_id = p_org and ss.kind = 'CLIENTE' and ss.statement_date = p_date
                          and ss.customer_id = c.id and ss.status = 'ENVIADO')
  )
  select jsonb_build_object(
    'date', p_date,
    'company', (select jsonb_build_object('name', coalesce(st.company_name, o.name), 'tax_id', st.tax_id,
                                          'address', st.address, 'phone', st.phone, 'mobile', st.mobile,
                                          'email', st.email, 'logo', st.logo,
                                          -- Responder a: correo de la empresa o, si no tiene, el del primer ADMIN activo
                                          'reply_to', coalesce(nullif(trim(st.email), ''),
                                            (select pr.email from public.profiles pr
                                              where pr.org_id = p_org and pr.role = 'ADMIN' and pr.active
                                              order by pr.created_at limit 1)))
                  from public.organizations o left join public.settings st on st.org_id = o.id
                 where o.id = p_org),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'customer_id', c.id, 'name', c.full_name, 'email', trim(c.email),
               'movements', (select jsonb_agg(jsonb_build_object(
                                      'receipt_number', p.receipt_number, 'order_number', p.order_number,
                                      'order_title', p.order_title, 'payment_date', p.payment_date,
                                      'method', p.method, 'amount', p.amount, 'currency', p.currency,
                                      'is_advance', p.is_advance, 'voided', p.voided, 'void_reason', p.void_reason)
                                    order by p.created_at)
                               from pays p where p.customer_id = c.id),
               'orders', (select jsonb_agg(jsonb_build_object(
                                   'number', o.number, 'title', o.title, 'status', o.status, 'currency', o.currency,
                                   'total', o.total, 'amount_paid', o.amount_paid, 'balance', o.balance)
                                 order by o.created_at)
                            from public.orders o
                           where o.customer_id = c.id and o.status <> 'CANCELADO'
                             and (o.balance > 0 or o.id in (select order_id from pays)))))
        from cust c), '[]'::jsonb),
    'closing', case
      when exists (select 1 from public.statement_sends
                    where org_id = p_org and kind = 'CIERRE' and statement_date = p_date and status = 'ENVIADO')
        then null
      else jsonb_build_object(
        'recipients', (select coalesce(jsonb_agg(distinct pr.email), '[]'::jsonb) from public.profiles pr
                        where pr.org_id = p_org and pr.active and pr.role in ('ADMIN', 'GERENTE')
                          and nullif(trim(pr.email), '') is not null),
        'by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'currency', currency,
                                                                   'count', n, 'amount', amt)
                                                order by currency, method), '[]'::jsonb)
                        from (select method, currency, count(*) n, sum(amount) amt from public.payments
                               where org_id = p_org and payment_date = p_date and not voided
                               group by method, currency) x),
        'advances', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'count', n, 'amount', amt)),
                                     '[]'::jsonb)
                       from (select currency, count(*) n, sum(amount) amt from public.payments
                              where org_id = p_org and payment_date = p_date and not voided and is_advance
                              group by currency) x),
        'payments', (select coalesce(jsonb_agg(jsonb_build_object(
                                       'receipt_number', p.receipt_number, 'order_number', p.order_number,
                                       'customer', c.full_name, 'method', p.method, 'amount', p.amount,
                                       'currency', p.currency, 'is_advance', p.is_advance)
                                     order by p.created_at), '[]'::jsonb)
                       from pays p join public.customers c on c.id = p.customer_id
                      where not p.voided and p.payment_date = p_date),
        'voided', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'receipt_number', p.receipt_number, 'order_number', p.order_number,
                                     'amount', p.amount, 'currency', p.currency, 'reason', p.void_reason)),
                                   '[]'::jsonb)
                     from pays p where p.voided),
        'jeweler_payments', (select coalesce(jsonb_agg(jsonb_build_object(
                                               'number', jp.number, 'jeweler', j.full_name, 'order_number', o.number,
                                               'amount', jp.amount, 'currency', jp.currency, 'method', jp.method)
                                             order by jp.created_at), '[]'::jsonb)
                               from public.jeweler_payments jp
                               join public.jewelers j on j.id = jp.jeweler_id
                               join public.orders o on o.id = jp.order_id
                              where jp.org_id = p_org and jp.payment_date = p_date and not jp.voided))
    end);
$$;

revoke execute on function public.check_statements_secret(text) from public, anon, authenticated;
revoke execute on function public.statement_orgs_due(uuid) from public, anon, authenticated;
revoke execute on function public.daily_statement_data(uuid, date) from public, anon, authenticated;
grant execute on function public.check_statements_secret(text) to service_role;
grant execute on function public.statement_orgs_due(uuid) to service_role;
grant execute on function public.daily_statement_data(uuid, date) to service_role;

-- ---------------------------------------------------------------------
-- Tarea programada: cada hora en punto. La función decide qué empresas
-- toca procesar según su hora configurada.
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'estados-de-cuenta';
select cron.schedule('estados-de-cuenta', '0 * * * *', $cron$
  select net.http_post(
    url     := 'https://ynxnxdgzsykhobfujyio.supabase.co/functions/v1/daily-statements',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'statements_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
