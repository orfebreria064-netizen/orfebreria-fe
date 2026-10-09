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
