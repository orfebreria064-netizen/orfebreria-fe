-- =====================================================================
-- 0012_taller_joyeros_precios.sql
-- Documentos comerciales, taller y joyeros (equivalente a la sección 1b y
-- 4.17 de database/mssql/orfebreria_mssql.sql):
--   * Moneda por documento (PEN / USD) en cotizaciones, pedidos y pagos.
--   * Peso en gramos por ítem (columna Gr. de los documentos).
--   * Marca de la empresa para los documentos: logo, eslogan, celular, ciudad.
--   * Proforma (PRO) y orden de producción (OP): un número por pedido,
--     asignado al emitirlo por primera vez.
--   * Recibo de ingreso (RI) por cada cobro y recibo de egreso (RE) por cada
--     pago a un joyero externo.
--   * Joyeros externos (no usan el sistema) y orden de producción del pedido:
--     joyero, material entregado, indicaciones y acabado (merma calculada).
--   * Precio de venta del día por material.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------
alter table public.settings
  add column logo    text,     -- data URL (PNG/JPEG)
  add column slogan  text,     -- una línea por viñeta
  add column mobile  text,     -- Cel. / RPC
  add column city    text;     -- "Lima, 16 de octubre del 2026"

alter table public.document_sequences drop constraint document_sequences_doc_type_check;
alter table public.document_sequences
  add constraint document_sequences_doc_type_check
  check (doc_type in ('COT', 'PED', 'ENT', 'PRO', 'OP', 'RI', 'RE'));

alter table public.quotations
  add column currency text not null default 'PEN' check (currency in ('PEN', 'USD'));
alter table public.orders
  add column currency text not null default 'PEN' check (currency in ('PEN', 'USD'));
alter table public.quotation_items
  add column weight numeric(10, 2) check (weight is null or weight > 0);
alter table public.order_items
  add column weight numeric(10, 2) check (weight is null or weight > 0);

-- Joyeros externos. Se les paga por pedido.
create table public.jewelers (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  full_name        text not null check (length(trim(full_name)) > 0),
  document_number  text check (document_number ~ '^[0-9]+$'),
  phone            text,
  specialty        text,
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index jewelers_org_idx on public.jewelers (org_id, active);
create unique index jewelers_document_uidx on public.jewelers (org_id, document_number) where document_number is not null;

create trigger jewelers_updated_at before update on public.jewelers
  for each row execute function public.set_updated_at();
create trigger aa_subscription_guard before insert or update or delete on public.jewelers
  for each row execute function public.enforce_org_writable();

-- Pedido: proforma, orden de producción y taller
alter table public.orders
  add column proforma_number          text,
  add column proforma_issued_at       timestamptz,
  add column production_number        text,
  add column production_issued_at     timestamptz,
  add column jeweler_id               uuid references public.jewelers (id),
  add column material_delivered_at    date,
  add column material_weight_out      numeric(10, 2) check (material_weight_out is null or material_weight_out > 0),
  add column production_instructions  text,
  add column product_delivered_at     date,
  add column weight_returned          numeric(10, 2) check (weight_returned is null or weight_returned > 0),
  add column production_notes         text;
alter table public.orders
  add column waste_weight numeric(10, 2) generated always as (material_weight_out - weight_returned) stored;   -- merma
create unique index orders_proforma_uidx on public.orders (org_id, proforma_number) where proforma_number is not null;
create unique index orders_production_uidx on public.orders (org_id, production_number) where production_number is not null;
create index orders_jeweler_idx on public.orders (jeweler_id) where jeweler_id is not null;

-- Pagos: moneda (la del pedido), recibo de ingreso, quién entrega el dinero y cheque
alter table public.payments
  add column currency        text not null default 'PEN' check (currency in ('PEN', 'USD')),
  add column receipt_number  text,
  add column received_from   text;
create unique index payments_receipt_uidx on public.payments (org_id, receipt_number) where receipt_number is not null;
alter table public.payments drop constraint payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO'));

-- Historial: emisión de documentos y pagos a joyeros
alter table public.order_history drop constraint order_history_event_type_check;
alter table public.order_history
  add constraint order_history_event_type_check
  check (event_type in ('CREACION', 'MODIFICACION', 'ESTADO', 'RESPONSABLE', 'PRODUCCION',
                        'PAGO', 'MATERIAL', 'ARCHIVO', 'ENTREGA', 'CIERRE', 'DOCUMENTO', 'EGRESO'));

-- Recibos de egreso: pagos a joyeros, siempre ligados a un pedido. No se eliminan: se anulan.
create table public.jeweler_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  branch_id     uuid not null references public.branches (id),
  number        text not null,
  jeweler_id    uuid not null references public.jewelers (id),
  order_id      uuid not null references public.orders (id),
  payment_date  date not null default current_date,
  amount        numeric(12, 2) not null check (amount > 0),
  currency      text not null default 'PEN' check (currency in ('PEN', 'USD')),
  method        text not null check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO')),
  reference     text,
  concept       text not null check (length(trim(concept)) > 0),
  voided        boolean not null default false,
  voided_at     timestamptz,
  voided_by     uuid references public.profiles (id),
  void_reason   text,
  created_by    uuid references public.profiles (id),     -- autorizado por
  created_at    timestamptz not null default now(),
  unique (org_id, number)
);
create index jp_jeweler_idx on public.jeweler_payments (jeweler_id, payment_date);
create index jp_order_idx on public.jeweler_payments (order_id);
create index jp_org_date_idx on public.jeweler_payments (org_id, payment_date);
create trigger aa_subscription_guard before insert or update or delete on public.jeweler_payments
  for each row execute function public.enforce_org_writable();

