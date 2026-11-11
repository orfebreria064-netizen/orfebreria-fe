-- =====================================================================
-- 0026_saldo_a_favor.sql
-- Saldo a favor del cliente (cuenta corriente por cliente y moneda).
--   * DEPOSITO:   el cliente deja dinero a cuenta (recibo de ingreso RI).
--   * EXCEDENTE:  lo que un pago supera el saldo del pedido pasa solo al
--                 saldo a favor (el pago queda por el saldo del pedido y
--                 el sobrante se guarda en payments.credit_excess).
--   * APLICACION: un pago de pedido con método SALDO_A_FAVOR consume saldo.
--   * DEVOLUCION: se devuelve dinero al cliente (recibo de egreso RE).
-- No se eliminan: se anulan. El excedente y la aplicación se anulan
-- anulando su pago.
--
-- Caja: el dinero entra al depositarse (DEPOSITO/EXCEDENTE) y sale al
-- devolverse; los pagos con SALDO_A_FAVOR no son dinero nuevo y no
-- cuentan como cobro en el dashboard, la utilidad ni el cierre diario.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pagos: nuevo método y excedente
-- ---------------------------------------------------------------------
alter table public.payments drop constraint payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO', 'SALDO_A_FAVOR'));
alter table public.payments
  add column credit_excess numeric(12, 2) not null default 0 check (credit_excess >= 0);

-- ---------------------------------------------------------------------
-- Movimientos del saldo a favor
-- ---------------------------------------------------------------------
create table public.customer_credits (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  branch_id       uuid not null references public.branches (id),
  customer_id     uuid not null references public.customers (id),
  kind            text not null check (kind in ('DEPOSITO', 'EXCEDENTE', 'APLICACION', 'DEVOLUCION')),
  movement_date   date not null default current_date,
  amount          numeric(12, 2) not null check (amount > 0),
  currency        text not null check (currency in ('PEN', 'USD')),
  method          text check (method in ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO')),
  reference       text,
  notes           text,
  received_from   text,
  receipt_number  text,
  payment_id      uuid references public.payments (id),
  voided          boolean not null default false,
  voided_at       timestamptz,
  voided_by       uuid references public.profiles (id),
  void_reason     text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  constraint customer_credits_method check ((kind = 'APLICACION') = (method is null)),
  constraint customer_credits_payment check ((kind in ('EXCEDENTE', 'APLICACION')) = (payment_id is not null))
);
create index customer_credits_customer_idx on public.customer_credits (customer_id, currency) where not voided;
create index customer_credits_org_date_idx on public.customer_credits (org_id, movement_date);
create index customer_credits_payment_idx on public.customer_credits (payment_id) where payment_id is not null;

-- Saldo vigente (uso interno: no valida permisos)
create or replace function public.customer_credit_balance(p_customer_id uuid, p_currency text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when kind in ('DEPOSITO', 'EXCEDENTE') then amount else -amount end), 0)
    from public.customer_credits
   where customer_id = p_customer_id and currency = p_currency and not voided;
$$;

-- Serializa los movimientos de un cliente en una moneda (evita gastar dos veces el mismo saldo)
create or replace function public.lock_customer_credit(p_customer_id uuid, p_currency text)
returns void
language sql
set search_path = public
as $$
  select pg_advisory_xact_lock(hashtextextended('customer_credit:' || p_customer_id::text || ':' || p_currency, 0));
$$;

-- Saldos del cliente: {"PEN": 0, "USD": 0}
create or replace function public.customer_credit_balances(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR') then
    raise exception 'No tiene permisos para ver el saldo a favor.';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and org_id = v_org) then
    raise exception 'Cliente no encontrado.';
  end if;
  return jsonb_build_object('PEN', public.customer_credit_balance(p_customer_id, 'PEN'),
                            'USD', public.customer_credit_balance(p_customer_id, 'USD'));
end;
$$;

