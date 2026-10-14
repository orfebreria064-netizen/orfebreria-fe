-- =====================================================================
-- 0009_saas_platform.sql
-- Plataforma SaaS multiempresa:
--   * Planes (límite de usuarios) y suscripción por organización.
--   * Pagos de suscripción registrados por el superadministrador.
--   * Solicitudes de acceso públicas y alta solo por invitación.
--   * Vencimiento: PRUEBA/ACTIVA -> GRACIA -> VENCIDA (solo lectura);
--     SUSPENDIDA/CANCELADA bloquean el acceso a los datos.
-- Todo se aplica en la base de datos (triggers + RLS), no solo en Angular.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Planes
-- ---------------------------------------------------------------------
create table public.plans (
  code              text primary key,
  name              text not null,
  max_users         integer not null check (max_users > 0),
  price_month       numeric(10, 2) not null check (price_month >= 0),
  price_year        numeric(10, 2) not null check (price_year >= 0),
  -- Precio mensual por usuario adicional; null = el plan no admite usuarios extra.
  extra_user_price  numeric(10, 2) check (extra_user_price is null or extra_user_price >= 0),
  position          integer not null default 0,
  active            boolean not null default true
);

insert into public.plans (code, name, max_users, price_month, price_year, extra_user_price, position) values
  ('BASICO',  'Básico',  3,  79, 790,  null, 1),
  ('TALLER',  'Taller',  8,  149, 1490, null, 2),
  ('EMPRESA', 'Empresa', 20, 299, 2990, 15,  3);