-- Precio de venta del día por material (S/ por unidad). Rige el último con fecha <= hoy.
create table public.material_prices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  material_id  uuid not null references public.materials (id) on delete cascade,
  price_date   date not null,
  price        numeric(12, 2) not null check (price > 0),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (material_id, price_date)
);
create index material_prices_org_idx on public.material_prices (org_id, price_date desc);
create trigger aa_subscription_guard before insert or update or delete on public.material_prices
  for each row execute function public.enforce_org_writable();

-- ---------------------------------------------------------------------
-- Formato de montos con moneda
-- ---------------------------------------------------------------------
create or replace function public.format_money(p_amount numeric, p_currency text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_currency = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_amount, 'FM999G999G990D00');
$$;

-- ---------------------------------------------------------------------
-- Pagos: moneda del pedido y recibo de ingreso (RI) en cada cobro
-- ---------------------------------------------------------------------
create or replace function public.payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance  numeric;
  v_status   text;
  v_currency text;
begin
  -- Asignar el número de recibo a un pago anterior a los recibos no es una modificación del pago
  if tg_op = 'UPDATE' and old.receipt_number is null and new.receipt_number is not null
     and (to_jsonb(new) - 'receipt_number') = (to_jsonb(old) - 'receipt_number') then
    return new;
  end if;

  perform public.assert_order_editable(new.order_id);

  if tg_op = 'INSERT' then
    select balance, status, currency into v_balance, v_status, v_currency
      from public.orders where id = new.order_id for update;
    new.currency := v_currency;
    if new.amount > v_balance and not new.overpayment_confirmed then
      raise exception 'El monto (%) supera el saldo pendiente (%). Confirme explícitamente el pago.',
        public.format_money(new.amount, v_currency), public.format_money(v_balance, v_currency);
    end if;
    new.voided := false;
    new.received_from := nullif(trim(new.received_from), '');
    new.receipt_number := public.next_document_number(new.org_id, 'RI');
  else
    if (new.order_id, new.amount, new.method, new.payment_date, new.currency) is distinct from
       (old.order_id, old.amount, old.method, old.payment_date, old.currency) then
      raise exception 'Un pago registrado no se puede modificar; anúlelo y registre uno nuevo.';
    end if;
    if old.receipt_number is not null and new.receipt_number is distinct from old.receipt_number then
      raise exception 'El número de recibo no se puede cambiar.';
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

create or replace function public.payments_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text;
begin
  if tg_op = 'UPDATE' and new.voided = old.voided then
    return null;      -- p. ej. asignación del número de recibo
  end if;

  update public.orders o
     set amount_paid = coalesce((select sum(amount) from public.payments
                                  where order_id = new.order_id and not voided), 0)
   where o.id = new.order_id;

  select number into v_number from public.orders where id = new.order_id;
  if tg_op = 'INSERT' then
    perform public.log_order_event(new.order_id, 'PAGO',
      public.current_user_name() || ' registró ' ||
      case when new.is_advance then 'un adelanto' else 'un pago' end || ' de ' ||
      public.format_money(new.amount, new.currency) ||
      ' (' || initcap(lower(new.method)) || ') en ' || v_number ||
      coalesce('. Recibo ' || new.receipt_number, '') || '.',
      null, new.amount::text);
  elsif new.voided and not old.voided then
    perform public.log_order_event(new.order_id, 'PAGO',
      public.current_user_name() || ' anuló un pago de ' || public.format_money(new.amount, new.currency) ||
      ' en ' || v_number || coalesce(' (recibo ' || new.receipt_number || ')', '') ||
      '. Motivo: ' || new.void_reason || '.',
      new.amount::text, null);
  end if;
  return null;
end;
$$;

-- Columnas calculadas para el recibo (PostgREST: select=*,balance_after,created_by_name)
-- Saldo del pedido después de este pago (0 o menos = este pago lo canceló).
create or replace function public.balance_after(p public.payments)
returns numeric
language sql
stable
set search_path = public
as $$
  select o.total - coalesce((
           select sum(x.amount) from public.payments x
            where x.order_id = p.order_id and not x.voided
              and (x.payment_date, x.created_at) <= (p.payment_date, p.created_at)), 0)
    from public.orders o where o.id = p.order_id;
$$;

create or replace function public.created_by_name(p public.payments)
returns text
language sql
stable
set search_path = public
as $$
  select full_name from public.profiles where id = p.created_by;
$$;