-- Depósito a cuenta. p_data: {amount, currency, method, movement_date, reference, notes, received_from, branch_id}
create or replace function public.register_customer_deposit(p_customer_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_id       uuid := gen_random_uuid();
  v_branch   uuid := coalesce(nullif(p_data ->> 'branch_id', '')::uuid, public.default_branch_id(v_org));
  v_date     date := coalesce(nullif(p_data ->> 'movement_date', '')::date, current_date);
  v_amount   numeric := coalesce(nullif(p_data ->> 'amount', '')::numeric, 0);
  v_currency text := coalesce(nullif(p_data ->> 'currency', ''), 'PEN');
  v_receipt  text;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE', 'VENDEDOR') then
    raise exception 'No tiene permisos para registrar depósitos.';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and org_id = v_org) then
    raise exception 'Cliente no encontrado.';
  end if;
  if not public.has_branch_access(v_branch) then
    raise exception 'Sucursal no válida.';
  end if;
  if v_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if v_date > current_date then
    raise exception 'La fecha del depósito no puede ser futura.';
  end if;

  v_receipt := public.next_document_number(v_org, 'RI');
  insert into public.customer_credits (id, org_id, branch_id, customer_id, kind, movement_date, amount, currency, method,
                                       reference, notes, received_from, receipt_number, created_by)
  values (v_id, v_org, v_branch, p_customer_id, 'DEPOSITO', v_date, round(v_amount, 2), v_currency, p_data ->> 'method',
          nullif(trim(p_data ->> 'reference'), ''), nullif(trim(p_data ->> 'notes'), ''),
          nullif(trim(p_data ->> 'received_from'), ''), v_receipt, auth.uid());
  return jsonb_build_object('id', v_id, 'receipt_number', v_receipt);
end;
$$;

-- Devolución al cliente. p_data: {amount, currency, method, movement_date, reference, notes, branch_id}
create or replace function public.refund_customer_credit(p_customer_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_id       uuid := gen_random_uuid();
  v_branch   uuid := coalesce(nullif(p_data ->> 'branch_id', '')::uuid, public.default_branch_id(v_org));
  v_date     date := coalesce(nullif(p_data ->> 'movement_date', '')::date, current_date);
  v_amount   numeric := round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0), 2);
  v_currency text := coalesce(nullif(p_data ->> 'currency', ''), 'PEN');
  v_balance  numeric;
  v_receipt  text;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede devolver saldo a favor.';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and org_id = v_org) then
    raise exception 'Cliente no encontrado.';
  end if;
  if not public.has_branch_access(v_branch) then
    raise exception 'Sucursal no válida.';
  end if;
  if v_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;
  if v_date > current_date then
    raise exception 'La fecha de la devolución no puede ser futura.';
  end if;

  perform public.lock_customer_credit(p_customer_id, v_currency);
  v_balance := public.customer_credit_balance(p_customer_id, v_currency);
  if v_amount > v_balance then
    raise exception 'La devolución (%) supera el saldo a favor del cliente (%).',
      public.format_money(v_amount, v_currency), public.format_money(v_balance, v_currency);
  end if;

  v_receipt := public.next_document_number(v_org, 'RE');
  insert into public.customer_credits (id, org_id, branch_id, customer_id, kind, movement_date, amount, currency, method,
                                       reference, notes, receipt_number, created_by)
  values (v_id, v_org, v_branch, p_customer_id, 'DEVOLUCION', v_date, v_amount, v_currency, p_data ->> 'method',
          nullif(trim(p_data ->> 'reference'), ''), nullif(trim(p_data ->> 'notes'), ''), v_receipt, auth.uid());
  return jsonb_build_object('id', v_id, 'receipt_number', v_receipt);
end;
$$;

