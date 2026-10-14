-- =====================================================================
-- 0011_branches.sql
-- Sucursales por empresa:
--   * Tabla branches; cada empresa tiene una sucursal principal (se crea
--     sola al crear la organización). Los datos existentes pasan a ella.
--   * Cotizaciones, pedidos, pagos, entregas y movimientos de material
--     llevan branch_id. Ítems, etapas, historial y adjuntos lo heredan
--     del pedido/cotización.
--   * Stock por sucursal (material_stock) y traslados entre sucursales.
--     materials.stock queda como total consolidado de la empresa.
--   * Visibilidad: ADMIN y GERENTE ven todas las sucursales; VENDEDOR y
--     SUPERVISOR solo las asignadas (user_branches); ORFEBRE sigue viendo
--     solo sus pedidos asignados, de cualquier sucursal.
--   * Límite de sucursales por plan (plans.max_branches, null = ilimitado).
--   * La numeración (COT/PED/ENT) sigue siendo única por empresa.
-- Clientes, catálogo de materiales, servicios y etapas siguen compartidos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Límite de sucursales por plan
-- ---------------------------------------------------------------------
alter table public.plans
  add column max_branches integer check (max_branches is null or max_branches > 0);

update public.plans set max_branches = 1 where code = 'BASICO';
update public.plans set max_branches = 3 where code = 'TALLER';
update public.plans set max_branches = null where code = 'EMPRESA';

-- ---------------------------------------------------------------------
-- Sucursales
-- ---------------------------------------------------------------------
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9]{2,6}$'),     -- abreviatura: LIM, AQP, MIRA...
  name        text not null check (length(trim(name)) > 0),
  address     text,
  phone       text,
  is_main     boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, name)
);
create index branches_org_idx on public.branches (org_id, active);
-- Regla: una sola sucursal principal por empresa
create unique index branches_one_main_uidx on public.branches (org_id) where is_main;

create trigger branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();

-- Sucursal principal para las empresas existentes (los datos actuales pasan a ella)
insert into public.branches (org_id, code, name, address, phone, is_main)
select o.id, 'PRI', 'Principal', s.address, s.phone, true
  from public.organizations o
  left join public.settings s on s.org_id = o.id;

-- Sucursal preferida del usuario (la usa la app como valor por defecto)
alter table public.profiles
  add column default_branch_id uuid references public.branches (id) on delete set null;

-- Sucursales asignadas a cada usuario. ADMIN y GERENTE ven todas sin asignación.
create table public.user_branches (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  branch_id   uuid not null references public.branches (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, branch_id)
);
create index user_branches_branch_idx on public.user_branches (branch_id);

-- Usuarios existentes: asignados a la sucursal principal de su empresa
insert into public.user_branches (org_id, user_id, branch_id)
select p.org_id, p.id, b.id
  from public.profiles p
  join public.branches b on b.org_id = p.org_id and b.is_main;

-- Sucursales con las que nace el usuario invitado (null = la principal)
alter table public.invitations add column branch_ids uuid[];

-- ---------------------------------------------------------------------
-- Funciones de acceso por sucursal (SECURITY DEFINER para evitar recursión RLS)
-- ---------------------------------------------------------------------

-- Sucursales visibles para el usuario actual (incluye inactivas, por el histórico).
-- En políticas usar `branch_id in (select public.current_branch_ids())`
-- para que se evalúe una sola vez por consulta.
create or replace function public.current_branch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
    from public.branches b
   where b.org_id = public.current_org_id()
     and (public.has_role('ADMIN', 'GERENTE')
          or exists (select 1 from public.user_branches ub
                      where ub.user_id = auth.uid() and ub.branch_id = b.id));
$$;

create or replace function public.has_branch_access(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.current_branch_ids() x where x = p_branch_id);
$$;

create or replace function public.main_branch_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.branches where org_id = p_org_id and is_main;
$$;

-- Sucursal por defecto para un registro nuevo: la preferida del usuario,
-- luego la primera asignada y, por último, la principal de la empresa.
create or replace function public.default_branch_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select b.id from public.profiles p
       join public.branches b on b.id = p.default_branch_id
      where p.id = auth.uid() and b.org_id = p_org_id and b.active),
    (select b.id from public.user_branches ub
       join public.branches b on b.id = ub.branch_id
      where ub.user_id = auth.uid() and b.org_id = p_org_id and b.active
      order by b.is_main desc, b.name limit 1),
    public.main_branch_id(p_org_id)
  );
$$;

