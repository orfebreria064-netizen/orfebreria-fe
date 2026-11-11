-- =====================================================================
-- 0014 · Superadministrador único de la plataforma
-- =====================================================================
-- Solo jjcastilloo79@gmail.com administra la plataforma (aprobar solicitudes,
-- empresas, planes y pagos de suscripción). Ningún otro usuario, aunque sea
-- ADMIN de su empresa, puede figurar en platform_admins.
--   * Se quitan los superadmins actuales que no sean ese correo.
--   * Un trigger impide insertar a cualquier otro usuario.
--   * Si ese correo se registra sin invitación, entra como superadmin sin empresa.
-- =====================================================================

create or replace function public.platform_owner_email()
returns text
language sql
immutable
as $$ select 'jjcastilloo79@gmail.com'::text $$;

-- is_platform_admin() también exige el correo, por si alguien insertara una fila a mano.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins pa
      join auth.users u on u.id = pa.user_id
     where pa.user_id = auth.uid()
       and lower(u.email) = public.platform_owner_email()
  );
$$;

create or replace function public.check_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id = new.user_id and lower(email) = public.platform_owner_email()) then
    raise exception 'Solo % puede ser administrador de la plataforma.', public.platform_owner_email();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_platform_admins_check on public.platform_admins;
create trigger trg_platform_admins_check
  before insert or update on public.platform_admins
  for each row execute function public.check_platform_admin();

delete from public.platform_admins pa
 using auth.users u
 where u.id = pa.user_id and lower(u.email) <> public.platform_owner_email();

insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = public.platform_owner_email()
on conflict do nothing;

-- Igual que en 0011, pero el superadmin es solo el dueño de la plataforma (sin empresa).
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
  if lower(new.email) = public.platform_owner_email() then
    insert into public.platform_admins (user_id) values (new.id) on conflict do nothing;
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

  -- El dueño de la plataforma no necesita empresa.
  if lower(new.email) = public.platform_owner_email() then
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

  raise exception 'El registro es solo por invitación. Solicite acceso desde la página de inicio.';
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.check_platform_admin() from public, anon, authenticated;