-- Anula un depósito o una devolución (el excedente y la aplicación se anulan anulando su pago)
create or replace function public.void_customer_credit(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  c     public.customer_credits%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede anular movimientos del saldo a favor.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indique el motivo de la anulación.';
  end if;
  select * into c from public.customer_credits where id = p_id and org_id = v_org;
  if not found or c.voided then
    raise exception 'Movimiento no encontrado o ya anulado.';
  end if;
  if c.kind in ('EXCEDENTE', 'APLICACION') then
    raise exception 'Este movimiento viene de un pago de pedido: anule el pago.';
  end if;

  perform public.lock_customer_credit(c.customer_id, c.currency);
  if c.kind = 'DEPOSITO' and public.customer_credit_balance(c.customer_id, c.currency) < c.amount then
    raise exception 'Parte de este depósito ya se usó en pedidos o se devolvió; anule primero esos movimientos.';
  end if;
  update public.customer_credits
     set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Pagos: aplicación del saldo a favor y excedente
-- (última versión anterior: 0012_taller_joyeros_precios.sql)
-- ---------------------------------------------------------------------
create or replace function public.payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance  numeric;
  v_status   text;
  v_currency text;
  v_customer uuid;
  v_credit   numeric;
begin
  -- Asignar el número de recibo a un pago anterior a los recibos no es una modificación del pago
  if tg_op = 'UPDATE' and old.receipt_number is null and new.receipt_number is not null
     and (to_jsonb(new) - 'receipt_number') = (to_jsonb(old) - 'receipt_number') then
    return new;
  end if;

  perform public.assert_order_editable(new.order_id);

  if tg_op = 'INSERT' then
    select balance, status, currency, customer_id into v_balance, v_status, v_currency, v_customer
      from public.orders where id = new.order_id for update;
    new.currency := v_currency;
    new.credit_excess := 0;
    if new.method = 'SALDO_A_FAVOR' then
      if new.amount > v_balance then
        raise exception 'El monto aplicado (%) supera el saldo pendiente del pedido (%).',
          public.format_money(new.amount, v_currency), public.format_money(greatest(v_balance, 0), v_currency);
      end if;
      perform public.lock_customer_credit(v_customer, v_currency);
      v_credit := public.customer_credit_balance(v_customer, v_currency);
      if new.amount > v_credit then
        raise exception 'El cliente tiene % de saldo a favor; no alcanza para aplicar %.',
          public.format_money(v_credit, v_currency), public.format_money(new.amount, v_currency);
      end if;
    elsif new.amount > v_balance then
      -- Lo que supera el saldo del pedido pasa al saldo a favor del cliente
      if v_balance <= 0 then
        raise exception 'El pedido no tiene saldo pendiente. Registre el dinero como depósito en el saldo a favor del cliente.';
      end if;
      new.credit_excess := new.amount - v_balance;
      new.amount := v_balance;
    end if;
    new.voided := false;
    new.received_from := nullif(trim(new.received_from), '');
    new.receipt_number := public.next_document_number(new.org_id, 'RI');
  else
    if (new.order_id, new.amount, new.method, new.payment_date, new.currency, new.credit_excess) is distinct from
       (old.order_id, old.amount, old.method, old.payment_date, old.currency, old.credit_excess) then
      raise exception 'Un pago registrado no se puede modificar; anúlelo y registre uno nuevo.';
    end if;
    if old.receipt_number is not null and new.receipt_number is distinct from old.receipt_number then
      raise exception 'El número de recibo no se puede cambiar.';
    end if;
    if old.voided and not new.voided then
      raise exception 'Un pago anulado no se puede reactivar.';
    end if;
    if new.voided and not old.voided then
      if length(trim(coalesce(new.void_reason, ''))) = 0 then
        raise exception 'Indique el motivo de la anulación.';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.payments_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number   text;
  v_customer uuid;
  v_method   text := case when new.method = 'SALDO_A_FAVOR' then 'saldo a favor' else initcap(lower(new.method)) end;
begin
  if tg_op = 'UPDATE' and new.voided = old.voided then
    return null;      -- p. ej. asignación del número de recibo
  end if;

  update public.orders o
     set amount_paid = coalesce((select sum(amount) from public.payments
                                  where order_id = new.order_id and not voided), 0)
   where o.id = new.order_id;

  select number, customer_id into v_number, v_customer from public.orders where id = new.order_id;
  if tg_op = 'INSERT' then
    if new.method = 'SALDO_A_FAVOR' then
      insert into public.customer_credits (org_id, branch_id, customer_id, kind, movement_date, amount, currency,
                                           notes, receipt_number, payment_id, created_by)
      values (new.org_id, new.branch_id, v_customer, 'APLICACION', new.payment_date, new.amount, new.currency,
              'Aplicado al pedido ' || v_number, new.receipt_number, new.id, new.created_by);
    end if;
    if new.credit_excess > 0 then
      insert into public.customer_credits (org_id, branch_id, customer_id, kind, movement_date, amount, currency, method,
                                           reference, notes, received_from, receipt_number, payment_id, created_by)
      values (new.org_id, new.branch_id, v_customer, 'EXCEDENTE', new.payment_date, new.credit_excess, new.currency,
              new.method, new.reference, 'Excedente del pago del pedido ' || v_number, new.received_from,
              new.receipt_number, new.id, new.created_by);
    end if;

    perform public.log_order_event(new.order_id, 'PAGO',
      public.current_user_name() || ' registró ' ||
      case when new.is_advance then 'un adelanto' else 'un pago' end || ' de ' ||
      public.format_money(new.amount, new.currency) ||
      ' (' || v_method || ') en ' || v_number ||
      coalesce('. Recibo ' || new.receipt_number, '') ||
      case when new.credit_excess > 0
           then '. ' || public.format_money(new.credit_excess, new.currency) || ' pasaron al saldo a favor del cliente'
           else '' end || '.',
      null, new.amount::text);
  elsif new.voided and not old.voided then
    -- El saldo a favor generado por el pago no debe estar ya usado
    if new.credit_excess > 0 then
      perform public.lock_customer_credit(v_customer, new.currency);
      if public.customer_credit_balance(v_customer, new.currency) < new.credit_excess then
        raise exception 'El saldo a favor que generó este pago (%) ya se usó o se devolvió; anule primero esos movimientos.',
          public.format_money(new.credit_excess, new.currency);
      end if;
    end if;
    update public.customer_credits
       set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = 'Pago anulado: ' || new.void_reason
     where payment_id = new.id and not voided;

    perform public.log_order_event(new.order_id, 'PAGO',
      public.current_user_name() || ' anuló un pago de ' || public.format_money(new.amount, new.currency) ||
      ' en ' || v_number || coalesce(' (recibo ' || new.receipt_number || ')', '') ||
      '. Motivo: ' || new.void_reason || '.',
      new.amount::text, null);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard: lo cobrado = pagos (sin SALDO_A_FAVOR) + depósitos y
-- excedentes − devoluciones (última versión anterior: 0012)
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard(p_branch_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with orders_b as (
    select * from public.orders where p_branch_id is null or branch_id = p_branch_id
  ),
  active_orders as (
    select * from orders_b where status not in ('ENTREGADO', 'CERRADO', 'CANCELADO')
  ),
  quotations_b as (
    select * from public.quotations where p_branch_id is null or branch_id = p_branch_id
  ),
  payments_b as (
    select currency, amount, payment_date from public.payments
     where not voided and method <> 'SALDO_A_FAVOR' and (p_branch_id is null or branch_id = p_branch_id)
    union all
    select currency, case when kind = 'DEVOLUCION' then -amount else amount end, movement_date
      from public.customer_credits
     where not voided and kind <> 'APLICACION' and (p_branch_id is null or branch_id = p_branch_id)
  ),
  months as (
    select date_trunc('month', current_date) - (n || ' month')::interval as m
      from generate_series(0, 5) n
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'active_orders',       (select count(*) from active_orders),
      'in_production',       (select count(*) from active_orders where status in ('DISENO', 'PRODUCCION', 'CONTROL_CALIDAD')),
      'ready_to_deliver',    (select count(*) from active_orders where status = 'LISTO_ENTREGA'),
      'pending_quotations',  (select count(*) from quotations_b where status in ('BORRADOR', 'ENVIADA')),
      'sales_month',         (select coalesce(sum(total), 0) from orders_b
                               where currency = 'PEN' and status <> 'CANCELADO' and created_at >= date_trunc('month', current_date)),
      'sales_month_usd',     (select coalesce(sum(total), 0) from orders_b
                               where currency = 'USD' and status <> 'CANCELADO' and created_at >= date_trunc('month', current_date)),
      'collected_month',     (select coalesce(sum(amount), 0) from payments_b
                               where currency = 'PEN' and payment_date >= date_trunc('month', current_date)),
      'collected_month_usd', (select coalesce(sum(amount), 0) from payments_b
                               where currency = 'USD' and payment_date >= date_trunc('month', current_date)),
      'receivable',          (select coalesce(sum(balance), 0) from orders_b
                               where currency = 'PEN' and status <> 'CANCELADO' and balance > 0),
      'receivable_usd',      (select coalesce(sum(balance), 0) from orders_b
                               where currency = 'USD' and status <> 'CANCELADO' and balance > 0),
      'overdue_orders',      (select count(*) from active_orders where due_date < current_date and status <> 'PAUSADO')
    ),
    'orders_by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]')
                           from (select status, count(*) c from orders_b group by status) s),
    'sales_by_month', (select jsonb_agg(jsonb_build_object(
                          'month', to_char(m.m, 'YYYY-MM'),
                          'sales', (select coalesce(sum(total), 0) from orders_b
                                     where currency = 'PEN' and status <> 'CANCELADO' and date_trunc('month', created_at) = m.m),
                          'collected', (select coalesce(sum(amount), 0) from payments_b
                                         where currency = 'PEN' and date_trunc('month', payment_date) = m.m)) order by m.m)
                         from months m),
    'orders_by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', st.name, 'count', c) order by c desc), '[]')
                            from (select service_type_id, count(*) c from orders_b
                                   where status <> 'CANCELADO' group by service_type_id) s
                            join public.service_types st on st.id = s.service_type_id),
    'production_by_stage', (select coalesce(jsonb_agg(jsonb_build_object('stage', name, 'position', position, 'count', c) order by position), '[]')
                              from (select ops.name, min(ops.position) position, count(*) c
                                      from public.order_production_stages ops
                                      join active_orders o on o.id = ops.order_id
                                     where ops.is_current
                                     group by ops.name) s),
    'upcoming_deliveries', (select coalesce(jsonb_agg(row_to_json(u) order by u.due_date), '[]')
                              from (select o.id, o.number, c.full_name as customer_name, o.title, o.due_date,
                                           o.status, o.balance, o.currency
                                      from active_orders o join public.customers c on c.id = o.customer_id
                                     where o.due_date is not null and o.status <> 'PAUSADO'
                                     order by o.due_date limit 10) u),
    'alerts', jsonb_build_object(
      'overdue', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.due_date
                      from active_orders o join public.customers c on c.id = o.customer_id
                     where o.due_date < current_date and o.status <> 'PAUSADO'
                     order by o.due_date limit 10) a),
      'pending_quotations', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select q.id, q.number, c.full_name as customer_name, q.expiry_date, q.total, q.currency
                      from quotations_b q join public.customers c on c.id = q.customer_id
                     where q.status in ('BORRADOR', 'ENVIADA')
                     order by q.expiry_date limit 10) a),
      'pending_payments', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.balance, o.currency
                      from orders_b o join public.customers c on c.id = o.customer_id
                     where o.status in ('LISTO_ENTREGA', 'ENTREGADO') and o.balance > 0
                     order by o.balance desc limit 10) a),
      'upcoming', (select coalesce(jsonb_agg(row_to_json(a)), '[]') from (
                    select o.id, o.number, c.full_name as customer_name, o.due_date
                      from active_orders o join public.customers c on c.id = o.customer_id
                     where o.due_date between current_date and current_date + 7
                     order by o.due_date limit 10) a)
    )
  );
