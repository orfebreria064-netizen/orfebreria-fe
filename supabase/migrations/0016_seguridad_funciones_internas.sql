-- =====================================================================
-- 0016_seguridad_funciones_internas.sql
-- Hallazgos de la revisión de seguridad del 2026-10-20 (prueba de ataque
-- desde otra empresa):
--   1. Funciones internas SECURITY DEFINER que cualquier usuario con sesión
--      podía llamar por /rest/v1/rpc sin validar la empresa: inyectar eventos
--      en el historial de otro pedido, adelantar la numeración de otra empresa,
--      leer correos de admins de otras empresas, contar sus usuarios, etc.
--      Solo las usan triggers y otras funciones SECURITY DEFINER (que corren
--      con los permisos del dueño), nunca políticas RLS ni la app: se les
--      quita EXECUTE a los usuarios.
--   2. Solicitud de acceso (anónima): límite contra spam.
--   3. Storage: sin SVG (puede llevar scripts incrustados).
--   4. Logo de la empresa: formato y tamaño validados también en la base.
-- =====================================================================

-- 1. Funciones internas fuera de la API
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'log_order_event', 'next_document_number', 'recalc_order_totals', 'recalc_quotation_totals',
         'sync_order_production', 'subscription_reminders_due', 'org_seats_used', 'org_seat_limit',
         'org_branch_limit', 'org_branches_used', 'main_branch_id', 'default_branch_id', 'org_access_state',
         'assert_order_editable', 'current_user_name', 'is_admin_or_system', 'current_app_role',
         'assert_platform_admin', 'has_branch_access')
  loop
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

-- 2. Solicitud de acceso: una por correo cada 24 horas y como máximo 30 por hora en total
create or replace function public.access_requests_throttle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.access_requests
              where lower(email) = lower(new.email) and created_at > now() - interval '24 hours') then
    raise exception 'Ya recibimos una solicitud con este correo. Le responderemos pronto.';
  end if;
  if (select count(*) from public.access_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Estamos recibiendo muchas solicitudes. Intente nuevamente en unos minutos.';
  end if;
  return new;
end;
$$;

drop trigger if exists access_requests_throttle on public.access_requests;
create trigger access_requests_throttle before insert on public.access_requests
  for each row execute function public.access_requests_throttle();
revoke execute on function public.access_requests_throttle() from public, anon, authenticated;

-- 3. Storage: sin SVG
update storage.buckets
   set allowed_mime_types = array_remove(allowed_mime_types, 'image/svg+xml')
 where id = 'orders';

-- 4. Logo: data URL PNG/JPEG de hasta ~750 KB (la app lo reduce a 600 px de ancho)
alter table public.settings
  add constraint settings_logo_check
  check (logo is null or (logo ~ '^data:image/(png|jpeg);base64,' and length(logo) <= 1000000));
