-- =====================================================================
-- 0021_actas_recepcion_reparaciones.sql
--   * Origen del material del pedido: EMPRESA, CLIENTE o MIXTO.
--   * Acta de recepción (AR): constancia de lo que el cliente deja en la
--     empresa, con detalle (descripción, ley, cantidad, peso), estado en
--     que se recibe y firma.
--       - MATERIAL: materia prima del cliente para fabricar su joya. Cada
--         línea con material y peso genera la ENTRADA de material del
--         cliente del pedido (saldo en order_client_materials).
--       - REPARACION: pieza del cliente para reparar, con el daño
--         reportado, el peso de entrada y, al devolverla, el de salida.
--   * register_repair(): crea en un paso el pedido de tipo Reparación y su
--     acta.
-- =====================================================================

alter table public.document_sequences drop constraint document_sequences_doc_type_check;
alter table public.document_sequences
  add constraint document_sequences_doc_type_check
  check (doc_type in ('COT', 'PED', 'ENT', 'PRO', 'OP', 'RI', 'RE', 'GA', 'PR', 'AP', 'JY', 'PD', 'AR'));

alter table public.orders
  add column material_source text not null default 'EMPRESA' check (material_source in ('EMPRESA', 'CLIENTE', 'MIXTO'));

create table public.customer_receipts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  branch_id         uuid not null references public.branches (id),
  number            text not null,
  order_id          uuid not null references public.orders (id),
  customer_id       uuid not null references public.customers (id),
  kind              text not null check (kind in ('MATERIAL', 'REPARACION')),
  received_at       timestamptz not null default now(),
  delivered_by      text,               -- quien entrega, si no es el cliente
  delivered_by_doc  text,
  reported_issue    text,               -- daño o trabajo pedido (reparación)
  condition_notes   text,               -- estado en que se recibe: rayones, piedras faltantes...
  signature_path    text,
  returned_at       timestamptz,        -- devolución de la pieza o del sobrante
  returned_weight   numeric(10, 2) check (returned_weight is null or returned_weight > 0),
  return_notes      text,
  voided            boolean not null default false,
  voided_at         timestamptz,
  voided_by         uuid references public.profiles (id),
  void_reason       text,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  unique (org_id, number)
);
create index customer_receipts_order_idx on public.customer_receipts (order_id);
create index customer_receipts_org_idx on public.customer_receipts (org_id, kind, received_at desc);
create trigger aa_subscription_guard before insert or update or delete on public.customer_receipts
  for each row execute function public.enforce_org_writable();

create table public.customer_receipt_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  receipt_id   uuid not null references public.customer_receipts (id) on delete cascade,
  position     integer not null default 0,
  description  text not null check (length(trim(description)) > 0),
  material_id  uuid references public.materials (id),
  purity       text,
  quantity     integer not null default 1 check (quantity > 0),
  weight_g     numeric(10, 2) check (weight_g is null or weight_g > 0),
  carats       numeric(8, 3) check (carats is null or carats > 0),
  movement_id  uuid references public.material_movements (id)
);
create index customer_receipt_items_receipt_idx on public.customer_receipt_items (receipt_id, position);

-- Peso total de la pieza al recibirla (suma de las líneas)
create or replace function public.weight_in(public.customer_receipts)
returns numeric
language sql
stable
set search_path = public
as $$
  select sum(weight_g) from public.customer_receipt_items where receipt_id = $1.id;
$$;