create or replace function public.org_branch_limit(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select p.max_branches
    from public.subscriptions s join public.plans p on p.code = s.plan_code
   where s.org_id = p_org_id;
$$;

create or replace function public.org_branches_used(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.branches where org_id = p_org_id and active;
$$;

-- ---------------------------------------------------------------------
-- Reglas de sucursales
-- ---------------------------------------------------------------------
create or replace function public.branches_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_main_change boolean := coalesce(current_setting('app.branch_main_change', true), '') = 'on';
  v_limit integer;
begin
  new.code := upper(trim(new.code));
  new.name := trim(new.name);

  if tg_op = 'INSERT' then
    -- La primera sucursal de la empresa es la principal; las demás nunca nacen como principal.
    new.is_main := not exists (select 1 from public.branches where org_id = new.org_id and is_main);
  else
    if new.org_id <> old.org_id then
      raise exception 'Una sucursal no puede cambiar de empresa.';
    end if;
    if new.is_main is distinct from old.is_main and not v_main_change then
      raise exception 'Para cambiar la sucursal principal use la opción «Marcar como principal».';
    end if;
  end if;

  if new.is_main and not new.active then
    raise exception 'La sucursal principal no se puede desactivar.';
  end if;

  if tg_op = 'UPDATE' and old.active and not new.active then
    if exists (select 1 from public.material_stock where branch_id = new.id and stock > 0) then
      raise exception 'La sucursal % todavía tiene stock de materiales. Trasládelo antes de desactivarla.', new.name;
    end if;
    if exists (select 1 from public.orders where branch_id = new.id
                 and status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')) then
      raise exception 'La sucursal % tiene pedidos en curso. Termínelos o muévalos antes de desactivarla.', new.name;
    end if;
  end if;

  -- Límite del plan: sucursales activas
  if new.active and (tg_op = 'INSERT' or not old.active) then
    v_limit := public.org_branch_limit(new.org_id);
    if v_limit is not null and public.org_branches_used(new.org_id) >= v_limit then
      raise exception 'Su plan permite % sucursal(es) activa(s). Desactive una o mejore el plan.', v_limit;
    end if;
  end if;
  return new;
end;
$$;

-- El orden alfabético hace que corra después de aa_subscription_guard
create trigger branches_before_write before insert or update on public.branches
  for each row execute function public.branches_before_write();

-- Toda organización nueva nace con su sucursal principal. El nombre del
-- trigger es posterior a organizations_create_subscription a propósito:
-- la suscripción debe existir antes para el control de plan.
create or replace function public.create_org_main_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.branches (org_id, code, name, is_main)
  values (new.id, 'PRI', 'Principal', true);
  return new;
end;
$$;

create trigger organizations_main_branch
  after insert on public.organizations
  for each row execute function public.create_org_main_branch();

-- ---------------------------------------------------------------------
-- Stock por sucursal. materials.stock = suma de todas las sucursales.
-- Solo lo escriben los triggers de movimientos (sin políticas de escritura).
-- ---------------------------------------------------------------------
create table public.material_stock (
  org_id       uuid not null references public.organizations (id) on delete cascade,
  material_id  uuid not null references public.materials (id) on delete cascade,
  branch_id    uuid not null references public.branches (id),
  stock        numeric(14, 3) not null default 0 check (stock >= 0),
  min_stock    numeric(14, 3) not null default 0 check (min_stock >= 0),
  updated_at   timestamptz not null default now(),
  primary key (material_id, branch_id)
);
create index material_stock_branch_idx on public.material_stock (branch_id);

-- El stock actual y el mínimo pasan a la sucursal principal
insert into public.material_stock (org_id, material_id, branch_id, stock, min_stock)
select m.org_id, m.id, b.id, m.stock, m.min_stock
  from public.materials m
  join public.branches b on b.org_id = m.org_id and b.is_main;

-- ---------------------------------------------------------------------
-- branch_id en documentos y movimientos. Los registros existentes pasan
-- a la sucursal principal (triggers desactivados para no tocar updated_at
-- ni la auditoría).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['quotations', 'orders', 'payments', 'deliveries', 'material_movements'] loop
    execute format('alter table public.%I add column branch_id uuid references public.branches (id)', t);
    execute format('alter table public.%I disable trigger user', t);
    execute format(
      'update public.%I x set branch_id = b.id from public.branches b where b.org_id = x.org_id and b.is_main', t);
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column branch_id set not null', t);
  end loop;
end;
$$;

create index quotations_branch_idx on public.quotations (branch_id, status);
create index orders_branch_idx on public.orders (branch_id, status);
create index payments_branch_date_idx on public.payments (branch_id, payment_date);
create index deliveries_branch_idx on public.deliveries (branch_id, status, scheduled_date);
create index mm_branch_idx on public.material_movements (branch_id, movement_date desc);

-- Traslados: dos movimientos enlazados por transfer_id (salida en origen, entrada en destino)
alter table public.material_movements drop constraint material_movements_movement_type_check;
alter table public.material_movements
  add constraint material_movements_movement_type_check check (movement_type in (
    'ENTRADA', 'SALIDA', 'AJUSTE', 'CONSUMO', 'DEVOLUCION', 'TRASLADO_SALIDA', 'TRASLADO_ENTRADA'));

alter table public.material_movements
  add column transfer_id uuid,
  add column counterpart_branch_id uuid references public.branches (id),
  add constraint mm_transfer_fields check (
    (movement_type in ('TRASLADO_SALIDA', 'TRASLADO_ENTRADA'))
      = (transfer_id is not null and counterpart_branch_id is not null)),
  add constraint mm_transfer_company check (
    movement_type not in ('TRASLADO_SALIDA', 'TRASLADO_ENTRADA') or (ownership = 'EMPRESA' and order_id is null)),
  add constraint mm_transfer_branches check (counterpart_branch_id is null or counterpart_branch_id <> branch_id);
create index mm_transfer_idx on public.material_movements (transfer_id) where transfer_id is not null;

-- ---------------------------------------------------------------------
-- Asignación y validación de la sucursal en cada registro.
--   * Sin branch_id: pagos, entregas y movimientos de un pedido toman la
--     sucursal del pedido; un pedido convertido, la de su cotización; el
--     resto, la sucursal por defecto del usuario.
--   * Una sucursal elegida a mano debe estar activa y ser accesible.
-- Nombre "ab_" para correr después de aa_subscription_guard y antes de
-- las reglas de cada tabla (que ya necesitan branch_id).
-- ---------------------------------------------------------------------
create or replace function public.assign_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       jsonb := to_jsonb(new);
  v_order_id  uuid;
  v_derived   uuid;
  v_inherited boolean;
  v_branch    public.branches%rowtype;
begin
  if tg_op = 'UPDATE' and new.branch_id is not distinct from old.branch_id then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if tg_table_name in ('payments', 'deliveries', 'material_movements') then
      v_order_id := (v_row ->> 'order_id')::uuid;
      if v_order_id is not null then
        select branch_id into v_derived from public.orders where id = v_order_id;
      end if;
    elsif tg_table_name = 'orders' and v_row ->> 'quotation_id' is not null then
      select branch_id into v_derived from public.quotations where id = (v_row ->> 'quotation_id')::uuid;
    end if;
    v_derived := coalesce(v_derived, public.default_branch_id(new.org_id));
    new.branch_id := coalesce(new.branch_id, v_derived);
  end if;

  -- Lo heredado del pedido no se revalida: el acceso al pedido ya lo controla RLS.
  v_inherited := v_order_id is not null and new.branch_id is not distinct from v_derived;

  select * into v_branch from public.branches where id = new.branch_id;
  if not found or v_branch.org_id <> new.org_id then
    raise exception 'La sucursal indicada no pertenece a la empresa.';
  end if;
  if not v_branch.active and not v_inherited then
    raise exception 'La sucursal % está inactiva.', v_branch.name;
  end if;
  if auth.uid() is not null
     and not v_inherited
     and coalesce(current_setting('app.material_transfer', true), '') <> 'on'
     and not public.has_branch_access(new.branch_id) then
    raise exception 'No tiene acceso a la sucursal %.', v_branch.name;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['quotations', 'orders', 'payments', 'deliveries', 'material_movements'] loop
    execute format(
      'create trigger ab_assign_branch before insert or update of branch_id on public.%I
         for each row execute function public.assign_branch()', t);
  end loop;
end;
$$;

create trigger aa_subscription_guard before insert or update or delete on public.branches
  for each row execute function public.enforce_org_writable();
create trigger aa_subscription_guard before insert or update or delete on public.user_branches
  for each row execute function public.enforce_org_writable();

-- ---------------------------------------------------------------------
-- Movimientos de material: el stock se lleva por sucursal y el total
-- consolidado se mantiene en materials.stock.
-- ---------------------------------------------------------------------
create or replace function public.material_movements_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta          numeric;
  v_stock          numeric;
  v_branch_stock   numeric;
  v_branch_name    text;
  v_name           text;
  v_unit           text;
  v_client_balance numeric;
begin
  if new.order_id is not null then
    perform public.assert_order_editable(new.order_id);
  end if;

  if new.movement_type in ('TRASLADO_SALIDA', 'TRASLADO_ENTRADA')
     and coalesce(current_setting('app.material_transfer', true), '') <> 'on' then
    raise exception 'Los traslados entre sucursales solo se registran con la opción «Trasladar».';
  end if;

  -- Bloquear el material serializa los movimientos de todas sus sucursales
  select stock, name, unit into v_stock, v_name, v_unit
    from public.materials where id = new.material_id for update;

  if new.ownership = 'EMPRESA' then
    v_delta := case new.movement_type
      when 'ENTRADA' then new.quantity
      when 'DEVOLUCION' then new.quantity
      when 'AJUSTE' then new.quantity
      when 'TRASLADO_ENTRADA' then new.quantity
      else -new.quantity end;

    select stock into v_branch_stock
      from public.material_stock where material_id = new.material_id and branch_id = new.branch_id;
    v_branch_stock := coalesce(v_branch_stock, 0);

    if v_branch_stock + v_delta < 0 then
      select name into v_branch_name from public.branches where id = new.branch_id;
      raise exception 'Stock insuficiente de % en %: disponible % %, requerido % %.',
        v_name, v_branch_name, trim(to_char(v_branch_stock, 'FM999G990D000')), v_unit,
        trim(to_char(abs(v_delta), 'FM999G990D000')), v_unit;
    end if;

    insert into public.material_stock (org_id, material_id, branch_id, stock)
    values (new.org_id, new.material_id, new.branch_id, v_branch_stock + v_delta)
    on conflict (material_id, branch_id)
    do update set stock = excluded.stock, updated_at = now();

    perform set_config('app.stock_update', 'on', true);
    update public.materials set stock = v_stock + v_delta where id = new.material_id;
    perform set_config('app.stock_update', 'off', true);
    new.stock_after := v_branch_stock + v_delta;      -- saldo de la sucursal
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

-- ---------------------------------------------------------------------
-- RPC de sucursales
-- ---------------------------------------------------------------------

-- Traslado de material de la empresa entre sucursales (salida + entrada en una transacción).
create or replace function public.transfer_material(
  p_material_id uuid,
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_quantity numeric,
  p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid := public.current_org_id();
  v_transfer  uuid := gen_random_uuid();
  v_notes     text := nullif(trim(p_notes), '');
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR') then
    raise exception 'No tiene permisos para trasladar materiales.';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'La cantidad a trasladar debe ser mayor que cero.';
  end if;
  if p_from_branch_id = p_to_branch_id then
    raise exception 'La sucursal de origen y la de destino deben ser distintas.';
  end if;
  if not exists (select 1 from public.materials where id = p_material_id and org_id = v_org) then
    raise exception 'Material no encontrado.';
  end if;
  if not public.has_branch_access(p_from_branch_id) then
    raise exception 'No tiene acceso a la sucursal de origen.';
  end if;
  if not exists (select 1 from public.branches where id = p_to_branch_id and org_id = v_org and active) then
    raise exception 'La sucursal de destino no existe o está inactiva.';
  end if;

  perform set_config('app.material_transfer', 'on', true);
  insert into public.material_movements (org_id, material_id, branch_id, movement_type, ownership, quantity,
                                         notes, transfer_id, counterpart_branch_id)
  values (v_org, p_material_id, p_from_branch_id, 'TRASLADO_SALIDA', 'EMPRESA', p_quantity,
          v_notes, v_transfer, p_to_branch_id),
         (v_org, p_material_id, p_to_branch_id, 'TRASLADO_ENTRADA', 'EMPRESA', p_quantity,
          v_notes, v_transfer, p_from_branch_id);
  perform set_config('app.material_transfer', 'off', true);
  return v_transfer;
end;
$$;

-- Stock mínimo de un material en una sucursal (alertas por sucursal).
create or replace function public.set_branch_min_stock(p_material_id uuid, p_branch_id uuid, p_min_stock numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede configurar el stock mínimo.';
  end if;
  if not public.org_can_write(v_org) then
    raise exception 'El plan de su empresa está vencido: el sistema está en modo solo lectura.';
  end if;
  if coalesce(p_min_stock, -1) < 0 then
    raise exception 'El stock mínimo no puede ser negativo.';
  end if;
  if not exists (select 1 from public.materials where id = p_material_id and org_id = v_org)
     or not exists (select 1 from public.branches where id = p_branch_id and org_id = v_org) then
    raise exception 'Material o sucursal no encontrados.';
  end if;

  insert into public.material_stock (org_id, material_id, branch_id, min_stock)
  values (v_org, p_material_id, p_branch_id, p_min_stock)
  on conflict (material_id, branch_id)
  do update set min_stock = excluded.min_stock, updated_at = now();
end;
$$;

-- El ADMIN define las sucursales de un usuario (reemplaza la lista completa).
create or replace function public.set_user_branches(p_user_id uuid, p_branch_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_ids uuid[] := coalesce(p_branch_ids, array[]::uuid[]);
begin
  if v_org is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador puede asignar sucursales.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = v_org) then
    raise exception 'Usuario no encontrado.';
  end if;
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from public.branches b where b.id = x and b.org_id = v_org)) then
    raise exception 'Una de las sucursales indicadas no pertenece a la empresa.';
  end if;

  delete from public.user_branches where user_id = p_user_id and not (branch_id = any (v_ids));
  insert into public.user_branches (org_id, user_id, branch_id)
  select v_org, p_user_id, x from unnest(v_ids) x
  on conflict do nothing;

  update public.profiles set default_branch_id = null
   where id = p_user_id and default_branch_id is not null and not (default_branch_id = any (v_ids));
end;
$$;

-- Cambia la sucursal principal de la empresa.
create or replace function public.set_main_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador puede cambiar la sucursal principal.';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and org_id = v_org and active) then
    raise exception 'La sucursal no existe o está inactiva.';
  end if;

  perform set_config('app.branch_main_change', 'on', true);
  update public.branches set is_main = false where org_id = v_org and is_main and id <> p_branch_id;
  update public.branches set is_main = true where id = p_branch_id;
  perform set_config('app.branch_main_change', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Funciones de negocio: aceptan y conservan la sucursal
-- (header.branch_id opcional; vacío = sucursal por defecto del usuario)
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
    insert into public.quotations (branch_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material,
                                   estimated_weight, stone, size, notes, terms, tax_rate)
    values (nullif(p_header ->> 'branch_id', '')::uuid,
            (p_header ->> 'customer_id')::uuid, (p_header ->> 'service_type_id')::uuid,
            coalesce((p_header ->> 'issue_date')::date, current_date),
            (p_header ->> 'expiry_date')::date,
            p_header ->> 'title', p_header ->> 'main_material',
            (p_header ->> 'estimated_weight')::numeric, p_header ->> 'stone', p_header ->> 'size',
            p_header ->> 'notes', p_header ->> 'terms',
            coalesce((p_header ->> 'tax_rate')::numeric, 18))
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
                                 estimated_weight, stone, size, notes, terms, tax_rate)
  select branch_id, customer_id, service_type_id, current_date, current_date + coalesce(v_days, 15), title, main_material,
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
                             start_date, due_date, tax_rate)
  values (q.org_id, q.branch_id, q.customer_id, q.id, q.service_type_id, 'APROBADO', coalesce(p_priority, 'MEDIA'),
          q.title,
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
    insert into public.orders (branch_id, customer_id, service_type_id, priority, title, description, main_material,
                               estimated_weight, stone, size, notes, assigned_to, start_date, due_date, tax_rate)
    values (nullif(p_header ->> 'branch_id', '')::uuid,
            (p_header ->> 'customer_id')::uuid, (p_header ->> 'service_type_id')::uuid,
            coalesce(p_header ->> 'priority', 'MEDIA'), p_header ->> 'title', p_header ->> 'description',
            p_header ->> 'main_material', (p_header ->> 'estimated_weight')::numeric, p_header ->> 'stone',
            p_header ->> 'size', p_header ->> 'notes', nullif(p_header ->> 'assigned_to', '')::uuid,
            coalesce((p_header ->> 'start_date')::date, current_date), (p_header ->> 'due_date')::date,
            coalesce((p_header ->> 'tax_rate')::numeric, 18))
    returning id into v_id;
  else
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
-- Usuarios, invitaciones y plan
-- ---------------------------------------------------------------------

-- Igual que en 0009, más la asignación de sucursales del usuario nuevo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv     public.invitations%rowtype;
  v_org_id  uuid;
  v_name    text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
begin
  select * into v_inv from public.invitations
   where lower(email) = lower(new.email) and status = 'PENDING'
   order by created_at desc limit 1;

  if found then
    insert into public.profiles (id, org_id, full_name, email, role, active)
    values (new.id, v_inv.org_id, coalesce(nullif(trim(v_inv.full_name), ''), v_name), new.email, v_inv.role, true);

    insert into public.user_branches (org_id, user_id, branch_id)
    select v_inv.org_id, new.id, b.id
      from public.branches b
     where b.org_id = v_inv.org_id
       and (case when coalesce(cardinality(v_inv.branch_ids), 0) = 0 then b.is_main
                 else b.id = any (v_inv.branch_ids) end);
    if not found then
      insert into public.user_branches (org_id, user_id, branch_id)
      values (v_inv.org_id, new.id, public.main_branch_id(v_inv.org_id));
    end if;

    update public.invitations set status = 'ACCEPTED', accepted_at = now() where id = v_inv.id;
    return new;
  end if;

  if not exists (select 1 from public.organizations) then
    insert into public.organizations (name) values ('Mi Orfebrería') returning id into v_org_id;
    insert into public.settings (org_id) values (v_org_id);
    insert into public.profiles (id, org_id, full_name, email, role, active)
    values (new.id, v_org_id, v_name, new.email, 'ADMIN', true);
    insert into public.user_branches (org_id, user_id, branch_id)
    values (v_org_id, new.id, public.main_branch_id(v_org_id));
    insert into public.platform_admins (user_id) values (new.id);
    return new;
  end if;

  raise exception 'El registro es solo por invitación. Solicite acceso desde la página de inicio.';
end;
$$;

-- Nueva firma con las sucursales del invitado (opcional: null = la principal).
drop function public.create_invitation(text, text, text);

create or replace function public.create_invitation(
  p_email text, p_full_name text, p_role text, p_branch_ids uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_email  text := lower(trim(p_email));
  v_limit  integer;
  v_id     uuid;
begin
  if v_org is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador de la empresa puede invitar usuarios.';
  end if;
  if not public.org_can_write(v_org) then
    raise exception 'El plan de su empresa está vencido. Regularice el pago para invitar usuarios.';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Ese correo ya tiene una cuenta en el sistema.';
  end if;
  if exists (select 1 from unnest(coalesce(p_branch_ids, array[]::uuid[])) x
              where not exists (select 1 from public.branches b where b.id = x and b.org_id = v_org and b.active)) then
    raise exception 'Una de las sucursales indicadas no existe o está inactiva.';
  end if;
  update public.invitations set status = 'REVOKED'
   where org_id = v_org and lower(email) = v_email and status = 'PENDING';
  v_limit := public.org_seat_limit(v_org);
  if public.org_seats_used(v_org) >= v_limit then
    raise exception 'Se alcanzó el límite de % usuarios del plan. Desactive un usuario o mejore el plan.', v_limit;
  end if;

  insert into public.invitations (org_id, email, full_name, role, branch_ids)
  values (v_org, v_email, nullif(trim(p_full_name), ''), p_role, nullif(p_branch_ids, array[]::uuid[]))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.my_subscription()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'org_id', s.org_id,
    'plan_code', s.plan_code,
    'plan_name', p.name,
    'max_users', p.max_users,
    'extra_users', s.extra_users,
    'seat_limit', p.max_users + s.extra_users,
    'seats_used', public.org_seats_used(s.org_id),
    'max_branches', p.max_branches,
    'branches_used', public.org_branches_used(s.org_id),
    'status', s.status,
    'state', public.org_access_state(s.org_id),
    'current_period_end', s.current_period_end,
    'grace_end', s.current_period_end + s.grace_days,
    'days_left', s.current_period_end - current_date
  )
    from public.profiles pr
    join public.subscriptions s on s.org_id = pr.org_id
    join public.plans p on p.code = s.plan_code
   where pr.id = auth.uid();
$$;

-- Listado del superadministrador, ahora con el uso de sucursales.
drop function public.platform_organizations();

create or replace function public.platform_organizations()
returns table (
  org_id uuid, name text, tax_id text, email text, phone text,
  plan_code text, plan_name text, status text, state text,
  current_period_end date, days_left integer, grace_days integer, extra_users integer, notes text,
  seats_used integer, seat_limit integer, branches_used integer, branch_limit integer,
  owner_name text, owner_email text, last_payment_at date, total_paid numeric, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  return query
  select o.id, coalesce(st.company_name, o.name), st.tax_id, st.email, st.phone,
         s.plan_code, p.name, s.status, public.org_access_state(o.id),
         s.current_period_end, (s.current_period_end - current_date)::integer, s.grace_days, s.extra_users, s.notes,
         public.org_seats_used(o.id), p.max_users + s.extra_users,
         public.org_branches_used(o.id), p.max_branches,
         ow.full_name, ow.email,
         (select max(sp.paid_at) from public.subscription_payments sp where sp.org_id = o.id),
         coalesce((select sum(sp.amount) from public.subscription_payments sp where sp.org_id = o.id), 0),
         o.created_at
    from public.organizations o
    join public.subscriptions s on s.org_id = o.id
    join public.plans p on p.code = s.plan_code
    left join public.settings st on st.org_id = o.id
    left join lateral (
      select pr.full_name, pr.email from public.profiles pr
       where pr.org_id = o.id and pr.role = 'ADMIN' and pr.active
       order by pr.created_at limit 1
    ) ow on true
   order by s.current_period_end;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.branches        enable row level security;
alter table public.user_branches   enable row level security;
alter table public.material_stock  enable row level security;

-- Todos los usuarios de la empresa ven la lista de sucursales (nombres para
-- selectores y traslados); los datos de cada una se filtran aparte.
create policy branches_select on public.branches for select to authenticated
  using (org_id = public.current_org_id());
create policy branches_insert on public.branches for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN'));
create policy branches_update on public.branches for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN'))
  with check (org_id = public.current_org_id());
-- Sin delete: las sucursales se desactivan.

-- Escritura solo vía set_user_branches().
create policy user_branches_select on public.user_branches for select to authenticated
  using (org_id = public.current_org_id() and (user_id = auth.uid() or public.has_role('ADMIN')));

-- Escritura solo vía triggers de movimientos y set_branch_min_stock().
create policy material_stock_select on public.material_stock for select to authenticated
  using (org_id = public.current_org_id() and branch_id in (select public.current_branch_ids()));

-- ¿Puede el usuario actual ver el pedido? (ahora también por sucursal)
create or replace function public.can_view_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
     where o.id = p_order_id
       and o.org_id = public.current_org_id()
       and (
         (public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
           and o.branch_id in (select public.current_branch_ids()))
         or (public.has_role('ORFEBRE') and (
               o.assigned_to = auth.uid()
               or exists (select 1 from public.order_production_stages s
                           where s.order_id = o.id and s.assigned_to = auth.uid())))
       )
  );
$$;

-- Cotizaciones
drop policy quotations_select on public.quotations;
drop policy quotations_insert on public.quotations;
drop policy quotations_update on public.quotations;
drop policy quotation_items_all on public.quotation_items;

create policy quotations_select on public.quotations for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
         and branch_id in (select public.current_branch_ids()));
create policy quotations_insert on public.quotations for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
              and branch_id in (select public.current_branch_ids()));
create policy quotations_update on public.quotations for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
         and branch_id in (select public.current_branch_ids()))
  with check (org_id = public.current_org_id() and branch_id in (select public.current_branch_ids()));

-- Los ítems siguen a su cotización (la subconsulta aplica la RLS de quotations)
create policy quotation_items_all on public.quotation_items for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
         and exists (select 1 from public.quotations q where q.id = quotation_items.quotation_id))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
              and exists (select 1 from public.quotations q where q.id = quotation_items.quotation_id));

