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
