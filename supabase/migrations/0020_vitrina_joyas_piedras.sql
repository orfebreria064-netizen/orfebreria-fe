-- =====================================================================
-- 0020_vitrina_joyas_piedras.sql
--   * Joyas terminadas en stock (vitrina): una fila por pieza.
--   * Piedras registradas una a una (diamantes y gemas de valor) con las
--     4C de GIA: quilates, color (D–Z), claridad (FL–I3) y talla
--     (Excelente–Pobre), más pulido, simetría, fluorescencia, medidas y
--     certificado. Las piedras pequeñas sin certificado (melee) siguen en
--     materiales por quilates.
--   * product_gems: piedras que lleva cada joya (una piedra registrada o
--     un grupo descrito: "12 brillantes 0.24 ct total").
--   * Venta: un pedido de tipo VENTA cuyo ítem apunta a la joya o a la
--     piedra (order_items.product_id / gem_id). Al guardar el pedido la
--     pieza queda RESERVADA; al entregarlo, VENDIDA; si se cancela, vuelve
--     a stock.
--   * Fotos en el bucket privado "products" (carpeta = empresa).
-- =====================================================================

-- Numeración: JY (joya) y PD (piedra), correlativo sin año (year = 0)
alter table public.document_sequences drop constraint document_sequences_doc_type_check;
alter table public.document_sequences
  add constraint document_sequences_doc_type_check
  check (doc_type in ('COT', 'PED', 'ENT', 'PRO', 'OP', 'RI', 'RE', 'GA', 'PR', 'AP', 'JY', 'PD'));

-- ---------------------------------------------------------------------
-- Joyas
-- ---------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  branch_id    uuid not null references public.branches (id),
  code         text not null,
  name         text not null check (length(trim(name)) > 0),
  category     text not null check (category in ('ANILLO', 'ARO_COMPROMISO', 'ARETES', 'COLLAR', 'CADENA', 'DIJE',
                                                 'PULSERA', 'BRAZALETE', 'GEMELOS', 'PRENDEDOR', 'RELOJ', 'OTRO')),
  material_id  uuid references public.materials (id),
  metal        text,                                  -- "Oro 18K", "Plata 925"
  metal_color  text check (metal_color in ('AMARILLO', 'BLANCO', 'ROSADO', 'BICOLOR', 'TRICOLOR')),
  weight_g     numeric(10, 2) check (weight_g is null or weight_g > 0),
  size         text,                                  -- talla del anillo, largo de la cadena
  description  text,
  cost         numeric(12, 2) not null default 0 check (cost >= 0),
  price        numeric(12, 2) not null check (price >= 0),
  currency     text not null default 'PEN' check (currency in ('PEN', 'USD')),
  photo_path   text,
  status       text not null default 'STOCK' check (status in ('STOCK', 'RESERVADO', 'VENDIDO', 'BAJA')),
  order_id     uuid references public.orders (id),    -- pedido que la reserva o la vendió
  sold_at      timestamptz,
  notes        text,
  created_by   uuid default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, code)
);
create index products_org_status_idx on public.products (org_id, status, category);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger aa_subscription_guard before insert or update or delete on public.products
  for each row execute function public.enforce_org_writable();