-- Pedidos
drop policy orders_select on public.orders;
drop policy orders_insert on public.orders;
drop policy orders_update on public.orders;
drop policy order_items_write on public.order_items;
drop policy ops_insert on public.order_production_stages;
drop policy ops_delete on public.order_production_stages;
drop policy ops_update on public.order_production_stages;

-- Condición inline (no can_view_order) para que INSERT ... RETURNING vea la fila nueva
create policy orders_select on public.orders for select to authenticated
  using (org_id = public.current_org_id() and (
    (public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
      and branch_id in (select public.current_branch_ids()))
    or (public.has_role('ORFEBRE') and (
          assigned_to = auth.uid()
          or exists (select 1 from public.order_production_stages s
                      where s.order_id = orders.id and s.assigned_to = auth.uid())))
  ));
create policy orders_insert on public.orders for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
              and branch_id in (select public.current_branch_ids()));
create policy orders_update on public.orders for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
         and branch_id in (select public.current_branch_ids()))
  with check (org_id = public.current_org_id() and branch_id in (select public.current_branch_ids()));

create policy order_items_write on public.order_items for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
         and public.can_view_order(order_id))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
              and public.can_view_order(order_id));

create policy ops_insert on public.order_production_stages for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
              and public.can_view_order(order_id));
create policy ops_delete on public.order_production_stages for delete to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR')
         and public.can_view_order(order_id));
