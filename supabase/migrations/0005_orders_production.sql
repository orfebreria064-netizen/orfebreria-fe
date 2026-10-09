-- =====================================================================
-- 0005_orders_production.sql
-- Pedidos / órdenes de trabajo, ítems, etapas de producción e historial.
-- =====================================================================

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null default public.current_org_id() references public.organizations (id),
  number               text,
  customer_id          uuid not null references public.customers (id),
  quotation_id         uuid references public.quotations (id),
  service_type_id      uuid not null references public.service_types (id),
  status               text not null default 'SOLICITUD'
                       check (status in ('SOLICITUD', 'COTIZADO', 'APROBADO', 'DISENO', 'PRODUCCION',
                                         'CONTROL_CALIDAD', 'LISTO_ENTREGA', 'ENTREGADO', 'CERRADO',
                                         'PAUSADO', 'CANCELADO')),
  priority             text not null default 'MEDIA' check (priority in ('BAJA', 'MEDIA', 'ALTA', 'URGENTE')),
  title                text not null check (length(trim(title)) > 0),
  description          text,
  main_material        text,
  estimated_weight     numeric(10, 2) check (estimated_weight is null or estimated_weight > 0),
  stone                text,
  size                 text,
  notes                text,
  assigned_to          uuid references public.profiles (id),
  start_date           date not null default current_date,
  due_date             date,
  delivered_at         timestamptz,
  closed_at            timestamptz,
  subtotal             numeric(12, 2) not null default 0,
  discount_total       numeric(12, 2) not null default 0,
  tax_rate             numeric(5, 2) not null default 18 check (tax_rate >= 0 and tax_rate <= 100),
  tax_amount           numeric(12, 2) not null default 0,
  total                numeric(12, 2) not null default 0,
  amount_paid          numeric(12, 2) not null default 0,
  balance              numeric(12, 2) generated always as (total - amount_paid) stored,
  payment_status       text generated always as (
                         case when amount_paid <= 0 then 'PENDIENTE'
                              when amount_paid >= total then 'PAGADO'
                              else 'PARCIAL' end
                       ) stored,
  progress             integer not null default 0 check (progress between 0 and 100),
  current_stage_name   text,
  qc_approved          boolean not null default false,
  qc_approved_at       timestamptz,
  qc_approved_by       uuid references public.profiles (id),
  created_by           uuid default auth.uid() references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, number),
  constraint orders_dates check (due_date is null or due_date >= start_date)
);
create index orders_org_status_idx on public.orders (org_id, status);
create index orders_customer_idx on public.orders (customer_id);
create index orders_assigned_idx on public.orders (assigned_to);
create index orders_due_idx on public.orders (org_id, due_date);
create unique index orders_quotation_uidx on public.orders (quotation_id) where quotation_id is not null;

alter table public.quotations
  add constraint quotations_order_fk foreign key (order_id) references public.orders (id);

create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default public.current_org_id() references public.organizations (id),
  order_id       uuid not null references public.orders (id) on delete cascade,
  position       integer not null default 0,
  description    text not null check (length(trim(description)) > 0),
  detail         text,
  material_id    uuid references public.materials (id),
  material_name  text,
  quantity       numeric(12, 3) not null check (quantity > 0),
  unit           text not null default 'und',
  unit_price     numeric(12, 2) not null check (unit_price >= 0),
  discount       numeric(12, 2) not null default 0 check (discount >= 0),
  subtotal       numeric(12, 2) generated always as (round(quantity * unit_price - discount, 2)) stored,
  constraint order_items_discount check (discount <= round(quantity * unit_price, 2))
);
create index order_items_order_idx on public.order_items (order_id, position);