-- ---------------------------------------------------------------------
-- Superadministradores de la plataforma (separados de los roles de empresa:
-- un ADMIN de una orfebrería nunca puede convertirse en superadmin).
-- ---------------------------------------------------------------------
create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Suscripción (1 por organización)
-- ---------------------------------------------------------------------
create table public.subscriptions (
  org_id              uuid primary key references public.organizations (id) on delete cascade,
  plan_code           text not null references public.plans (code),
  status              text not null default 'TRIAL'
                      check (status in ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED')),
  extra_users         integer not null default 0 check (extra_users >= 0),
  current_period_end  date not null,
  grace_days          integer not null default 5 check (grace_days between 0 and 60),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Toda organización nueva nace con 14 días de prueba del plan Básico.
create or replace function public.create_org_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (org_id, plan_code, status, current_period_end)
  values (new.id, 'BASICO', 'TRIAL', current_date + 14)
  on conflict (org_id) do nothing;
  return new;
end;
$$;

create trigger organizations_create_subscription
  after insert on public.organizations
  for each row execute function public.create_org_subscription();

-- Organizaciones existentes: plan Empresa activo por un año.
insert into public.subscriptions (org_id, plan_code, status, current_period_end)
select id, 'EMPRESA', 'ACTIVE', current_date + 365 from public.organizations
on conflict (org_id) do nothing;

-- Estado efectivo: TRIAL | ACTIVE | GRACE | EXPIRED | SUSPENDED | CANCELLED
create or replace function public.org_access_state(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when s.status in ('SUSPENDED', 'CANCELLED') then s.status
      when current_date <= s.current_period_end then s.status
      when s.status = 'ACTIVE' and current_date <= s.current_period_end + s.grace_days then 'GRACE'
      else 'EXPIRED'
    end
    from public.subscriptions s where s.org_id = p_org_id
  ), 'EXPIRED');
$$;

create or replace function public.org_can_write(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_access_state(p_org_id) in ('TRIAL', 'ACTIVE', 'GRACE');
$$;

create or replace function public.org_seat_limit(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select p.max_users + s.extra_users
    from public.subscriptions s join public.plans p on p.code = s.plan_code
   where s.org_id = p_org_id;
$$;

-- Una organización suspendida o cancelada deja de "existir" para RLS:
-- todas las políticas filtran por current_org_id().
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id
    from public.profiles p
    join public.subscriptions s on s.org_id = p.org_id
   where p.id = auth.uid() and p.active and s.status not in ('SUSPENDED', 'CANCELLED');
$$;

-- ---------------------------------------------------------------------
-- Modo solo lectura: bloquea escrituras de negocio con el plan vencido.
-- Se aplica con trigger (no con RLS) para cubrir también las funciones
-- SECURITY DEFINER. Las ejecuciones de servidor (auth.uid() nulo) pasan.
-- ---------------------------------------------------------------------
create or replace function public.enforce_org_writable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
begin
  if auth.uid() is not null and not public.org_can_write(v_org) then
    raise exception 'El plan de su empresa está vencido: el sistema está en modo solo lectura. Regularice el pago para seguir registrando información.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'service_types', 'production_stages', 'customers', 'customer_contacts', 'materials',
    'quotations', 'quotation_items', 'orders', 'order_items', 'order_production_stages',
    'material_movements', 'payments', 'deliveries', 'attachments'
  ] loop
    execute format(
      'create trigger aa_subscription_guard before insert or update or delete on public.%I
         for each row execute function public.enforce_org_writable()', t);
  end loop;
end;
$$;

drop policy orders_files_insert on storage.objects;
create policy orders_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'orders' and public.can_access_order_file(name)
              and public.org_can_write(public.current_org_id()));

-- ---------------------------------------------------------------------
-- Pagos de suscripción (los registra el superadministrador)
-- ---------------------------------------------------------------------
create table public.subscription_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  plan_code     text not null references public.plans (code),
  amount        numeric(10, 2) not null check (amount > 0),
  method        text not null check (method in ('YAPE', 'PLIN', 'TRANSFERENCIA', 'EFECTIVO', 'TARJETA', 'OTRO')),
  reference     text,
  months        integer not null check (months between 1 and 36),
  paid_at       date not null default current_date,
  period_start  date not null,
  period_end    date not null check (period_end >= period_start),
  created_by    uuid default auth.uid() references auth.users (id),
  created_at    timestamptz not null default now()
);
create index subscription_payments_org_idx on public.subscription_payments (org_id, paid_at desc);

-- ---------------------------------------------------------------------
-- Solicitudes de acceso (formulario público)
-- ---------------------------------------------------------------------
create table public.access_requests (
  id             uuid primary key default gen_random_uuid(),
  company_name   text not null check (length(trim(company_name)) between 2 and 120),
  tax_id         text check (tax_id is null or tax_id ~ '^(10|15|17|20)\d{9}$'),
  contact_name   text not null check (length(trim(contact_name)) between 3 and 120),
  email          text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone          text,
  plan_code      text references public.plans (code),
  message        text check (message is null or length(message) <= 1000),
  status         text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  org_id         uuid references public.organizations (id) on delete set null,
  reject_reason  text,
  reviewed_by    uuid references auth.users (id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index access_requests_pending_email on public.access_requests (lower(email)) where status = 'PENDING';

-- ---------------------------------------------------------------------
-- Invitaciones: única vía para crear usuarios (además del primer arranque).
-- inviteUserByEmail crea el usuario en auth al enviar el correo; el trigger
-- handle_new_user consume la invitación y crea el perfil activo.
-- ---------------------------------------------------------------------
create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name    text,
  role         text not null check (role in ('ADMIN', 'GERENTE', 'VENDEDOR', 'ORFEBRE', 'SUPERVISOR')),
  status       text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REVOKED')),
  invited_by   uuid default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);
create unique index invitations_pending_email on public.invitations (lower(email)) where status = 'PENDING';
create index invitations_org_idx on public.invitations (org_id, created_at desc);

-- ---------------------------------------------------------------------
-- Límite de usuarios del plan: activos + invitaciones pendientes.
-- ---------------------------------------------------------------------
create or replace function public.org_seats_used(p_org_id uuid, p_exclude_email text default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.profiles
            where org_id = p_org_id and active
              and (p_exclude_email is null or lower(email) <> lower(p_exclude_email)))::integer
       + (select count(*) from public.invitations
            where org_id = p_org_id and status = 'PENDING'
              and (p_exclude_email is null or lower(email) <> lower(p_exclude_email)))::integer;
$$;

create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if new.active and (tg_op = 'INSERT' or not old.active) then
    v_limit := public.org_seat_limit(new.org_id);
    if v_limit is not null and public.org_seats_used(new.org_id, new.email) >= v_limit then
      raise exception 'Se alcanzó el límite de % usuarios activos del plan. Desactive un usuario o mejore el plan.', v_limit;
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_seat_limit before insert or update of active on public.profiles
  for each row execute function public.enforce_seat_limit();

-- ---------------------------------------------------------------------
-- Alta de usuarios: solo por invitación. Excepción: instalación vacía,
-- donde el primer usuario crea la organización y es superadministrador.
-- ---------------------------------------------------------------------
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
    update public.invitations set status = 'ACCEPTED', accepted_at = now() where id = v_inv.id;
    return new;
  end if;

  if not exists (select 1 from public.organizations) then
    insert into public.organizations (name) values ('Mi Orfebrería') returning id into v_org_id;
    insert into public.settings (org_id) values (v_org_id);
    insert into public.profiles (id, org_id, full_name, email, role, active)
    values (new.id, v_org_id, v_name, new.email, 'ADMIN', true);
    insert into public.platform_admins (user_id) values (new.id);
    return new;
  end if;

  raise exception 'El registro es solo por invitación. Solicite acceso desde la página de inicio.';
end;
$$;

-- El superadministrador inicial es el primer ADMIN de la primera organización
-- (el dueño de la instalación). Cambiar con:
--   insert into public.platform_admins (user_id) select id from auth.users where email = '...';
insert into public.platform_admins (user_id)
select p.id from public.profiles p
 where p.role = 'ADMIN' and p.active
   and p.org_id = (select id from public.organizations order by created_at limit 1)
 order by p.created_at limit 1
on conflict do nothing;

-- ---------------------------------------------------------------------
-- RLS de las tablas nuevas
-- ---------------------------------------------------------------------
alter table public.plans                  enable row level security;
alter table public.platform_admins        enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.subscription_payments  enable row level security;
alter table public.access_requests        enable row level security;
alter table public.invitations            enable row level security;

create policy plans_select on public.plans for select to anon, authenticated using (true);
create policy plans_write on public.plans for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- La empresa ve su suscripción y sus pagos (solo el ADMIN ve los pagos); escribe solo la plataforma vía RPC.
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_platform_admin() or org_id = (select org_id from public.profiles where id = auth.uid()));
create policy subscription_payments_select on public.subscription_payments for select to authenticated
  using (public.is_platform_admin() or (org_id = public.current_org_id() and public.has_role('ADMIN')));

create policy access_requests_select on public.access_requests for select to authenticated
  using (public.is_platform_admin());

-- Datos de otras empresas: el superadmin los obtiene solo vía platform_organizations();
-- las tablas de negocio siguen limitadas a su propia organización.
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_platform_admin() or (org_id = public.current_org_id() and public.has_role('ADMIN')));