-- ---------------------------------------------------------------------
-- Registrar un acta. p_data: {received_at, delivered_by, delivered_by_doc, reported_issue, condition_notes}
-- p_items: [{description, material_id, purity, quantity, weight_g, carats}]
-- ---------------------------------------------------------------------
create or replace function public.register_customer_receipt(p_order_id uuid, p_kind text, p_data jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_id      uuid := gen_random_uuid();
  v_number  text;
  o         public.orders%rowtype;
  it        record;
  v_unit    text;
  v_qty     numeric;
  v_mov     uuid;
  v_metal   boolean := false;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR') then
    raise exception 'No tiene permisos para registrar actas de recepción.';
  end if;
  if not public.can_view_order(p_order_id) then
    raise exception 'Pedido no encontrado o sin permisos.';
  end if;
  perform public.assert_order_editable(p_order_id);
  if p_kind not in ('MATERIAL', 'REPARACION') then
    raise exception 'Tipo de acta no válido.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Detalle al menos una pieza o material recibido.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where length(trim(coalesce(x ->> 'description', ''))) = 0) then
    raise exception 'Cada línea debe tener una descripción.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x
              where nullif(x ->> 'material_id', '') is not null
                and not exists (select 1 from public.materials m where m.id = (x ->> 'material_id')::uuid and m.org_id = v_org)) then
    raise exception 'Material no encontrado.';
  end if;

  select * into o from public.orders where id = p_order_id;
  v_number := public.next_document_number(v_org, 'AR');
  insert into public.customer_receipts (id, org_id, branch_id, number, order_id, customer_id, kind, received_at,
                                        delivered_by, delivered_by_doc, reported_issue, condition_notes, created_by)
  values (v_id, v_org, o.branch_id, v_number, p_order_id, o.customer_id, p_kind,
          coalesce(nullif(p_data ->> 'received_at', '')::timestamptz, now()),
          nullif(trim(p_data ->> 'delivered_by'), ''), nullif(trim(p_data ->> 'delivered_by_doc'), ''),
          nullif(trim(p_data ->> 'reported_issue'), ''), nullif(trim(p_data ->> 'condition_notes'), ''), auth.uid());

  for it in select x.item, x.ord from jsonb_array_elements(p_items) with ordinality as x(item, ord) loop
    v_mov := null;
    -- Materia prima del cliente: entra al saldo del cliente en el pedido (no al stock de la empresa)
    if p_kind = 'MATERIAL' and nullif(it.item ->> 'material_id', '') is not null then
      select unit into v_unit from public.materials where id = (it.item ->> 'material_id')::uuid;
      v_qty := case v_unit when 'g' then nullif(it.item ->> 'weight_g', '')::numeric
                           when 'ct' then nullif(it.item ->> 'carats', '')::numeric
                           else nullif(it.item ->> 'quantity', '')::numeric end;
      if coalesce(v_qty, 0) > 0 then
        insert into public.material_movements (org_id, material_id, branch_id, order_id, movement_type, ownership,
                                               quantity, notes, created_by)
        values (v_org, (it.item ->> 'material_id')::uuid, o.branch_id, p_order_id, 'ENTRADA', 'CLIENTE', v_qty,
                'Acta de recepción ' || v_number || ': ' || trim(it.item ->> 'description'), auth.uid())
        returning id into v_mov;
        v_metal := true;
      end if;
    end if;

    insert into public.customer_receipt_items (org_id, receipt_id, position, description, material_id, purity,
                                               quantity, weight_g, carats, movement_id)
    values (v_org, v_id, (it.ord - 1)::integer, trim(it.item ->> 'description'),
            nullif(it.item ->> 'material_id', '')::uuid, nullif(trim(it.item ->> 'purity'), ''),
            coalesce(nullif(it.item ->> 'quantity', '')::integer, 1), nullif(it.item ->> 'weight_g', '')::numeric,
            nullif(it.item ->> 'carats', '')::numeric, v_mov);
  end loop;

  if p_kind = 'MATERIAL' and o.material_source = 'EMPRESA' then
    update public.orders set material_source = 'CLIENTE' where id = p_order_id;
  end if;

  perform public.log_order_event(p_order_id, 'MATERIAL',
    public.current_user_name() || ' registró el acta de recepción ' || v_number ||
    case when p_kind = 'REPARACION' then ' (pieza para reparación)' else ' (material del cliente)' end || '.',
    null, v_number);
  return jsonb_build_object('id', v_id, 'number', v_number, 'material_entries', v_metal);
end;
$$;

