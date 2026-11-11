-- =====================================================================
-- 0024_vitrina_cantidad.sql
--   Cantidad en la vitrina: cada joya y cada piedra registrada tiene
--   unidades disponibles (products.quantity / gems.quantity).
--   * quantity = unidades disponibles para vender (no reservadas ni vendidas).
--   * Un ítem de pedido con joya o piedra puede llevar N unidades (entero):
--     al guardarlo se descuentan de la vitrina; al quitarlo o cancelar el
--     pedido vuelven; al reabrir un pedido cancelado se vuelven a tomar.
--   * El estado se calcula: STOCK mientras quedan unidades; con 0
--     unidades, RESERVADO/RESERVADA si hay un pedido abierto, VENDIDO/
--     VENDIDA si ya se entregó y BAJA si no hay pedido.
--   * Una piedra con certificado es única (cantidad 1). Solo se monta en
--     una joya una piedra registrada de 1 unidad, y una joya con piedras
--     registradas montadas es única (cantidad 1).
-- =====================================================================

alter table public.products add column quantity integer not null default 1 check (quantity >= 0);
alter table public.gems     add column quantity integer not null default 1 check (quantity >= 0);

-- Piezas existentes: las reservadas o vendidas ya no tienen unidades disponibles.
update public.products set quantity = 0 where status in ('RESERVADO', 'VENDIDO');
update public.gems     set quantity = 0 where status in ('RESERVADA', 'VENDIDA', 'DEVUELTA');

alter table public.gems
  add constraint gems_certificate_unique_qty check (certificate_number is null or quantity <= 1);

alter table public.order_items drop constraint order_items_piece_qty;
alter table public.order_items
  add constraint order_items_piece_qty
  check ((product_id is null and gem_id is null) or (quantity >= 1 and quantity = trunc(quantity)));

-- ---------------------------------------------------------------------
-- Estado calculado de una joya y de una piedra
-- ---------------------------------------------------------------------
create or replace function public.inventory_refresh_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty    integer;
  v_status text;
  v_order  uuid;
  v_open   boolean;
  v_new    text;
begin
  select quantity, status into v_qty, v_status from public.products where id = p_id;
  if not found or v_status = 'BAJA' then
    return;
  end if;

  -- Pedido más relevante: primero los abiertos, luego el más reciente.
  select oi.order_id, o.status not in ('ENTREGADO', 'CERRADO')
    into v_order, v_open
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.product_id = p_id and o.status <> 'CANCELADO'
   order by (o.status not in ('ENTREGADO', 'CERRADO')) desc, o.created_at desc
   limit 1;

  v_new := case when v_qty > 0 then 'STOCK'
                when v_open then 'RESERVADO'
                when v_order is not null then 'VENDIDO'
                else 'BAJA' end;

  update public.products
     set status = v_new,
         order_id = case when v_open or v_qty = 0 then v_order end,
         sold_at = case when v_new = 'VENDIDO' then coalesce(sold_at, now()) end
   where id = p_id
     and (status, order_id, sold_at) is distinct from
         (v_new, case when v_open or v_qty = 0 then v_order end,
          case when v_new = 'VENDIDO' then coalesce(sold_at, now()) end);

  -- Las piedras montadas siguen a la joya.
  if v_new = 'VENDIDO' then
    update public.gems set status = 'VENDIDA', sold_at = coalesce(sold_at, now()), order_id = v_order
     where product_id = p_id and status = 'MONTADA';
  else
    update public.gems set status = 'MONTADA', sold_at = null, order_id = null
     where product_id = p_id and status = 'VENDIDA';
  end if;
end;
$$;

