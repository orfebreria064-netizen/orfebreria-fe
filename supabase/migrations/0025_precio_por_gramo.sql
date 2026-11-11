-- =====================================================================
-- 0025 · Precio por gramo
--   Cuando la línea se cotiza por gramos (unit = 'g', p. ej. oro) el importe
--   es precio × peso (columna Gr.), no precio × cantidad. Si la línea no
--   tiene peso, se usa la cantidad como antes. El resto de unidades
--   (und, par, ct, servicio…) siguen siendo precio × cantidad.
-- =====================================================================

create or replace function public.line_billable_qty(p_unit text, p_quantity numeric, p_weight numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when p_unit = 'g' and p_weight is not null and p_weight > 0 then p_weight else p_quantity end;
$$;

-- ---------------------------------------------------------------------
-- Ítems de cotización
-- ---------------------------------------------------------------------
alter table public.quotation_items drop constraint quotation_items_discount;
alter table public.quotation_items drop column subtotal;
alter table public.quotation_items
  add column subtotal numeric(12, 2)
    generated always as (round(public.line_billable_qty(unit, quantity, weight) * unit_price - discount, 2)) stored,
  add constraint quotation_items_discount
    check (discount <= round(public.line_billable_qty(unit, quantity, weight) * unit_price, 2));

-- ---------------------------------------------------------------------
-- Ítems de pedido
-- ---------------------------------------------------------------------
alter table public.order_items drop constraint order_items_discount;
alter table public.order_items drop column subtotal;
alter table public.order_items
  add column subtotal numeric(12, 2)
    generated always as (round(public.line_billable_qty(unit, quantity, weight) * unit_price - discount, 2)) stored,
  add constraint order_items_discount
    check (discount <= round(public.line_billable_qty(unit, quantity, weight) * unit_price, 2));

-- ---------------------------------------------------------------------
-- Totales de cabecera
-- ---------------------------------------------------------------------
create or replace function public.recalc_quotation_totals(p_quotation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.quotations q
     set subtotal       = coalesce(t.gross, 0),
         discount_total = coalesce(t.disc, 0)
    from (select round(sum(public.line_billable_qty(unit, quantity, weight) * unit_price), 2) as gross,
                 sum(discount) as disc
            from public.quotation_items where quotation_id = p_quotation_id) t
   where q.id = p_quotation_id
     and (q.subtotal, q.discount_total) is distinct from (coalesce(t.gross, 0), coalesce(t.disc, 0));
$$;
revoke execute on function public.recalc_quotation_totals(uuid) from public, anon, authenticated;

create or replace function public.recalc_order_totals(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders o
     set subtotal       = coalesce(t.gross, 0),
         discount_total = coalesce(t.disc, 0)
    from (select round(sum(public.line_billable_qty(unit, quantity, weight) * unit_price), 2) as gross,
                 sum(discount) as disc
            from public.order_items where order_id = p_order_id) t
   where o.id = p_order_id
     and (o.subtotal, o.discount_total) is distinct from (coalesce(t.gross, 0), coalesce(t.disc, 0));
$$;
revoke execute on function public.recalc_order_totals(uuid) from public, anon, authenticated;

-- Recalcular los documentos existentes con la nueva regla.
select public.recalc_quotation_totals(id) from public.quotations;
select public.recalc_order_totals(id) from public.orders;
