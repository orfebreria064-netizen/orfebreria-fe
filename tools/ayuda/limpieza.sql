-- =====================================================================
-- Borra definitivamente los datos de demostración que crean los guiones de tools/ayuda.
-- Ejecutar completo en el SQL Editor de Supabase (corre en una sola transacción).
--
-- Qué se considera "demo" (nombres de tools/ayuda/lib/demo.mjs):
--   · clientes con correo @ejemplo.pe, y todo lo que cuelga de ellos (cotizaciones, pedidos,
--     pagos, entregas, actas, archivos, historial)
--   · el material "Oro 18K" (y sus copias "Oro 18K (demo …)"), el joyero "Carlos Mendoza Huamán",
--     la joya "Aretes de oro 18K con perla", el diamante demo de 0.50 ct, el gasto "Recibo de luz
--     de noviembre" y los préstamos al joyero demo
--   · solo lo creado desde el 2026-11-04 (inicio de las grabaciones)
--
-- Al final, si no queda ningún documento, reinicia los correlativos del año (COT, PED, RE…)
-- para que BRILLOS empiece en 000001.
-- =====================================================================
begin;

-- Los triggers de auditoría y de bloqueo (p. ej. no borrar etapas de pedidos entregados) se
-- desactivan solo durante esta transacción; por eso los hijos se borran explícitamente.
set local session_replication_role = replica;

create temp table demo_clientes on commit drop as
  select id from public.customers where email like '%@ejemplo.pe' and created_at >= '2026-11-04';
create temp table demo_pedidos on commit drop as
  select id from public.orders where customer_id in (select id from demo_clientes);
create temp table demo_cotizaciones on commit drop as
  select id from public.quotations where customer_id in (select id from demo_clientes);
create temp table demo_materiales on commit drop as
  select id from public.materials
  where (name = 'Oro 18K' or name like 'Oro 18K (demo %)') and created_at >= '2026-11-04';
create temp table demo_joyeros on commit drop as
  select id from public.jewelers where full_name = 'Carlos Mendoza Huamán' and created_at >= '2026-11-04';
create temp table demo_joyas on commit drop as
  select id from public.products
  where created_at >= '2026-11-04'
    and (name = 'Aretes de oro 18K con perla' or order_id in (select id from demo_pedidos));
create temp table demo_piedras on commit drop as
  select id from public.gems
  where created_at >= '2026-11-04'
    and ((carat = 0.5 and price = 1400)
         or customer_id in (select id from demo_clientes)
         or order_id in (select id from demo_pedidos)
         or product_id in (select id from demo_joyas));
create temp table demo_actas on commit drop as
  select id from public.customer_receipts
  where order_id in (select id from demo_pedidos) or customer_id in (select id from demo_clientes);
create temp table demo_prestamos on commit drop as
  select id from public.loans where jeweler_id in (select id from demo_joyeros);

-- Resumen de lo que se va a borrar
select 'clientes' as tabla, count(*) from demo_clientes
union all select 'cotizaciones', count(*) from demo_cotizaciones
union all select 'pedidos', count(*) from demo_pedidos
union all select 'materiales', count(*) from demo_materiales
union all select 'joyeros', count(*) from demo_joyeros
union all select 'joyas', count(*) from demo_joyas
union all select 'piedras', count(*) from demo_piedras
union all select 'actas', count(*) from demo_actas
union all select 'préstamos', count(*) from demo_prestamos;

-- Referencias circulares: se sueltan antes de borrar
update public.quotations set order_id = null where id in (select id from demo_cotizaciones);
update public.orders set quotation_id = null where id in (select id from demo_pedidos);
update public.gems set product_id = null, order_id = null where id in (select id from demo_piedras);
update public.products set order_id = null where id in (select id from demo_joyas);

-- Vitrina
delete from public.product_gems where product_id in (select id from demo_joyas) or gem_id in (select id from demo_piedras);
delete from public.order_items where product_id in (select id from demo_joyas);
delete from public.gems where id in (select id from demo_piedras);
delete from public.products where id in (select id from demo_joyas);

-- Actas de recepción y reparaciones
delete from public.customer_receipt_items where receipt_id in (select id from demo_actas);
delete from public.customer_receipts where id in (select id from demo_actas);

-- Movimiento de dinero y entregas
delete from public.payments where order_id in (select id from demo_pedidos);
delete from public.jeweler_payments where order_id in (select id from demo_pedidos) or jeweler_id in (select id from demo_joyeros);
delete from public.deliveries where order_id in (select id from demo_pedidos) or customer_id in (select id from demo_clientes);
delete from public.loan_payments where loan_id in (select id from demo_prestamos);
delete from public.loans where id in (select id from demo_prestamos);
delete from public.expenses
  where description = 'Recibo de luz de noviembre' and supplier = 'Luz del Sur' and created_at >= '2026-11-04';

-- Material
delete from public.customer_receipt_items where material_id in (select id from demo_materiales);
delete from public.material_movements
  where material_id in (select id from demo_materiales) or order_id in (select id from demo_pedidos);
delete from public.material_prices where material_id in (select id from demo_materiales);
delete from public.material_stock where material_id in (select id from demo_materiales);
update public.quotation_items set material_id = null where material_id in (select id from demo_materiales);
update public.order_items set material_id = null where material_id in (select id from demo_materiales);

-- Pedidos y cotizaciones
delete from public.attachments where order_id in (select id from demo_pedidos);
delete from public.order_history where order_id in (select id from demo_pedidos);
delete from public.order_production_stages where order_id in (select id from demo_pedidos);
delete from public.order_items where order_id in (select id from demo_pedidos);
delete from public.orders where id in (select id from demo_pedidos);
delete from public.quotation_items where quotation_id in (select id from demo_cotizaciones);
delete from public.quotations where id in (select id from demo_cotizaciones);

-- Catálogos demo
update public.orders set jeweler_id = null where jeweler_id in (select id from demo_joyeros);
delete from public.jewelers where id in (select id from demo_joyeros);
delete from public.materials where id in (select id from demo_materiales);

-- Clientes
delete from public.statement_sends where customer_id in (select id from demo_clientes);
delete from public.customer_contacts where customer_id in (select id from demo_clientes);
delete from public.customers where id in (select id from demo_clientes);

-- Correlativos: si no quedó ningún documento real, la numeración vuelve a empezar
do $$
begin
  if not exists (select 1 from public.quotations) and not exists (select 1 from public.orders)
     and not exists (select 1 from public.payments) and not exists (select 1 from public.deliveries)
     and not exists (select 1 from public.jeweler_payments) and not exists (select 1 from public.expenses)
     and not exists (select 1 from public.loans) and not exists (select 1 from public.products)
     and not exists (select 1 from public.gems) and not exists (select 1 from public.customer_receipts) then
    delete from public.document_sequences where year = extract(year from now())::integer;
    raise notice 'Correlativos del año reiniciados.';
  else
    raise notice 'Hay documentos reales: los correlativos no se tocaron.';
  end if;
end $$;

commit;

-- Archivos de demostración en Storage (bucket "orders") de los pedidos borrados: no hay
-- (los guiones no suben archivos). Los videos del bucket "ayuda" se conservan.