create or replace function public.inventory_refresh_gem(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty     integer;
  v_status  text;
  v_product uuid;
  v_order   uuid;
  v_open    boolean;
  v_new     text;
begin
  select quantity, status, product_id into v_qty, v_status, v_product from public.gems where id = p_id;
  -- Las montadas siguen a su joya; las devueltas y las de baja no cambian solas.
  if not found or v_product is not null or v_status in ('BAJA', 'DEVUELTA', 'MONTADA') then
    return;
  end if;

  select oi.order_id, o.status not in ('ENTREGADO', 'CERRADO')
    into v_order, v_open
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.gem_id = p_id and o.status <> 'CANCELADO'
   order by (o.status not in ('ENTREGADO', 'CERRADO')) desc, o.created_at desc
   limit 1;

  v_new := case when v_qty > 0 then 'STOCK'
                when v_open then 'RESERVADA'
                when v_order is not null then 'VENDIDA'
                else 'BAJA' end;

  update public.gems
     set status = v_new,
         order_id = case when v_open or v_qty = 0 then v_order end,
         sold_at = case when v_new = 'VENDIDA' then coalesce(sold_at, now()) end
   where id = p_id
     and (status, order_id, sold_at) is distinct from
         (v_new, case when v_open or v_qty = 0 then v_order end,
          case when v_new = 'VENDIDA' then coalesce(sold_at, now()) end);
end;
$$;

-- Al cambiar la cantidad (o reactivar desde BAJA) se recalcula el estado.
create or replace function public.products_quantity_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reponer unidades a una joya sin stock la reactiva.
  if tg_op = 'UPDATE' and old.quantity = 0 and new.quantity > 0 and new.status = 'BAJA' then
    update public.products set status = 'STOCK' where id = new.id;
    return null;
  end if;
  perform public.inventory_refresh_product(new.id);
  return null;
end;
$$;
create trigger products_quantity_sync after insert or update of quantity, status on public.products
  for each row execute function public.products_quantity_sync();

create or replace function public.gems_quantity_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reponer unidades a una piedra sin stock la reactiva.
  if tg_op = 'UPDATE' and old.quantity = 0 and new.quantity > 0 and new.status = 'BAJA' then
    update public.gems set status = 'STOCK' where id = new.id;
    return null;
  end if;
  perform public.inventory_refresh_gem(new.id);
  return null;
end;
$$;
create trigger gems_quantity_sync after insert or update of quantity, status on public.gems
  for each row execute function public.gems_quantity_sync();

-- Una joya con piedras registradas montadas es una pieza única.
create or replace function public.products_check_quantity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quantity > 1 and exists (select 1 from public.product_gems where product_id = new.id and gem_id is not null) then
    raise exception 'Una joya con piedras registradas montadas es única: su cantidad debe ser 1.';
  end if;
  return new;
end;
$$;
create trigger products_check_quantity before update of quantity on public.products
  for each row execute function public.products_check_quantity();

-- ---------------------------------------------------------------------
-- Montar / desmontar: solo piedras de 1 unidad en joyas de 1 unidad
-- ---------------------------------------------------------------------
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
    if (select quantity from public.gems where id = new.gem_id) <> 1 then
      raise exception 'Solo se puede montar una piedra registrada de 1 unidad. Para un lote, describa el grupo de piedras.';
    end if;
    if (select quantity from public.products where id = new.product_id) > 1 then
      raise exception 'Una joya con piedras registradas montadas es única: su cantidad debe ser 1.';
    end if;
    update public.gems set status = 'MONTADA', product_id = new.product_id where id = new.gem_id;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Ítems de pedido: descuentan y devuelven unidades
-- ---------------------------------------------------------------------
create or replace function public.order_items_inventory_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active boolean;
  v_avail  integer;
  v_code   text;
begin
  if tg_op in ('UPDATE', 'DELETE') and (old.product_id is not null or old.gem_id is not null) then
    -- Si el pedido ya no existe (borrado en cascada) las unidades también vuelven.
    select status <> 'CANCELADO' into v_active from public.orders where id = old.order_id;
    if coalesce(v_active, true) then
      if old.product_id is not null then
        update public.products set quantity = quantity + old.quantity::integer where id = old.product_id;
      else
        update public.gems set quantity = quantity + old.quantity::integer where id = old.gem_id;
      end if;
    else
      if old.product_id is not null then
        perform public.inventory_refresh_product(old.product_id);
      else
        perform public.inventory_refresh_gem(old.gem_id);
      end if;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and (new.product_id is not null or new.gem_id is not null) then
    select status <> 'CANCELADO' into v_active from public.orders where id = new.order_id;
    if coalesce(v_active, false) then
      if new.product_id is not null then
        update public.products set quantity = quantity - new.quantity::integer
         where id = new.product_id and org_id = new.org_id and status <> 'BAJA' and quantity >= new.quantity;
        if not found then
          select code, case when status = 'BAJA' then 0 else quantity end into v_code, v_avail
            from public.products where id = new.product_id;
          raise exception 'La joya % no tiene % unidad(es) disponibles en vitrina (disponibles: %).',
            coalesce(v_code, ''), new.quantity::integer, coalesce(v_avail, 0);
        end if;
      else
        update public.gems set quantity = quantity - new.quantity::integer
         where id = new.gem_id and org_id = new.org_id and product_id is null
           and status not in ('BAJA', 'MONTADA', 'DEVUELTA') and quantity >= new.quantity;
        if not found then
          select code, case when status in ('BAJA', 'MONTADA', 'DEVUELTA') then 0 else quantity end into v_code, v_avail
            from public.gems where id = new.gem_id;
          raise exception 'La piedra % no tiene % unidad(es) disponibles (disponibles: %).',
            coalesce(v_code, ''), new.quantity::integer, coalesce(v_avail, 0);
        end if;
      end if;
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Estado del pedido: cancelar devuelve unidades, reabrir las vuelve a tomar
-- ---------------------------------------------------------------------
create or replace function public.orders_inventory_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if new.status = 'CANCELADO' then
    update public.products p set quantity = p.quantity + s.qty
      from (select product_id, sum(quantity)::integer as qty from public.order_items
             where order_id = new.id and product_id is not null group by product_id) s
     where p.id = s.product_id;
    update public.gems g set quantity = g.quantity + s.qty
      from (select gem_id, sum(quantity)::integer as qty from public.order_items
             where order_id = new.id and gem_id is not null group by gem_id) s
     where g.id = s.gem_id;
  elsif old.status = 'CANCELADO' then
    select p.code into v_code
      from (select product_id, sum(quantity)::integer as qty from public.order_items
             where order_id = new.id and product_id is not null group by product_id) s
      join public.products p on p.id = s.product_id
     where p.status = 'BAJA' or p.quantity < s.qty
     limit 1;
    if found then
      raise exception 'La joya % ya no tiene unidades suficientes en vitrina.', v_code;
    end if;
    select g.code into v_code
      from (select gem_id, sum(quantity)::integer as qty from public.order_items
             where order_id = new.id and gem_id is not null group by gem_id) s
      join public.gems g on g.id = s.gem_id
     where g.status in ('BAJA', 'MONTADA', 'DEVUELTA') or g.product_id is not null or g.quantity < s.qty
     limit 1;
    if found then
      raise exception 'La piedra % ya no tiene unidades suficientes.', v_code;
    end if;
    update public.products p set quantity = p.quantity - s.qty
      from (select product_id, sum(quantity)::integer as qty from public.order_items
             where order_id = new.id and product_id is not null group by product_id) s
     where p.id = s.product_id;
    update public.gems g set quantity = g.quantity - s.qty
      from (select gem_id, sum(quantity)::integer as qty from public.order_items
             where order_id = new.id and gem_id is not null group by gem_id) s
     where g.id = s.gem_id;
  end if;

  -- Entregado / reabierto: reservada ↔ vendida.
  perform public.inventory_refresh_product(x.product_id)
     from (select distinct product_id from public.order_items where order_id = new.id and product_id is not null) x;
  perform public.inventory_refresh_gem(x.gem_id)
     from (select distinct gem_id from public.order_items where order_id = new.id and gem_id is not null) x;
  return null;
end;
$$;

revoke execute on function public.inventory_refresh_product(uuid) from public, anon, authenticated;
revoke execute on function public.inventory_refresh_gem(uuid) from public, anon, authenticated;
revoke execute on function public.products_quantity_sync() from public, anon, authenticated;
revoke execute on function public.gems_quantity_sync() from public, anon, authenticated;
revoke execute on function public.products_check_quantity() from public, anon, authenticated;
revoke execute on function public.product_gems_sync() from public, anon, authenticated;
revoke execute on function public.order_items_inventory_sync() from public, anon, authenticated;
revoke execute on function public.orders_inventory_status() from public, anon, authenticated;
