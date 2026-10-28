-- =====================================================================
-- 0019_gastos_prestamos.sql
--   * Gastos de la empresa (planilla, servicios, alquiler, impuestos...).
--     No se eliminan: se anulan (como los recibos de egreso).
--   * Préstamos al personal y a joyeros, con sus abonos (en efectivo o
--     descontados del pago al joyero / de la planilla).
--   * Estado de resultados mensual por caja: cobros recibidos del mes
--     menos pagos a joyeros y gastos. Los montos en US$ se pasan a soles
--     con el TC de venta vigente en la fecha de cada movimiento (0018).
--     Los préstamos no son gasto ni ingreso: se informan aparte.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Conversión a soles con el TC de la empresa en una fecha
-- ---------------------------------------------------------------------
create or replace function public.to_pen(p_amount numeric, p_currency text, p_date date)
returns numeric
language sql
stable
set search_path = public
as $$
  select case when p_currency = 'USD'
              then round(p_amount * coalesce((select sell from public.exchange_rate_on(p_date)),
                                             (select sell from public.exchange_rate_on(null))), 2)
              else p_amount end;
$$;

-- ---------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  branch_id     uuid not null references public.branches (id),
  number        text not null,
  expense_date  date not null default current_date,
  category      text not null check (category in ('PLANILLA', 'SERVICIOS', 'ALQUILER', 'IMPUESTOS', 'COMPRA_MATERIAL',
                                                  'HONORARIOS', 'MARKETING', 'MANTENIMIENTO', 'TRANSPORTE',
                                                  'BANCARIOS', 'OTROS')),
  description   text not null check (length(trim(description)) > 0),
  supplier      text,                                   -- proveedor o persona a quien se paga
  document_ref  text,                                   -- factura, boleta, recibo
  amount        numeric(12, 2) not null check (amount > 0),
  currency      text not null default 'PEN' check (currency in ('PEN', 'USD')),
  method        text not null check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO')),
  notes         text,
  voided        boolean not null default false,
  voided_at     timestamptz,
  voided_by     uuid references public.profiles (id),
  void_reason   text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, number)
);
create index expenses_org_date_idx on public.expenses (org_id, expense_date);
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
create trigger aa_subscription_guard before insert or update or delete on public.expenses
  for each row execute function public.enforce_org_writable();