-- ---------------------------------------------------------------------
-- Piedras (una fila por piedra)
-- ---------------------------------------------------------------------
create table public.gems (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  branch_id           uuid not null references public.branches (id),
  code                text not null,
  gem_type            text not null default 'DIAMANTE'
                      check (gem_type in ('DIAMANTE', 'ESMERALDA', 'RUBI', 'ZAFIRO', 'TANZANITA', 'AMATISTA', 'TOPACIO',
                                          'AGUAMARINA', 'PERLA', 'OTRA')),
  shape               text not null check (shape in ('REDONDO', 'PRINCESA', 'OVALO', 'PERA', 'ESMERALDA', 'CORAZON',
                                                     'MARQUISE', 'COJIN', 'RADIANT', 'ASSCHER', 'BAGUETTE', 'TRILLION', 'OTRA')),
  carat               numeric(8, 3) not null check (carat > 0),
  color               text,              -- D…Z en diamantes; descripción libre en gemas de color
  clarity             text check (clarity in ('FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3')),
  cut_grade           text check (cut_grade in ('EXCELENTE', 'MUY_BUENA', 'BUENA', 'REGULAR', 'POBRE')),
  polish              text check (polish in ('EXCELENTE', 'MUY_BUENA', 'BUENA', 'REGULAR', 'POBRE')),
  symmetry            text check (symmetry in ('EXCELENTE', 'MUY_BUENA', 'BUENA', 'REGULAR', 'POBRE')),
  fluorescence        text check (fluorescence in ('NINGUNA', 'DEBIL', 'MEDIA', 'FUERTE', 'MUY_FUERTE')),
  length_mm           numeric(6, 2) check (length_mm is null or length_mm > 0),
  width_mm            numeric(6, 2) check (width_mm is null or width_mm > 0),
  depth_mm            numeric(6, 2) check (depth_mm is null or depth_mm > 0),
  lab                 text check (lab in ('GIA', 'IGI', 'HRD', 'AGS', 'GCAL', 'OTRO')),
  certificate_number  text,
  origin              text not null default 'EMPRESA' check (origin in ('EMPRESA', 'CLIENTE')),
  customer_id         uuid references public.customers (id),     -- dueño si es del cliente
  cost                numeric(12, 2) not null default 0 check (cost >= 0),
  price               numeric(12, 2) not null default 0 check (price >= 0),
  currency            text not null default 'USD' check (currency in ('PEN', 'USD')),
  photo_path          text,
  status              text not null default 'STOCK'
                      check (status in ('STOCK', 'RESERVADA', 'MONTADA', 'VENDIDA', 'DEVUELTA', 'BAJA')),
  product_id          uuid references public.products (id),      -- joya en la que está montada
  order_id            uuid references public.orders (id),
  sold_at             timestamptz,
  notes               text,
  created_by          uuid default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, code),
  constraint gems_diamond_color check (gem_type <> 'DIAMANTE' or color is null or color ~ '^[D-Z]$'),
  constraint gems_customer check ((origin = 'CLIENTE') = (customer_id is not null))
);
create index gems_org_status_idx on public.gems (org_id, status, gem_type);
create unique index gems_certificate_uidx on public.gems (org_id, lab, certificate_number) where certificate_number is not null;
create trigger gems_updated_at before update on public.gems
  for each row execute function public.set_updated_at();
create trigger aa_subscription_guard before insert or update or delete on public.gems
  for each row execute function public.enforce_org_writable();

-- Piedras de cada joya
create table public.product_gems (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  gem_id       uuid references public.gems (id),
  role         text not null default 'CENTRAL' check (role in ('CENTRAL', 'LATERAL', 'PAVE', 'OTRA')),
  description  text,                           -- para grupos sin registro individual
  quantity     integer not null default 1 check (quantity > 0),
  total_carat  numeric(8, 3) check (total_carat is null or total_carat > 0),
  constraint product_gems_what check (gem_id is not null or length(trim(coalesce(description, ''))) > 0)
);
create index product_gems_product_idx on public.product_gems (product_id);
create unique index product_gems_gem_uidx on public.product_gems (gem_id) where gem_id is not null;
create trigger aa_subscription_guard before insert or update or delete on public.product_gems
  for each row execute function public.enforce_org_writable();

-- Código automático (JY-000001 / PD-000001) si no se indica uno
create or replace function public.inventory_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := case tg_table_name when 'products' then 'JY' else 'PD' end;
  v_next   integer;
begin
  new.branch_id := coalesce(new.branch_id, public.default_branch_id(new.org_id));
  if nullif(trim(new.code), '') is null then
    insert into public.document_sequences as s (org_id, doc_type, year, last_value)
    values (new.org_id, v_prefix, 0, 1)
    on conflict (org_id, doc_type, year) do update set last_value = s.last_value + 1
    returning last_value into v_next;
    new.code := v_prefix || '-' || lpad(v_next::text, 6, '0');
  else
    new.code := upper(trim(new.code));
  end if;
  return new;
end;
$$;
create trigger products_before_insert before insert on public.products
  for each row execute function public.inventory_before_insert();
create trigger gems_before_insert before insert on public.gems
  for each row execute function public.inventory_before_insert();

