-- =====================================================================
-- schema.sql — ARCHIVO GENERADO con `npm run db:schema`. No editar a mano.
-- Fuente: supabase/migrations/*.sql (en orden). Ejecutar en un proyecto
-- Supabase vacío desde el SQL Editor; luego, opcionalmente, seed.sql.
-- =====================================================================

-- >>> 0001_core.sql
-- =====================================================================
-- 0001_core.sql
-- Núcleo: organizaciones (base multiempresa), perfiles, configuración,
-- funciones de seguridad y numeración correlativa segura.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Utilidades genéricas
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Organizaciones (tenant). El MVP usa una sola, pero todas las tablas
-- de negocio llevan org_id para evolucionar a SaaS multiempresa.
-- ---------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Perfiles de usuario (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  org_id      uuid not null references public.organizations (id),
  full_name   text not null,
  email       text not null,
  phone       text,
  role        text not null default 'VENDEDOR'
              check (role in ('ADMIN', 'GERENTE', 'VENDEDOR', 'ORFEBRE', 'SUPERVISOR')),
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (org_id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Configuración por organización (datos de empresa, IGV, vigencias)
-- ---------------------------------------------------------------------
create table public.settings (
  org_id               uuid primary key references public.organizations (id) on delete cascade,
  company_name         text not null default 'Mi Orfebrería',
  tax_id               text,
  address              text,
  phone                text,
  email                text,
  currency             text not null default 'PEN',
  tax_rate             numeric(5, 2) not null default 18 check (tax_rate >= 0 and tax_rate <= 100),
  quote_validity_days  integer not null default 15 check (quote_validity_days > 0),
  default_terms        text default 'Adelanto mínimo del 50% para iniciar el trabajo. Saldo contra entrega.',
  updated_at           timestamptz not null default now()
);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Funciones de seguridad (SECURITY DEFINER para evitar recursión RLS)
-- ---------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.has_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = any (roles) from public.profiles where id = auth.uid() and active),
    false
  );
$$;

create or replace function public.current_user_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), 'Sistema');
$$;

-- ---------------------------------------------------------------------
-- Numeración correlativa: COT-2026-000001, PED-2026-000001, ENT-2026-000001
-- INSERT ... ON CONFLICT DO UPDATE bloquea la fila del contador, por lo
-- que dos transacciones concurrentes nunca obtienen el mismo número.
-- ---------------------------------------------------------------------
create table public.document_sequences (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  doc_type    text not null check (doc_type in ('COT', 'PED', 'ENT')),
  year        integer not null,
  last_value  integer not null default 0,
  primary key (org_id, doc_type, year)
);

create or replace function public.next_document_number(p_org_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year  integer := extract(year from now())::integer;
  v_value integer;
begin
  insert into public.document_sequences as s (org_id, doc_type, year, last_value)
  values (p_org_id, p_doc_type, v_year, 1)
  on conflict (org_id, doc_type, year)
  do update set last_value = s.last_value + 1
  returning last_value into v_value;

  return p_doc_type || '-' || v_year || '-' || lpad(v_value::text, 6, '0');
end;
$$;
revoke execute on function public.next_document_number(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Alta automática de perfil al registrarse un usuario.
--   * Si no existe ningún ADMIN activo: el usuario queda como ADMIN activo
--     (crea la organización si no existe).
--   * En otro caso queda inactivo (rol VENDEDOR) hasta que un ADMIN lo
--     active y le asigne rol. El rol NUNCA se toma de metadata del cliente.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_is_first boolean;
begin
  select id into v_org_id from public.organizations order by created_at limit 1;
  if v_org_id is null then
    insert into public.organizations (name) values ('Mi Orfebrería') returning id into v_org_id;
    insert into public.settings (org_id) values (v_org_id);
  end if;

  v_is_first := not exists (
    select 1 from public.profiles where org_id = v_org_id and role = 'ADMIN' and active
  );

  insert into public.profiles (id, org_id, full_name, email, role, active)
  values (
    new.id,
    v_org_id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    case when v_is_first then 'ADMIN' else 'VENDEDOR' end,
    v_is_first
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un usuario no-ADMIN solo puede modificar su nombre/teléfono.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not public.has_role('ADMIN') then
    if new.role <> old.role or new.active <> old.active or new.org_id <> old.org_id or new.email <> old.email then
      raise exception 'No tiene permisos para modificar rol, estado u organización del usuario.';
    end if;
  end if;
  if auth.uid() = old.id and old.role = 'ADMIN' and (new.role <> 'ADMIN' or not new.active) then
    raise exception 'No puede quitarse a sí mismo el rol de administrador.';
  end if;
  return new;
end;
$$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ADMIN, o ejecución de servidor sin usuario (SQL Editor, seed, service_role).
-- El rol anon no tiene políticas RLS, así que no puede aprovechar este caso.
create or replace function public.is_admin_or_system()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null or public.has_role('ADMIN');
$$;

-- >>> 0002_catalogs_customers.sql
-- =====================================================================
-- 0002_catalogs_customers.sql
-- Catálogos (tipos de servicio, plantilla de etapas) y clientes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos de servicio
-- ---------------------------------------------------------------------
create table public.service_types (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org_id() references public.organizations (id),
  code        text not null,
  name        text not null,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, code)
);

-- ---------------------------------------------------------------------
-- Plantilla de etapas de producción (se copian a cada pedido)
-- ---------------------------------------------------------------------
create table public.production_stages (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default public.current_org_id() references public.organizations (id),
  name               text not null,
  position           integer not null,
  is_quality_check   boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create index production_stages_org_idx on public.production_stages (org_id, position);

-- Catálogos iniciales para cada organización nueva
create or replace function public.seed_org_catalogs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.service_types (org_id, code, name, position) values
    (new.id, 'VENTA',        'Venta de joya',             1),
    (new.id, 'FABRICACION',  'Fabricación personalizada', 2),
    (new.id, 'REPARACION',   'Reparación',                3),
    (new.id, 'MODIFICACION', 'Modificación',              4),
    (new.id, 'OTRO',         'Otro',                      5);

  insert into public.production_stages (org_id, name, position, is_quality_check) values
    (new.id, 'Diseño',              1, false),
    (new.id, 'Fundición',           2, false),
    (new.id, 'Tallado',             3, false),
    (new.id, 'Engaste',             4, false),
    (new.id, 'Pulido',              5, false),
    (new.id, 'Acabado',             6, false),
    (new.id, 'Control de calidad',  7, true);
  return new;
end;
$$;

create trigger organizations_seed_catalogs
  after insert on public.organizations
  for each row execute function public.seed_org_catalogs();

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.current_org_id() references public.organizations (id),
  person_type      text not null default 'NATURAL' check (person_type in ('NATURAL', 'EMPRESA')),
  first_name       text,
  last_name        text,
  business_name    text,
  document_type    text not null default 'DNI' check (document_type in ('DNI', 'RUC', 'CE', 'PASAPORTE', 'OTRO')),
  document_number  text,
  phone            text,
  whatsapp         text,
  email            text,
  address          text,
  city             text,
  notes            text,
  active           boolean not null default true,
  full_name        text generated always as (
                     case when person_type = 'EMPRESA' then coalesce(business_name, '')
                          else trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
                     end
                   ) stored,
  created_by       uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint customers_name_required check (
    (person_type = 'NATURAL' and length(trim(coalesce(first_name, ''))) > 0)
    or (person_type = 'EMPRESA' and length(trim(coalesce(business_name, ''))) > 0)
  ),
  constraint customers_email_format check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index customers_document_uidx on public.customers (org_id, document_type, document_number)
  where document_number is not null and document_number <> '';
create index customers_org_name_idx on public.customers (org_id, full_name);

create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- Contactos adicionales del cliente (útil para empresas)
create table public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default public.current_org_id() references public.organizations (id),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  name         text not null,
  position     text,
  phone        text,
  email        text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

-- >>> 0003_materials.sql
-- =====================================================================
-- 0003_materials.sql
-- Catálogo de materiales. Los movimientos (que dependen de pedidos)
-- se crean en 0006.
-- =====================================================================

create table public.materials (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.current_org_id() references public.organizations (id),
  name             text not null check (length(trim(name)) > 0),
  type             text not null check (type in ('ORO', 'PLATA', 'PLATINO', 'PIEDRA_PRECIOSA', 'PIEDRA_SEMIPRECIOSA', 'OTRO')),
  purity           text,                              -- ley: 18K, 14K, 925, 950...
  unit             text not null default 'g' check (unit in ('g', 'ct', 'und')),
  stock            numeric(14, 3) not null default 0 check (stock >= 0),
  min_stock        numeric(14, 3) not null default 0 check (min_stock >= 0),
  reference_cost   numeric(12, 2) not null default 0 check (reference_cost >= 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, name)
);
create index materials_org_idx on public.materials (org_id, type);

create trigger materials_updated_at before update on public.materials
  for each row execute function public.set_updated_at();

-- El stock solo cambia mediante movimientos (ver 0006). Este trigger
-- impide editarlo directamente desde el cliente.
create or replace function public.protect_material_stock()
returns trigger
language plpgsql
as $$
begin
  if new.stock <> old.stock and current_setting('app.stock_update', true) is distinct from 'on' then
    raise exception 'El stock solo puede modificarse mediante movimientos de material.';
  end if;
  return new;
end;
$$;

create trigger materials_protect_stock before update on public.materials
  for each row execute function public.protect_material_stock();

-- >>> 0004_quotations.sql
-- =====================================================================
-- 0004_quotations.sql
-- Cotizaciones y su detalle. Los totales se calculan en la base de datos.
-- =====================================================================

create table public.quotations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default public.current_org_id() references public.organizations (id),
  number            text,
  customer_id       uuid not null references public.customers (id),
  service_type_id   uuid not null references public.service_types (id),
  status            text not null default 'BORRADOR'
                    check (status in ('BORRADOR', 'ENVIADA', 'APROBADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA')),
  issue_date        date not null default current_date,
  expiry_date       date not null default (current_date + 15),
  title             text not null check (length(trim(title)) > 0),   -- producto principal
  main_material     text,
  estimated_weight  numeric(10, 2) check (estimated_weight is null or estimated_weight > 0),
  stone             text,
  size              text,                                            -- talla / medida
  notes             text,
  terms             text,
  subtotal          numeric(12, 2) not null default 0,
  discount_total    numeric(12, 2) not null default 0,
  tax_rate          numeric(5, 2) not null default 18 check (tax_rate >= 0 and tax_rate <= 100),
  tax_amount        numeric(12, 2) not null default 0,
  total             numeric(12, 2) not null default 0,
  approved_at       timestamptz,
  approved_by       uuid references public.profiles (id),
  order_id          uuid,                                            -- FK añadida en 0005
  created_by        uuid default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, number),
  constraint quotations_dates check (expiry_date >= issue_date)
);
create index quotations_org_status_idx on public.quotations (org_id, status);
create index quotations_customer_idx on public.quotations (customer_id);

create table public.quotation_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default public.current_org_id() references public.organizations (id),
  quotation_id   uuid not null references public.quotations (id) on delete cascade,
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
  constraint quotation_items_discount check (discount <= round(quantity * unit_price, 2))
);
create index quotation_items_quotation_idx on public.quotation_items (quotation_id, position);

-- ---------------------------------------------------------------------
-- Numeración, impuestos y reglas de estado
-- ---------------------------------------------------------------------
create or replace function public.quotations_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[];
begin
  if tg_op = 'INSERT' then
    new.number := public.next_document_number(new.org_id, 'COT');
  else
    new.number := old.number;            -- el número es inmutable
    if new.status <> old.status then
      v_allowed := case old.status
        when 'BORRADOR'  then array['ENVIADA', 'APROBADA', 'RECHAZADA', 'CANCELADA']
        when 'ENVIADA'   then array['BORRADOR', 'APROBADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA']
        when 'VENCIDA'   then array['BORRADOR', 'ENVIADA', 'CANCELADA']
        when 'RECHAZADA' then array['BORRADOR']
        when 'APROBADA'  then case when old.order_id is null then array['CANCELADA'] else array[]::text[] end
        else array[]::text[]
      end;
      if not (new.status = any (v_allowed)) then
        raise exception 'No se puede cambiar la cotización de % a %.', old.status, new.status;
      end if;
      if new.status = 'APROBADA' then
        new.approved_at := now();
        new.approved_by := auth.uid();
      end if;
    elsif old.status not in ('BORRADOR', 'ENVIADA')
          and (new.order_id is not distinct from old.order_id)
          and (new.customer_id, new.title, new.tax_rate, new.expiry_date, new.notes, new.terms)
              is distinct from (old.customer_id, old.title, old.tax_rate, old.expiry_date, old.notes, old.terms) then
      raise exception 'Solo se pueden editar cotizaciones en estado Borrador o Enviada.';
    end if;
    if old.order_id is not null and new.order_id is distinct from old.order_id then
      raise exception 'La cotización ya fue convertida en pedido.';
    end if;
  end if;

  new.tax_amount := round((new.subtotal - new.discount_total) * new.tax_rate / 100, 2);
  new.total := new.subtotal - new.discount_total + new.tax_amount;
  return new;
end;
$$;

create trigger quotations_before_write before insert or update on public.quotations
  for each row execute function public.quotations_before_write();

create trigger quotations_updated_at before update on public.quotations
  for each row execute function public.set_updated_at();

create or replace function public.recalc_quotation_totals(p_quotation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.quotations q
     set subtotal       = coalesce(t.gross, 0),
         discount_total = coalesce(t.disc, 0)
    from (select round(sum(quantity * unit_price), 2) as gross, sum(discount) as disc
            from public.quotation_items where quotation_id = p_quotation_id) t
   where q.id = p_quotation_id
     and (q.subtotal, q.discount_total) is distinct from (coalesce(t.gross, 0), coalesce(t.disc, 0));
$$;
revoke execute on function public.recalc_quotation_totals(uuid) from public, anon, authenticated;

create or replace function public.quotation_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_quotation_totals(coalesce(new.quotation_id, old.quotation_id));
  return null;
end;
$$;

create trigger quotation_items_after_write after insert or update or delete on public.quotation_items
  for each row execute function public.quotation_items_after_write();

-- Los ítems solo se editan mientras la cotización es editable.
create or replace function public.quotation_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.quotations
   where id = coalesce(new.quotation_id, old.quotation_id);
  if v_status is not null and v_status not in ('BORRADOR', 'ENVIADA') then
    raise exception 'Solo se pueden editar los ítems de cotizaciones en estado Borrador o Enviada.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger quotation_items_guard before insert or update or delete on public.quotation_items
  for each row execute function public.quotation_items_guard();

-- >>> 0005_orders_production.sql
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

-- >>> 0006_movements_payments_deliveries.sql
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

-- >>> 0007_business_functions.sql
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

-- >>> 0008_rls_storage.sql
-- =====================================================================
-- 0008_rls_storage.sql
-- Row Level Security. La seguridad real vive aquí; los guards de Angular
-- solo mejoran la experiencia de usuario.
--
-- Matriz de acceso:
--   ADMIN       acceso total
--   GERENTE     clientes, cotizaciones, pedidos, producción, materiales, pagos, entregas, dashboard
--   VENDEDOR    clientes, cotizaciones, pedidos, pagos (adelantos), entregas
--   SUPERVISOR  pedidos, producción, control de calidad, materiales (movimientos), entregas
--   ORFEBRE     solo pedidos asignados (a él o a una de sus etapas) y su producción
-- =====================================================================

-- ¿Puede el usuario actual ver el pedido?
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
         public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
         or (public.has_role('ORFEBRE') and (
               o.assigned_to = auth.uid()
               or exists (select 1 from public.order_production_stages s
                           where s.order_id = o.id and s.assigned_to = auth.uid())))
       )
  );
$$;

-- Ruta de Storage "{order_id}/archivo" -> ¿puede acceder?
create or replace function public.can_access_order_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when split_part(p_path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_view_order(split_part(p_path, '/', 1)::uuid)
    else false
  end;
$$;

alter table public.organizations           enable row level security;
alter table public.profiles                enable row level security;
alter table public.settings                enable row level security;
alter table public.document_sequences      enable row level security;
alter table public.service_types           enable row level security;
alter table public.production_stages       enable row level security;
alter table public.customers               enable row level security;
alter table public.customer_contacts       enable row level security;
alter table public.materials               enable row level security;
alter table public.quotations              enable row level security;
alter table public.quotation_items         enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.order_production_stages enable row level security;
alter table public.order_history           enable row level security;
alter table public.material_movements      enable row level security;
alter table public.payments                enable row level security;
alter table public.deliveries              enable row level security;
alter table public.attachments             enable row level security;

-- document_sequences: sin políticas (solo accesible vía funciones SECURITY DEFINER)

-- ---------------------------------------------------------------------
-- Organización, perfiles y configuración
-- ---------------------------------------------------------------------
create policy org_select on public.organizations for select to authenticated
  using (id = public.current_org_id());
create policy org_update on public.organizations for update to authenticated
  using (id = public.current_org_id() and public.has_role('ADMIN'));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or org_id = public.current_org_id());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or (org_id = public.current_org_id() and public.has_role('ADMIN')))
  with check (id = auth.uid() or org_id = public.current_org_id());  -- org/rol protegidos por trigger

create policy settings_select on public.settings for select to authenticated
  using (org_id = public.current_org_id());
create policy settings_update on public.settings for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN'));

create policy service_types_select on public.service_types for select to authenticated
  using (org_id = public.current_org_id());
create policy service_types_write on public.service_types for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN'))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN'));

create policy production_stages_select on public.production_stages for select to authenticated
  using (org_id = public.current_org_id());
create policy production_stages_write on public.production_stages for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN'))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN'));

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create policy customers_select on public.customers for select to authenticated
  using (org_id = public.current_org_id() and (
    public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
    or exists (select 1 from public.orders o where o.customer_id = customers.id and public.can_view_order(o.id))
  ));
create policy customers_insert on public.customers for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));
create policy customers_update on public.customers for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'))
  with check (org_id = public.current_org_id());

create policy customer_contacts_select on public.customer_contacts for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'));
create policy customer_contacts_write on public.customer_contacts for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));

-- ---------------------------------------------------------------------
-- Materiales
-- ---------------------------------------------------------------------
create policy materials_select on public.materials for select to authenticated
  using (org_id = public.current_org_id());
create policy materials_insert on public.materials for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'));
create policy materials_update on public.materials for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'))
  with check (org_id = public.current_org_id());

create policy mm_select on public.material_movements for select to authenticated
  using (org_id = public.current_org_id() and (
    public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR')
    or (order_id is not null and public.can_view_order(order_id))
  ));
create policy mm_insert on public.material_movements for insert to authenticated
  with check (org_id = public.current_org_id() and (
    public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR')
    or (order_id is not null and public.can_view_order(order_id))
  ));
-- Sin update/delete: los movimientos son inmutables.

-- ---------------------------------------------------------------------
-- Cotizaciones
-- ---------------------------------------------------------------------
create policy quotations_select on public.quotations for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));
create policy quotations_insert on public.quotations for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));
create policy quotations_update on public.quotations for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'))
  with check (org_id = public.current_org_id());

create policy quotation_items_all on public.quotation_items for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
-- Condición inline (no can_view_order) para que INSERT ... RETURNING vea la fila nueva
create policy orders_select on public.orders for select to authenticated
  using (org_id = public.current_org_id() and (
    public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')
    or (public.has_role('ORFEBRE') and (
          assigned_to = auth.uid()
          or exists (select 1 from public.order_production_stages s
                      where s.order_id = orders.id and s.assigned_to = auth.uid())))
  ));
create policy orders_insert on public.orders for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));
create policy orders_update on public.orders for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'))
  with check (org_id = public.current_org_id());

create policy order_items_select on public.order_items for select to authenticated
  using (public.can_view_order(order_id));
create policy order_items_write on public.order_items for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));

create policy ops_select on public.order_production_stages for select to authenticated
  using (public.can_view_order(order_id));
create policy ops_insert on public.order_production_stages for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'));
create policy ops_delete on public.order_production_stages for delete to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR'));
create policy ops_update on public.order_production_stages for update to authenticated
  using (org_id = public.current_org_id() and (
    public.has_role('ADMIN', 'GERENTE', 'SUPERVISOR')
    or (public.has_role('ORFEBRE') and (
          assigned_to = auth.uid()
          or exists (select 1 from public.orders o where o.id = order_id and o.assigned_to = auth.uid())))
  ))
  with check (org_id = public.current_org_id());

create policy order_history_select on public.order_history for select to authenticated
  using (public.can_view_order(order_id));
-- Sin políticas de escritura: solo los triggers registran auditoría.

-- ---------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------
create policy payments_select on public.payments for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));
create policy payments_insert on public.payments for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));
create policy payments_update on public.payments for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'))
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------
-- Entregas
-- ---------------------------------------------------------------------
create policy deliveries_select on public.deliveries for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'));
create policy deliveries_insert on public.deliveries for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'));
create policy deliveries_update on public.deliveries for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'))
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------
-- Adjuntos
-- ---------------------------------------------------------------------
create policy attachments_select on public.attachments for select to authenticated
  using (public.can_view_order(order_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (org_id = public.current_org_id() and public.can_view_order(order_id));
create policy attachments_update on public.attachments for update to authenticated
  using (org_id = public.current_org_id() and (public.has_role('ADMIN', 'GERENTE') or uploaded_by = auth.uid()))
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------
-- Supabase Storage: bucket privado "orders", rutas {order_id}/{archivo}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('orders', 'orders', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
              'image/svg+xml', 'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy orders_files_select on storage.objects for select to authenticated
  using (bucket_id = 'orders' and public.can_access_order_file(name));
create policy orders_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'orders' and public.can_access_order_file(name));
create policy orders_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'orders' and public.can_access_order_file(name)
         and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR', 'ORFEBRE'));

-- ---------------------------------------------------------------------
-- Funciones RPC: solo usuarios autenticados
-- ---------------------------------------------------------------------
revoke execute on function public.save_quotation(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.duplicate_quotation(uuid) from public, anon;
revoke execute on function public.expire_quotations() from public, anon;
revoke execute on function public.create_order_stages(uuid) from public, anon;
revoke execute on function public.convert_quotation_to_order(uuid, uuid, date, text, boolean) from public, anon;
revoke execute on function public.save_order(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.get_dashboard() from public, anon;
grant execute on function public.save_quotation(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.duplicate_quotation(uuid) to authenticated;
grant execute on function public.expire_quotations() to authenticated;
grant execute on function public.create_order_stages(uuid) to authenticated;
grant execute on function public.convert_quotation_to_order(uuid, uuid, date, text, boolean) to authenticated;
grant execute on function public.save_order(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.get_dashboard() to authenticated;

-- >>> 0009_saas_platform.sql
-- =====================================================================
-- 0009_saas_platform.sql
-- Plataforma SaaS multiempresa:
--   * Planes (límite de usuarios) y suscripción por organización.
--   * Pagos de suscripción registrados por el superadministrador.
--   * Solicitudes de acceso públicas y alta solo por invitación.
--   * Vencimiento: PRUEBA/ACTIVA -> GRACIA -> VENCIDA (solo lectura);
--     SUSPENDIDA/CANCELADA bloquean el acceso a los datos.
-- Todo se aplica en la base de datos (triggers + RLS), no solo en Angular.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Planes
-- ---------------------------------------------------------------------
create table public.plans (
  code              text primary key,
  name              text not null,
  max_users         integer not null check (max_users > 0),
  price_month       numeric(10, 2) not null check (price_month >= 0),
  price_year        numeric(10, 2) not null check (price_year >= 0),
  -- Precio mensual por usuario adicional; null = el plan no admite usuarios extra.
  extra_user_price  numeric(10, 2) check (extra_user_price is null or extra_user_price >= 0),
  position          integer not null default 0,
  active            boolean not null default true
);

insert into public.plans (code, name, max_users, price_month, price_year, extra_user_price, position) values
  ('BASICO',  'Básico',  3,  79, 790,  null, 1),
  ('TALLER',  'Taller',  8,  149, 1490, null, 2),
  ('EMPRESA', 'Empresa', 20, 299, 2990, 15,  3);

-- ---------------------------------------------------------------------
-- Superadministradores de la plataforma (separados de los roles de empresa:
-- un ADMIN de una orfebrería nunca puede convertirse en superadmin).
-- ---------------------------------------------------------------------
create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Suscripción (1 por organización)
-- ---------------------------------------------------------------------
create table public.subscriptions (
  org_id              uuid primary key references public.organizations (id) on delete cascade,
  plan_code           text not null references public.plans (code),
  status              text not null default 'TRIAL'
                      check (status in ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED')),
  extra_users         integer not null default 0 check (extra_users >= 0),
  current_period_end  date not null,
  grace_days          integer not null default 5 check (grace_days between 0 and 60),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Toda organización nueva nace con 14 días de prueba del plan Básico.
create or replace function public.create_org_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (org_id, plan_code, status, current_period_end)
  values (new.id, 'BASICO', 'TRIAL', current_date + 14)
  on conflict (org_id) do nothing;
  return new;
end;
$$;

create trigger organizations_create_subscription
  after insert on public.organizations
  for each row execute function public.create_org_subscription();

-- Organizaciones existentes: plan Empresa activo por un año.
insert into public.subscriptions (org_id, plan_code, status, current_period_end)
select id, 'EMPRESA', 'ACTIVE', current_date + 365 from public.organizations
on conflict (org_id) do nothing;

-- Estado efectivo: TRIAL | ACTIVE | GRACE | EXPIRED | SUSPENDED | CANCELLED
create or replace function public.org_access_state(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when s.status in ('SUSPENDED', 'CANCELLED') then s.status
      when current_date <= s.current_period_end then s.status
      when s.status = 'ACTIVE' and current_date <= s.current_period_end + s.grace_days then 'GRACE'
      else 'EXPIRED'
    end
    from public.subscriptions s where s.org_id = p_org_id
  ), 'EXPIRED');
$$;

create or replace function public.org_can_write(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_access_state(p_org_id) in ('TRIAL', 'ACTIVE', 'GRACE');
$$;

create or replace function public.org_seat_limit(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select p.max_users + s.extra_users
    from public.subscriptions s join public.plans p on p.code = s.plan_code
   where s.org_id = p_org_id;
$$;

-- Una organización suspendida o cancelada deja de "existir" para RLS:
-- todas las políticas filtran por current_org_id().
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id
    from public.profiles p
    join public.subscriptions s on s.org_id = p.org_id
   where p.id = auth.uid() and p.active and s.status not in ('SUSPENDED', 'CANCELLED');
$$;

-- ---------------------------------------------------------------------
-- Modo solo lectura: bloquea escrituras de negocio con el plan vencido.
-- Se aplica con trigger (no con RLS) para cubrir también las funciones
-- SECURITY DEFINER. Las ejecuciones de servidor (auth.uid() nulo) pasan.
-- ---------------------------------------------------------------------
create or replace function public.enforce_org_writable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
begin
  if auth.uid() is not null and not public.org_can_write(v_org) then
    raise exception 'El plan de su empresa está vencido: el sistema está en modo solo lectura. Regularice el pago para seguir registrando información.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'service_types', 'production_stages', 'customers', 'customer_contacts', 'materials',
    'quotations', 'quotation_items', 'orders', 'order_items', 'order_production_stages',
    'material_movements', 'payments', 'deliveries', 'attachments'
  ] loop
    execute format(
      'create trigger aa_subscription_guard before insert or update or delete on public.%I
         for each row execute function public.enforce_org_writable()', t);
  end loop;
end;
$$;

drop policy orders_files_insert on storage.objects;
create policy orders_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'orders' and public.can_access_order_file(name)
              and public.org_can_write(public.current_org_id()));

-- ---------------------------------------------------------------------
-- Pagos de suscripción (los registra el superadministrador)
-- ---------------------------------------------------------------------
create table public.subscription_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  plan_code     text not null references public.plans (code),
  amount        numeric(10, 2) not null check (amount > 0),
  method        text not null check (method in ('YAPE', 'PLIN', 'TRANSFERENCIA', 'EFECTIVO', 'TARJETA', 'OTRO')),
  reference     text,
  months        integer not null check (months between 1 and 36),
  paid_at       date not null default current_date,
  period_start  date not null,
  period_end    date not null check (period_end >= period_start),
  created_by    uuid default auth.uid() references auth.users (id),
  created_at    timestamptz not null default now()
);
create index subscription_payments_org_idx on public.subscription_payments (org_id, paid_at desc);

-- ---------------------------------------------------------------------
-- Solicitudes de acceso (formulario público)
-- ---------------------------------------------------------------------
create table public.access_requests (
  id             uuid primary key default gen_random_uuid(),
  company_name   text not null check (length(trim(company_name)) between 2 and 120),
  tax_id         text check (tax_id is null or tax_id ~ '^(10|15|17|20)\d{9}$'),
  contact_name   text not null check (length(trim(contact_name)) between 3 and 120),
  email          text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone          text,
  plan_code      text references public.plans (code),
  message        text check (message is null or length(message) <= 1000),
  status         text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  org_id         uuid references public.organizations (id) on delete set null,
  reject_reason  text,
  reviewed_by    uuid references auth.users (id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index access_requests_pending_email on public.access_requests (lower(email)) where status = 'PENDING';

-- ---------------------------------------------------------------------
-- Invitaciones: única vía para crear usuarios (además del primer arranque).
-- inviteUserByEmail crea el usuario en auth al enviar el correo; el trigger
-- handle_new_user consume la invitación y crea el perfil activo.
-- ---------------------------------------------------------------------
create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name    text,
  role         text not null check (role in ('ADMIN', 'GERENTE', 'VENDEDOR', 'ORFEBRE', 'SUPERVISOR')),
  status       text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REVOKED')),
  invited_by   uuid default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);
create unique index invitations_pending_email on public.invitations (lower(email)) where status = 'PENDING';
create index invitations_org_idx on public.invitations (org_id, created_at desc);

-- ---------------------------------------------------------------------
-- Límite de usuarios del plan: activos + invitaciones pendientes.
-- ---------------------------------------------------------------------
create or replace function public.org_seats_used(p_org_id uuid, p_exclude_email text default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.profiles
            where org_id = p_org_id and active
              and (p_exclude_email is null or lower(email) <> lower(p_exclude_email)))::integer
       + (select count(*) from public.invitations
            where org_id = p_org_id and status = 'PENDING'
              and (p_exclude_email is null or lower(email) <> lower(p_exclude_email)))::integer;
$$;

create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if new.active and (tg_op = 'INSERT' or not old.active) then
    v_limit := public.org_seat_limit(new.org_id);
    if v_limit is not null and public.org_seats_used(new.org_id, new.email) >= v_limit then
      raise exception 'Se alcanzó el límite de % usuarios activos del plan. Desactive un usuario o mejore el plan.', v_limit;
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_seat_limit before insert or update of active on public.profiles
  for each row execute function public.enforce_seat_limit();

-- ---------------------------------------------------------------------
-- Alta de usuarios: solo por invitación. Excepción: instalación vacía,
-- donde el primer usuario crea la organización y es superadministrador.
-- ---------------------------------------------------------------------
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
    update public.invitations set status = 'ACCEPTED', accepted_at = now() where id = v_inv.id;
    return new;
  end if;

  if not exists (select 1 from public.organizations) then
    insert into public.organizations (name) values ('Mi Orfebrería') returning id into v_org_id;
    insert into public.settings (org_id) values (v_org_id);
    insert into public.profiles (id, org_id, full_name, email, role, active)
    values (new.id, v_org_id, v_name, new.email, 'ADMIN', true);
    insert into public.platform_admins (user_id) values (new.id);
    return new;
  end if;

  raise exception 'El registro es solo por invitación. Solicite acceso desde la página de inicio.';
end;
$$;

-- El superadministrador inicial es el primer ADMIN de la primera organización
-- (el dueño de la instalación). Cambiar con:
--   insert into public.platform_admins (user_id) select id from auth.users where email = '...';
insert into public.platform_admins (user_id)
select p.id from public.profiles p
 where p.role = 'ADMIN' and p.active
   and p.org_id = (select id from public.organizations order by created_at limit 1)
 order by p.created_at limit 1
on conflict do nothing;

-- ---------------------------------------------------------------------
-- RLS de las tablas nuevas
-- ---------------------------------------------------------------------
alter table public.plans                  enable row level security;
alter table public.platform_admins        enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.subscription_payments  enable row level security;
alter table public.access_requests        enable row level security;
alter table public.invitations            enable row level security;

create policy plans_select on public.plans for select to anon, authenticated using (true);
create policy plans_write on public.plans for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- La empresa ve su suscripción y sus pagos (solo el ADMIN ve los pagos); escribe solo la plataforma vía RPC.
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_platform_admin() or org_id = (select org_id from public.profiles where id = auth.uid()));
create policy subscription_payments_select on public.subscription_payments for select to authenticated
  using (public.is_platform_admin() or (org_id = public.current_org_id() and public.has_role('ADMIN')));

create policy access_requests_select on public.access_requests for select to authenticated
  using (public.is_platform_admin());

-- Datos de otras empresas: el superadmin los obtiene solo vía platform_organizations();
-- las tablas de negocio siguen limitadas a su propia organización.
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_platform_admin() or (org_id = public.current_org_id() and public.has_role('ADMIN')));

-- ---------------------------------------------------------------------
-- RPC públicas y de empresa
-- ---------------------------------------------------------------------

-- Formulario público "Solicitar acceso" (anon).
create or replace function public.submit_access_request(
  p_company_name text, p_tax_id text, p_contact_name text, p_email text,
  p_phone text, p_plan_code text, p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Ese correo ya tiene una cuenta. Inicie sesión o use «¿Olvidó su contraseña?».';
  end if;
  if exists (select 1 from public.access_requests where lower(email) = v_email and status = 'PENDING') then
    raise exception 'Ya existe una solicitud pendiente con ese correo. Le contactaremos pronto.';
  end if;
  if (select count(*) from public.access_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Recibimos demasiadas solicitudes. Intente nuevamente en unos minutos.';
  end if;

  insert into public.access_requests (company_name, tax_id, contact_name, email, phone, plan_code, message)
  values (trim(p_company_name), nullif(trim(p_tax_id), ''), trim(p_contact_name), v_email,
          nullif(trim(p_phone), ''), nullif(p_plan_code, ''), nullif(trim(p_message), ''));
end;
$$;

-- Estado del plan de la empresa del usuario (funciona aun suspendida, para mostrar el aviso).
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

-- El ADMIN de la empresa invita a un usuario (reserva un cupo del plan).
-- El correo lo envía la Edge Function send-invitation.
create or replace function public.create_invitation(p_email text, p_full_name text, p_role text)
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
  update public.invitations set status = 'REVOKED'
   where org_id = v_org and lower(email) = v_email and status = 'PENDING';
  v_limit := public.org_seat_limit(v_org);
  if public.org_seats_used(v_org) >= v_limit then
    raise exception 'Se alcanzó el límite de % usuarios del plan. Desactive un usuario o mejore el plan.', v_limit;
  end if;

  insert into public.invitations (org_id, email, full_name, role)
  values (v_org, v_email, nullif(trim(p_full_name), ''), p_role)
  returning id into v_id;
  return v_id;
end;
$$;

-- Usada por la Edge Function (con el JWT del usuario) para validar el envío.
create or replace function public.invitation_for_sending(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', i.id, 'email', i.email, 'full_name', i.full_name, 'org_id', i.org_id)
    from public.invitations i
   where i.id = p_id and i.status = 'PENDING'
     and (public.is_platform_admin()
          or (i.org_id = public.current_org_id() and public.has_role('ADMIN')));
$$;

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invitations set status = 'REVOKED'
   where id = p_id and status = 'PENDING'
     and (public.is_platform_admin()
          or (org_id = public.current_org_id() and public.has_role('ADMIN')));
end;
$$;

-- ---------------------------------------------------------------------
-- RPC del superadministrador
-- ---------------------------------------------------------------------
create or replace function public.assert_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo el administrador de la plataforma puede realizar esta acción.';
  end if;
end;
$$;

-- Aprueba la solicitud: crea la empresa (catálogos y suscripción por trigger),
-- fija plan y días de prueba, e invita al dueño como ADMIN.
create or replace function public.platform_approve_request(p_id uuid, p_plan_code text, p_trial_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.access_requests%rowtype;
  v_org   uuid;
  v_inv   uuid;
begin
  perform public.assert_platform_admin();
  select * into r from public.access_requests where id = p_id for update;
  if not found or r.status <> 'PENDING' then
    raise exception 'La solicitud no existe o ya fue atendida.';
  end if;
  if exists (select 1 from public.profiles where lower(email) = lower(r.email)) then
    raise exception 'El correo % ya tiene una cuenta en el sistema.', r.email;
  end if;
  if p_trial_days not between 0 and 90 then
    raise exception 'Los días de prueba deben estar entre 0 y 90.';
  end if;

  insert into public.organizations (name) values (r.company_name) returning id into v_org;
  insert into public.settings (org_id, company_name, tax_id, phone, email)
  values (v_org, r.company_name, r.tax_id, r.phone, r.email);
  update public.subscriptions
     set plan_code = coalesce(p_plan_code, r.plan_code, 'BASICO'),
         status = 'TRIAL',
         current_period_end = current_date + p_trial_days
   where org_id = v_org;

  update public.invitations set status = 'REVOKED' where lower(email) = lower(r.email) and status = 'PENDING';
  insert into public.invitations (org_id, email, full_name, role)
  values (v_org, lower(r.email), r.contact_name, 'ADMIN') returning id into v_inv;

  update public.access_requests
     set status = 'APPROVED', org_id = v_org, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('org_id', v_org, 'invitation_id', v_inv, 'email', r.email);
end;
$$;

create or replace function public.platform_reject_request(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  update public.access_requests
     set status = 'REJECTED', reject_reason = nullif(trim(p_reason), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status = 'PENDING';
  if not found then
    raise exception 'La solicitud no existe o ya fue atendida.';
  end if;
end;
$$;

-- Invita a un usuario ADMIN a una empresa existente (p. ej. reemplazo del dueño).
create or replace function public.platform_invite_admin(p_org_id uuid, p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_id    uuid;
begin
  perform public.assert_platform_admin();
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Ese correo ya tiene una cuenta en el sistema.';
  end if;
  update public.invitations set status = 'REVOKED' where lower(email) = v_email and status = 'PENDING';
  if public.org_seats_used(p_org_id) >= public.org_seat_limit(p_org_id) then
    raise exception 'La empresa no tiene cupos libres. Aumente los usuarios adicionales o cambie de plan.';
  end if;
  insert into public.invitations (org_id, email, full_name, role)
  values (p_org_id, v_email, nullif(trim(p_full_name), ''), 'ADMIN') returning id into v_id;
  return v_id;
end;
$$;

-- Registra un pago y extiende el periodo. Vigente o en gracia: el nuevo periodo
-- continúa al día siguiente del vencimiento (la gracia no es gratis). Prueba o
-- vencida: empieza en la fecha de pago.
create or replace function public.platform_register_payment(
  p_org_id uuid, p_plan_code text, p_amount numeric, p_method text,
  p_months integer, p_paid_at date, p_reference text
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  s        public.subscriptions%rowtype;
  v_start  date;
  v_end    date;
begin
  perform public.assert_platform_admin();
  select * into s from public.subscriptions where org_id = p_org_id for update;
  if not found then
    raise exception 'La empresa no tiene suscripción.';
  end if;

  v_start := coalesce(p_paid_at, current_date);
  if s.status <> 'TRIAL' and v_start <= s.current_period_end + s.grace_days then
    v_start := s.current_period_end + 1;
  end if;
  v_end := (v_start + make_interval(months => p_months))::date - 1;

  insert into public.subscription_payments (org_id, plan_code, amount, method, reference, months, paid_at, period_start, period_end)
  values (p_org_id, p_plan_code, p_amount, p_method, nullif(trim(p_reference), ''), p_months,
          coalesce(p_paid_at, current_date), v_start, v_end);

  update public.subscriptions
     set plan_code = p_plan_code, status = 'ACTIVE', current_period_end = v_end
   where org_id = p_org_id;
  return v_end;
end;
$$;

-- Edición manual: cambio de plan, usuarios extra, extender/ajustar fecha, suspender o reactivar.
create or replace function public.platform_update_subscription(
  p_org_id uuid, p_plan_code text, p_status text, p_extra_users integer,
  p_current_period_end date, p_grace_days integer, p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  update public.subscriptions
     set plan_code = p_plan_code,
         status = p_status,
         extra_users = p_extra_users,
         current_period_end = p_current_period_end,
         grace_days = p_grace_days,
         notes = nullif(trim(p_notes), '')
   where org_id = p_org_id;
  if not found then
    raise exception 'La empresa no tiene suscripción.';
  end if;
end;
$$;

-- Listado de empresas con su situación de plan y uso.
create or replace function public.platform_organizations()
returns table (
  org_id uuid, name text, tax_id text, email text, phone text,
  plan_code text, plan_name text, status text, state text,
  current_period_end date, days_left integer, grace_days integer, extra_users integer, notes text,
  seats_used integer, seat_limit integer, owner_name text, owner_email text,
  last_payment_at date, total_paid numeric, created_at timestamptz
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

-- Resumen de la plataforma: empresas por estado, ingreso mensual recurrente y cobrado.
create or replace function public.platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.assert_platform_admin();
  with orgs as (
    select s.org_id, public.org_access_state(s.org_id) as state, p.price_month, p.extra_user_price, s.extra_users
      from public.subscriptions s join public.plans p on p.code = s.plan_code
  )
  select jsonb_build_object(
    'total',      (select count(*) from orgs),
    'active',     (select count(*) from orgs where state = 'ACTIVE'),
    'trial',      (select count(*) from orgs where state = 'TRIAL'),
    'grace',      (select count(*) from orgs where state = 'GRACE'),
    'expired',    (select count(*) from orgs where state = 'EXPIRED'),
    'suspended',  (select count(*) from orgs where state in ('SUSPENDED', 'CANCELLED')),
    'pending_requests', (select count(*) from public.access_requests where status = 'PENDING'),
    'expiring_7_days',  (select count(*) from public.subscriptions s
                          where s.status in ('ACTIVE', 'TRIAL') and s.current_period_end between current_date and current_date + 7),
    'mrr', (select coalesce(sum(price_month + coalesce(extra_user_price, 0) * extra_users), 0)
              from orgs where state in ('ACTIVE', 'GRACE')),
    'collected_month', (select coalesce(sum(amount), 0) from public.subscription_payments
                         where date_trunc('month', paid_at) = date_trunc('month', current_date)),
    'revenue_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'amount', coalesce(t.amount, 0)) order by m), '[]'::jsonb)
        from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m
        left join (select date_trunc('month', paid_at) as month, sum(amount) as amount
                     from public.subscription_payments group by 1) t on t.month = m
    )
  ) into v;
  return v;
end;
$$;

-- Avisos por correo del día (Edge Function subscription-reminders, con service_role):
-- 7, 3, 1 y 0 días antes del vencimiento, al entrar en gracia y al vencer.
create or replace function public.subscription_reminders_due()
returns table (
  org_id uuid, company_name text, plan_name text, status text, state text,
  current_period_end date, days_left integer, grace_end date, admin_emails text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select s.org_id, coalesce(st.company_name, o.name), p.name, s.status, public.org_access_state(s.org_id),
         s.current_period_end, (s.current_period_end - current_date)::integer, s.current_period_end + s.grace_days,
         array(select pr.email from public.profiles pr where pr.org_id = s.org_id and pr.role = 'ADMIN' and pr.active)
    from public.subscriptions s
    join public.organizations o on o.id = s.org_id
    join public.plans p on p.code = s.plan_code
    left join public.settings st on st.org_id = s.org_id
   where s.status in ('TRIAL', 'ACTIVE')
     and (
       (s.current_period_end - current_date) in (7, 3, 1, 0)
       or current_date = s.current_period_end + 1
       or (s.status = 'ACTIVE' and s.grace_days > 0 and current_date = s.current_period_end + s.grace_days + 1)
     );
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function public.subscription_reminders_due() from public, anon, authenticated;
grant execute on function public.subscription_reminders_due() to service_role;

revoke execute on function public.submit_access_request(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_access_request(text, text, text, text, text, text, text) to anon, authenticated;

revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.assert_platform_admin() from public, anon;
revoke execute on function public.org_access_state(uuid) from public, anon;
revoke execute on function public.org_can_write(uuid) from public, anon;
revoke execute on function public.org_seat_limit(uuid) from public, anon;
revoke execute on function public.org_seats_used(uuid, text) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.assert_platform_admin() to authenticated;
grant execute on function public.org_access_state(uuid) to authenticated;
grant execute on function public.org_can_write(uuid) to authenticated;
grant execute on function public.org_seat_limit(uuid) to authenticated;
grant execute on function public.org_seats_used(uuid, text) to authenticated;

revoke execute on function public.my_subscription() from public, anon;
revoke execute on function public.create_invitation(text, text, text) from public, anon;
revoke execute on function public.invitation_for_sending(uuid) from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
revoke execute on function public.platform_approve_request(uuid, text, integer) from public, anon;
revoke execute on function public.platform_reject_request(uuid, text) from public, anon;
revoke execute on function public.platform_invite_admin(uuid, text, text) from public, anon;
revoke execute on function public.platform_register_payment(uuid, text, numeric, text, integer, date, text) from public, anon;
revoke execute on function public.platform_update_subscription(uuid, text, text, integer, date, integer, text) from public, anon;
revoke execute on function public.platform_organizations() from public, anon;
revoke execute on function public.platform_overview() from public, anon;
grant execute on function public.my_subscription() to authenticated;
grant execute on function public.create_invitation(text, text, text) to authenticated;
grant execute on function public.invitation_for_sending(uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.platform_approve_request(uuid, text, integer) to authenticated;
grant execute on function public.platform_reject_request(uuid, text) to authenticated;
grant execute on function public.platform_invite_admin(uuid, text, text) to authenticated;
grant execute on function public.platform_register_payment(uuid, text, numeric, text, integer, date, text) to authenticated;
grant execute on function public.platform_update_subscription(uuid, text, text, integer, date, integer, text) to authenticated;
grant execute on function public.platform_organizations() to authenticated;
grant execute on function public.platform_overview() to authenticated;

-- >>> 0010_reports.sql
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

-- >>> 0011_branches.sql
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