-- Devolución de la pieza reparada o del sobrante del material: peso de salida y notas.
create or replace function public.return_customer_receipt(p_id uuid, p_returned_weight numeric, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  r     public.customer_receipts%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR') then
    raise exception 'No tiene permisos para registrar la devolución.';
  end if;
  select * into r from public.customer_receipts where id = p_id and org_id = v_org for update;
  if not found or r.voided then
    raise exception 'Acta no encontrada o anulada.';
  end if;
  if not public.can_view_order(r.order_id) then
    raise exception 'Pedido no encontrado o sin permisos.';
  end if;
  update public.customer_receipts
     set returned_at = now(), returned_weight = p_returned_weight, return_notes = nullif(trim(p_notes), '')
   where id = p_id;
  perform public.log_order_event(r.order_id, 'ENTREGA',
    public.current_user_name() || ' registró la devolución de lo recibido en el acta ' || r.number ||
    coalesce(' (peso de salida ' || trim(to_char(p_returned_weight, 'FM999G990D00')) || ' g)', '') || '.', null, r.number);
end;
$$;

create or replace function public.void_customer_receipt(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  r     public.customer_receipts%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede anular actas.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  select * into r from public.customer_receipts where id = p_id and org_id = v_org for update;
  if not found or r.voided then
    raise exception 'Acta no encontrada o ya anulada.';
  end if;
  if exists (select 1 from public.customer_receipt_items i where i.receipt_id = p_id and i.movement_id is not null) then
    raise exception 'El acta generó entradas de material del cliente: regularícelas con una devolución en Materiales antes de anularla.';
  end if;
  update public.customer_receipts
     set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_id;
  perform public.log_order_event(r.order_id, 'MATERIAL',
    public.current_user_name() || ' anuló el acta de recepción ' || r.number || '. Motivo: ' || trim(p_reason) || '.', null, r.number);
end;
$$;

-- Firma del cliente en el acta (archivo en el bucket del pedido)
create or replace function public.set_customer_receipt_signature(p_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid;
begin
  select order_id into v_order from public.customer_receipts where id = p_id and org_id = public.current_org_id();
  if v_order is null or not public.can_view_order(v_order) or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR') then
    raise exception 'Acta no encontrada o sin permisos.';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_order::text then
    raise exception 'Archivo de firma no válido.';
  end if;
  update public.customer_receipts set signature_path = p_path where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Reparación en un paso: pedido de tipo Reparación + acta de recepción
-- p_data: {customer_id, title, reported_issue, condition_notes, due_date, price, currency, branch_id,
--          delivered_by, delivered_by_doc}
-- p_items: líneas del acta (la pieza o piezas recibidas)
-- ---------------------------------------------------------------------
create or replace function public.register_repair(p_data jsonb, p_items jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_service  uuid;
  v_order    uuid;
  v_receipt  jsonb;
  v_title    text := coalesce(nullif(trim(p_data ->> 'title'), ''), 'Reparación');
  v_issue    text := nullif(trim(p_data ->> 'reported_issue'), '');
begin
  if nullif(p_data ->> 'customer_id', '') is null then
    raise exception 'Seleccione el cliente.';
  end if;
  if v_issue is null then
    raise exception 'Describa el trabajo o daño a reparar.';
  end if;
  select id into v_service from public.service_types
   where org_id = public.current_org_id() and code = 'REPARACION' and active
   order by position limit 1;
  if v_service is null then
    raise exception 'No existe el tipo de servicio «Reparación» activo. Créelo en Configuración.';
  end if;

  v_order := public.save_order(null,
    jsonb_build_object('customer_id', p_data ->> 'customer_id', 'service_type_id', v_service,
                       'branch_id', p_data ->> 'branch_id', 'title', v_title, 'description', v_issue,
                       'due_date', nullif(p_data ->> 'due_date', ''), 'currency', coalesce(nullif(p_data ->> 'currency', ''), 'PEN'),
                       'priority', 'MEDIA', 'tax_rate', coalesce(nullif(p_data ->> 'tax_rate', ''), '0')),
    jsonb_build_array(jsonb_build_object('description', 'Reparación: ' || v_title, 'detail', left(v_issue, 500),
                                         'quantity', 1, 'unit', 'servicio',
                                         'unit_price', coalesce(nullif(p_data ->> 'price', '')::numeric, 0))));

  v_receipt := public.register_customer_receipt(v_order, 'REPARACION', p_data, p_items);
  return jsonb_build_object('order_id', v_order,
                            'order_number', (select number from public.orders where id = v_order),
                            'receipt_id', v_receipt ->> 'id', 'receipt_number', v_receipt ->> 'number');
end;
$$;

-- ---------------------------------------------------------------------
-- RLS (escritura solo vía funciones)
-- ---------------------------------------------------------------------
alter table public.customer_receipts      enable row level security;
alter table public.customer_receipt_items enable row level security;

create policy customer_receipts_select on public.customer_receipts for select to authenticated
  using (org_id = public.current_org_id() and public.can_view_order(order_id));
create policy customer_receipt_items_select on public.customer_receipt_items for select to authenticated
  using (org_id = public.current_org_id()
         and exists (select 1 from public.customer_receipts r where r.id = receipt_id and public.can_view_order(r.order_id)));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.weight_in(public.customer_receipts)',
    'public.register_customer_receipt(uuid, text, jsonb, jsonb)',
    'public.return_customer_receipt(uuid, numeric, text)',
    'public.void_customer_receipt(uuid, text)',
    'public.set_customer_receipt_signature(uuid, text)',
    'public.register_repair(jsonb, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