-- Montar / desmontar una piedra registrada en una joya
create or replace function public.product_gems_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.gem_id is not null then
    update public.gems set status = 'STOCK', product_id = null
     where id = old.gem_id and product_id = old.product_id and status = 'MONTADA';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.gem_id is not null then
    if not exists (select 1 from public.gems
                    where id = new.gem_id and org_id = new.org_id
                      and (status = 'STOCK' or (status = 'MONTADA' and product_id = new.product_id))) then
      raise exception 'La piedra no está disponible en stock.';
    end if;
    update public.gems set status = 'MONTADA', product_id = new.product_id where id = new.gem_id;
  end if;
  return null;
end;
$$;
create trigger product_gems_sync after insert or update or delete on public.product_gems
  for each row execute function public.product_gems_sync();

-- ---------------------------------------------------------------------
-- Venta desde pedidos
-- ---------------------------------------------------------------------
alter table public.order_items
  add column product_id uuid references public.products (id),
  add column gem_id     uuid references public.gems (id),
  add constraint order_items_one_piece check (product_id is null or gem_id is null),
  add constraint order_items_piece_qty check ((product_id is null and gem_id is null) or quantity = 1);
create index order_items_product_idx on public.order_items (product_id) where product_id is not null;
create index order_items_gem_idx on public.order_items (gem_id) where gem_id is not null;

create or replace function public.order_items_inventory_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.product_id is not null then
      update public.products set status = 'STOCK', order_id = null
       where id = old.product_id and order_id = old.order_id and status = 'RESERVADO';
    end if;
    if old.gem_id is not null then
      update public.gems set status = 'STOCK', order_id = null
       where id = old.gem_id and order_id = old.order_id and status = 'RESERVADA';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.product_id is not null then
      update public.products set status = 'RESERVADO', order_id = new.order_id
       where id = new.product_id and org_id = new.org_id
         and (status = 'STOCK' or (status = 'RESERVADO' and order_id = new.order_id));
      if not found then
        raise exception 'La joya % ya no está disponible en vitrina.',
          coalesce((select code from public.products where id = new.product_id), '');
      end if;
    end if;
    if new.gem_id is not null then
      update public.gems set status = 'RESERVADA', order_id = new.order_id
       where id = new.gem_id and org_id = new.org_id
         and (status = 'STOCK' or (status = 'RESERVADA' and order_id = new.order_id));
      if not found then
        raise exception 'La piedra % ya no está disponible.',
          coalesce((select code from public.gems where id = new.gem_id), '');
      end if;
    end if;
  end if;
  return null;
end;
$$;
create trigger order_items_inventory_sync after insert or update or delete on public.order_items
  for each row execute function public.order_items_inventory_sync();

-- Al entregar: vendida. Al cancelar: vuelve a stock. Al reabrir una entrega: reservada otra vez.
create or replace function public.orders_inventory_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('ENTREGADO', 'CERRADO') and old.status not in ('ENTREGADO', 'CERRADO') then
    update public.products set status = 'VENDIDO', sold_at = now() where order_id = new.id and status = 'RESERVADO';
    update public.gems set status = 'VENDIDA', sold_at = now() where order_id = new.id and status = 'RESERVADA';
    -- Las piedras montadas en la joya vendida se van con ella.
    update public.gems g set status = 'VENDIDA', sold_at = now(), order_id = new.id
      from public.products p
     where p.order_id = new.id and g.product_id = p.id and g.status = 'MONTADA';
  elsif new.status = 'CANCELADO' then
    update public.products set status = 'STOCK', order_id = null, sold_at = null
     where order_id = new.id and status in ('RESERVADO', 'VENDIDO');
    update public.gems g set status = case when g.product_id is not null then 'MONTADA' else 'STOCK' end,
                             order_id = null, sold_at = null
     where g.order_id = new.id and g.status in ('RESERVADA', 'VENDIDA');
  elsif old.status in ('ENTREGADO', 'CERRADO') and new.status not in ('ENTREGADO', 'CERRADO') then
    update public.products set status = 'RESERVADO', sold_at = null where order_id = new.id and status = 'VENDIDO';
    update public.gems g set status = case when g.product_id is not null then 'MONTADA' else 'RESERVADA' end, sold_at = null
     where g.order_id = new.id and g.status = 'VENDIDA';
  elsif old.status = 'CANCELADO' then
    -- Reapertura: vuelve a reservar las piezas de sus ítems (falla si ya se vendieron en otro pedido).
    update public.order_items set product_id = product_id where order_id = new.id and (product_id is not null or gem_id is not null);
  end if;
  return null;
