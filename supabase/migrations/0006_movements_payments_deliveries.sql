-- =====================================================================
-- 0006_movements_payments_deliveries.sql
-- Movimientos de material, pagos, entregas y archivos adjuntos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Movimientos de material (inmutables: las correcciones se hacen con AJUSTE)
--   ownership = EMPRESA  -> afecta el stock de la empresa
--   ownership = CLIENTE  -> material entregado por el cliente para un pedido;
--                          no afecta stock, se controla su saldo por pedido
-- ---------------------------------------------------------------------
create table public.material_movements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null default public.current_org_id() references public.organizations (id),
  material_id     uuid not null references public.materials (id),
  order_id        uuid references public.orders (id),
  movement_type   text not null check (movement_type in ('ENTRADA', 'SALIDA', 'AJUSTE', 'CONSUMO', 'DEVOLUCION')),
  ownership       text not null default 'EMPRESA' check (ownership in ('EMPRESA', 'CLIENTE')),
  quantity        numeric(14, 3) not null check (quantity <> 0),
  unit_cost       numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  movement_date   date not null default current_date,
  notes           text,
  stock_after     numeric(14, 3),
  created_by      uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now(),
  constraint mm_positive_qty check (movement_type = 'AJUSTE' or quantity > 0),
  constraint mm_consumption_needs_order check (movement_type <> 'CONSUMO' or order_id is not null),
  constraint mm_client_needs_order check (ownership <> 'CLIENTE' or order_id is not null),
  constraint mm_client_types check (ownership <> 'CLIENTE' or movement_type in ('ENTRADA', 'CONSUMO', 'DEVOLUCION'))
);
create index mm_material_idx on public.material_movements (material_id, movement_date desc);
create index mm_order_idx on public.material_movements (order_id);

-- Saldo de material del cliente por pedido
create or replace view public.order_client_materials
with (security_invoker = true) as
select mm.order_id,
       mm.material_id,
       m.name  as material_name,
       m.purity,
       m.unit,
       sum(mm.quantity) filter (where mm.movement_type = 'ENTRADA')    as received,
       coalesce(sum(mm.quantity) filter (where mm.movement_type = 'CONSUMO'), 0)    as used,
       coalesce(sum(mm.quantity) filter (where mm.movement_type = 'DEVOLUCION'), 0) as returned,
       coalesce(sum(mm.quantity) filter (where mm.movement_type = 'ENTRADA'), 0)
         - coalesce(sum(mm.quantity) filter (where mm.movement_type in ('CONSUMO', 'DEVOLUCION')), 0) as balance
  from public.material_movements mm
  join public.materials m on m.id = mm.material_id
 where mm.ownership = 'CLIENTE'
 group by mm.order_id, mm.material_id, m.name, m.purity, m.unit;

create or replace function public.material_movements_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta    numeric;
  v_stock    numeric;
  v_name     text;
  v_unit     text;
  v_client_balance numeric;
begin
  if new.order_id is not null then
    perform public.assert_order_editable(new.order_id);
  end if;

  select stock, name, unit into v_stock, v_name, v_unit
    from public.materials where id = new.material_id for update;

  if new.ownership = 'EMPRESA' then
    v_delta := case new.movement_type
      when 'ENTRADA' then new.quantity
      when 'DEVOLUCION' then new.quantity
      when 'AJUSTE' then new.quantity
      else -new.quantity end;
    if v_stock + v_delta < 0 then
      raise exception 'Stock insuficiente de %: disponible % %, requerido % %.',
        v_name, trim(to_char(v_stock, 'FM999G990D000')), v_unit,
        trim(to_char(abs(v_delta), 'FM999G990D000')), v_unit;
    end if;
    perform set_config('app.stock_update', 'on', true);
    update public.materials set stock = v_stock + v_delta where id = new.material_id;
    perform set_config('app.stock_update', 'off', true);
    new.stock_after := v_stock + v_delta;
  else
    if new.movement_type in ('CONSUMO', 'DEVOLUCION') then
      select coalesce(balance, 0) into v_client_balance
        from public.order_client_materials
       where order_id = new.order_id and material_id = new.material_id;
      if coalesce(v_client_balance, 0) < new.quantity then
        raise exception 'El saldo de % entregado por el cliente es % %; no alcanza para %.',
          v_name, trim(to_char(coalesce(v_client_balance, 0), 'FM999G990D000')), v_unit,
          trim(to_char(new.quantity, 'FM999G990D000'));
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger material_movements_before_insert before insert on public.material_movements
  for each row execute function public.material_movements_before_insert();

