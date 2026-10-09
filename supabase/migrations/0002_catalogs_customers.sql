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
