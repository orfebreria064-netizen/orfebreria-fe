-- =====================================================================
-- 0007_business_functions.sql
-- Funciones RPC de negocio y vistas de lectura.
-- Todas son SECURITY INVOKER: se ejecutan con los permisos (RLS) del
-- usuario que las llama.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Guardar cotización (cabecera + ítems) en una sola transacción
-- ---------------------------------------------------------------------
create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := p_id;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La cotización debe tener al menos un ítem.';
  end if;

  if v_id is null then
    insert into public.quotations (customer_id, service_type_id, issue_date, expiry_date, title, main_material,
                                   estimated_weight, stone, size, notes, terms, tax_rate)
    values ((p_header ->> 'customer_id')::uuid, (p_header ->> 'service_type_id')::uuid,
            coalesce((p_header ->> 'issue_date')::date, current_date),
            (p_header ->> 'expiry_date')::date,
            p_header ->> 'title', p_header ->> 'main_material',
            (p_header ->> 'estimated_weight')::numeric, p_header ->> 'stone', p_header ->> 'size',
            p_header ->> 'notes', p_header ->> 'terms',
            coalesce((p_header ->> 'tax_rate')::numeric, 18))
    returning id into v_id;
  else
    update public.quotations
       set customer_id = (p_header ->> 'customer_id')::uuid,
           service_type_id = (p_header ->> 'service_type_id')::uuid,
           issue_date = (p_header ->> 'issue_date')::date,
           expiry_date = (p_header ->> 'expiry_date')::date,
           title = p_header ->> 'title',
           main_material = p_header ->> 'main_material',
           estimated_weight = (p_header ->> 'estimated_weight')::numeric,
           stone = p_header ->> 'stone',
           size = p_header ->> 'size',
           notes = p_header ->> 'notes',
           terms = p_header ->> 'terms',
           tax_rate = coalesce((p_header ->> 'tax_rate')::numeric, tax_rate)
     where id = v_id;
    if not found then
      raise exception 'Cotización no encontrada o sin permisos.';
    end if;
    delete from public.quotation_items where quotation_id = v_id;
  end if;

  insert into public.quotation_items (quotation_id, position, description, detail, material_id, material_name,
                                      quantity, unit, unit_price, discount)
  select v_id, (i.ord - 1)::integer, i.item ->> 'description', i.item ->> 'detail',
         nullif(i.item ->> 'material_id', '')::uuid, i.item ->> 'material_name',
         (i.item ->> 'quantity')::numeric, coalesce(i.item ->> 'unit', 'und'),
         (i.item ->> 'unit_price')::numeric, coalesce((i.item ->> 'discount')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as i(item, ord);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Duplicar cotización (queda en Borrador con fechas nuevas)
-- ---------------------------------------------------------------------
create or replace function public.duplicate_quotation(p_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_new uuid;
  v_days integer;
begin
  select coalesce(s.quote_validity_days, 15) into v_days
    from public.settings s where s.org_id = public.current_org_id();

  insert into public.quotations (customer_id, service_type_id, issue_date, expiry_date, title, main_material,
                                 estimated_weight, stone, size, notes, terms, tax_rate)
  select customer_id, service_type_id, current_date, current_date + coalesce(v_days, 15), title, main_material,
         estimated_weight, stone, size, notes, terms, tax_rate
    from public.quotations where id = p_id
  returning id into v_new;

  if v_new is null then
    raise exception 'Cotización no encontrada o sin permisos.';
  end if;

  insert into public.quotation_items (quotation_id, position, description, detail, material_id, material_name,
                                      quantity, unit, unit_price, discount)
  select v_new, position, description, detail, material_id, material_name, quantity, unit, unit_price, discount
    from public.quotation_items where quotation_id = p_id;

  return v_new;
end;
$$;

-- Marca como vencidas las cotizaciones enviadas fuera de plazo
create or replace function public.expire_quotations()
returns integer
language sql
set search_path = public
as $$
  with upd as (
    update public.quotations set status = 'VENCIDA'
     where status = 'ENVIADA' and expiry_date < current_date
    returning 1
  )
  select count(*)::integer from upd;
$$;

-- ---------------------------------------------------------------------
-- Generar etapas de producción a partir de la plantilla
-- ---------------------------------------------------------------------
create or replace function public.create_order_stages(p_order_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if exists (select 1 from public.order_production_stages where order_id = p_order_id) then
    raise exception 'El pedido ya tiene etapas de producción.';
  end if;

  insert into public.order_production_stages (org_id, order_id, stage_id, name, position, is_quality_check)
  select o.org_id, o.id, ps.id, ps.name, ps.position, ps.is_quality_check
    from public.orders o
    join public.production_stages ps on ps.org_id = o.org_id and ps.active
   where o.id = p_order_id;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'Pedido no encontrado, sin permisos o sin etapas configuradas.';
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Convertir cotización aprobada en pedido (reglas 1 y 2)
-- ---------------------------------------------------------------------
create or replace function public.convert_quotation_to_order(
  p_quotation_id uuid,
  p_assigned_to uuid default null,
  p_due_date date default null,
  p_priority text default 'MEDIA',
  p_create_stages boolean default true)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  q public.quotations%rowtype;
  v_order_id uuid;
begin
  select * into q from public.quotations where id = p_quotation_id for update;
  if not found then
    raise exception 'Cotización no encontrada o sin permisos.';
  end if;
  if q.status <> 'APROBADA' then
    raise exception 'Solo una cotización aprobada puede convertirse en pedido.';
  end if;
  if q.order_id is not null then
    raise exception 'La cotización % ya fue convertida en pedido.', q.number;
  end if;

  insert into public.orders (org_id, customer_id, quotation_id, service_type_id, status, priority, title, description,
                             main_material, estimated_weight, stone, size, notes, assigned_to, start_date,
                             due_date, tax_rate)
  values (q.org_id, q.customer_id, q.id, q.service_type_id, 'APROBADO', coalesce(p_priority, 'MEDIA'), q.title,
          (select string_agg(description || coalesce(': ' || detail, ''), E'\n' order by position)
             from public.quotation_items where quotation_id = q.id),
          q.main_material, q.estimated_weight, q.stone, q.size, q.notes, p_assigned_to, current_date,
          p_due_date, q.tax_rate)
  returning id into v_order_id;

  insert into public.order_items (org_id, order_id, position, description, detail, material_id, material_name,
                                  quantity, unit, unit_price, discount)
  select org_id, v_order_id, position, description, detail, material_id, material_name,
         quantity, unit, unit_price, discount
    from public.quotation_items where quotation_id = q.id;

  update public.quotations set order_id = v_order_id where id = q.id;

  if p_create_stages then
    perform public.create_order_stages(v_order_id);
  end if;

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Guardar pedido directo (sin cotización): cabecera + ítems
-- ---------------------------------------------------------------------
create or replace function public.save_order(p_id uuid, p_header jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := p_id;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'El pedido debe tener al menos un ítem.';
  end if;

  if v_id is null then
    insert into public.orders (customer_id, service_type_id, priority, title, description, main_material,
                               estimated_weight, stone, size, notes, assigned_to, start_date, due_date, tax_rate)
    values ((p_header ->> 'customer_id')::uuid, (p_header ->> 'service_type_id')::uuid,
            coalesce(p_header ->> 'priority', 'MEDIA'), p_header ->> 'title', p_header ->> 'description',
            p_header ->> 'main_material', (p_header ->> 'estimated_weight')::numeric, p_header ->> 'stone',
            p_header ->> 'size', p_header ->> 'notes', nullif(p_header ->> 'assigned_to', '')::uuid,
            coalesce((p_header ->> 'start_date')::date, current_date), (p_header ->> 'due_date')::date,
            coalesce((p_header ->> 'tax_rate')::numeric, 18))
    returning id into v_id;
  else
    update public.orders
       set customer_id = (p_header ->> 'customer_id')::uuid,
           service_type_id = (p_header ->> 'service_type_id')::uuid,
           priority = coalesce(p_header ->> 'priority', priority),
           title = p_header ->> 'title',
           description = p_header ->> 'description',
           main_material = p_header ->> 'main_material',
           estimated_weight = (p_header ->> 'estimated_weight')::numeric,
           stone = p_header ->> 'stone',
           size = p_header ->> 'size',
           notes = p_header ->> 'notes',
           assigned_to = nullif(p_header ->> 'assigned_to', '')::uuid,
           start_date = coalesce((p_header ->> 'start_date')::date, start_date),
           due_date = (p_header ->> 'due_date')::date,
           tax_rate = coalesce((p_header ->> 'tax_rate')::numeric, tax_rate)
     where id = v_id;
    if not found then
      raise exception 'Pedido no encontrado o sin permisos.';
    end if;
    delete from public.order_items where order_id = v_id;
  end if;

  insert into public.order_items (order_id, position, description, detail, material_id, material_name,
                                  quantity, unit, unit_price, discount)
  select v_id, (i.ord - 1)::integer, i.item ->> 'description', i.item ->> 'detail',
         nullif(i.item ->> 'material_id', '')::uuid, i.item ->> 'material_name',
         (i.item ->> 'quantity')::numeric, coalesce(i.item ->> 'unit', 'und'),
         (i.item ->> 'unit_price')::numeric, coalesce((i.item ->> 'discount')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as i(item, ord);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Resumen 360° del cliente
-- ---------------------------------------------------------------------
create or replace view public.customer_stats
with (security_invoker = true) as
select c.id as customer_id,
       count(o.id) filter (where o.status <> 'CANCELADO')                         as orders_count,
       coalesce(sum(o.total) filter (where o.status <> 'CANCELADO'), 0)           as total_purchased,
       coalesce(sum(o.balance) filter (where o.status <> 'CANCELADO'), 0)         as balance,
       max(o.created_at)                                                          as last_order_at,
       greatest(max(o.updated_at),
                (select max(q.updated_at) from public.quotations q where q.customer_id = c.id),
                (select max(p.created_at) from public.payments p join public.orders po on po.id = p.order_id
                  where po.customer_id = c.id))                                   as last_interaction_at
  from public.customers c
  left join public.orders o on o.customer_id = c.id
 group by c.id;

-- ---------------------------------------------------------------------
-- Dashboard gerencial en una sola llamada
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard()
returns jsonb
language sql
stable
set search_path = public
as $$
  with active_orders as (
    select * from public.orders where status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')
  ),
  months as (
    select date_trunc('month', current_date) - (n || ' month')::interval as m
      from generate_series(0, 5) n
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'active_orders',       (select count(*) from active_orders),
      'in_production',       (select count(*) from active_orders where status in ('DISENO', 'PRODUCCION', 'CONTROL_CALIDAD')),
      'ready_to_deliver',    (select count(*) from active_orders where status = 'LISTO_ENTREGA'),
      'pending_quotations',  (select count(*) from public.quotations where status in ('BORRADOR', 'ENVIADA')),
      'sales_month',         (select coalesce(sum(total), 0) from public.orders
                               where status <> 'CANCELADO' and created_at >= date_trunc('month', current_date)),
      'collected_month',     (select coalesce(sum(amount), 0) from public.payments
                               where not voided and payment_date >= date_trunc('month', current_date)),
      'receivable',          (select coalesce(sum(balance), 0) from public.orders
                               where status <> 'CANCELADO' and balance > 0),
      'overdue_orders',      (select count(*) from active_orders where due_date < current_date and status <> 'PAUSADO')
    ),
    'orders_by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]')
                           from (select status, count(*) c from public.orders group by status) s),
    'sales_by_month', (select jsonb_agg(jsonb_build_object(
                          'month', to_char(m.m, 'YYYY-MM'),
                          'sales', (select coalesce(sum(total), 0) from public.orders
                                     where status <> 'CANCELADO' and date_trunc('month', created_at) = m.m),
                          'collected', (select coalesce(sum(amount), 0) from public.payments
                                         where not voided and date_trunc('month', payment_date) = m.m)) order by m.m)
                         from months m),
    'orders_by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', st.name, 'count', c) order by c desc), '[]')
                            from (select service_type_id, count(*) c from public.orders
                                   where status <> 'CANCELADO' group by service_type_id) s
                            join public.service_types st on st.id = s.service_type_id),
    'production_by_stage', (select coalesce(jsonb_agg(jsonb_build_object('stage', name, 'position', position, 'count', c) order by position), '[]')
                              from (select ops.name, min(ops.position) position, count(*) c
                                      from public.order_production_stages ops
                                      join active_orders o on o.id = ops.order_id
                                     where ops.is_current
                                     group by ops.name) s),
    'upcoming_deliveries', (select coalesce(jsonb_agg(row_to_json(u) order by u.due_date), '[]')
                              from (select o.id, o.number, c.full_name as customer_name, o.title, o.due_date,
                                           o.status, o.balance
                                      from active_orders o join public.customers c on c.id = o.customer_id
                                     where o.due_date is not null and o.status <> 'PAUSADO'
                                     order by o.due_date limit 10) u),
    'alerts', jsonb_build_object(
      'overdue', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.due_date
                      from active_orders o join public.customers c on c.id = o.customer_id
                     where o.due_date < current_date and o.status <> 'PAUSADO'
                     order by o.due_date limit 10) a),
      'pending_quotations', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select q.id, q.number, c.full_name as customer_name, q.expiry_date, q.total
                      from public.quotations q join public.customers c on c.id = q.customer_id
                     where q.status in ('BORRADOR', 'ENVIADA')
                     order by q.expiry_date limit 10) a),
      'pending_payments', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.balance
                      from public.orders o join public.customers c on c.id = o.customer_id
                     where o.status in ('LISTO_ENTREGA', 'ENTREGADO') and o.balance > 0
                     order by o.balance desc limit 10) a),
      'upcoming', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.due_date
                      from active_orders o join public.customers c on c.id = o.customer_id
                     where o.due_date between current_date and current_date + 7
                     order by o.due_date limit 10) a)
    )
  );
$$;