-- Registra o corrige un gasto. p_data: {expense_date, category, description, supplier, document_ref,
-- amount, currency, method, notes, branch_id}
create or replace function public.save_expense(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_id      uuid := coalesce(p_id, gen_random_uuid());
  v_number  text;
  v_branch  uuid := coalesce(nullif(p_data ->> 'branch_id', '')::uuid, public.default_branch_id(v_org));
  v_date    date := coalesce(nullif(p_data ->> 'expense_date', '')::date, current_date);
  e         public.expenses%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede registrar gastos.';
  end if;
  if not public.has_branch_access(v_branch) then
    raise exception 'Sucursal no válida.';
  end if;
  if v_date > current_date then
    raise exception 'La fecha del gasto no puede ser futura.';
  end if;
  if coalesce(nullif(p_data ->> 'amount', '')::numeric, 0) <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if length(trim(coalesce(p_data ->> 'description', ''))) = 0 then
    raise exception 'Indique la descripción del gasto.';
  end if;

  if p_id is null then
    v_number := public.next_document_number(v_org, 'GA');
    insert into public.expenses (id, org_id, branch_id, number, expense_date, category, description, supplier,
                                 document_ref, amount, currency, method, notes, created_by)
    values (v_id, v_org, v_branch, v_number, v_date, p_data ->> 'category', trim(p_data ->> 'description'),
            nullif(trim(p_data ->> 'supplier'), ''), nullif(trim(p_data ->> 'document_ref'), ''),
            (p_data ->> 'amount')::numeric, coalesce(nullif(p_data ->> 'currency', ''), 'PEN'), p_data ->> 'method',
            nullif(trim(p_data ->> 'notes'), ''), auth.uid());
  else
    select * into e from public.expenses where id = p_id and org_id = v_org for update;
    if not found then
      raise exception 'Gasto no encontrado.';
    end if;
    if e.voided then
      raise exception 'El gasto está anulado y no puede modificarse.';
    end if;
    v_number := e.number;
    update public.expenses
       set branch_id = v_branch, expense_date = v_date, category = p_data ->> 'category',
           description = trim(p_data ->> 'description'), supplier = nullif(trim(p_data ->> 'supplier'), ''),
           document_ref = nullif(trim(p_data ->> 'document_ref'), ''), amount = (p_data ->> 'amount')::numeric,
           currency = coalesce(nullif(p_data ->> 'currency', ''), 'PEN'), method = p_data ->> 'method',
           notes = nullif(trim(p_data ->> 'notes'), '')
     where id = p_id;
  end if;
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

create or replace function public.void_expense(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede anular gastos.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  update public.expenses
     set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_id and org_id = v_org and not voided;
  if not found then
    raise exception 'Gasto no encontrado o ya anulado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Préstamos
-- ---------------------------------------------------------------------
create table public.loans (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  branch_id         uuid not null references public.branches (id),
  number            text not null,
  beneficiary_type  text not null check (beneficiary_type in ('EMPLEADO', 'JOYERO')),
  jeweler_id        uuid references public.jewelers (id),
  profile_id        uuid references public.profiles (id),
  beneficiary_name  text not null check (length(trim(beneficiary_name)) > 0),
  document_number   text,
  loan_date         date not null default current_date,
  amount            numeric(12, 2) not null check (amount > 0),
  currency          text not null default 'PEN' check (currency in ('PEN', 'USD')),
  installments      integer not null default 1 check (installments between 1 and 60),
  method            text not null check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO')),
  reason            text not null check (length(trim(reason)) > 0),
  amount_paid       numeric(12, 2) not null default 0,
  balance           numeric(12, 2) generated always as (amount - amount_paid) stored,
  voided            boolean not null default false,
  voided_at         timestamptz,
  voided_by         uuid references public.profiles (id),
  void_reason       text,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  unique (org_id, number),
  constraint loans_jeweler check ((beneficiary_type = 'JOYERO') = (jeweler_id is not null))
);
create index loans_org_idx on public.loans (org_id, loan_date);
create index loans_jeweler_idx on public.loans (jeweler_id) where jeweler_id is not null;
create trigger aa_subscription_guard before insert or update or delete on public.loans
  for each row execute function public.enforce_org_writable();

create table public.loan_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  loan_id       uuid not null references public.loans (id),
  number        text not null,
  payment_date  date not null default current_date,
  amount        numeric(12, 2) not null check (amount > 0),
  method        text not null check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE',
                                                'DESCUENTO_PLANILLA', 'DESCUENTO_PAGO_JOYERO', 'OTRO')),
  reference     text,
  voided        boolean not null default false,
  voided_at     timestamptz,
  voided_by     uuid references public.profiles (id),
  void_reason   text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  unique (org_id, number)
);
create index loan_payments_loan_idx on public.loan_payments (loan_id);
create index loan_payments_org_date_idx on public.loan_payments (org_id, payment_date);
create trigger aa_subscription_guard before insert or update or delete on public.loan_payments
  for each row execute function public.enforce_org_writable();

