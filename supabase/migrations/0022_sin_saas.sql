-- =====================================================================
-- 0022_sin_saas.sql
-- La app deja de ser SaaS multiempresa con suscripción mensual
-- (decisión del 2026-11-03): es para una sola orfebrería (BRILLOS).
--   * Se eliminan planes, suscripciones, pagos de suscripción, solicitudes
--     de acceso y el superadministrador de plataforma.
--   * Se quitan el modo solo lectura por plan vencido y los límites de
--     usuarios y de sucursales por plan.
--   * Se conservan organizations/org_id (RLS por empresa) y las invitaciones,
--     que siguen siendo la única forma de dar de alta usuarios.
--   * El antiguo superadministrador (jjcastilloo79@gmail.com) pasa a ser
--     ADMIN de BRILLOS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Modo solo lectura y cupos: triggers en todas las tablas
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as tbl, t.tgname
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal
       and t.tgname in ('aa_subscription_guard', 'organizations_create_subscription', 'profiles_seat_limit')
  loop
    execute format('drop trigger %I on %s', r.tgname, r.tbl);
  end loop;
end;
$$;

drop policy if exists orders_files_insert on storage.objects;
create policy orders_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'orders' and public.can_access_order_file(name));

-- ---------------------------------------------------------------------
-- 2. RLS: la empresa ya no depende del estado de una suscripción
-- ---------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id from public.profiles p where p.id = auth.uid() and p.active;
$$;

drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN'));

-- ---------------------------------------------------------------------
-- 3. Funciones de negocio sin controles de plan (mismo cuerpo que su
--    última versión, sin el chequeo de vencimiento ni de cupos)
-- ---------------------------------------------------------------------
drop function if exists public.create_invitation(text, text, text);