$$;

-- ---------------------------------------------------------------------
-- Utilidad por caja: mismos ingresos que el dashboard
-- (última versión anterior: 0019_gastos_prestamos.sql)
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
     where p.org_id = v_org and not p.voided and p.method <> 'SALDO_A_FAVOR'
       and p.payment_date between v_from and v_to
       and (p_branch_id is null or o.branch_id = p_branch_id)
    union all
    select cc.method, cc.currency, x.amount, public.to_pen(x.amount, cc.currency, cc.movement_date)
      from public.customer_credits cc
      cross join lateral (select case when cc.kind = 'DEVOLUCION' then -cc.amount else cc.amount end as amount) x
     where cc.org_id = v_org and not cc.voided and cc.kind <> 'APLICACION'
       and cc.movement_date between v_from and v_to
       and (p_branch_id is null or cc.branch_id = p_branch_id)),
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
-- Cierre diario por correo: el resumen por método cuenta la caja real
-- (última versión anterior: 0017_estados_de_cuenta_brevo.sql)
-- ---------------------------------------------------------------------
create or replace function public.daily_statement_data(p_org uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with last_sent as (
    select customer_id, max(created_at) as sent_at
      from public.statement_sends
     where org_id = p_org and kind = 'CLIENTE' and status = 'ENVIADO' and customer_id is not null
     group by customer_id
  ),
  -- Movimientos de cada cliente desde su último estado de cuenta (o desde el inicio de p_date en Lima)
  moves as (
    select p.*, o.number as order_number, o.title as order_title, o.customer_id
      from public.payments p
      join public.orders o on o.id = p.order_id
      left join last_sent ls on ls.customer_id = o.customer_id
     where p.org_id = p_org
       and (p.created_at > coalesce(ls.sent_at, p_date::timestamp at time zone 'America/Lima')
            or (p.voided and p.voided_at > coalesce(ls.sent_at, p_date::timestamp at time zone 'America/Lima')))
  ),
  -- Cierre de caja: movimientos del día p_date
  pays as (
    select p.*, o.number as order_number, o.title as order_title, o.customer_id
      from public.payments p
      join public.orders o on o.id = p.order_id
     where p.org_id = p_org
       and (p.payment_date = p_date
            or (p.voided and (p.voided_at at time zone 'America/Lima')::date = p_date))
  ),
  -- Caja del día: pagos con dinero nuevo + depósitos/excedentes − devoluciones
  cash as (
    select method, currency, amount from public.payments
     where org_id = p_org and payment_date = p_date and not voided and method <> 'SALDO_A_FAVOR'
    union all
    select method, currency, case when kind = 'DEVOLUCION' then -amount else amount end
      from public.customer_credits
     where org_id = p_org and movement_date = p_date and not voided and kind <> 'APLICACION'
  ),
  cust as (
    select c.id, c.full_name, c.email
      from public.customers c
     where c.id in (select customer_id from moves)
       and c.statement_email
       and nullif(trim(c.email), '') is not null
  )
  select jsonb_build_object(
    'date', p_date,
    'company', (select jsonb_build_object('name', coalesce(st.company_name, o.name), 'tax_id', st.tax_id,
                                          'address', st.address, 'phone', st.phone, 'mobile', st.mobile,
                                          'email', st.email, 'logo', st.logo,
                                          'reply_to', coalesce(nullif(trim(st.email), ''),
                                            (select pr.email from public.profiles pr
                                              where pr.org_id = p_org and pr.role = 'ADMIN' and pr.active
                                              order by pr.created_at limit 1)))
                  from public.organizations o left join public.settings st on st.org_id = o.id
                 where o.id = p_org),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'customer_id', c.id, 'name', c.full_name, 'email', trim(c.email),
               'movements', (select jsonb_agg(jsonb_build_object(
                                      'receipt_number', m.receipt_number, 'order_number', m.order_number,
                                      'order_title', m.order_title, 'payment_date', m.payment_date,
                                      'method', m.method, 'amount', m.amount, 'currency', m.currency,
                                      'is_advance', m.is_advance, 'voided', m.voided, 'void_reason', m.void_reason)
                                    order by m.created_at)
                               from moves m where m.customer_id = c.id),
               'orders', (select jsonb_agg(jsonb_build_object(
                                   'number', o.number, 'title', o.title, 'status', o.status, 'currency', o.currency,
                                   'total', o.total, 'amount_paid', o.amount_paid, 'balance', o.balance)
                                 order by o.created_at)
                            from public.orders o
                           where o.customer_id = c.id and o.status <> 'CANCELADO'
                             and (o.balance > 0 or o.id in (select order_id from moves)))))
        from cust c), '[]'::jsonb),
    'closing', case
      when exists (select 1 from public.statement_sends
                    where org_id = p_org and kind = 'CIERRE' and statement_date = p_date and status = 'ENVIADO')
        then null
      else jsonb_build_object(
        'recipients', (select coalesce(jsonb_agg(distinct pr.email), '[]'::jsonb) from public.profiles pr
                        where pr.org_id = p_org and pr.active and pr.role in ('ADMIN', 'GERENTE')
                          and nullif(trim(pr.email), '') is not null),
        'by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'currency', currency,
                                                                   'count', n, 'amount', amt)
                                                order by currency, method), '[]'::jsonb)
                        from (select method, currency, count(*) n, sum(amount) amt from cash
                               group by method, currency) x),
        'advances', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'count', n, 'amount', amt)),
                                     '[]'::jsonb)
                       from (select currency, count(*) n, sum(amount) amt from public.payments
                              where org_id = p_org and payment_date = p_date and not voided and is_advance
                              group by currency) x),
        'payments', (select coalesce(jsonb_agg(jsonb_build_object(
                                       'receipt_number', p.receipt_number, 'order_number', p.order_number,
                                       'customer', c.full_name, 'method', p.method, 'amount', p.amount,
                                       'currency', p.currency, 'is_advance', p.is_advance)
                                     order by p.created_at), '[]'::jsonb)
                       from pays p join public.customers c on c.id = p.customer_id
                      where not p.voided and p.payment_date = p_date),
        'voided', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'receipt_number', p.receipt_number, 'order_number', p.order_number,
                                     'amount', p.amount, 'currency', p.currency, 'reason', p.void_reason)),
                                   '[]'::jsonb)
                     from pays p where p.voided),
        'jeweler_payments', (select coalesce(jsonb_agg(jsonb_build_object(
                                               'number', jp.number, 'jeweler', j.full_name, 'order_number', o.number,
                                               'amount', jp.amount, 'currency', jp.currency, 'method', jp.method)
                                             order by jp.created_at), '[]'::jsonb)
                               from public.jeweler_payments jp
                               join public.jewelers j on j.id = jp.jeweler_id
                               join public.orders o on o.id = jp.order_id
                              where jp.org_id = p_org and jp.payment_date = p_date and not jp.voided))
    end);
$$;

-- ---------------------------------------------------------------------
-- RLS (escritura solo vía funciones y el trigger de pagos)
-- ---------------------------------------------------------------------
alter table public.customer_credits enable row level security;

create policy customer_credits_select on public.customer_credits for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.customer_credit_balance(uuid, text) from public, anon, authenticated;
revoke execute on function public.lock_customer_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.customer_credit_balance(uuid, text) to service_role;
grant execute on function public.lock_customer_credit(uuid, text) to service_role;
revoke execute on function public.daily_statement_data(uuid, date) from public, anon, authenticated;
grant execute on function public.daily_statement_data(uuid, date) to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.customer_credit_balances(uuid)',
    'public.register_customer_deposit(uuid, jsonb)',
    'public.refund_customer_credit(uuid, jsonb)',
    'public.void_customer_credit(uuid, text)',
    'public.report_profit(integer, integer, uuid)',
    'public.get_dashboard(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
