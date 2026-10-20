-- =====================================================================
-- 0014_superadmin_sin_empresa.sql
-- El superadministrador de la plataforma no pertenece a ninguna empresa
-- (igual que en database/mssql/fix_superadmin_sin_empresa.sql).
--   * Un usuario creado con raw_app_meta_data.platform_admin = 'true' queda
--     como superadministrador sin perfil de empresa. app_metadata solo lo
--     escribe el servidor (service_role / SQL), nunca el cliente.
--   * El resto de handle_new_user() no cambia (invitación o primer usuario).
-- =====================================================================
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
  -- Superadministrador de la plataforma: sin empresa ni perfil
  if coalesce(new.raw_app_meta_data ->> 'platform_admin', '') = 'true' then
    insert into public.platform_admins (user_id) values (new.id) on conflict do nothing;
    return new;
  end if;

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
    insert into public.platform_admins (user_id) values (new.id);
    return new;
  end if;

  raise exception 'El registro es solo por invitación. Solicite acceso desde la página de inicio.';
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