-- (última versión: 0011_branches.sql)
create or replace function public.create_invitation(
  p_email text, p_full_name text, p_role text, p_branch_ids uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_email  text := lower(trim(p_email));
  v_id     uuid;
begin
  if v_org is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador de la empresa puede invitar usuarios.';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Ese correo ya tiene una cuenta en el sistema.';
  end if;
  if exists (select 1 from unnest(coalesce(p_branch_ids, array[]::uuid[])) x
              where not exists (select 1 from public.branches b where b.id = x and b.org_id = v_org and b.active)) then
    raise exception 'Una de las sucursales indicadas no existe o está inactiva.';
  end if;
  update public.invitations set status = 'REVOKED'
   where org_id = v_org and lower(email) = v_email and status = 'PENDING';

  insert into public.invitations (org_id, email, full_name, role, branch_ids)
  values (v_org, v_email, nullif(trim(p_full_name), ''), p_role, nullif(p_branch_ids, array[]::uuid[]))
  returning id into v_id;
  return v_id;
end;
$$;

-- (última versión: 0011_branches.sql)
create or replace function public.set_branch_min_stock(p_material_id uuid, p_branch_id uuid, p_min_stock numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede configurar el stock mínimo.';
  end if;
  if coalesce(p_min_stock, -1) < 0 then
    raise exception 'El stock mínimo no puede ser negativo.';
  end if;
  if not exists (select 1 from public.materials where id = p_material_id and org_id = v_org)
     or not exists (select 1 from public.branches where id = p_branch_id and org_id = v_org) then
    raise exception 'Material o sucursal no encontrados.';
  end if;

  insert into public.material_stock (org_id, material_id, branch_id, min_stock)
  values (v_org, p_material_id, p_branch_id, p_min_stock)
  on conflict (material_id, branch_id)
  do update set min_stock = excluded.min_stock, updated_at = now();
end;
$$;

-- (última versión: 0012_taller_joyeros_precios.sql)
create or replace function public.issue_payment_receipt(p_payment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_order    uuid;
  v_receipt  text;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR') then
    raise exception 'No tiene permisos para emitir recibos.';
  end if;
  select order_id, receipt_number into v_order, v_receipt
    from public.payments where id = p_payment_id and org_id = v_org for update;
  if v_order is null or not public.can_view_order(v_order) then
    raise exception 'Pago no encontrado.';
  end if;
  if v_receipt is null then
    v_receipt := public.next_document_number(v_org, 'RI');
    update public.payments set receipt_number = v_receipt where id = p_payment_id;
  end if;
  return v_receipt;
end;
$$;

-- (última versión: 0012_taller_joyeros_precios.sql)
create or replace function public.issue_order_document(p_order_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_number  text;
  v_order   text;
begin
  if p_doc_type not in ('PRO', 'OP') then
    raise exception 'Tipo de documento no válido.';
  end if;
  if v_org is null
     or (p_doc_type = 'PRO' and not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'))
     or (p_doc_type = 'OP' and not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR')) then
    raise exception 'No tiene permisos para emitir este documento.';
  end if;
  if not public.can_view_order(p_order_id) then
    raise exception 'Pedido no encontrado o sin permisos.';
  end if;

  select number, case when p_doc_type = 'PRO' then proforma_number else production_number end
    into v_order, v_number
    from public.orders where id = p_order_id for update;

  if v_number is null then
    v_number := public.next_document_number(v_org, p_doc_type);
    if p_doc_type = 'PRO' then
      update public.orders set proforma_number = v_number, proforma_issued_at = now() where id = p_order_id;
    else
      update public.orders set production_number = v_number, production_issued_at = now() where id = p_order_id;
    end if;
    perform public.log_order_event(p_order_id, 'DOCUMENTO',
      public.current_user_name() || ' emitió ' ||
      case when p_doc_type = 'PRO' then 'la proforma ' else 'la orden de producción ' end ||
      v_number || ' del pedido ' || v_order || '.', null, v_number);
  end if;
  return v_number;
end;
$$;

-- (última versión: 0011_branches.sql)
create or replace function public.branches_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_main_change boolean := coalesce(current_setting('app.branch_main_change', true), '') = 'on';
begin
  new.code := upper(trim(new.code));
  new.name := trim(new.name);

  if tg_op = 'INSERT' then
    -- La primera sucursal de la empresa es la principal; las demás nunca nacen como principal.
    new.is_main := not exists (select 1 from public.branches where org_id = new.org_id and is_main);
  else
    if new.org_id <> old.org_id then
      raise exception 'Una sucursal no puede cambiar de empresa.';
    end if;
    if new.is_main is distinct from old.is_main and not v_main_change then
      raise exception 'Para cambiar la sucursal principal use la opción «Marcar como principal».';
    end if;
  end if;

  if new.is_main and not new.active then
    raise exception 'La sucursal principal no se puede desactivar.';
  end if;

  if tg_op = 'UPDATE' and old.active and not new.active then
    if exists (select 1 from public.material_stock where branch_id = new.id and stock > 0) then
      raise exception 'La sucursal % todavía tiene stock de materiales. Trasládelo antes de desactivarla.', new.name;
    end if;
    if exists (select 1 from public.orders where branch_id = new.id
                 and status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')) then
      raise exception 'La sucursal % tiene pedidos en curso. Termínelos o muévalos antes de desactivarla.', new.name;
    end if;
  end if;
  return new;
end;
$$;

-- (última versión: 0015_estados_de_cuenta.sql)
create or replace function public.statement_orgs_due(p_org uuid default null)
returns table (org_id uuid, statement_date date)
language sql
stable
security definer
set search_path = public
as $$
  select s.org_id, (now() at time zone 'America/Lima')::date
    from public.settings s
   where case when p_org is not null then s.org_id = p_org
              else s.daily_statements_enabled
                   and s.daily_statements_hour = extract(hour from now() at time zone 'America/Lima')::integer end;
$$;

-- (última versión: 0018_tipo_cambio_precio_oro.sql)
create or replace function public.refresh_market_rates_now()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede actualizar el tipo de cambio.';
  end if;
  return public.refresh_market_rates();
end;
$$;

-- (última versión: 0009_saas_platform.sql)
create or replace function public.invitation_for_sending(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', i.id, 'email', i.email, 'full_name', i.full_name, 'org_id', i.org_id)
    from public.invitations i
   where i.id = p_id and i.status = 'PENDING'
     and i.org_id = public.current_org_id() and public.has_role('ADMIN');
$$;

-- (última versión: 0009_saas_platform.sql)
create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invitations set status = 'REVOKED'
   where id = p_id and status = 'PENDING'
     and org_id = public.current_org_id() and public.has_role('ADMIN');
end;
$$;

-- Alta de usuarios: por invitación. Excepción: instalación vacía, donde el
-- primer usuario crea la organización y queda como ADMIN.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv     public.invitations%rowtype;
  v_org_id  uuid;
  v_name    text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
begin
  select * into v_inv from public.invitations
   where lower(email) = lower(new.email) and status = 'PENDING'
   order by created_at desc limit 1;

  if found then
    insert into public.profiles (id, org_id, full_name, email, role, active)
    values (new.id, v_inv.org_id, coalesce(nullif(trim(v_inv.full_name), ''), v_name), new.email, v_inv.role, true);

    insert into public.user_branches (org_id, user_id, branch_id)
    select v_inv.org_id, new.id, b.id
      from public.branches b
     where b.org_id = v_inv.org_id
       and (case when coalesce(cardinality(v_inv.branch_ids), 0) = 0 then b.is_main
                 else b.id = any (v_inv.branch_ids) end);
    if not found then
      insert into public.user_branches (org_id, user_id, branch_id)
      values (v_inv.org_id, new.id, public.main_branch_id(v_inv.org_id));
    end if;

    update public.invitations set status = 'ACCEPTED', accepted_at = now() where id = v_inv.id;
    return new;
  end if;

  if not exists (select 1 from public.organizations) then
    insert into public.organizations (name) values ('Mi Orfebrería') returning id into v_org_id;
    insert into public.settings (org_id) values (v_org_id);
    insert into public.profiles (id, org_id, full_name, email, role, active)
    values (new.id, v_org_id, v_name, new.email, 'ADMIN', true);
    insert into public.user_branches (org_id, user_id, branch_id)
    values (v_org_id, new.id, public.main_branch_id(v_org_id));
    return new;
  end if;

  raise exception 'El registro es solo por invitación. Pida a un administrador de la empresa que lo invite.';
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. El antiguo superadministrador pasa a ser ADMIN de la empresa (BRILLOS)
-- ---------------------------------------------------------------------
do $$
declare
  v_user  uuid;
  v_email text;
  v_org   uuid;
begin
  select id, email into v_user, v_email from auth.users where lower(email) = 'jjcastilloo79@gmail.com';
  -- La empresa de la app (BRILLOS): la única organización, o la más antigua si hubiera varias.
  select id into v_org from public.organizations
   order by (name ilike '%brillos%') desc, created_at limit 1;
  if v_user is null or v_org is null then
    raise notice 'No se encontró el usuario o la empresa BRILLOS: se omite el alta como ADMIN.';
    return;
  end if;

  insert into public.profiles (id, org_id, full_name, email, role, active)
  values (v_user, v_org, 'Juan José Castillo', v_email, 'ADMIN', true)
  on conflict (id) do update set org_id = excluded.org_id, role = 'ADMIN', active = true;

  delete from public.user_branches where user_id = v_user and org_id <> v_org;
  insert into public.user_branches (org_id, user_id, branch_id)
  select v_org, v_user, b.id from public.branches b
   where b.org_id = v_org and b.active
     and not exists (select 1 from public.user_branches ub where ub.user_id = v_user and ub.branch_id = b.id);
end;
$$;

-- ---------------------------------------------------------------------
-- 4b. Se elimina la empresa vacía "Casbernet" (pedido del 2026-11-03).
--     Solo si no tiene usuarios ni datos de negocio; si los tiene, no se borra.
-- ---------------------------------------------------------------------
do $$
declare
  v_org    uuid;
  v_tables text[];
  v_left   text[];
  v_pass   integer := 0;
  t        text;
  n        bigint;
begin
  select id into v_org from public.organizations where name ilike 'casbernet%';
  if v_org is null then
    raise notice 'No existe la empresa Casbernet.';
    return;
  end if;

  foreach t in array array['profiles', 'customers', 'quotations', 'orders', 'payments'] loop
    execute format('select count(*) from public.%I where org_id = $1', t) into n using v_org;
    if n > 0 then
      raise notice 'Casbernet tiene % fila(s) en %: no se borra.', n, t;
      return;
    end if;
  end loop;

  -- Tablas con org_id (catálogos sembrados, correlativos, sucursales, etc.)
  select array_agg(c.table_name::text) into v_tables
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'org_id' and tb.table_type = 'BASE TABLE';

  -- Varias pasadas: el orden entre tablas depende de sus propias FK.
  loop
    v_pass := v_pass + 1;
    v_left := array[]::text[];
    foreach t in array v_tables loop
      begin
        execute format('delete from public.%I where org_id = $1', t) using v_org;
      exception when foreign_key_violation or raise_exception then
        v_left := v_left || t;
      end;
    end loop;
    exit when cardinality(v_left) = 0 or v_pass >= 10;
    v_tables := v_left;
  end loop;

  if cardinality(v_left) > 0 then
    raise exception 'No se pudo vaciar Casbernet; quedan datos en: %', array_to_string(v_left, ', ');
  end if;

  delete from public.organizations where id = v_org;
  raise notice 'Empresa Casbernet eliminada.';
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Objetos de la plataforma SaaS (primero las tablas: sus políticas usan las funciones)
-- ---------------------------------------------------------------------
drop table if exists public.subscription_payments;
drop table if exists public.access_requests;
drop table if exists public.subscriptions;
drop table if exists public.plans;
drop table if exists public.platform_admins;

do $$
declare
  r record;
begin
  -- Algunas firmas cambiaron entre migraciones: se borran todas las sobrecargas.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'platform_register_payment', 'platform_update_subscription', 'platform_approve_request',
         'platform_reject_request', 'platform_invite_admin', 'platform_organizations', 'platform_overview',
         'submit_access_request', 'my_subscription', 'subscription_reminders_due',
         'create_org_subscription', 'enforce_org_writable', 'enforce_seat_limit', 'access_requests_throttle',
         'org_can_write', 'org_access_state', 'org_seat_limit', 'org_seats_used', 'org_branch_limit',
         'assert_platform_admin', 'check_platform_admin', 'is_platform_admin', 'platform_owner_email')
  loop
    execute format('drop function %s', r.sig);
  end loop;
end;
$$;


-- Recordatorios de vencimiento, si se programaron con pg_cron
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job
     where jobname ilike '%subscription%' or command ilike '%subscription-reminders%';
  end if;
end;
$$;