create policy ops_update on public.order_production_stages for update to authenticated
  using (org_id = public.current_org_id() and (
    (public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR') and public.can_view_order(order_id))
    or (public.has_role('ORFEBRE') and (
          assigned_to = auth.uid()
          or exists (select 1 from public.orders o where o.id = order_id and o.assigned_to = auth.uid())))
  ))
  with check (org_id = public.current_org_id());

-- Movimientos de material
drop policy mm_select on public.material_movements;
drop policy mm_insert on public.material_movements;

create policy mm_select on public.material_movements for select to authenticated
  using (org_id = public.current_org_id() and (
    (public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR') and branch_id in (select public.current_branch_ids()))
    or (order_id is not null and public.can_view_order(order_id))
  ));
create policy mm_insert on public.material_movements for insert to authenticated
  with check (org_id = public.current_org_id() and (
    (public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR') and branch_id in (select public.current_branch_ids()))
    or (order_id is not null and public.can_view_order(order_id))
  ));

-- Pagos: visibles en la sucursal donde se cobraron y en la del pedido
drop policy payments_select on public.payments;
drop policy payments_insert on public.payments;
drop policy payments_update on public.payments;

create policy payments_select on public.payments for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
         and (branch_id in (select public.current_branch_ids()) or public.can_view_order(order_id)));
create policy payments_insert on public.payments for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR')
              and branch_id in (select public.current_branch_ids()));
create policy payments_update on public.payments for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE')
         and branch_id in (select public.current_branch_ids()))
  with check (org_id = public.current_org_id());