create or replace function public.recalc_loan(p_loan_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.loans
     set amount_paid = coalesce((select sum(amount) from public.loan_payments
                                  where loan_id = p_loan_id and not voided), 0)
   where id = p_loan_id;
$$;

-- p_data: {beneficiary_type, jeweler_id, profile_id, beneficiary_name, document_number, loan_date, amount,
-- currency, installments, method, reason, branch_id}
create or replace function public.register_loan(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_id      uuid := gen_random_uuid();
  v_number  text;
  v_type    text := p_data ->> 'beneficiary_type';
  v_jeweler uuid := nullif(p_data ->> 'jeweler_id', '')::uuid;
  v_profile uuid := nullif(p_data ->> 'profile_id', '')::uuid;
  v_name    text := nullif(trim(p_data ->> 'beneficiary_name'), '');
  v_doc     text := nullif(trim(p_data ->> 'document_number'), '');
  v_branch  uuid := coalesce(nullif(p_data ->> 'branch_id', '')::uuid, public.default_branch_id(v_org));
  v_date    date := coalesce(nullif(p_data ->> 'loan_date', '')::date, current_date);
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede registrar préstamos.';
  end if;
  if not public.has_branch_access(v_branch) then
    raise exception 'Sucursal no válida.';
  end if;
  if v_type = 'JOYERO' then
    select full_name, coalesce(v_doc, document_number) into v_name, v_doc
      from public.jewelers where id = v_jeweler and org_id = v_org;
    if v_name is null then
      raise exception 'Seleccione un joyero válido.';
    end if;
    v_profile := null;
  elsif v_type = 'EMPLEADO' then
    v_jeweler := null;
    if v_profile is not null then
      select coalesce(v_name, full_name) into v_name from public.profiles where id = v_profile and org_id = v_org;
      if not found then
        raise exception 'Usuario no válido.';
      end if;
    end if;
    if v_name is null then
      raise exception 'Indique el nombre del trabajador.';
    end if;
  else
    raise exception 'Tipo de beneficiario no válido.';
  end if;
  if coalesce(nullif(p_data ->> 'amount', '')::numeric, 0) <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if length(trim(coalesce(p_data ->> 'reason', ''))) = 0 then
    raise exception 'Indique el motivo del préstamo.';
  end if;
  if v_date > current_date then
    raise exception 'La fecha del préstamo no puede ser futura.';
  end if;

  v_number := public.next_document_number(v_org, 'PR');
  insert into public.loans (id, org_id, branch_id, number, beneficiary_type, jeweler_id, profile_id, beneficiary_name,
                            document_number, loan_date, amount, currency, installments, method, reason, created_by)
  values (v_id, v_org, v_branch, v_number, v_type, v_jeweler, v_profile, v_name, v_doc, v_date,
          (p_data ->> 'amount')::numeric, coalesce(nullif(p_data ->> 'currency', ''), 'PEN'),
          coalesce(nullif(p_data ->> 'installments', '')::integer, 1), p_data ->> 'method', trim(p_data ->> 'reason'),
          auth.uid());
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

create or replace function public.register_loan_payment(p_loan_id uuid, p_amount numeric, p_method text,
                                                        p_payment_date date default null, p_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_id      uuid := gen_random_uuid();
  v_number  text;
  l         public.loans%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede registrar abonos.';
  end if;
  select * into l from public.loans where id = p_loan_id and org_id = v_org for update;
  if not found then
    raise exception 'Préstamo no encontrado.';
  end if;
  if l.voided then
    raise exception 'El préstamo está anulado.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if p_amount > l.balance then
    raise exception 'El abono (%) supera el saldo del préstamo (%).',
      public.format_money(p_amount, l.currency), public.format_money(l.balance, l.currency);
  end if;
  if coalesce(p_payment_date, current_date) > current_date then
    raise exception 'La fecha del abono no puede ser futura.';
  end if;

  v_number := public.next_document_number(v_org, 'AP');
  insert into public.loan_payments (id, org_id, loan_id, number, payment_date, amount, method, reference, created_by)
  values (v_id, v_org, p_loan_id, v_number, coalesce(p_payment_date, current_date), p_amount, p_method,
          nullif(trim(p_reference), ''), auth.uid());
  perform public.recalc_loan(p_loan_id);
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

create or replace function public.void_loan_payment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  v_loan uuid;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede anular abonos.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  update public.loan_payments
     set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_id and org_id = v_org and not voided
  returning loan_id into v_loan;
  if v_loan is null then
    raise exception 'Abono no encontrado o ya anulado.';
  end if;
  perform public.recalc_loan(v_loan);
end;
$$;

-- Un préstamo solo se anula si no tiene abonos vigentes.
create or replace function public.void_loan(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede anular préstamos.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  if exists (select 1 from public.loan_payments where loan_id = p_id and not voided) then
    raise exception 'Anule primero los abonos del préstamo.';
  end if;
  update public.loans
     set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_id and org_id = v_org and not voided;
  if not found then
    raise exception 'Préstamo no encontrado o ya anulado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Estado de resultados (por caja) de un mes
-- ---------------------------------------------------------------------
create or replace function public.report_profit(p_year integer, p_month integer, p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_from   date := make_date(p_year, p_month, 1);
  v_to     date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_result jsonb;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede ver la utilidad.';
  end if;
  if p_branch_id is not null and not public.has_branch_access(p_branch_id) then
    raise exception 'Sucursal no válida.';
  end if;

  with
  income as (
    select p.method, p.currency, p.amount, public.to_pen(p.amount, p.currency, p.payment_date) as pen
      from public.payments p join public.orders o on o.id = p.order_id
     where p.org_id = v_org and not p.voided and p.payment_date between v_from and v_to
       and (p_branch_id is null or o.branch_id = p_branch_id)),
  labor as (
    select jp.currency, jp.amount, public.to_pen(jp.amount, jp.currency, jp.payment_date) as pen
      from public.jeweler_payments jp
     where jp.org_id = v_org and not jp.voided and jp.payment_date between v_from and v_to
       and (p_branch_id is null or jp.branch_id = p_branch_id)),
  spend as (
    select e.category, e.currency, e.amount, public.to_pen(e.amount, e.currency, e.expense_date) as pen
      from public.expenses e
     where e.org_id = v_org and not e.voided and e.expense_date between v_from and v_to
       and (p_branch_id is null or e.branch_id = p_branch_id)),
  lent as (
    select public.to_pen(l.amount, l.currency, l.loan_date) as pen
      from public.loans l
     where l.org_id = v_org and not l.voided and l.loan_date between v_from and v_to
       and (p_branch_id is null or l.branch_id = p_branch_id)),
  repaid as (
    select public.to_pen(lp.amount, l.currency, lp.payment_date) as pen
      from public.loan_payments lp join public.loans l on l.id = lp.loan_id
     where lp.org_id = v_org and not lp.voided and lp.payment_date between v_from and v_to
       and (p_branch_id is null or l.branch_id = p_branch_id)),
  totals as (
    select (select coalesce(sum(pen), 0) from income) as income,
           (select coalesce(sum(pen), 0) from labor)  as labor,
           (select coalesce(sum(pen), 0) from spend)  as expenses)
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'income', t.income,
    'income_usd', (select coalesce(sum(amount), 0) from income where currency = 'USD'),
    'income_by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by amt desc), '[]'::jsonb)
                           from (select method, sum(pen) amt from income group by method) x),
    'labor', t.labor,
    'gross_profit', t.income - t.labor,
    'expenses', t.expenses,
    'expenses_by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amt, 'count', n)
                                                       order by amt desc), '[]'::jsonb)
                               from (select category, sum(pen) amt, count(*) n from spend group by category) x),
    'net_profit', t.income - t.labor - t.expenses,
    'margin', case when t.income > 0 then round((t.income - t.labor - t.expenses) / t.income * 100, 1) end,
    'loans_given', (select coalesce(sum(pen), 0) from lent),
    'loans_repaid', (select coalesce(sum(pen), 0) from repaid),
    'exchange_rate', (select sell from public.exchange_rate_on(v_to)))
    into v_result
    from totals t;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS (escritura solo vía funciones)
-- ---------------------------------------------------------------------
alter table public.expenses      enable row level security;
alter table public.loans         enable row level security;
alter table public.loan_payments enable row level security;

create policy expenses_select on public.expenses for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE')
         and branch_id in (select public.current_branch_ids()));
create policy loans_select on public.loans for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE')
         and branch_id in (select public.current_branch_ids()));
create policy loan_payments_select on public.loan_payments for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE'));

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.recalc_loan(uuid) from public, anon, authenticated;
grant execute on function public.recalc_loan(uuid) to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.to_pen(numeric, text, date)',
    'public.save_expense(uuid, jsonb)',
    'public.void_expense(uuid, text)',
    'public.register_loan(jsonb)',
    'public.register_loan_payment(uuid, numeric, text, date, text)',
    'public.void_loan_payment(uuid, text)',
    'public.void_loan(uuid, text)',
    'public.report_profit(integer, integer, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
