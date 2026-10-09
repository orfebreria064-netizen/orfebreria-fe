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
