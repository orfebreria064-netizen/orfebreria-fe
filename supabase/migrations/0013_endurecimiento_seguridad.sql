-- =====================================================================
-- 0013_endurecimiento_seguridad.sql
-- Recomendaciones del linter de Supabase (aplicado el 2026-10-20):
--   * search_path fijo en las funciones auxiliares que no lo tenían.
--   * Las funciones de trigger no se exponen por la API (los triggers no verifican EXECUTE).
--   * Ninguna función SECURITY DEFINER es ejecutable sin sesión, salvo
--     submit_access_request (página pública de solicitud de acceso).
--   * Funciones internas fuera del alcance de los usuarios con sesión.
-- =====================================================================
do $$
declare r record;
begin
  -- 1) search_path fijo en las funciones señaladas
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('set_updated_at','protect_profile_fields','protect_material_stock',
                  'order_status_label','stage_status_label','format_money','materials_initial_stock_before') loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;

  -- 2) Funciones de trigger: nadie necesita llamarlas por la API (los triggers no verifican EXECUTE)
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype) loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;

  -- 3) SECURITY DEFINER restantes: fuera de anon (salvo la solicitud de acceso), se mantienen authenticated y service_role
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
              and p.proname <> 'submit_access_request' loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;

  -- 4) Funciones internas sin uso desde la app
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('seed_org_catalogs','create_org_subscription','rls_auto_enable','handle_new_user') loop
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end;
$$;