-- Recibo de ingreso de un pago (asigna número a los pagos anteriores a esta versión)
create or replace function public.issue_payment_receipt(p_payment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_order    uuid;
  v_receipt  text;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR') then
    raise exception 'No tiene permisos para emitir recibos.';
  end if;
  select order_id, receipt_number into v_order, v_receipt
    from public.payments where id = p_payment_id and org_id = v_org for update;
  if v_order is null or not public.can_view_order(v_order) then
    raise exception 'Pago no encontrado.';
  end if;
  if v_receipt is null then
    if not public.org_can_write(v_org) then
      raise exception 'El plan de su empresa está vencido: el sistema está en modo solo lectura. Regularice el pago para seguir registrando información.';
    end if;
    v_receipt := public.next_document_number(v_org, 'RI');
    update public.payments set receipt_number = v_receipt where id = p_payment_id;
  end if;
  return v_receipt;
end;
$$;

-- ---------------------------------------------------------------------
-- Cotizaciones y pedidos: moneda por documento y peso por ítem
-- ---------------------------------------------------------------------
create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_currency text := coalesce(nullif(p_header ->> 'currency', ''), 'PEN');
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La cotización debe tener al menos un ítem.';
  end if;
  if v_currency not in ('PEN', 'USD') then
    raise exception 'Moneda no válida.';
  end if;

  if v_id is null then
    insert into public.quotations (branch_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material,
                                   estimated_weight, stone, size, notes, terms, tax_rate, currency)
    values (nullif(p_header ->> 'branch_id', '')::uuid,
            (p_header ->> 'customer_id')::uuid, (p_header ->> 'service_type_id')::uuid,
            coalesce((p_header ->> 'issue_date')::date, current_date),
            (p_header ->> 'expiry_date')::date,
            p_header ->> 'title', p_header ->> 'main_material',
            (p_header ->> 'estimated_weight')::numeric, p_header ->> 'stone', p_header ->> 'size',
            p_header ->> 'notes', p_header ->> 'terms',
            coalesce((p_header ->> 'tax_rate')::numeric, 18), v_currency)
    returning id into v_id;
  else
    update public.quotations
       set branch_id = coalesce(nullif(p_header ->> 'branch_id', '')::uuid, branch_id),
           customer_id = (p_header ->> 'customer_id')::uuid,
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
           tax_rate = coalesce((p_header ->> 'tax_rate')::numeric, tax_rate),
           currency = v_currency
     where id = v_id;
    if not found then
      raise exception 'Cotización no encontrada o sin permisos.';
    end if;
    delete from public.quotation_items where quotation_id = v_id;
  end if;

  insert into public.quotation_items (quotation_id, position, description, detail, material_id, material_name,
                                      quantity, unit, weight, unit_price, discount)
  select v_id, (i.ord - 1)::integer, i.item ->> 'description', i.item ->> 'detail',
         nullif(i.item ->> 'material_id', '')::uuid, i.item ->> 'material_name',
         (i.item ->> 'quantity')::numeric, coalesce(i.item ->> 'unit', 'und'),
         nullif(i.item ->> 'weight', '')::numeric,
         (i.item ->> 'unit_price')::numeric, coalesce((i.item ->> 'discount')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as i(item, ord);

  return v_id;
end;
$$;

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

  insert into public.quotations (branch_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material,
                                 estimated_weight, stone, size, notes, terms, tax_rate, currency)
  select branch_id, customer_id, service_type_id, current_date, current_date + coalesce(v_days, 15), title, main_material,
         estimated_weight, stone, size, notes, terms, tax_rate, currency
    from public.quotations where id = p_id
  returning id into v_new;

  if v_new is null then
    raise exception 'Cotización no encontrada o sin permisos.';
  end if;

  insert into public.quotation_items (quotation_id, position, description, detail, material_id, material_name,
                                      quantity, unit, weight, unit_price, discount)
  select v_new, position, description, detail, material_id, material_name, quantity, unit, weight, unit_price, discount
    from public.quotation_items where quotation_id = p_id;

  return v_new;
end;
$$;

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

  insert into public.orders (org_id, branch_id, customer_id, quotation_id, service_type_id, status, priority, title,
                             description, main_material, estimated_weight, stone, size, notes, assigned_to,
                             start_date, due_date, tax_rate, currency)
  values (q.org_id, q.branch_id, q.customer_id, q.id, q.service_type_id, 'APROBADO', coalesce(p_priority, 'MEDIA'),
          q.title,
          (select string_agg(description || coalesce(': ' || detail, ''), E'\n' order by position)
             from public.quotation_items where quotation_id = q.id),
          q.main_material, q.estimated_weight, q.stone, q.size, q.notes, p_assigned_to, current_date,
          p_due_date, q.tax_rate, q.currency)
  returning id into v_order_id;

  insert into public.order_items (org_id, order_id, position, description, detail, material_id, material_name,
                                  quantity, unit, weight, unit_price, discount)
  select org_id, v_order_id, position, description, detail, material_id, material_name,
         quantity, unit, weight, unit_price, discount
    from public.quotation_items where quotation_id = q.id;

  update public.quotations set order_id = v_order_id where id = q.id;

  if p_create_stages then
    perform public.create_order_stages(v_order_id);
  end if;

  return v_order_id;
end;
$$;

create or replace function public.save_order(p_id uuid, p_header jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_currency text := coalesce(nullif(p_header ->> 'currency', ''), 'PEN');
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'El pedido debe tener al menos un ítem.';
  end if;
  if v_currency not in ('PEN', 'USD') then
    raise exception 'Moneda no válida.';
  end if;

  if v_id is null then
    insert into public.orders (branch_id, customer_id, service_type_id, priority, title, description, main_material,
                               estimated_weight, stone, size, notes, assigned_to, start_date, due_date, tax_rate, currency)
    values (nullif(p_header ->> 'branch_id', '')::uuid,
            (p_header ->> 'customer_id')::uuid, (p_header ->> 'service_type_id')::uuid,
            coalesce(p_header ->> 'priority', 'MEDIA'), p_header ->> 'title', p_header ->> 'description',
            p_header ->> 'main_material', (p_header ->> 'estimated_weight')::numeric, p_header ->> 'stone',
            p_header ->> 'size', p_header ->> 'notes', nullif(p_header ->> 'assigned_to', '')::uuid,
            coalesce((p_header ->> 'start_date')::date, current_date), (p_header ->> 'due_date')::date,
            coalesce((p_header ->> 'tax_rate')::numeric, 18), v_currency)
    returning id into v_id;
  else
    if exists (select 1 from public.orders where id = v_id and currency <> v_currency)
       and exists (select 1 from public.payments where order_id = v_id and not voided) then
      raise exception 'No se puede cambiar la moneda de un pedido con pagos registrados.';
    end if;
    update public.orders
       set branch_id = coalesce(nullif(p_header ->> 'branch_id', '')::uuid, branch_id),
           customer_id = (p_header ->> 'customer_id')::uuid,
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
           tax_rate = coalesce((p_header ->> 'tax_rate')::numeric, tax_rate),
           currency = v_currency
     where id = v_id;
    if not found then
      raise exception 'Pedido no encontrado o sin permisos.';
    end if;
    delete from public.order_items where order_id = v_id;
  end if;

  insert into public.order_items (order_id, position, description, detail, material_id, material_name,
                                  quantity, unit, weight, unit_price, discount)
  select v_id, (i.ord - 1)::integer, i.item ->> 'description', i.item ->> 'detail',
         nullif(i.item ->> 'material_id', '')::uuid, i.item ->> 'material_name',
         (i.item ->> 'quantity')::numeric, coalesce(i.item ->> 'unit', 'und'),
         nullif(i.item ->> 'weight', '')::numeric,
         (i.item ->> 'unit_price')::numeric, coalesce((i.item ->> 'discount')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as i(item, ord);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Proforma y orden de producción: un número por pedido; las reimpresiones lo reutilizan
-- ---------------------------------------------------------------------
create or replace function public.issue_order_document(p_order_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_number  text;
  v_order   text;
begin
  if p_doc_type not in ('PRO', 'OP') then
    raise exception 'Tipo de documento no válido.';
  end if;
  if v_org is null
     or (p_doc_type = 'PRO' and not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'))
     or (p_doc_type = 'OP' and not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')) then
    raise exception 'No tiene permisos para emitir este documento.';
  end if;
  if not public.can_view_order(p_order_id) then
    raise exception 'Pedido no encontrado o sin permisos.';
  end if;

  select number, case when p_doc_type = 'PRO' then proforma_number else production_number end
    into v_order, v_number
    from public.orders where id = p_order_id for update;

  if v_number is null then
    if not public.org_can_write(v_org) then
      raise exception 'El plan de su empresa está vencido: el sistema está en modo solo lectura. Regularice el pago para seguir registrando información.';
    end if;
    v_number := public.next_document_number(v_org, p_doc_type);
    if p_doc_type = 'PRO' then
      update public.orders set proforma_number = v_number, proforma_issued_at = now() where id = p_order_id;
    else
      update public.orders set production_number = v_number, production_issued_at = now() where id = p_order_id;
    end if;
    perform public.log_order_event(p_order_id, 'DOCUMENTO',
      public.current_user_name() || ' emitió ' ||
      case when p_doc_type = 'PRO' then 'la proforma ' else 'la orden de producción ' end ||
      v_number || ' del pedido ' || v_order || '.', null, v_number);
  end if;
  return v_number;
end;
$$;

-- ---------------------------------------------------------------------
-- Orden de producción (taller): joyero, material entregado, indicaciones y acabado
-- ---------------------------------------------------------------------
create or replace function public.save_order_production(
  p_order_id                 uuid,
  p_jeweler_id               uuid default null,
  p_material_delivered_at    date default null,
  p_material_weight_out      numeric default null,
  p_production_instructions  text default null,
  p_product_delivered_at     date default null,
  p_weight_returned          numeric default null,
  p_production_notes         text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  o           public.orders%rowtype;
  v_old_name  text;
  v_new_name  text;
  v_actor     text := public.current_user_name();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR') then
    raise exception 'No tiene permisos para registrar la orden de producción.';
  end if;
  if not public.can_view_order(p_order_id) then
    raise exception 'Pedido no encontrado o sin permisos.';
  end if;
  perform public.assert_order_editable(p_order_id);

  if p_jeweler_id is not null and not exists (select 1 from public.jewelers where id = p_jeweler_id and org_id = v_org) then
    raise exception 'El joyero indicado no existe.';
  end if;
  if coalesce(p_material_weight_out, 1) <= 0 or coalesce(p_weight_returned, 1) <= 0 then
    raise exception 'Los pesos deben ser mayores que cero.';
  end if;
  if p_weight_returned is not null and p_material_weight_out is null then
    raise exception 'Registre primero el peso del material entregado al joyero.';
  end if;
  if p_product_delivered_at is not null and p_material_delivered_at is not null
     and p_product_delivered_at < p_material_delivered_at then
    raise exception 'La fecha de entrega del producto no puede ser anterior a la entrega del material.';
  end if;

  select * into o from public.orders where id = p_order_id for update;

  update public.orders
     set jeweler_id = p_jeweler_id,
         material_delivered_at = p_material_delivered_at,
         material_weight_out = p_material_weight_out,
         production_instructions = nullif(trim(p_production_instructions), ''),
         product_delivered_at = p_product_delivered_at,
         weight_returned = p_weight_returned,
         production_notes = nullif(trim(p_production_notes), '')
   where id = p_order_id;

  if o.jeweler_id is distinct from p_jeweler_id then
    select full_name into v_old_name from public.jewelers where id = o.jeweler_id;
    select full_name into v_new_name from public.jewelers where id = p_jeweler_id;
    perform public.log_order_event(p_order_id, 'PRODUCCION',
      v_actor || ' asignó el pedido ' || o.number || ' al joyero ' || coalesce(v_new_name, '(sin joyero)') ||
      coalesce(' (antes: ' || v_old_name || ')', '') || '.', v_old_name, v_new_name);
  end if;
  if o.material_weight_out is distinct from p_material_weight_out and p_material_weight_out is not null then
    perform public.log_order_event(p_order_id, 'PRODUCCION',
      v_actor || ' registró ' || to_char(p_material_weight_out, 'FM999G990D00') || ' g de material entregado al taller.');
  end if;
  if o.weight_returned is distinct from p_weight_returned and p_weight_returned is not null then
    perform public.log_order_event(p_order_id, 'PRODUCCION',
      v_actor || ' registró ' || to_char(p_weight_returned, 'FM999G990D00') ||
      ' g en el producto entregado por el taller (merma ' ||
      to_char(p_material_weight_out - p_weight_returned, 'FM999G990D00') || ' g).');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Joyeros
-- ---------------------------------------------------------------------
create or replace function public.jewelers_list(p_include_inactive boolean default false)
returns table (
  id uuid, full_name text, document_number text, phone text, specialty text, notes text, active boolean,
  created_at timestamptz, updated_at timestamptz, active_orders integer, paid_pen numeric, paid_usd numeric
)
language sql
stable
set search_path = public
as $$
  select j.id, j.full_name, j.document_number, j.phone, j.specialty, j.notes, j.active, j.created_at, j.updated_at,
         (select count(*)::integer from public.orders o
           where o.jeweler_id = j.id and o.status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')),
         case when public.has_role('ADMIN', 'GERENTE') then
           (select coalesce(sum(amount), 0) from public.jeweler_payments
             where jeweler_id = j.id and not voided and currency = 'PEN') end,
         case when public.has_role('ADMIN', 'GERENTE') then
           (select coalesce(sum(amount), 0) from public.jeweler_payments
             where jeweler_id = j.id and not voided and currency = 'USD') end
    from public.jewelers j
   where j.org_id = public.current_org_id() and (p_include_inactive or j.active)
   order by j.active desc, j.full_name;
$$;

create or replace function public.save_jeweler(
  p_id               uuid,
  p_full_name        text,
  p_document_number  text default null,
  p_phone            text default null,
  p_specialty        text default null,
  p_notes            text default null,
  p_active           boolean default true)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_id    uuid := p_id;
  v_name  text := trim(coalesce(p_full_name, ''));
  v_doc   text := nullif(trim(p_document_number), '');
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR') then
    raise exception 'No tiene permisos para registrar joyeros.';
  end if;
  if length(v_name) = 0 then
    raise exception 'Indique el nombre del joyero.';
  end if;
  if v_doc is not null and v_doc !~ '^[0-9]+$' then
    raise exception 'El DNI solo debe contener números.';
  end if;
  if v_doc is not null and exists (select 1 from public.jewelers
                                    where org_id = v_org and document_number = v_doc and (v_id is null or id <> v_id)) then
    raise exception 'Ya existe un joyero con el DNI %.', v_doc;
  end if;

  if v_id is null then
    insert into public.jewelers (org_id, full_name, document_number, phone, specialty, notes, active)
    values (v_org, v_name, v_doc, nullif(trim(p_phone), ''), nullif(trim(p_specialty), ''),
            nullif(trim(p_notes), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.jewelers
       set full_name = v_name, document_number = v_doc, phone = nullif(trim(p_phone), ''),
           specialty = nullif(trim(p_specialty), ''), notes = nullif(trim(p_notes), ''),
           active = coalesce(p_active, active)
     where id = v_id and org_id = v_org;
    if not found then
      raise exception 'Joyero no encontrado.';
    end if;
  end if;
  return v_id;
end;
$$;

-- Recibo de egreso: pago a un joyero por un pedido (en la moneda del pedido)
create or replace function public.register_jeweler_payment(
  p_order_id      uuid,
  p_jeweler_id    uuid,
  p_amount        numeric,
  p_method        text,
  p_concept       text,
  p_payment_date  date default null,
  p_reference     text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_id       uuid := gen_random_uuid();
  v_number   text;
  v_jeweler  text;
  o          public.orders%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede registrar pagos a joyeros.';
  end if;
  if not public.can_view_order(p_order_id) then
    raise exception 'Pedido no encontrado o sin permisos.';
  end if;
  perform public.assert_order_editable(p_order_id);

  select full_name into v_jeweler from public.jewelers where id = p_jeweler_id and org_id = v_org;
  if v_jeweler is null then
    raise exception 'Seleccione un joyero válido.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if length(trim(coalesce(p_concept, ''))) = 0 then
    raise exception 'Indique el detalle del pago.';
  end if;
  if p_method not in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into o from public.orders where id = p_order_id;
  v_number := public.next_document_number(v_org, 'RE');
  insert into public.jeweler_payments (id, org_id, branch_id, number, jeweler_id, order_id, payment_date, amount, currency,
                                       method, reference, concept, created_by)
  values (v_id, v_org, o.branch_id, v_number, p_jeweler_id, p_order_id, coalesce(p_payment_date, current_date), p_amount,
          o.currency, p_method, nullif(trim(p_reference), ''), trim(p_concept), auth.uid());

  perform public.log_order_event(p_order_id, 'EGRESO',
    public.current_user_name() || ' pagó ' || public.format_money(p_amount, o.currency) || ' al joyero ' || v_jeweler ||
    ' por el pedido ' || o.number || '. Recibo ' || v_number || '.', null, p_amount::text);
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

create or replace function public.void_jeweler_payment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  jp     public.jeweler_payments%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede anular pagos a joyeros.';
  end if;
  select * into jp from public.jeweler_payments where id = p_id and org_id = v_org for update;
  if not found then
    raise exception 'Recibo no encontrado.';
  end if;
  if jp.voided then
    raise exception 'El recibo ya está anulado.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  perform public.assert_order_editable(jp.order_id);

  update public.jeweler_payments
     set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_id;

  perform public.log_order_event(jp.order_id, 'EGRESO',
    public.current_user_name() || ' anuló el recibo de egreso ' || jp.number || ' (' ||
    public.format_money(jp.amount, jp.currency) || ') del pedido ' ||
    (select number from public.orders where id = jp.order_id) || '. Motivo: ' || trim(p_reason) || '.',
    jp.amount::text, null);
end;
$$;

-- Pagos a joyeros (por joyero, pedido y periodo)
create or replace function public.jeweler_payments_list(
  p_jeweler_id      uuid default null,
  p_order_id        uuid default null,
  p_from            date default null,
  p_to              date default null,
  p_include_voided  boolean default false)
returns table (
  id uuid, number text, jeweler_id uuid, jeweler_name text, jeweler_document text,
  order_id uuid, order_number text, order_title text, customer_name text,
  payment_date date, amount numeric, currency text, method text, reference text, concept text,
  voided boolean, voided_at timestamptz, void_reason text, voided_by_name text,
  branch_id uuid, branch_name text, created_by_name text, created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select jp.id, jp.number, jp.jeweler_id, j.full_name, j.document_number,
         jp.order_id, o.number, o.title, c.full_name,
         jp.payment_date, jp.amount, jp.currency, jp.method, jp.reference, jp.concept,
         jp.voided, jp.voided_at, jp.void_reason, vb.full_name,
         jp.branch_id, b.name, cb.full_name, jp.created_at
    from public.jeweler_payments jp
    join public.jewelers j on j.id = jp.jeweler_id
    join public.orders o on o.id = jp.order_id
    join public.customers c on c.id = o.customer_id
    join public.branches b on b.id = jp.branch_id
    left join public.profiles vb on vb.id = jp.voided_by
    left join public.profiles cb on cb.id = jp.created_by
   where (p_jeweler_id is null or jp.jeweler_id = p_jeweler_id)
     and (p_order_id is null or jp.order_id = p_order_id)
     and (p_from is null or jp.payment_date >= p_from)
     and (p_to is null or jp.payment_date <= p_to)
     and (p_include_voided or not jp.voided)
   order by jp.payment_date desc, jp.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- Precios del día
-- ---------------------------------------------------------------------
-- Columnas calculadas del material (select=*,day_price,day_price_date)
create or replace function public.day_price(m public.materials)
returns numeric
language sql
stable
set search_path = public
as $$
  select price from public.material_prices
   where material_id = m.id and price_date <= current_date
   order by price_date desc limit 1;
$$;

create or replace function public.day_price_date(m public.materials)
returns date
language sql
stable
set search_path = public
as $$
  select price_date from public.material_prices
   where material_id = m.id and price_date <= current_date
   order by price_date desc limit 1;
$$;

-- Precio vigente de cada material activo, con el anterior para ver la variación
create or replace function public.material_prices_current()
returns table (
  material_id uuid, name text, type text, purity text, unit text, reference_cost numeric,
  price numeric, price_date date, previous_price numeric, previous_date date, updated_by text
)
language sql
stable
set search_path = public
as $$
  select m.id, m.name, m.type, m.purity, m.unit, m.reference_cost,
         dp.price, dp.price_date, prev.price, prev.price_date, pr.full_name
    from public.materials m
    left join lateral (
      select p.price, p.price_date, p.created_by from public.material_prices p
       where p.material_id = m.id and p.price_date <= current_date
       order by p.price_date desc limit 1) dp on true
    left join lateral (
      select p.price, p.price_date from public.material_prices p
       where p.material_id = m.id and p.price_date < dp.price_date
       order by p.price_date desc limit 1) prev on true
    left join public.profiles pr on pr.id = dp.created_by
   where m.org_id = public.current_org_id() and m.active
   order by case m.type when 'ORO' then 1 when 'PLATA' then 2 when 'PLATINO' then 3 else 4 end, m.name;
$$;

-- Registra (o corrige) los precios de una fecha. p_prices: [{"material_id": "...", "price": 285.5}, ...]
create or replace function public.save_material_prices(p_price_date date, p_prices jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_date  date := coalesce(p_price_date, current_date);
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede registrar precios.';
  end if;
  if v_date > current_date then
    raise exception 'No se pueden registrar precios con fecha futura.';
  end if;
  if jsonb_typeof(p_prices) <> 'array' then
    raise exception 'Lista de precios no válida.';
  end if;

  if not exists (select 1 from jsonb_array_elements(p_prices) x where x ->> 'price' is not null) then
    raise exception 'Indique al menos un precio.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_prices) x
              where x ->> 'price' is not null and (x ->> 'price')::numeric <= 0) then
    raise exception 'Los precios deben ser mayores que cero.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_prices) x
              where x ->> 'price' is not null
                and not exists (select 1 from public.materials m
                                 where m.id = nullif(x ->> 'material_id', '')::uuid and m.org_id = v_org)) then
    raise exception 'Material no encontrado.';
  end if;

  insert into public.material_prices (org_id, material_id, price_date, price, created_by)
  select v_org, (x ->> 'material_id')::uuid, v_date, (x ->> 'price')::numeric(12, 2), auth.uid()
    from jsonb_array_elements(p_prices) x
   where x ->> 'price' is not null
  on conflict (material_id, price_date)
  do update set price = excluded.price, created_by = excluded.created_by, updated_at = now();
end;
$$;

create or replace function public.material_price_history(p_material_id uuid, p_limit integer default 60)
returns table (price_date date, price numeric, updated_by text, updated_at timestamptz)
language sql
stable
set search_path = public
as $$
  select p.price_date, p.price, pr.full_name, p.updated_at
    from public.material_prices p
    left join public.profiles pr on pr.id = p.created_by
   where p.material_id = p_material_id and p.org_id = public.current_org_id()
   order by p.price_date desc
   limit coalesce(p_limit, 60);
$$;

-- ---------------------------------------------------------------------
-- Dashboard: montos en soles y, aparte, los de pedidos en dólares (*_usd)
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard(p_branch_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with orders_b as (
    select * from public.orders where p_branch_id is null or branch_id = p_branch_id
  ),
  active_orders as (
    select * from orders_b where status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')
  ),
  quotations_b as (
    select * from public.quotations where p_branch_id is null or branch_id = p_branch_id
  ),
  payments_b as (
    select * from public.payments where not voided and (p_branch_id is null or branch_id = p_branch_id)
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
      'pending_quotations',  (select count(*) from quotations_b where status in ('BORRADOR', 'ENVIADA')),
      'sales_month',         (select coalesce(sum(total), 0) from orders_b
                               where currency = 'PEN' and status <> 'CANCELADO' and created_at >= date_trunc('month', current_date)),
      'sales_month_usd',     (select coalesce(sum(total), 0) from orders_b
                               where currency = 'USD' and status <> 'CANCELADO' and created_at >= date_trunc('month', current_date)),
      'collected_month',     (select coalesce(sum(amount), 0) from payments_b
                               where currency = 'PEN' and payment_date >= date_trunc('month', current_date)),
      'collected_month_usd', (select coalesce(sum(amount), 0) from payments_b
                               where currency = 'USD' and payment_date >= date_trunc('month', current_date)),
      'receivable',          (select coalesce(sum(balance), 0) from orders_b
                               where currency = 'PEN' and status <> 'CANCELADO' and balance > 0),
      'receivable_usd',      (select coalesce(sum(balance), 0) from orders_b
                               where currency = 'USD' and status <> 'CANCELADO' and balance > 0),
      'overdue_orders',      (select count(*) from active_orders where due_date < current_date and status <> 'PAUSADO')
    ),
    'orders_by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]')
                           from (select status, count(*) c from orders_b group by status) s),
    'sales_by_month', (select jsonb_agg(jsonb_build_object(
                          'month', to_char(m.m, 'YYYY-MM'),
                          'sales', (select coalesce(sum(total), 0) from orders_b
                                     where currency = 'PEN' and status <> 'CANCELADO' and date_trunc('month', created_at) = m.m),
                          'collected', (select coalesce(sum(amount), 0) from payments_b
                                         where currency = 'PEN' and date_trunc('month', payment_date) = m.m)) order by m.m)
                         from months m),
    'orders_by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', st.name, 'count', c) order by c desc), '[]')
                            from (select service_type_id, count(*) c from orders_b
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
                                           o.status, o.balance, o.currency
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
                    select q.id, q.number, c.full_name as customer_name, q.expiry_date, q.total, q.currency
                      from quotations_b q join public.customers c on c.id = q.customer_id
                     where q.status in ('BORRADOR', 'ENVIADA')
                     order by q.expiry_date limit 10) a),
      'pending_payments', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.balance, o.currency
                      from orders_b o join public.customers c on c.id = o.customer_id
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

-- ---------------------------------------------------------------------
-- Reportes: moneda en cada fila y filtro opcional por moneda
-- ---------------------------------------------------------------------
drop function public.report_sales(date, date, uuid, uuid, uuid, uuid);
drop function public.report_receivables(uuid, uuid);
drop function public.report_collections(date, date, text, boolean, uuid);
drop function public.report_order_deadlines(integer, uuid, uuid);

create or replace function public.report_sales(
  p_from date,
  p_to date,
  p_service_type_id uuid default null,
  p_customer_id uuid default null,
  p_assigned_to uuid default null,
  p_branch_id uuid default null,
  p_currency text default null
)
returns table (
  id uuid, number text, order_date date, branch_name text, customer_name text, service_name text, title text,
  assignee_name text, status text, subtotal numeric, discount_total numeric, tax_amount numeric,
  total numeric, amount_paid numeric, balance numeric, currency text
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select o.id, o.number, o.created_at::date, b.name, c.full_name, st.name, o.title,
           pr.full_name, o.status, o.subtotal, o.discount_total, o.tax_amount,
           o.total, o.amount_paid, o.balance, o.currency
      from public.orders o
      join public.branches b on b.id = o.branch_id
      join public.customers c on c.id = o.customer_id
      join public.service_types st on st.id = o.service_type_id
      left join public.profiles pr on pr.id = o.assigned_to
     where o.status <> 'CANCELADO'
       and o.created_at::date between p_from and p_to
       and (p_service_type_id is null or o.service_type_id = p_service_type_id)
       and (p_customer_id is null or o.customer_id = p_customer_id)
       and (p_assigned_to is null or o.assigned_to = p_assigned_to)
       and (p_branch_id is null or o.branch_id = p_branch_id)
       and (p_currency is null or o.currency = p_currency)
     order by o.created_at;
end;
$$;

create or replace function public.report_receivables(
  p_customer_id uuid default null, p_branch_id uuid default null, p_currency text default null)
returns table (
  id uuid, number text, branch_name text, customer_name text, customer_phone text, title text, status text,
  due_date date, delivered_at timestamptz, reference_date date, total numeric, amount_paid numeric,
  balance numeric, currency text, days_old integer, bucket text
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select x.id, x.number, x.branch_name, x.customer_name, x.customer_phone, x.title, x.status, x.due_date,
           x.delivered_at, x.reference_date, x.total, x.amount_paid, x.balance, x.currency, x.days_old,
           case when x.days_old < 0 then 'POR_VENCER'
                when x.days_old <= 30 then '0_30'
                when x.days_old <= 60 then '31_60'
                when x.days_old <= 90 then '61_90'
                else 'MAS_90' end
      from (
        select o.id, o.number, b.name as branch_name, c.full_name as customer_name,
               coalesce(c.whatsapp, c.phone) as customer_phone,
               o.title, o.status, o.due_date, o.delivered_at,
               coalesce(o.delivered_at::date, o.due_date, o.created_at::date) as reference_date,
               o.total, o.amount_paid, o.balance, o.currency,
               (current_date - coalesce(o.delivered_at::date, o.due_date, o.created_at::date))::integer as days_old
          from public.orders o
          join public.branches b on b.id = o.branch_id
          join public.customers c on c.id = o.customer_id
         where o.status <> 'CANCELADO'
           and o.balance > 0
           and (p_customer_id is null or o.customer_id = p_customer_id)
           and (p_branch_id is null or o.branch_id = p_branch_id)
           and (p_currency is null or o.currency = p_currency)
      ) x
     order by x.days_old desc;
end;
$$;

create or replace function public.report_collections(
  p_from date,
  p_to date,
  p_method text default null,
  p_include_voided boolean default false,
  p_branch_id uuid default null,
  p_currency text default null
)
returns table (
  id uuid, payment_date date, branch_name text, order_id uuid, order_number text, receipt_number text,
  customer_name text, method text, reference text, is_advance boolean, amount numeric, currency text,
  voided boolean, void_reason text, voided_by_name text, created_by_name text
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select p.id, p.payment_date, b.name, o.id, o.number, p.receipt_number, c.full_name, p.method, p.reference,
           p.is_advance, p.amount, p.currency, p.voided, p.void_reason, vb.full_name, cb.full_name
      from public.payments p
      join public.branches b on b.id = p.branch_id
      join public.orders o on o.id = p.order_id
      join public.customers c on c.id = o.customer_id
      left join public.profiles vb on vb.id = p.voided_by
      left join public.profiles cb on cb.id = p.created_by
     where p.payment_date between p_from and p_to
       and (p_method is null or p.method = p_method)
       and (p_include_voided or not p.voided)
       and (p_branch_id is null or p.branch_id = p_branch_id)
       and (p_currency is null or p.currency = p_currency)
     order by p.payment_date, p.created_at;
end;
$$;

create or replace function public.report_order_deadlines(
  p_days_ahead integer default 7,
  p_assigned_to uuid default null,
  p_branch_id uuid default null
)
returns table (
  id uuid, number text, branch_name text, customer_name text, customer_phone text, title text, status text,
  priority text, current_stage_name text, progress integer, assignee_name text, due_date date,
  days_left integer, balance numeric, currency text
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_report_access();
  return query
    select o.id, o.number, b.name, c.full_name, coalesce(c.whatsapp, c.phone), o.title, o.status, o.priority,
           o.current_stage_name, o.progress, pr.full_name, o.due_date,
           (o.due_date - current_date)::integer, o.balance, o.currency
      from public.orders o
      join public.branches b on b.id = o.branch_id
      join public.customers c on c.id = o.customer_id
      left join public.profiles pr on pr.id = o.assigned_to
     where o.status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')
       and o.due_date is not null
       and o.due_date <= current_date + greatest(coalesce(p_days_ahead, 7), 0)
       and (p_assigned_to is null or o.assigned_to = p_assigned_to)
       and (p_branch_id is null or o.branch_id = p_branch_id)
     order by o.due_date,
              case o.priority when 'URGENTE' then 1 when 'ALTA' then 2 when 'MEDIA' then 3 else 4 end;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.jewelers          enable row level security;
alter table public.jeweler_payments  enable row level security;
alter table public.material_prices   enable row level security;

create policy jewelers_select on public.jewelers for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'));
create policy jewelers_insert on public.jewelers for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR'));
create policy jewelers_update on public.jewelers for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR'))
  with check (org_id = public.current_org_id());
-- Sin delete: los joyeros se desactivan.

-- Escritura solo vía register_jeweler_payment() y void_jeweler_payment().
create policy jeweler_payments_select on public.jeweler_payments for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE')
         and branch_id in (select public.current_branch_ids()));

-- Escritura solo vía save_material_prices().
create policy material_prices_select on public.material_prices for select to authenticated
  using (org_id = public.current_org_id());

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function public.payments_before_write() from public, anon, authenticated;
revoke execute on function public.payments_after_write() from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.format_money(numeric, text)',
    'public.balance_after(public.payments)',
    'public.created_by_name(public.payments)',
    'public.issue_payment_receipt(uuid)',
    'public.save_quotation(uuid, jsonb, jsonb)',
    'public.duplicate_quotation(uuid)',
    'public.convert_quotation_to_order(uuid, uuid, date, text, boolean)',
    'public.save_order(uuid, jsonb, jsonb)',
    'public.issue_order_document(uuid, text)',
    'public.save_order_production(uuid, uuid, date, numeric, text, date, numeric, text)',
    'public.jewelers_list(boolean)',
    'public.save_jeweler(uuid, text, text, text, text, text, boolean)',
    'public.register_jeweler_payment(uuid, uuid, numeric, text, text, date, text)',
    'public.void_jeweler_payment(uuid, text)',
    'public.jeweler_payments_list(uuid, uuid, date, date, boolean)',
    'public.day_price(public.materials)',
    'public.day_price_date(public.materials)',
    'public.material_prices_current()',
    'public.save_material_prices(date, jsonb)',
    'public.material_price_history(uuid, integer)',
    'public.get_dashboard(uuid)',
    'public.report_sales(date, date, uuid, uuid, uuid, uuid, text)',
    'public.report_receivables(uuid, uuid, text)',
    'public.report_collections(date, date, text, boolean, uuid, text)',
    'public.report_order_deadlines(integer, uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