-- ---------------------------------------------------------------------
-- RPC públicas y de empresa
-- ---------------------------------------------------------------------

-- Formulario público "Solicitar acceso" (anon).
create or replace function public.submit_access_request(
  p_company_name text, p_tax_id text, p_contact_name text, p_email text,
  p_phone text, p_plan_code text, p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Ese correo ya tiene una cuenta. Inicie sesión o use «¿Olvidó su contraseña?».';
  end if;
  if exists (select 1 from public.access_requests where lower(email) = v_email and status = 'PENDING') then
    raise exception 'Ya existe una solicitud pendiente con ese correo. Le contactaremos pronto.';
  end if;
  if (select count(*) from public.access_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Recibimos demasiadas solicitudes. Intente nuevamente en unos minutos.';
  end if;

  insert into public.access_requests (company_name, tax_id, contact_name, email, phone, plan_code, message)
  values (trim(p_company_name), nullif(trim(p_tax_id), ''), trim(p_contact_name), v_email,
          nullif(trim(p_phone), ''), nullif(p_plan_code, ''), nullif(trim(p_message), ''));
end;
$$;

-- Estado del plan de la empresa del usuario (funciona aun suspendida, para mostrar el aviso).
create or replace function public.my_subscription()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'org_id', s.org_id,
    'plan_code', s.plan_code,
    'plan_name', p.name,
    'max_users', p.max_users,
    'extra_users', s.extra_users,
    'seat_limit', p.max_users + s.extra_users,
    'seats_used', public.org_seats_used(s.org_id),
    'status', s.status,
    'state', public.org_access_state(s.org_id),
    'current_period_end', s.current_period_end,
    'grace_end', s.current_period_end + s.grace_days,
    'days_left', s.current_period_end - current_date
  )
    from public.profiles pr
    join public.subscriptions s on s.org_id = pr.org_id
    join public.plans p on p.code = s.plan_code
   where pr.id = auth.uid();
$$;

-- El ADMIN de la empresa invita a un usuario (reserva un cupo del plan).
-- El correo lo envía la Edge Function send-invitation.
create or replace function public.create_invitation(p_email text, p_full_name text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_email  text := lower(trim(p_email));
  v_limit  integer;
  v_id     uuid;
begin
  if v_org is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador de la empresa puede invitar usuarios.';
  end if;
  if not public.org_can_write(v_org) then
    raise exception 'El plan de su empresa está vencido. Regularice el pago para invitar usuarios.';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Ese correo ya tiene una cuenta en el sistema.';
  end if;
  update public.invitations set status = 'REVOKED'
   where org_id = v_org and lower(email) = v_email and status = 'PENDING';
  v_limit := public.org_seat_limit(v_org);
  if public.org_seats_used(v_org) >= v_limit then
    raise exception 'Se alcanzó el límite de % usuarios del plan. Desactive un usuario o mejore el plan.', v_limit;
  end if;

  insert into public.invitations (org_id, email, full_name, role)
  values (v_org, v_email, nullif(trim(p_full_name), ''), p_role)
  returning id into v_id;
  return v_id;
end;
$$;

-- Usada por la Edge Function (con el JWT del usuario) para validar el envío.
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
     and (public.is_platform_admin()
          or (i.org_id = public.current_org_id() and public.has_role('ADMIN')));
$$;

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invitations set status = 'REVOKED'
   where id = p_id and status = 'PENDING'
     and (public.is_platform_admin()
          or (org_id = public.current_org_id() and public.has_role('ADMIN')));
end;
$$;

-- ---------------------------------------------------------------------
-- RPC del superadministrador
-- ---------------------------------------------------------------------
create or replace function public.assert_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo el administrador de la plataforma puede realizar esta acción.';
  end if;
end;
$$;

-- Aprueba la solicitud: crea la empresa (catálogos y suscripción por trigger),
-- fija plan y días de prueba, e invita al dueño como ADMIN.
create or replace function public.platform_approve_request(p_id uuid, p_plan_code text, p_trial_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.access_requests%rowtype;
  v_org   uuid;
  v_inv   uuid;
begin
  perform public.assert_platform_admin();
  select * into r from public.access_requests where id = p_id for update;
  if not found or r.status <> 'PENDING' then
    raise exception 'La solicitud no existe o ya fue atendida.';
  end if;
  if exists (select 1 from public.profiles where lower(email) = lower(r.email)) then
    raise exception 'El correo % ya tiene una cuenta en el sistema.', r.email;
  end if;
  if p_trial_days not between 0 and 90 then
    raise exception 'Los días de prueba deben estar entre 0 y 90.';
  end if;

  insert into public.organizations (name) values (r.company_name) returning id into v_org;
  insert into public.settings (org_id, company_name, tax_id, phone, email)
  values (v_org, r.company_name, r.tax_id, r.phone, r.email);
  update public.subscriptions
     set plan_code = coalesce(p_plan_code, r.plan_code, 'BASICO'),
         status = 'TRIAL',
         current_period_end = current_date + p_trial_days
   where org_id = v_org;

  update public.invitations set status = 'REVOKED' where lower(email) = lower(r.email) and status = 'PENDING';
  insert into public.invitations (org_id, email, full_name, role)
  values (v_org, lower(r.email), r.contact_name, 'ADMIN') returning id into v_inv;

  update public.access_requests
     set status = 'APPROVED', org_id = v_org, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('org_id', v_org, 'invitation_id', v_inv, 'email', r.email);
end;
$$;

create or replace function public.platform_reject_request(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  update public.access_requests
     set status = 'REJECTED', reject_reason = nullif(trim(p_reason), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status = 'PENDING';
  if not found then
    raise exception 'La solicitud no existe o ya fue atendida.';
  end if;
end;
$$;

-- Invita a un usuario ADMIN a una empresa existente (p. ej. reemplazo del dueño).
create or replace function public.platform_invite_admin(p_org_id uuid, p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_id    uuid;
begin
  perform public.assert_platform_admin();
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Ese correo ya tiene una cuenta en el sistema.';
  end if;
  update public.invitations set status = 'REVOKED' where lower(email) = v_email and status = 'PENDING';
  if public.org_seats_used(p_org_id) >= public.org_seat_limit(p_org_id) then
    raise exception 'La empresa no tiene cupos libres. Aumente los usuarios adicionales o cambie de plan.';
  end if;
  insert into public.invitations (org_id, email, full_name, role)
  values (p_org_id, v_email, nullif(trim(p_full_name), ''), 'ADMIN') returning id into v_id;
  return v_id;
end;
$$;

-- Registra un pago y extiende el periodo. Vigente o en gracia: el nuevo periodo
-- continúa al día siguiente del vencimiento (la gracia no es gratis). Prueba o
-- vencida: empieza en la fecha de pago.
create or replace function public.platform_register_payment(
  p_org_id uuid, p_plan_code text, p_amount numeric, p_method text,
  p_months integer, p_paid_at date, p_reference text
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  s        public.subscriptions%rowtype;
  v_start  date;
  v_end    date;
begin
  perform public.assert_platform_admin();
  select * into s from public.subscriptions where org_id = p_org_id for update;
  if not found then
    raise exception 'La empresa no tiene suscripción.';
  end if;

  v_start := coalesce(p_paid_at, current_date);
  if s.status <> 'TRIAL' and v_start <= s.current_period_end + s.grace_days then
    v_start := s.current_period_end + 1;
  end if;
  v_end := (v_start + make_interval(months => p_months))::date - 1;

  insert into public.subscription_payments (org_id, plan_code, amount, method, reference, months, paid_at, period_start, period_end)
  values (p_org_id, p_plan_code, p_amount, p_method, nullif(trim(p_reference), ''), p_months,
          coalesce(p_paid_at, current_date), v_start, v_end);

  update public.subscriptions
     set plan_code = p_plan_code, status = 'ACTIVE', current_period_end = v_end
   where org_id = p_org_id;
  return v_end;
end;
$$;

-- Edición manual: cambio de plan, usuarios extra, extender/ajustar fecha, suspender o reactivar.
create or replace function public.platform_update_subscription(
  p_org_id uuid, p_plan_code text, p_status text, p_extra_users integer,
  p_current_period_end date, p_grace_days integer, p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  update public.subscriptions
     set plan_code = p_plan_code,
         status = p_status,
         extra_users = p_extra_users,
         current_period_end = p_current_period_end,
         grace_days = p_grace_days,
         notes = nullif(trim(p_notes), '')
   where org_id = p_org_id;
  if not found then
    raise exception 'La empresa no tiene suscripción.';
  end if;
end;
$$;

-- Listado de empresas con su situación de plan y uso.
create or replace function public.platform_organizations()
returns table (
  org_id uuid, name text, tax_id text, email text, phone text,
  plan_code text, plan_name text, status text, state text,
  current_period_end date, days_left integer, grace_days integer, extra_users integer, notes text,
  seats_used integer, seat_limit integer, owner_name text, owner_email text,
  last_payment_at date, total_paid numeric, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  return query
  select o.id, coalesce(st.company_name, o.name), st.tax_id, st.email, st.phone,
         s.plan_code, p.name, s.status, public.org_access_state(o.id),
         s.current_period_end, (s.current_period_end - current_date)::integer, s.grace_days, s.extra_users, s.notes,
         public.org_seats_used(o.id), p.max_users + s.extra_users,
         ow.full_name, ow.email,
         (select max(sp.paid_at) from public.subscription_payments sp where sp.org_id = o.id),
         coalesce((select sum(sp.amount) from public.subscription_payments sp where sp.org_id = o.id), 0),
         o.created_at
    from public.organizations o
    join public.subscriptions s on s.org_id = o.id
    join public.plans p on p.code = s.plan_code
    left join public.settings st on st.org_id = o.id
    left join lateral (
      select pr.full_name, pr.email from public.profiles pr
       where pr.org_id = o.id and pr.role = 'ADMIN' and pr.active
       order by pr.created_at limit 1
    ) ow on true
   order by s.current_period_end;
end;
$$;

-- Resumen de la plataforma: empresas por estado, ingreso mensual recurrente y cobrado.
create or replace function public.platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.assert_platform_admin();
  with orgs as (
    select s.org_id, public.org_access_state(s.org_id) as state, p.price_month, p.extra_user_price, s.extra_users
      from public.subscriptions s join public.plans p on p.code = s.plan_code
  )
  select jsonb_build_object(
    'total',      (select count(*) from orgs),
    'active',     (select count(*) from orgs where state = 'ACTIVE'),
    'trial',      (select count(*) from orgs where state = 'TRIAL'),
    'grace',      (select count(*) from orgs where state = 'GRACE'),
    'expired',    (select count(*) from orgs where state = 'EXPIRED'),
    'suspended',  (select count(*) from orgs where state in ('SUSPENDED', 'CANCELLED')),
    'pending_requests', (select count(*) from public.access_requests where status = 'PENDING'),
    'expiring_7_days',  (select count(*) from public.subscriptions s
                          where s.status in ('ACTIVE', 'TRIAL') and s.current_period_end between current_date and current_date + 7),
    'mrr', (select coalesce(sum(price_month + coalesce(extra_user_price, 0) * extra_users), 0)
              from orgs where state in ('ACTIVE', 'GRACE')),
    'collected_month', (select coalesce(sum(amount), 0) from public.subscription_payments
                         where date_trunc('month', paid_at) = date_trunc('month', current_date)),
    'revenue_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'amount', coalesce(t.amount, 0)) order by m), '[]'::jsonb)
        from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m
        left join (select date_trunc('month', paid_at) as month, sum(amount) as amount
                     from public.subscription_payments group by 1) t on t.month = m
    )
  ) into v;
  return v;
end;
$$;

-- Avisos por correo del día (Edge Function subscription-reminders, con service_role):
-- 7, 3, 1 y 0 días antes del vencimiento, al entrar en gracia y al vencer.
create or replace function public.subscription_reminders_due()
returns table (
  org_id uuid, company_name text, plan_name text, status text, state text,
  current_period_end date, days_left integer, grace_end date, admin_emails text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select s.org_id, coalesce(st.company_name, o.name), p.name, s.status, public.org_access_state(s.org_id),
         s.current_period_end, (s.current_period_end - current_date)::integer, s.current_period_end + s.grace_days,
         array(select pr.email from public.profiles pr where pr.org_id = s.org_id and pr.role = 'ADMIN' and pr.active)
    from public.subscriptions s
    join public.organizations o on o.id = s.org_id
    join public.plans p on p.code = s.plan_code
    left join public.settings st on st.org_id = s.org_id
   where s.status in ('TRIAL', 'ACTIVE')
     and (
       (s.current_period_end - current_date) in (7, 3, 1, 0)
       or current_date = s.current_period_end + 1
       or (s.status = 'ACTIVE' and s.grace_days > 0 and current_date = s.current_period_end + s.grace_days + 1)
     );
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function public.subscription_reminders_due() from public, anon, authenticated;
grant execute on function public.subscription_reminders_due() to service_role;

revoke execute on function public.submit_access_request(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_access_request(text, text, text, text, text, text, text) to anon, authenticated;

revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.assert_platform_admin() from public, anon;
revoke execute on function public.org_access_state(uuid) from public, anon;
revoke execute on function public.org_can_write(uuid) from public, anon;
revoke execute on function public.org_seat_limit(uuid) from public, anon;
revoke execute on function public.org_seats_used(uuid, text) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.assert_platform_admin() to authenticated;
grant execute on function public.org_access_state(uuid) to authenticated;
grant execute on function public.org_can_write(uuid) to authenticated;
grant execute on function public.org_seat_limit(uuid) to authenticated;
grant execute on function public.org_seats_used(uuid, text) to authenticated;

revoke execute on function public.my_subscription() from public, anon;
revoke execute on function public.create_invitation(text, text, text) from public, anon;
revoke execute on function public.invitation_for_sending(uuid) from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
revoke execute on function public.platform_approve_request(uuid, text, integer) from public, anon;
revoke execute on function public.platform_reject_request(uuid, text) from public, anon;
revoke execute on function public.platform_invite_admin(uuid, text, text) from public, anon;
revoke execute on function public.platform_register_payment(uuid, text, numeric, text, integer, date, text) from public, anon;
revoke execute on function public.platform_update_subscription(uuid, text, text, integer, date, integer, text) from public, anon;
revoke execute on function public.platform_organizations() from public, anon;
revoke execute on function public.platform_overview() from public, anon;
grant execute on function public.my_subscription() to authenticated;
grant execute on function public.create_invitation(text, text, text) to authenticated;
grant execute on function public.invitation_for_sending(uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.platform_approve_request(uuid, text, integer) to authenticated;
grant execute on function public.platform_reject_request(uuid, text) to authenticated;
grant execute on function public.platform_invite_admin(uuid, text, text) to authenticated;
grant execute on function public.platform_register_payment(uuid, text, numeric, text, integer, date, text) to authenticated;
grant execute on function public.platform_update_subscription(uuid, text, text, integer, date, integer, text) to authenticated;
grant execute on function public.platform_organizations() to authenticated;
grant execute on function public.platform_overview() to authenticated;