-- Entregas
drop policy deliveries_select on public.deliveries;
drop policy deliveries_insert on public.deliveries;
drop policy deliveries_update on public.deliveries;

create policy deliveries_select on public.deliveries for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
         and (branch_id in (select public.current_branch_ids()) or public.can_view_order(order_id)));
create policy deliveries_insert on public.deliveries for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
              and branch_id in (select public.current_branch_ids()));
create policy deliveries_update on public.deliveries for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
         and branch_id in (select public.current_branch_ids()))
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------
-- Dashboard con filtro opcional de sucursal (null = todas las visibles)
-- ---------------------------------------------------------------------
drop function public.get_dashboard();

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
                               where status <> 'CANCELADO' and created_at >= date_trunc('month', current_date)),
      'collected_month',     (select coalesce(sum(amount), 0) from payments_b
                               where payment_date >= date_trunc('month', current_date)),
      'receivable',          (select coalesce(sum(balance), 0) from orders_b
                               where status <> 'CANCELADO' and balance > 0),
      'overdue_orders',      (select count(*) from active_orders where due_date < current_date and status <> 'PAUSADO')
    ),
    'orders_by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]')
                           from (select status, count(*) c from orders_b group by status) s),
    'sales_by_month', (select jsonb_agg(jsonb_build_object(
                          'month', to_char(m.m, 'YYYY-MM'),
                          'sales', (select coalesce(sum(total), 0) from orders_b
                                     where status <> 'CANCELADO' and date_trunc('month', created_at) = m.m),
                          'collected', (select coalesce(sum(amount), 0) from payments_b
                                         where date_trunc('month', payment_date) = m.m)) order by m.m)
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
                      from quotations_b q join public.customers c on c.id = q.customer_id
                     where q.status in ('BORRADOR', 'ENVIADA')
                     order by q.expiry_date limit 10) a),
      'pending_payments', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.balance
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
-- Reportes con filtro opcional de sucursal y su nombre en cada fila
-- ---------------------------------------------------------------------
drop function public.report_sales(date, date, uuid, uuid, uuid);
drop function public.report_receivables(uuid);
drop function public.report_collections(date, date, text, boolean);
drop function public.report_order_deadlines(integer, uuid);
drop function public.report_stock(text, boolean);
drop function public.report_client_custody(uuid);