create or replace function public.material_movements_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_unit text;
begin
  if new.order_id is not null then
    select name, unit into v_name, v_unit from public.materials where id = new.material_id;
    perform public.log_order_event(new.order_id, 'MATERIAL',
      public.current_user_name() || ' registró ' ||
      case new.movement_type
        when 'ENTRADA' then 'la recepción'
        when 'CONSUMO' then 'el consumo'
        when 'DEVOLUCION' then 'la devolución'
        when 'SALIDA' then 'la salida'
        else 'un ajuste' end ||
      ' de ' || trim(to_char(new.quantity, 'FM999G990D00')) || ' ' || v_unit || ' de ' || v_name ||
      case when new.ownership = 'CLIENTE' then ' (material del cliente)' else '' end || '.');
  end if;
  return null;
end;
$$;

create trigger material_movements_after_insert after insert on public.material_movements
  for each row execute function public.material_movements_after_insert();

-- Stock inicial al crear un material: se registra como movimiento de entrada
create or replace function public.materials_initial_stock_before()
returns trigger
language plpgsql
as $$
begin
  if new.stock > 0 then
    perform set_config('app.initial_stock', new.stock::text, true);
    new.stock := 0;
  else
    perform set_config('app.initial_stock', '', true);
  end if;
  return new;
end;
$$;

create or replace function public.materials_initial_stock_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initial text := current_setting('app.initial_stock', true);
begin
  if coalesce(v_initial, '') <> '' then
    perform set_config('app.initial_stock', '', true);
    insert into public.material_movements (org_id, material_id, movement_type, ownership, quantity, notes)
    values (new.org_id, new.id, 'ENTRADA', 'EMPRESA', v_initial::numeric, 'Stock inicial');
  end if;
  return null;
end;
$$;

create trigger materials_initial_stock_before before insert on public.materials
  for each row execute function public.materials_initial_stock_before();
create trigger materials_initial_stock_after after insert on public.materials
  for each row execute function public.materials_initial_stock_after();

-- ---------------------------------------------------------------------
-- Pagos (no se eliminan: se anulan)
-- ---------------------------------------------------------------------
create table public.payments (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null default public.current_org_id() references public.organizations (id),
  order_id                uuid not null references public.orders (id),
  payment_date            date not null default current_date,
  amount                  numeric(12, 2) not null check (amount > 0),
  method                  text not null check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'OTRO')),
  reference               text,
  notes                   text,
  is_advance              boolean not null default false,
  overpayment_confirmed   boolean not null default false,
  voided                  boolean not null default false,
  voided_at               timestamptz,
  voided_by               uuid references public.profiles (id),
  void_reason             text,
  created_by              uuid default auth.uid() references public.profiles (id),
  created_at              timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
create index payments_org_date_idx on public.payments (org_id, payment_date);

create or replace function public.payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_status  text;
begin
  perform public.assert_order_editable(new.order_id);

  if tg_op = 'INSERT' then
    select balance, status into v_balance, v_status from public.orders where id = new.order_id for update;
    if new.amount > v_balance and not new.overpayment_confirmed then
      raise exception 'El monto (%) supera el saldo pendiente (%). Confirme explícitamente el pago.',
        public.format_money(new.amount), public.format_money(v_balance);
    end if;
    new.voided := false;
  else
    if (new.order_id, new.amount, new.method, new.payment_date) is distinct from
       (old.order_id, old.amount, old.method, old.payment_date) then
      raise exception 'Un pago registrado no se puede modificar; anúlelo y registre uno nuevo.';
    end if;
    if old.voided and not new.voided then
      raise exception 'Un pago anulado no se puede reactivar.';
    end if;
    if new.voided and not old.voided then
      if length(trim(coalesce(new.void_reason, ''))) = 0 then
        raise exception 'Indique el motivo de la anulación.';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create trigger payments_before_write before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.payments_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text;
begin
  update public.orders o
     set amount_paid = coalesce((select sum(amount) from public.payments
                                  where order_id = new.order_id and not voided), 0)
   where o.id = new.order_id;

  select number into v_number from public.orders where id = new.order_id;
  if tg_op = 'INSERT' then
    perform public.log_order_event(new.order_id, 'PAGO',
      public.current_user_name() || ' registró ' ||
      case when new.is_advance then 'un adelanto' else 'un pago' end || ' de ' || public.format_money(new.amount) ||
      ' (' || initcap(lower(new.method)) || ') en ' || v_number || '.',
      null, new.amount::text);
  elsif new.voided and not old.voided then
    perform public.log_order_event(new.order_id, 'PAGO',
      public.current_user_name() || ' anuló un pago de ' || public.format_money(new.amount) ||
      ' en ' || v_number || '. Motivo: ' || new.void_reason || '.',
      new.amount::text, null);
  end if;
  return null;
end;
$$;

create trigger payments_after_write after insert or update on public.payments
  for each row execute function public.payments_after_write();