create table public.order_production_stages (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default public.current_org_id() references public.organizations (id),
  order_id           uuid not null references public.orders (id) on delete cascade,
  stage_id           uuid references public.production_stages (id),
  name               text not null,
  position           integer not null,
  is_quality_check   boolean not null default false,
  assigned_to        uuid references public.profiles (id),
  status             text not null default 'PENDIENTE'
                     check (status in ('PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'BLOQUEADO')),
  is_current         boolean not null default false,
  started_at         timestamptz,
  completed_at       timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index ops_order_idx on public.order_production_stages (order_id, position);
create index ops_assigned_idx on public.order_production_stages (assigned_to);
-- Regla: solo una etapa actual por pedido
create unique index ops_one_current_uidx on public.order_production_stages (order_id) where is_current;

create table public.order_history (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id),
  order_id     uuid not null references public.orders (id) on delete cascade,
  event_type   text not null check (event_type in ('CREACION', 'MODIFICACION', 'ESTADO', 'RESPONSABLE', 'PRODUCCION',
                                                    'PAGO', 'MATERIAL', 'ARCHIVO', 'ENTREGA', 'CIERRE')),
  description  text not null,
  old_value    text,
  new_value    text,
  actor_id     uuid,
  actor_name   text not null,
  created_at   timestamptz not null default now()
);
create index order_history_order_idx on public.order_history (order_id, created_at desc);

-- ---------------------------------------------------------------------
-- Etiquetas en español (para mensajes de auditoría)
-- ---------------------------------------------------------------------
create or replace function public.order_status_label(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'SOLICITUD' then 'Solicitud'
    when 'COTIZADO' then 'Cotizado'
    when 'APROBADO' then 'Aprobado'
    when 'DISENO' then 'Diseño'
    when 'PRODUCCION' then 'Producción'
    when 'CONTROL_CALIDAD' then 'Control de calidad'
    when 'LISTO_ENTREGA' then 'Listo para entregar'
    when 'ENTREGADO' then 'Entregado'
    when 'CERRADO' then 'Cerrado'
    when 'PAUSADO' then 'Pausado'
    when 'CANCELADO' then 'Cancelado'
    else p_status end;
$$;

create or replace function public.stage_status_label(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'PENDIENTE' then 'Pendiente'
    when 'EN_PROCESO' then 'En proceso'
    when 'COMPLETADO' then 'Completado'
    when 'BLOQUEADO' then 'Bloqueado'
    else p_status end;
$$;

create or replace function public.format_money(p_amount numeric)
returns text
language sql
immutable
as $$
  select 'S/ ' || to_char(p_amount, 'FM999G999G990D00');
$$;

-- ---------------------------------------------------------------------
-- Auditoría: solo los triggers (SECURITY DEFINER) escriben el historial
-- ---------------------------------------------------------------------
create or replace function public.log_order_event(
  p_order_id uuid, p_event_type text, p_description text,
  p_old_value text default null, p_new_value text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.order_history (org_id, order_id, event_type, description, old_value, new_value, actor_id, actor_name)
  select o.org_id, o.id, p_event_type, p_description, p_old_value, p_new_value, auth.uid(), public.current_user_name()
    from public.orders o where o.id = p_order_id;
$$;
revoke execute on function public.log_order_event(uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Reglas del pedido (antes de escribir)
-- ---------------------------------------------------------------------
create or replace function public.orders_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_stages integer;
begin
  if tg_op = 'INSERT' then
    new.number := public.next_document_number(new.org_id, 'PED');
  else
    new.number := old.number;

    -- Regla 12: pedido cerrado/cancelado no se modifica sin permisos especiales
    if old.status in ('CERRADO', 'CANCELADO') and not public.is_admin_or_system() then
      raise exception 'El pedido % está %; solo un administrador puede modificarlo.',
        old.number, lower(public.order_status_label(old.status));
    end if;

    if new.status <> old.status then
      select count(*) into v_pending_stages
        from public.order_production_stages
       where order_id = new.id and status <> 'COMPLETADO';

      if new.status = 'LISTO_ENTREGA' then
        if v_pending_stages > 0 then
          raise exception 'No se puede pasar a "Listo para entregar": hay % etapa(s) de producción sin completar.', v_pending_stages;
        end if;
        new.qc_approved := true;
        new.qc_approved_at := coalesce(new.qc_approved_at, now());
        new.qc_approved_by := coalesce(new.qc_approved_by, auth.uid());
      end if;

      if new.status = 'ENTREGADO' then
        if not exists (select 1 from public.deliveries where order_id = new.id and status = 'ENTREGADA') then
          raise exception 'Para marcar el pedido como entregado registre primero la entrega.';
        end if;
        new.delivered_at := coalesce(new.delivered_at, now());
      end if;

      if new.status = 'CERRADO' then
        if v_pending_stages > 0 then
          raise exception 'No se puede cerrar: la producción no está completada.';
        end if;
        if not new.qc_approved then
          raise exception 'No se puede cerrar: el control de calidad no está aprobado.';
        end if;
        if not exists (select 1 from public.deliveries where order_id = new.id and status = 'ENTREGADA') then
          raise exception 'No se puede cerrar: no hay una entrega registrada.';
        end if;
        new.closed_at := now();
      elsif old.status = 'CERRADO' then
        new.closed_at := null;
      end if;
    end if;
  end if;

  new.tax_amount := round((new.subtotal - new.discount_total) * new.tax_rate / 100, 2);
  new.total := new.subtotal - new.discount_total + new.tax_amount;
  return new;
end;
$$;

create trigger orders_before_write before insert or update on public.orders
  for each row execute function public.orders_before_write();

create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Auditoría del pedido (después de escribir)
-- ---------------------------------------------------------------------
create or replace function public.orders_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   text := public.current_user_name();
  v_changes text[] := array[]::text[];
  v_old_name text;
  v_new_name text;
begin
  if tg_op = 'INSERT' then
    perform public.log_order_event(new.id, 'CREACION',
      v_actor || ' creó el pedido ' || new.number ||
      coalesce(' a partir de la cotización ' || (select number from public.quotations where id = new.quotation_id), '') || '.');
    return null;
  end if;

  if new.status <> old.status then
    perform public.log_order_event(new.id,
      case when new.status = 'CERRADO' then 'CIERRE' else 'ESTADO' end,
      v_actor || ' cambió el pedido ' || new.number || ' de ' || public.order_status_label(old.status) ||
      ' a ' || public.order_status_label(new.status) || '.',
      old.status, new.status);
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    select full_name into v_old_name from public.profiles where id = old.assigned_to;
    select full_name into v_new_name from public.profiles where id = new.assigned_to;
    perform public.log_order_event(new.id, 'RESPONSABLE',
      v_actor || ' asignó como responsable a ' || coalesce(v_new_name, '(sin responsable)') ||
      coalesce(' (antes: ' || v_old_name || ')', '') || '.',
      v_old_name, v_new_name);
  end if;

  if new.title is distinct from old.title then v_changes := array_append(v_changes, 'producto'::text); end if;
  if new.description is distinct from old.description then v_changes := array_append(v_changes, 'descripción'::text); end if;
  if new.customer_id is distinct from old.customer_id then v_changes := array_append(v_changes, 'cliente'::text); end if;
  if new.service_type_id is distinct from old.service_type_id then v_changes := array_append(v_changes, 'tipo de servicio'::text); end if;
  if new.priority is distinct from old.priority then v_changes := array_append(v_changes, 'prioridad'::text); end if;
  if new.start_date is distinct from old.start_date then v_changes := array_append(v_changes, 'fecha de inicio'::text); end if;
  if new.due_date is distinct from old.due_date then v_changes := array_append(v_changes, 'fecha de entrega'::text); end if;
  if (new.main_material, new.estimated_weight, new.stone, new.size)
     is distinct from (old.main_material, old.estimated_weight, old.stone, old.size) then
    v_changes := array_append(v_changes, 'especificaciones'::text);
  end if;
  if new.notes is distinct from old.notes then v_changes := array_append(v_changes, 'observaciones'::text); end if;
  if new.total is distinct from old.total and old.total <> 0 then
    v_changes := array_append(v_changes, ('total (' || public.format_money(old.total) || ' → ' || public.format_money(new.total) || ')')::text);
  end if;

  if array_length(v_changes, 1) > 0 then
    perform public.log_order_event(new.id, 'MODIFICACION',
      v_actor || ' modificó ' || array_to_string(v_changes, ', ') || ' del pedido ' || new.number || '.');
  end if;
  return null;
end;
$$;

create trigger orders_after_write after insert or update on public.orders
  for each row execute function public.orders_after_write();

-- ---------------------------------------------------------------------
-- Totales del pedido a partir de sus ítems
-- ---------------------------------------------------------------------
create or replace function public.recalc_order_totals(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders o
     set subtotal       = coalesce(t.gross, 0),
         discount_total = coalesce(t.disc, 0)
    from (select round(sum(quantity * unit_price), 2) as gross, sum(discount) as disc
            from public.order_items where order_id = p_order_id) t
   where o.id = p_order_id
     and (o.subtotal, o.discount_total) is distinct from (coalesce(t.gross, 0), coalesce(t.disc, 0));
$$;
revoke execute on function public.recalc_order_totals(uuid) from public, anon, authenticated;

create or replace function public.order_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_order_totals(coalesce(new.order_id, old.order_id));
  return null;
end;
$$;

create trigger order_items_after_write after insert or update or delete on public.order_items
  for each row execute function public.order_items_after_write();

-- Bloquea cambios en tablas hijas si el pedido está cerrado/cancelado
create or replace function public.assert_order_editable(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_number text;
begin
  select status, number into v_status, v_number from public.orders where id = p_order_id;
  if v_status in ('CERRADO', 'CANCELADO') and not public.is_admin_or_system() then
    raise exception 'El pedido % está %; solo un administrador puede modificarlo.',
      v_number, lower(public.order_status_label(v_status));
  end if;
end;
$$;

create or replace function public.order_child_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_order_editable(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

create trigger order_items_guard before insert or update or delete on public.order_items
  for each row execute function public.order_child_guard();

-- ---------------------------------------------------------------------
-- Producción: fechas por estado, etapa actual, avance y estado del pedido
-- ---------------------------------------------------------------------
create or replace function public.ops_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_order_editable(new.order_id);
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'EN_PROCESO' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := null;
    elsif new.status = 'COMPLETADO' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := coalesce(new.completed_at, now());
    elsif new.status = 'PENDIENTE' then
      new.started_at := null;
      new.completed_at := null;
    else
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger ops_before_write before insert or update on public.order_production_stages
  for each row execute function public.ops_before_write();

create trigger ops_updated_at before update on public.order_production_stages
  for each row execute function public.set_updated_at();

create or replace function public.sync_order_production(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total        integer;
  v_done         integer;
  v_started      integer;
  v_work_pending integer;
  v_current      public.order_production_stages%rowtype;
  v_order        public.orders%rowtype;
  v_new_status   text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return; end if;

  select count(*),
         count(*) filter (where status = 'COMPLETADO'),
         count(*) filter (where status in ('EN_PROCESO', 'COMPLETADO')),
         count(*) filter (where status <> 'COMPLETADO' and not is_quality_check)
    into v_total, v_done, v_started, v_work_pending
    from public.order_production_stages where order_id = p_order_id;

  select * into v_current from public.order_production_stages
   where order_id = p_order_id and status <> 'COMPLETADO'
   order by position, created_at limit 1;

  -- Regla 9: solo una etapa actual
  update public.order_production_stages
     set is_current = false
   where order_id = p_order_id and is_current and id is distinct from v_current.id;
  if v_current.id is not null then
    update public.order_production_stages set is_current = true
     where id = v_current.id and not is_current;
  end if;

  -- Estado del pedido derivado de la producción
  v_new_status := v_order.status;
  if v_order.status in ('APROBADO', 'DISENO', 'PRODUCCION', 'CONTROL_CALIDAD', 'LISTO_ENTREGA') and v_total > 0 then
    if v_done = v_total then
      v_new_status := 'LISTO_ENTREGA';                     -- todo completado (incluye control de calidad)
    elsif v_work_pending = 0 then
      v_new_status := 'CONTROL_CALIDAD';                   -- regla 10
    elsif v_started > 0 then
      v_new_status := case when v_current.position = (select min(position) from public.order_production_stages where order_id = p_order_id)
                                and v_current.name ilike 'dise%'
                           then 'DISENO' else 'PRODUCCION' end;
    end if;
  end if;

  update public.orders
     set progress = case when v_total = 0 then 0 else round(v_done * 100.0 / v_total)::integer end,
         current_stage_name = v_current.name,
         status = v_new_status,
         qc_approved = case when v_new_status = 'LISTO_ENTREGA' then true
                            when v_total > 0 and v_done < v_total then false
                            else qc_approved end,
         qc_approved_at = case when v_total > 0 and v_done < v_total then null else qc_approved_at end,
         qc_approved_by = case when v_total > 0 and v_done < v_total then null else qc_approved_by end
   where id = p_order_id
     and (progress, current_stage_name, status, qc_approved) is distinct from
         (case when v_total = 0 then 0 else round(v_done * 100.0 / v_total)::integer end,
          v_current.name, v_new_status,
          case when v_new_status = 'LISTO_ENTREGA' then true
               when v_total > 0 and v_done < v_total then false
               else v_order.qc_approved end);
end;
$$;
revoke execute on function public.sync_order_production(uuid) from public, anon, authenticated;

create or replace function public.ops_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text;
  v_assignee text;
begin
  if tg_op = 'UPDATE' then
    select number into v_number from public.orders where id = new.order_id;
    if new.status <> old.status then
      perform public.log_order_event(new.order_id, 'PRODUCCION',
        public.current_user_name() || ' marcó la etapa "' || new.name || '" de ' || v_number ||
        ' como ' || public.stage_status_label(new.status) || '.',
        old.status, new.status);
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      select full_name into v_assignee from public.profiles where id = new.assigned_to;
      perform public.log_order_event(new.order_id, 'PRODUCCION',
        public.current_user_name() || ' asignó la etapa "' || new.name || '" a ' || coalesce(v_assignee, '(nadie)') || '.');
    end if;
  elsif tg_op = 'DELETE' then
    perform public.log_order_event(old.order_id, 'PRODUCCION',
      public.current_user_name() || ' eliminó la etapa "' || old.name || '".');
  end if;

  perform public.sync_order_production(coalesce(new.order_id, old.order_id));
  return null;
end;
$$;

-- Se excluye is_current/updated_at para no re-disparar al sincronizar
create trigger ops_after_insert_delete after insert or delete on public.order_production_stages
  for each row execute function public.ops_after_write();
create trigger ops_after_update after update of status, position, assigned_to on public.order_production_stages
  for each row execute function public.ops_after_write();

create or replace function public.ops_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_order_editable(old.order_id);
  return old;
end;
$$;

create trigger ops_delete_guard before delete on public.order_production_stages
  for each row execute function public.ops_delete_guard();
