-- =====================================================================
-- 0010 — Reportes gerenciales (ADMIN y GERENTE)
-- Funciones de solo lectura con SECURITY INVOKER: el aislamiento por
-- empresa lo sigue aplicando RLS. Cada función valida además el rol.
-- =====================================================================

create or replace function public.assert_report_access()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede consultar reportes.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Ventas por periodo (fecha de creación del pedido; excluye cancelados)
-- ---------------------------------------------------------------------
create or replace function public.report_sales(
  p_from date,
  p_to date,
  p_service_type_id uuid default null,
  p_customer_id uuid default null,
  p_assigned_to uuid default null
)
returns table (
  id uuid, number text, order_date date, customer_name text, service_name text, title text,
  assignee_name text, status text, subtotal numeric, discount_total numeric, tax_amount numeric,
  total numeric, amount_paid numeric, balance numeric
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select o.id, o.number, o.created_at::date, c.full_name, st.name, o.title,
           pr.full_name, o.status, o.subtotal, o.discount_total, o.tax_amount,
           o.total, o.amount_paid, o.balance
      from public.orders o
      join public.customers c on c.id = o.customer_id
      join public.service_types st on st.id = o.service_type_id
      left join public.profiles pr on pr.id = o.assigned_to
     where o.status <> 'CANCELADO'
       and o.created_at::date between p_from and p_to
       and (p_service_type_id is null or o.service_type_id = p_service_type_id)
       and (p_customer_id is null or o.customer_id = p_customer_id)
       and (p_assigned_to is null or o.assigned_to = p_assigned_to)
     order by o.created_at;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Cuentas por cobrar con antigüedad
-- La deuda se cuenta desde la entrega real; si no se entregó, desde la
-- fecha de entrega comprometida; si no tiene, desde la creación.
-- ---------------------------------------------------------------------
create or replace function public.report_receivables(p_customer_id uuid default null)
returns table (
  id uuid, number text, customer_name text, customer_phone text, title text, status text,
  due_date date, delivered_at timestamptz, reference_date date, total numeric, amount_paid numeric,
  balance numeric, days_old integer, bucket text
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select x.id, x.number, x.customer_name, x.customer_phone, x.title, x.status, x.due_date, x.delivered_at,
           x.reference_date, x.total, x.amount_paid, x.balance, x.days_old,
           case when x.days_old < 0 then 'POR_VENCER'
                when x.days_old <= 30 then '0_30'
                when x.days_old <= 60 then '31_60'
                when x.days_old <= 90 then '61_90'
                else 'MAS_90' end
      from (
        select o.id, o.number, c.full_name as customer_name, coalesce(c.whatsapp, c.phone) as customer_phone,
               o.title, o.status, o.due_date, o.delivered_at,
               coalesce(o.delivered_at::date, o.due_date, o.created_at::date) as reference_date,
               o.total, o.amount_paid, o.balance,
               (current_date - coalesce(o.delivered_at::date, o.due_date, o.created_at::date))::integer as days_old
          from public.orders o
          join public.customers c on c.id = o.customer_id
         where o.status <> 'CANCELADO'
           and o.balance > 0
           and (p_customer_id is null or o.customer_id = p_customer_id)
      ) x
     order by x.days_old desc;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Cobranza / caja
-- ---------------------------------------------------------------------
create or replace function public.report_collections(
  p_from date,
  p_to date,
  p_method text default null,
  p_include_voided boolean default false
)
returns table (
  id uuid, payment_date date, order_id uuid, order_number text, customer_name text, method text,
  reference text, is_advance boolean, amount numeric, voided boolean, void_reason text,
  voided_by_name text, created_by_name text
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select p.id, p.payment_date, o.id, o.number, c.full_name, p.method, p.reference, p.is_advance,
           p.amount, p.voided, p.void_reason, vb.full_name, cb.full_name
      from public.payments p
      join public.orders o on o.id = p.order_id
      join public.customers c on c.id = o.customer_id
      left join public.profiles vb on vb.id = p.voided_by
      left join public.profiles cb on cb.id = p.created_by
     where p.payment_date between p_from and p_to
       and (p_method is null or p.method = p_method)
       and (p_include_voided or not p.voided)
     order by p.payment_date, p.created_at;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Pedidos atrasados y por entregar (activos con entrega hasta hoy + N días)
-- ---------------------------------------------------------------------
create or replace function public.report_order_deadlines(
  p_days_ahead integer default 7,
  p_assigned_to uuid default null
)
returns table (
  id uuid, number text, customer_name text, customer_phone text, title text, status text,
  priority text, current_stage_name text, progress integer, assignee_name text, due_date date,
  days_left integer, balance numeric
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select o.id, o.number, c.full_name, coalesce(c.whatsapp, c.phone), o.title, o.status, o.priority,
           o.current_stage_name, o.progress, pr.full_name, o.due_date,
           (o.due_date - current_date)::integer, o.balance
      from public.orders o
      join public.customers c on c.id = o.customer_id
      left join public.profiles pr on pr.id = o.assigned_to
     where o.status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')
       and o.due_date is not null
       and o.due_date <= current_date + greatest(coalesce(p_days_ahead, 7), 0)
       and (p_assigned_to is null or o.assigned_to = p_assigned_to)
     order by o.due_date,
              case o.priority when 'URGENTE' then 1 when 'ALTA' then 2 when 'MEDIA' then 3 else 4 end;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Stock valorizado
-- ---------------------------------------------------------------------
create or replace function public.report_stock(p_type text default null, p_include_inactive boolean default false)
returns table (
  id uuid, name text, type text, purity text, unit text, stock numeric, min_stock numeric,
  reference_cost numeric, stock_value numeric, below_min boolean, active boolean
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select m.id, m.name, m.type, m.purity, m.unit, m.stock, m.min_stock, m.reference_cost,
           round(m.stock * m.reference_cost, 2), (m.active and m.stock <= m.min_stock), m.active
      from public.materials m
     where (p_type is null or m.type = p_type)
       and (p_include_inactive or m.active)
     order by m.type, m.name;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Material de clientes en custodia (saldo pendiente por pedido)
-- ---------------------------------------------------------------------
create or replace function public.report_client_custody(p_customer_id uuid default null)
returns table (
  order_id uuid, order_number text, order_status text, customer_name text, customer_phone text,
  material_name text, purity text, unit text, received numeric, used numeric, returned numeric,
  balance numeric, last_movement date
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select o.id, o.number, o.status, c.full_name, coalesce(c.whatsapp, c.phone),
           ocm.material_name, ocm.purity, ocm.unit, coalesce(ocm.received, 0), ocm.used, ocm.returned,
           ocm.balance,
           (select max(mm.movement_date) from public.material_movements mm
             where mm.order_id = ocm.order_id and mm.material_id = ocm.material_id and mm.ownership = 'CLIENTE')
      from public.order_client_materials ocm
      join public.orders o on o.id = ocm.order_id
      join public.customers c on c.id = o.customer_id
     where ocm.balance <> 0
       and (p_customer_id is null or o.customer_id = p_customer_id)
     order by c.full_name, o.number, ocm.material_name;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.assert_report_access() from public, anon;
revoke execute on function public.report_sales(date, date, uuid, uuid, uuid) from public, anon;
revoke execute on function public.report_receivables(uuid) from public, anon;
revoke execute on function public.report_collections(date, date, text, boolean) from public, anon;
revoke execute on function public.report_order_deadlines(integer, uuid) from public, anon;
revoke execute on function public.report_stock(text, boolean) from public, anon;
revoke execute on function public.report_client_custody(uuid) from public, anon;
grant execute on function public.assert_report_access() to authenticated;
grant execute on function public.report_sales(date, date, uuid, uuid, uuid) to authenticated;
grant execute on function public.report_receivables(uuid) to authenticated;
grant execute on function public.report_collections(date, date, text, boolean) to authenticated;
grant execute on function public.report_order_deadlines(integer, uuid) to authenticated;
grant execute on function public.report_stock(text, boolean) to authenticated;
grant execute on function public.report_client_custody(uuid) to authenticated;