end;
$$;
create trigger orders_inventory_status after update of status on public.orders
  for each row when (new.status is distinct from old.status)
  execute function public.orders_inventory_status();

-- save_order: ahora guarda la joya o piedra de cada ítem
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
                                  quantity, unit, weight, unit_price, discount, product_id, gem_id)
  select v_id, (i.ord - 1)::integer, i.item ->> 'description', i.item ->> 'detail',
         nullif(i.item ->> 'material_id', '')::uuid, i.item ->> 'material_name',
         (i.item ->> 'quantity')::numeric, coalesce(i.item ->> 'unit', 'und'),
         nullif(i.item ->> 'weight', '')::numeric,
         (i.item ->> 'unit_price')::numeric, coalesce((i.item ->> 'discount')::numeric, 0),
         nullif(i.item ->> 'product_id', '')::uuid, nullif(i.item ->> 'gem_id', '')::uuid
    from jsonb_array_elements(p_items) with ordinality as i(item, ord);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.products     enable row level security;
alter table public.gems         enable row level security;
alter table public.product_gems enable row level security;

-- Lectura: todo el personal comercial y de taller; el costo lo oculta la app a quien no es ADMIN/GERENTE.
create policy products_select on public.products for select to authenticated
  using (org_id = public.current_org_id() and branch_id in (select public.current_branch_ids()));
create policy products_insert on public.products for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE')
              and branch_id in (select public.current_branch_ids()));
-- Estado y pedido los cambian solo los triggers (SECURITY DEFINER); BAJA sí puede marcarla el usuario.
create policy products_update on public.products for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'))
  with check (org_id = public.current_org_id() and branch_id in (select public.current_branch_ids()));

create policy gems_select on public.gems for select to authenticated
  using (org_id = public.current_org_id() and branch_id in (select public.current_branch_ids()));
create policy gems_insert on public.gems for insert to authenticated
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE')
              and branch_id in (select public.current_branch_ids()));
create policy gems_update on public.gems for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'))
  with check (org_id = public.current_org_id() and branch_id in (select public.current_branch_ids()));

create policy product_gems_select on public.product_gems for select to authenticated
  using (org_id = public.current_org_id());
create policy product_gems_write on public.product_gems for all to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'))
  with check (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE')
              and exists (select 1 from public.products p where p.id = product_id and p.org_id = public.current_org_id()));

-- El usuario no cambia a mano status/order_id/sold_at salvo dar de baja o reactivar una pieza en stock.
create or replace function public.inventory_protect_status()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.status, new.order_id, new.sold_at) is distinct from (old.status, old.order_id, old.sold_at)
     and not (new.order_id is not distinct from old.order_id and new.sold_at is not distinct from old.sold_at
              and old.status in ('STOCK', 'BAJA') and new.status in ('STOCK', 'BAJA')) then
    raise exception 'El estado de la pieza lo cambian los pedidos (reserva, venta o cancelación).';
  end if;
  return new;
end;
$$;
create trigger products_protect_status before update on public.products
  for each row execute function public.inventory_protect_status();
create trigger gems_protect_status before update on public.gems
  for each row execute function public.inventory_protect_status();

-- ---------------------------------------------------------------------
-- Fotos (bucket privado; la primera carpeta es el id de la empresa)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy products_files_select on storage.objects for select to authenticated
  using (bucket_id = 'products' and (storage.foldername(name))[1] = public.current_org_id()::text);
create policy products_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and (storage.foldername(name))[1] = public.current_org_id()::text
              and public.has_role('ADMIN', 'GERENTE'));
create policy products_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'products' and (storage.foldername(name))[1] = public.current_org_id()::text
         and public.has_role('ADMIN', 'GERENTE'));

revoke execute on function public.inventory_before_insert() from public, anon, authenticated;
revoke execute on function public.product_gems_sync() from public, anon, authenticated;
revoke execute on function public.order_items_inventory_sync() from public, anon, authenticated;
revoke execute on function public.orders_inventory_status() from public, anon, authenticated;
revoke execute on function public.inventory_protect_status() from public, anon, authenticated;