create or replace function public.report_sales(
  p_from date,
  p_to date,
  p_service_type_id uuid default null,
  p_customer_id uuid default null,
  p_assigned_to uuid default null,
  p_branch_id uuid default null
)
returns table (
  id uuid, number text, order_date date, branch_name text, customer_name text, service_name text, title text,
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
    select o.id, o.number, o.created_at::date, b.name, c.full_name, st.name, o.title,
           pr.full_name, o.status, o.subtotal, o.discount_total, o.tax_amount,
           o.total, o.amount_paid, o.balance
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
     order by o.created_at;
end;
$$;

create or replace function public.report_receivables(p_customer_id uuid default null, p_branch_id uuid default null)
returns table (
  id uuid, number text, branch_name text, customer_name text, customer_phone text, title text, status text,
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
    select x.id, x.number, x.branch_name, x.customer_name, x.customer_phone, x.title, x.status, x.due_date,
           x.delivered_at, x.reference_date, x.total, x.amount_paid, x.balance, x.days_old,
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
               o.total, o.amount_paid, o.balance,
               (current_date - coalesce(o.delivered_at::date, o.due_date, o.created_at::date))::integer as days_old
          from public.orders o
          join public.branches b on b.id = o.branch_id
          join public.customers c on c.id = o.customer_id
         where o.status <> 'CANCELADO'
           and o.balance > 0
           and (p_customer_id is null or o.customer_id = p_customer_id)
           and (p_branch_id is null or o.branch_id = p_branch_id)
      ) x
     order by x.days_old desc;
end;
$$;

-- La caja se cuenta en la sucursal donde se cobró (payments.branch_id)
create or replace function public.report_collections(
  p_from date,
  p_to date,
  p_method text default null,
  p_include_voided boolean default false,
  p_branch_id uuid default null
)
returns table (
  id uuid, payment_date date, branch_name text, order_id uuid, order_number text, customer_name text, method text,
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
    select p.id, p.payment_date, b.name, o.id, o.number, c.full_name, p.method, p.reference, p.is_advance,
           p.amount, p.voided, p.void_reason, vb.full_name, cb.full_name
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
    select o.id, o.number, b.name, c.full_name, coalesce(c.whatsapp, c.phone), o.title, o.status, o.priority,
           o.current_stage_name, o.progress, pr.full_name, o.due_date,
           (o.due_date - current_date)::integer, o.balance
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

-- Sin sucursal: stock consolidado y mínimo global. Con sucursal: su stock y su mínimo.
create or replace function public.report_stock(
  p_type text default null,
  p_include_inactive boolean default false,
  p_branch_id uuid default null
)
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
    select m.id, m.name, m.type, m.purity, m.unit, x.qty, x.min_qty, m.reference_cost,
           round(x.qty * m.reference_cost, 2), (m.active and x.qty <= x.min_qty), m.active
      from public.materials m
      left join public.material_stock ms on ms.material_id = m.id and ms.branch_id = p_branch_id
      cross join lateral (
        select case when p_branch_id is null then m.stock else coalesce(ms.stock, 0) end as qty,
               case when p_branch_id is null then m.min_stock else coalesce(ms.min_stock, 0) end as min_qty
      ) x
     where (p_type is null or m.type = p_type)
       and (p_include_inactive or m.active)
     order by m.type, m.name;
end;
$$;

create or replace function public.report_client_custody(p_customer_id uuid default null, p_branch_id uuid default null)
returns table (
  order_id uuid, order_number text, order_status text, branch_name text, customer_name text, customer_phone text,
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
    select o.id, o.number, o.status, b.name, c.full_name, coalesce(c.whatsapp, c.phone),
           ocm.material_name, ocm.purity, ocm.unit, coalesce(ocm.received, 0), ocm.used, ocm.returned,
           ocm.balance,
           (select max(mm.movement_date) from public.material_movements mm
             where mm.order_id = ocm.order_id and mm.material_id = ocm.material_id and mm.ownership = 'CLIENTE')
      from public.order_client_materials ocm
      join public.orders o on o.id = ocm.order_id
      join public.branches b on b.id = o.branch_id
      join public.customers c on c.id = o.customer_id
     where ocm.balance <> 0
       and (p_customer_id is null or o.customer_id = p_customer_id)
       and (p_branch_id is null or o.branch_id = p_branch_id)
     order by c.full_name, o.number, ocm.material_name;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function public.assign_branch() from public, anon, authenticated;
revoke execute on function public.branches_before_write() from public, anon, authenticated;
revoke execute on function public.create_org_main_branch() from public, anon, authenticated;
revoke execute on function public.main_branch_id(uuid) from public, anon, authenticated;

revoke execute on function public.current_branch_ids() from public, anon;
revoke execute on function public.has_branch_access(uuid) from public, anon;
revoke execute on function public.default_branch_id(uuid) from public, anon;
revoke execute on function public.org_branch_limit(uuid) from public, anon;
revoke execute on function public.org_branches_used(uuid) from public, anon;
revoke execute on function public.transfer_material(uuid, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.set_branch_min_stock(uuid, uuid, numeric) from public, anon;
revoke execute on function public.set_user_branches(uuid, uuid[]) from public, anon;
revoke execute on function public.set_main_branch(uuid) from public, anon;
revoke execute on function public.create_invitation(text, text, text, uuid[]) from public, anon;
revoke execute on function public.platform_organizations() from public, anon;
revoke execute on function public.get_dashboard(uuid) from public, anon;
revoke execute on function public.report_sales(date, date, uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function public.report_receivables(uuid, uuid) from public, anon;
revoke execute on function public.report_collections(date, date, text, boolean, uuid) from public, anon;
revoke execute on function public.report_order_deadlines(integer, uuid, uuid) from public, anon;
revoke execute on function public.report_stock(text, boolean, uuid) from public, anon;
revoke execute on function public.report_client_custody(uuid, uuid) from public, anon;

grant execute on function public.current_branch_ids() to authenticated;
grant execute on function public.has_branch_access(uuid) to authenticated;
grant execute on function public.default_branch_id(uuid) to authenticated;
grant execute on function public.org_branch_limit(uuid) to authenticated;
grant execute on function public.org_branches_used(uuid) to authenticated;
grant execute on function public.transfer_material(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.set_branch_min_stock(uuid, uuid, numeric) to authenticated;
grant execute on function public.set_user_branches(uuid, uuid[]) to authenticated;
grant execute on function public.set_main_branch(uuid) to authenticated;
grant execute on function public.create_invitation(text, text, text, uuid[]) to authenticated;
grant execute on function public.platform_organizations() to authenticated;
grant execute on function public.get_dashboard(uuid) to authenticated;
grant execute on function public.report_sales(date, date, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.report_receivables(uuid, uuid) to authenticated;
grant execute on function public.report_collections(date, date, text, boolean, uuid) to authenticated;
grant execute on function public.report_order_deadlines(integer, uuid, uuid) to authenticated;
grant execute on function public.report_stock(text, boolean, uuid) to authenticated;
grant execute on function public.report_client_custody(uuid, uuid) to authenticated;
