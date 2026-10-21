-- =====================================================================
-- 0017_estados_de_cuenta_brevo.sql
--   * Envío por Brevo: la API key y el remitente verificado se guardan en
--     Vault (brevo_api_key, mail_sender_email) y solo los lee la Edge
--     Function con service_role.
--   * El estado de cuenta incluye todo lo ocurrido desde el último estado
--     de cuenta enviado a ese cliente (o desde el inicio del día si nunca
--     recibió uno): ningún movimiento se pierde aunque ocurra después de la
--     hora de envío o si un día falló el correo.
--   * El cierre de caja sigue siendo por día (uno por fecha).
-- La API key NO va en este archivo: se carga en Vault con
--   select vault.create_secret('<api key>', 'brevo_api_key', '...');
-- =====================================================================

select vault.create_secret('orfebreria064@gmail.com', 'mail_sender_email',
                           'Remitente verificado en Brevo para correos transaccionales')
 where not exists (select 1 from vault.secrets where name = 'mail_sender_email');

-- Configuración de envío para la Edge Function (solo service_role)
create or replace function public.statement_mail_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'brevo_api_key', (select decrypted_secret from vault.decrypted_secrets where name = 'brevo_api_key'),
    'sender_email',  (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sender_email'));
$$;
revoke execute on function public.statement_mail_config() from public, anon, authenticated;
grant execute on function public.statement_mail_config() to service_role;

-- Varios estados de cuenta por cliente y fecha son válidos (p. ej. si cambia la hora de envío);
-- el control de duplicados lo da "desde el último enviado". El cierre de caja sigue siendo uno por día.
drop index if exists public.statement_sends_once_uidx;
create unique index statement_sends_closing_once_uidx on public.statement_sends (org_id, statement_date)
  where status = 'ENVIADO' and kind = 'CIERRE';

create or replace function public.daily_statement_data(p_org uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with last_sent as (
    select customer_id, max(created_at) as sent_at
      from public.statement_sends
     where org_id = p_org and kind = 'CLIENTE' and status = 'ENVIADO' and customer_id is not null
     group by customer_id
  ),
  -- Movimientos de cada cliente desde su último estado de cuenta (o desde el inicio de p_date en Lima)
  moves as (
    select p.*, o.number as order_number, o.title as order_title, o.customer_id
      from public.payments p
      join public.orders o on o.id = p.order_id
      left join last_sent ls on ls.customer_id = o.customer_id
     where p.org_id = p_org
       and (p.created_at > coalesce(ls.sent_at, p_date::timestamp at time zone 'America/Lima')
            or (p.voided and p.voided_at > coalesce(ls.sent_at, p_date::timestamp at time zone 'America/Lima')))
  ),
  -- Cierre de caja: movimientos del día p_date
  pays as (
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
     where c.id in (select customer_id from moves)
       and c.statement_email
       and nullif(trim(c.email), '') is not null
  )
  select jsonb_build_object(
    'date', p_date,
    'company', (select jsonb_build_object('name', coalesce(st.company_name, o.name), 'tax_id', st.tax_id,
                                          'address', st.address, 'phone', st.phone, 'mobile', st.mobile,
                                          'email', st.email, 'logo', st.logo,
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
                                      'receipt_number', m.receipt_number, 'order_number', m.order_number,
                                      'order_title', m.order_title, 'payment_date', m.payment_date,
                                      'method', m.method, 'amount', m.amount, 'currency', m.currency,
                                      'is_advance', m.is_advance, 'voided', m.voided, 'void_reason', m.void_reason)
                                    order by m.created_at)
                               from moves m where m.customer_id = c.id),
               'orders', (select jsonb_agg(jsonb_build_object(
                                   'number', o.number, 'title', o.title, 'status', o.status, 'currency', o.currency,
                                   'total', o.total, 'amount_paid', o.amount_paid, 'balance', o.balance)
                                 order by o.created_at)
                            from public.orders o
                           where o.customer_id = c.id and o.status <> 'CANCELADO'
                             and (o.balance > 0 or o.id in (select order_id from moves)))))
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
revoke execute on function public.daily_statement_data(uuid, date) from public, anon, authenticated;
grant execute on function public.daily_statement_data(uuid, date) to service_role;
