-- =====================================================================
-- seed.sql — Datos demo (ejecutar en el SQL Editor DESPUÉS de las migraciones)
-- Idempotente: si ya existen clientes no inserta nada.
-- Recomendado: registre primero su usuario administrador para que los
-- pedidos demo queden asignados a él.
-- Todo pasa por los triggers reales (numeración, totales, stock, auditoría).
-- =====================================================================
do $$
declare
  v_org uuid;
  v_admin uuid;
  st_venta uuid; st_fab uuid; st_rep uuid; st_mod uuid;
  c_juan uuid; c_maria uuid; c_carlos uuid; c_lucia uuid; c_andina uuid;
  m_oro18 uuid; m_oro14 uuid; m_plata uuid; m_diam uuid; m_rubi uuid; m_zaf uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; o8 uuid;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    insert into public.organizations (name) values ('Orfebrería Demo') returning id into v_org;
    insert into public.settings (org_id) values (v_org);
  end if;

  if exists (select 1 from public.customers where org_id = v_org) then
    raise notice 'La organización ya tiene clientes; se omite el seed.';
    return;
  end if;

  update public.settings
     set company_name = 'Orfebrería Aurum', tax_id = '20601234567', address = 'Jr. de la Unión 455, Lima',
         phone = '01 426 7788', email = 'ventas@aurum.pe'
   where org_id = v_org;

  select id into v_admin from public.profiles where org_id = v_org and role = 'ADMIN' and active order by created_at limit 1;

  select id into st_venta from public.service_types where org_id = v_org and code = 'VENTA';
  select id into st_fab   from public.service_types where org_id = v_org and code = 'FABRICACION';
  select id into st_rep   from public.service_types where org_id = v_org and code = 'REPARACION';
  select id into st_mod   from public.service_types where org_id = v_org and code = 'MODIFICACION';

  -- -------------------------------------------------------------- Clientes
  insert into public.customers (org_id, person_type, first_name, last_name, document_type, document_number, phone, whatsapp, email, address, city, notes)
  values (v_org, 'NATURAL', 'Juan', 'Pérez Gamarra', 'DNI', '45871236', '987654321', '987654321', 'juan.perez@correo.pe', 'Av. Arequipa 1450', 'Lima', 'Cliente frecuente. Prefiere oro amarillo.')
  returning id into c_juan;
  insert into public.customers (org_id, person_type, first_name, last_name, document_type, document_number, phone, whatsapp, email, address, city)
  values (v_org, 'NATURAL', 'María', 'Torres Quispe', 'DNI', '41236587', '954112233', '954112233', 'maria.torres@correo.pe', 'Calle Los Pinos 230', 'Miraflores')
  returning id into c_maria;
  insert into public.customers (org_id, person_type, first_name, last_name, document_type, document_number, phone, whatsapp, city)
  values (v_org, 'NATURAL', 'Carlos', 'Ramírez Soto', 'DNI', '70125489', '965478123', '965478123', 'San Isidro')
  returning id into c_carlos;
  insert into public.customers (org_id, person_type, first_name, last_name, document_type, document_number, phone, whatsapp, email, city)
  values (v_org, 'NATURAL', 'Lucía', 'Fernández Ríos', 'DNI', '46985213', '912345678', '912345678', 'lucia.fr@correo.pe', 'Surco')
  returning id into c_lucia;
  insert into public.customers (org_id, person_type, business_name, document_type, document_number, phone, email, address, city, notes)
  values (v_org, 'EMPRESA', 'Joyería Andina S.A.C.', 'RUC', '20587412369', '01 445 9988', 'compras@joyeriaandina.pe', 'Av. Larco 890', 'Miraflores', 'Pedidos por volumen; pago a 30 días.')
  returning id into c_andina;
  insert into public.customer_contacts (org_id, customer_id, name, position, phone, email)
  values (v_org, c_andina, 'Rosa Medina', 'Jefa de compras', '998877665', 'rmedina@joyeriaandina.pe');

  -- ------------------------------------------------------------ Materiales
  insert into public.materials (org_id, name, type, purity, unit, stock, min_stock, reference_cost)
  values (v_org, 'Oro 18K', 'ORO', '18K', 'g', 125.50, 50, 285.00) returning id into m_oro18;
  insert into public.materials (org_id, name, type, purity, unit, stock, min_stock, reference_cost)
  values (v_org, 'Oro 14K', 'ORO', '14K', 'g', 80.00, 30, 220.00) returning id into m_oro14;
  insert into public.materials (org_id, name, type, purity, unit, stock, min_stock, reference_cost)
  values (v_org, 'Plata 925', 'PLATA', '925', 'g', 520.00, 200, 4.20) returning id into m_plata;
  insert into public.materials (org_id, name, type, purity, unit, stock, min_stock, reference_cost)
  values (v_org, 'Diamante', 'PIEDRA_PRECIOSA', 'VS1', 'ct', 6.50, 2, 3800.00) returning id into m_diam;
  insert into public.materials (org_id, name, type, purity, unit, stock, min_stock, reference_cost)
  values (v_org, 'Rubí', 'PIEDRA_PRECIOSA', null, 'ct', 8.00, 2, 1200.00) returning id into m_rubi;
  insert into public.materials (org_id, name, type, purity, unit, stock, min_stock, reference_cost)
  values (v_org, 'Zafiro', 'PIEDRA_PRECIOSA', null, 'ct', 10.00, 2, 950.00) returning id into m_zaf;

  -- ----------------------------------------------------------- Cotizaciones
  -- Q1: aprobada y convertida (pedido O1)
  insert into public.quotations (org_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material, estimated_weight, stone, size, notes, terms, tax_rate)
  values (v_org, c_juan, st_fab, current_date - 40, current_date - 25, 'Anillo de compromiso en oro 18K', 'Oro 18K', 8.50, 'Diamante 0.50 ct', '18',
          'Grabado interior: "J & A 2026".', 'Adelanto del 50%. Saldo contra entrega.', 18)
  returning id into q1;
  insert into public.quotation_items (org_id, quotation_id, position, description, detail, material_id, material_name, quantity, unit, unit_price, discount) values
    (v_org, q1, 0, 'Fabricación anillo solitario', 'Diseño personalizado, montura de 6 garras', m_oro18, 'Oro 18K', 1, 'und', 1250.00, 0),
    (v_org, q1, 1, 'Diamante central', 'Talla brillante 0.50 ct VS1', m_diam, 'Diamante', 0.5, 'ct', 3400.00, 0),
    (v_org, q1, 2, 'Grabado láser', null, null, null, 1, 'und', 80.00, 80.00);
  update public.quotations set status = 'APROBADA' where id = q1;

  -- Q2: enviada (pendiente)
  insert into public.quotations (org_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material, estimated_weight, notes, terms, tax_rate)
  values (v_org, c_lucia, st_fab, current_date - 3, current_date + 12, 'Dije personalizado con inicial', 'Oro 14K', 3.20, null, 'Validez 15 días.', 18)
  returning id into q2;
  insert into public.quotation_items (org_id, quotation_id, position, description, material_id, material_name, quantity, unit, unit_price) values
    (v_org, q2, 0, 'Dije letra "L" calado', m_oro14, 'Oro 14K', 1, 'und', 690.00),
    (v_org, q2, 1, 'Cadena veneciana 45 cm', m_oro14, 'Oro 14K', 1, 'und', 520.00);
  update public.quotations set status = 'ENVIADA' where id = q2;

  -- Q3: borrador
  insert into public.quotations (org_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material, notes, tax_rate)
  values (v_org, c_carlos, st_rep, current_date, current_date + 15, 'Soldadura y limpieza de esclava', 'Plata 925', 'Cliente trae la pieza.', 18)
  returning id into q3;
  insert into public.quotation_items (org_id, quotation_id, position, description, quantity, unit, unit_price) values
    (v_org, q3, 0, 'Soldadura de eslabón', 1, 'servicio', 60.00),
    (v_org, q3, 1, 'Limpieza ultrasónica y pulido', 1, 'servicio', 40.00);

  -- Q4: rechazada
  insert into public.quotations (org_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material, tax_rate)
  values (v_org, c_maria, st_venta, current_date - 30, current_date - 15, 'Juego de aretes y collar de perlas', 'Plata 925', 18)
  returning id into q4;
  insert into public.quotation_items (org_id, quotation_id, position, description, material_id, material_name, quantity, unit, unit_price) values
    (v_org, q4, 0, 'Collar de perlas cultivadas', m_plata, 'Plata 925', 1, 'und', 890.00),
    (v_org, q4, 1, 'Aretes de perla', m_plata, 'Plata 925', 1, 'par', 320.00);
  update public.quotations set status = 'ENVIADA' where id = q4;
  update public.quotations set status = 'RECHAZADA' where id = q4;

  -- Q5: aprobada (lista para convertir)
  insert into public.quotations (org_id, customer_id, service_type_id, issue_date, expiry_date, title, main_material, estimated_weight, stone, notes, terms, tax_rate)
  values (v_org, c_andina, st_fab, current_date - 5, current_date + 10, 'Collar con zafiros (colección otoño)', 'Oro 18K', 14.00, 'Zafiros 1.20 ct total', 'Entregar en estuche de la marca.', 'Pago a 30 días.', 18)
  returning id into q5;
  insert into public.quotation_items (org_id, quotation_id, position, description, material_id, material_name, quantity, unit, unit_price, discount) values
    (v_org, q5, 0, 'Collar riviera en oro 18K', m_oro18, 'Oro 18K', 1, 'und', 4200.00, 200.00),
    (v_org, q5, 1, 'Zafiros azules', m_zaf, 'Zafiro', 1.2, 'ct', 1100.00, 0);
  update public.quotations set status = 'APROBADA' where id = q5;

  -- ---------------------------------------------------------------- Pedidos
  -- O1: desde Q1, en producción (Pulido)
  o1 := public.convert_quotation_to_order(q1, v_admin, current_date + 6, 'ALTA', true);
  update public.orders set created_at = now() - interval '25 days', start_date = current_date - 25 where id = o1;
  update public.order_production_stages set status = 'COMPLETADO', assigned_to = v_admin where order_id = o1 and position <= 4;
  update public.order_production_stages set status = 'EN_PROCESO', assigned_to = v_admin where order_id = o1 and position = 5;
  insert into public.material_movements (org_id, material_id, order_id, movement_type, ownership, quantity, notes) values
    (v_org, m_oro18, o1, 'CONSUMO', 'EMPRESA', 8.50, 'Fundición de montura'),
    (v_org, m_diam,  o1, 'CONSUMO', 'EMPRESA', 0.50, 'Engaste diamante central');
  insert into public.payments (org_id, order_id, payment_date, amount, method, reference, is_advance)
  values (v_org, o1, current_date - 25, 1500.00, 'YAPE', 'OP 558812', true);

  -- O2: venta de joya, cerrada y pagada (hace 4 meses)
  insert into public.orders (org_id, customer_id, service_type_id, status, priority, title, description, main_material, assigned_to, start_date, due_date, tax_rate)
  values (v_org, c_maria, st_venta, 'APROBADO', 'MEDIA', 'Aretes argolla en plata 925', 'Venta directa de stock', 'Plata 925', v_admin, current_date - 120, current_date - 115, 18)
  returning id into o2;
  insert into public.order_items (org_id, order_id, position, description, material_id, material_name, quantity, unit, unit_price)
  values (v_org, o2, 0, 'Aretes argolla diamantada', m_plata, 'Plata 925', 1, 'par', 280.00);
  update public.orders set status = 'LISTO_ENTREGA' where id = o2;
  insert into public.payments (org_id, order_id, payment_date, amount, method, reference)
  values (v_org, o2, current_date - 118, 330.40, 'TARJETA', 'VISA ****4421');
  insert into public.deliveries (org_id, order_id, status, scheduled_date, delivered_at, responsible_id, received_by, conformity, conformity_notes)
  values (v_org, o2, 'ENTREGADA', current_date - 115, now() - interval '115 days', v_admin, 'María Torres', true, 'Conforme.');
  update public.orders set status = 'CERRADO' where id = o2;
  update public.orders set created_at = now() - interval '120 days' where id = o2;

  -- O3: Joyería Andina, 20 dijes en control de calidad
  insert into public.orders (org_id, customer_id, service_type_id, status, priority, title, main_material, estimated_weight, assigned_to, start_date, due_date, tax_rate)
  values (v_org, c_andina, st_fab, 'APROBADO', 'ALTA', 'Lote de 20 dijes de plata (trébol)', 'Plata 925', 60.00, v_admin, current_date - 50, current_date + 2, 18)
  returning id into o3;
  insert into public.order_items (org_id, order_id, position, description, material_id, material_name, quantity, unit, unit_price)
  values (v_org, o3, 0, 'Dije trébol en plata 925', m_plata, 'Plata 925', 20, 'und', 95.00);
  perform public.create_order_stages(o3);
  update public.order_production_stages set status = 'COMPLETADO' where order_id = o3 and not is_quality_check;
  update public.orders set created_at = now() - interval '50 days' where id = o3;
  insert into public.material_movements (org_id, material_id, order_id, movement_type, ownership, quantity, notes)
  values (v_org, m_plata, o3, 'CONSUMO', 'EMPRESA', 62.00, 'Fundición del lote');
  insert into public.payments (org_id, order_id, payment_date, amount, method, reference, is_advance)
  values (v_org, o3, current_date - 50, 1000.00, 'TRANSFERENCIA', 'BCP 00125487', true);

  -- O4: reparación con oro del cliente, lista para entregar, saldo pendiente
  insert into public.orders (org_id, customer_id, service_type_id, status, priority, title, description, main_material, estimated_weight, assigned_to, start_date, due_date, tax_rate)
  values (v_org, c_carlos, st_rep, 'APROBADO', 'MEDIA', 'Reparación y refuerzo de cadena oro 14K', 'Cambio de broche y refuerzo de eslabones', 'Oro 14K', 15.00, v_admin, current_date - 12, current_date + 1, 18)
  returning id into o4;
  insert into public.order_items (org_id, order_id, position, description, quantity, unit, unit_price)
  values (v_org, o4, 0, 'Reparación de cadena', 1, 'servicio', 250.00),
         (v_org, o4, 1, 'Broche mosquetón oro 14K', 1, 'und', 180.00);
  insert into public.order_production_stages (org_id, order_id, name, position, is_quality_check) values
    (v_org, o4, 'Soldadura', 1, false), (v_org, o4, 'Pulido', 2, false), (v_org, o4, 'Control de calidad', 3, true);
  insert into public.material_movements (org_id, material_id, order_id, movement_type, ownership, quantity, notes) values
    (v_org, m_oro14, o4, 'ENTRADA', 'CLIENTE', 15.00, 'Oro entregado por el cliente'),
    (v_org, m_oro14, o4, 'CONSUMO', 'CLIENTE', 11.80, 'Refuerzo de eslabones');
  update public.order_production_stages set status = 'COMPLETADO' where order_id = o4;
  update public.orders set created_at = now() - interval '12 days' where id = o4;
  insert into public.payments (org_id, order_id, payment_date, amount, method, is_advance)
  values (v_org, o4, current_date - 12, 200.00, 'EFECTIVO', true);
  insert into public.deliveries (org_id, order_id, status, scheduled_date, responsible_id)
  values (v_org, o4, 'LISTA', current_date + 1, v_admin);

  -- O5: modificación aprobada sin iniciar y atrasada
  insert into public.orders (org_id, customer_id, service_type_id, status, priority, title, description, main_material, size, assigned_to, start_date, due_date, tax_rate)
  values (v_org, c_lucia, st_mod, 'APROBADO', 'URGENTE', 'Ajuste de talla de anillo', 'Reducir de talla 16 a 14', 'Oro 18K', '14', v_admin, current_date - 10, current_date - 2, 18)
  returning id into o5;
  insert into public.order_items (org_id, order_id, position, description, quantity, unit, unit_price)
  values (v_org, o5, 0, 'Ajuste de talla', 1, 'servicio', 120.00);
  update public.orders set created_at = now() - interval '10 days' where id = o5;

  -- O6: pulsera entregada (no cerrada) con saldo pendiente
  insert into public.orders (org_id, customer_id, service_type_id, status, priority, title, main_material, estimated_weight, assigned_to, start_date, due_date, tax_rate)
  values (v_org, c_juan, st_fab, 'APROBADO', 'MEDIA', 'Pulsera eslabón cubano oro 18K', 'Oro 18K', 22.00, v_admin, current_date - 70, current_date - 20, 18)
  returning id into o6;
  insert into public.order_items (org_id, order_id, position, description, material_id, material_name, quantity, unit, unit_price)
  values (v_org, o6, 0, 'Pulsera eslabón cubano 19 cm', m_oro18, 'Oro 18K', 1, 'und', 6800.00);
  perform public.create_order_stages(o6);
  update public.order_production_stages set status = 'COMPLETADO' where order_id = o6;
  insert into public.material_movements (org_id, material_id, order_id, movement_type, ownership, quantity, notes)
  values (v_org, m_oro18, o6, 'CONSUMO', 'EMPRESA', 22.40, 'Fundición de eslabones');
  insert into public.payments (org_id, order_id, payment_date, amount, method, reference, is_advance) values
    (v_org, o6, current_date - 70, 3000.00, 'TRANSFERENCIA', 'BBVA 7781', true),
    (v_org, o6, current_date - 35, 2500.00, 'PLIN', 'PLIN 99812', false);
  insert into public.deliveries (org_id, order_id, status, scheduled_date, delivered_at, responsible_id, received_by, conformity)
  values (v_org, o6, 'ENTREGADA', current_date - 20, now() - interval '20 days', v_admin, 'Juan Pérez', true);
  update public.orders set created_at = now() - interval '70 days' where id = o6;

  -- O7: desde Q5, en diseño
  o7 := public.convert_quotation_to_order(q5, v_admin, current_date + 25, 'MEDIA', true);
  update public.order_production_stages set status = 'EN_PROCESO', assigned_to = v_admin where order_id = o7 and position = 1;
  insert into public.payments (org_id, order_id, payment_date, amount, method, reference, is_advance)
  values (v_org, o7, current_date - 2, 2500.00, 'TRANSFERENCIA', 'BCP 00987451', true);

  -- O8: aretes con rubí, pausado
  insert into public.orders (org_id, customer_id, service_type_id, status, priority, title, main_material, stone, assigned_to, start_date, due_date, tax_rate)
  values (v_org, c_maria, st_fab, 'APROBADO', 'BAJA', 'Aretes con rubí en oro 18K', 'Oro 18K', 'Rubí 2 x 0.30 ct', v_admin, current_date - 30, current_date + 15, 18)
  returning id into o8;
  insert into public.order_items (org_id, order_id, position, description, material_id, material_name, quantity, unit, unit_price)
  values (v_org, o8, 0, 'Aretes con rubí', m_oro18, 'Oro 18K', 1, 'par', 2350.00);
  perform public.create_order_stages(o8);
  update public.order_production_stages set status = 'COMPLETADO' where order_id = o8 and position = 1;
  update public.order_production_stages set status = 'BLOQUEADO', notes = 'Esperando confirmación del cliente sobre el tono del rubí' where order_id = o8 and position = 2;
  update public.orders set status = 'PAUSADO', created_at = now() - interval '30 days' where id = o8;
  insert into public.payments (org_id, order_id, payment_date, amount, method, is_advance)
  values (v_org, o8, current_date - 30, 800.00, 'EFECTIVO', true);

  -- Fechas de auditoría coherentes con la fecha de creación de cada pedido
  update public.order_history h set created_at = o.created_at
    from public.orders o where o.id = h.order_id and h.event_type = 'CREACION';

  raise notice 'Seed demo cargado correctamente.';
end;
$$;
