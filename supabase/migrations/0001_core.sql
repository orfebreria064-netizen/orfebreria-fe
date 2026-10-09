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