-- ---------------------------------------------------------------------
-- Entregas
-- ---------------------------------------------------------------------
create table public.deliveries (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default public.current_org_id() references public.organizations (id),
  number             text,
  order_id           uuid not null references public.orders (id),
  customer_id        uuid not null references public.customers (id),
  status             text not null default 'PENDIENTE' check (status in ('PENDIENTE', 'LISTA', 'ENTREGADA', 'NO_ENTREGADA')),
  scheduled_date     date not null default current_date,
  delivered_at       timestamptz,
  responsible_id     uuid references public.profiles (id),
  received_by        text,
  conformity         boolean,
  conformity_notes   text,
  signature_path     text,
  notes              text,
  created_by         uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, number)
);
create index deliveries_order_idx on public.deliveries (order_id);
create index deliveries_org_status_idx on public.deliveries (org_id, status, scheduled_date);

create or replace function public.deliveries_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = new.order_id;
  if v_order.status in ('CERRADO', 'CANCELADO') and not public.is_admin_or_system() then
    raise exception 'El pedido % está %; no admite entregas.', v_order.number, lower(public.order_status_label(v_order.status));
  end if;

  new.customer_id := v_order.customer_id;
  if tg_op = 'INSERT' then
    new.number := public.next_document_number(new.org_id, 'ENT');
  else
    new.number := old.number;
    if old.status = 'ENTREGADA' and new.status <> 'ENTREGADA' and not public.is_admin_or_system() then
      raise exception 'Una entrega realizada solo puede revertirla un administrador.';
    end if;
  end if;

  if new.status = 'ENTREGADA' then
    if not v_order.qc_approved then
      raise exception 'No se puede entregar: el control de calidad del pedido % no está aprobado.', v_order.number;
    end if;
    if new.conformity is null then
      raise exception 'Indique si el cliente dio su conformidad.';
    end if;
    new.delivered_at := coalesce(new.delivered_at, now());     -- regla 11: fecha real de entrega
  elsif new.status <> 'ENTREGADA' then
    new.delivered_at := null;
  end if;
  return new;
end;
$$;

create trigger deliveries_before_write before insert or update on public.deliveries
  for each row execute function public.deliveries_before_write();

create trigger deliveries_updated_at before update on public.deliveries
  for each row execute function public.set_updated_at();

create or replace function public.deliveries_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = new.order_id;

  if tg_op = 'INSERT' then
    perform public.log_order_event(new.order_id, 'ENTREGA',
      public.current_user_name() || ' programó la entrega ' || new.number || ' para el ' ||
      to_char(new.scheduled_date, 'DD/MM/YYYY') || '.');
  end if;

  if new.status = 'ENTREGADA' and (tg_op = 'INSERT' or old.status <> 'ENTREGADA') then
    perform public.log_order_event(new.order_id, 'ENTREGA',
      public.current_user_name() || ' registró la entrega ' || new.number || ' del pedido ' || v_order.number ||
      case when new.conformity then ' con conformidad del cliente' else ' SIN conformidad del cliente' end ||
      case when v_order.balance > 0 then '. Saldo pendiente: ' || public.format_money(v_order.balance) else '' end || '.');
    if v_order.status not in ('ENTREGADO', 'CERRADO') then
      update public.orders set status = 'ENTREGADO', delivered_at = new.delivered_at where id = new.order_id;
    end if;
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    perform public.log_order_event(new.order_id, 'ENTREGA',
      public.current_user_name() || ' cambió la entrega ' || new.number || ' a ' ||
      case new.status when 'PENDIENTE' then 'Pendiente' when 'LISTA' then 'Lista'
                      when 'NO_ENTREGADA' then 'No entregada' else new.status end || '.');
    if old.status = 'ENTREGADA' and v_order.status = 'ENTREGADO' then
      update public.orders set status = 'LISTO_ENTREGA', delivered_at = null where id = new.order_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger deliveries_after_write after insert or update on public.deliveries
  for each row execute function public.deliveries_after_write();

-- ---------------------------------------------------------------------
-- Archivos adjuntos (metadata; el archivo vive en Storage bucket "orders")
-- ---------------------------------------------------------------------
create table public.attachments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default public.current_org_id() references public.organizations (id),
  order_id       uuid not null references public.orders (id),
  category       text not null default 'FOTO' check (category in ('FOTO', 'DISENO', 'BOCETO', 'DOCUMENTO', 'EVIDENCIA')),
  file_name      text not null,
  storage_path   text not null unique,
  mime_type      text,
  size_bytes     bigint,
  description    text,
  uploaded_by    uuid default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references public.profiles (id)
);
create index attachments_order_idx on public.attachments (order_id) where deleted_at is null;

create or replace function public.attachments_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_order_event(new.order_id, 'ARCHIVO',
      public.current_user_name() || ' subió el archivo "' || new.file_name || '".');
  elsif new.deleted_at is not null and old.deleted_at is null then
    perform public.log_order_event(new.order_id, 'ARCHIVO',
      public.current_user_name() || ' eliminó el archivo "' || new.file_name || '".');
  end if;
  return null;
end;
$$;

create trigger attachments_after_write after insert or update on public.attachments
  for each row execute function public.attachments_after_write();

create or replace function public.attachments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_order_editable(new.order_id);
  if tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger attachments_before_write before insert or update on public.attachments
  for each row execute function public.attachments_before_write();
