-- =====================================================================
-- 0028_saldo_a_favor_cuentas.sql
-- El saldo a favor (0026) también indica la cuenta (0027) donde entra o
-- de donde sale el dinero:
--   * DEPOSITO y DEVOLUCION: cuenta elegida (o la única/principal del método).
--   * EXCEDENTE: la misma cuenta del pago que lo generó.
--   * APLICACION: sin cuenta (no es dinero nuevo).
-- Resumen por cuenta: los depósitos suman como entradas y las devoluciones
-- como salidas (el excedente ya está dentro del pago).
-- =====================================================================

alter table public.customer_credits add column bank_account_id uuid references public.bank_accounts (id);
create index customer_credits_bank_account_idx on public.customer_credits (bank_account_id, movement_date)
  where bank_account_id is not null;

-- ---------------------------------------------------------------------
-- Validación/asignación de la cuenta (última versión anterior: 0027)
-- ---------------------------------------------------------------------
create or replace function public.movement_bank_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.bank_accounts%rowtype;
  v_count  int;
  v_label  text;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name in ('payments', 'customer_credits') then
      if new.bank_account_id is distinct from old.bank_account_id then
        raise exception 'La cuenta de un movimiento registrado no se puede cambiar; anúlelo y regístrelo de nuevo.';
      end if;
      return new;
    end if;
    -- Gasto editado: solo se revalida si cambió algo que afecte la cuenta
    if (new.bank_account_id, new.method, new.currency) is not distinct from
       (old.bank_account_id, old.method, old.currency) then
      return new;
    end if;
  end if;

  -- El saldo a favor no es dinero nuevo: no entra a ninguna cuenta
  if new.method is null or new.method = 'SALDO_A_FAVOR' then
    new.bank_account_id := null;
    return new;
  end if;

  v_label := case tg_table_name when 'payments' then 'el cobro' when 'customer_credits' then 'el movimiento'
                                else 'el gasto' end;

  if new.bank_account_id is null then
    select count(*) into v_count
      from public.bank_accounts b
     where b.org_id = new.org_id and b.active and b.currency = new.currency
       and public.bank_account_accepts(b.account_type, b.wallet, new.method);
    if v_count = 0 then
      return new;  -- aún no hay cuentas compatibles configuradas
    end if;
    select b.id into new.bank_account_id
      from public.bank_accounts b
     where b.org_id = new.org_id and b.active and b.currency = new.currency
       and public.bank_account_accepts(b.account_type, b.wallet, new.method)
       and (b.is_default or v_count = 1)
     order by b.is_default desc
     limit 1;
    if new.bank_account_id is null then
      raise exception 'Seleccione la cuenta de %: hay varias cuentas en % para %.',
        v_label, new.currency, initcap(lower(new.method));
    end if;
    return new;
  end if;

  select * into a from public.bank_accounts where id = new.bank_account_id and org_id = new.org_id;
  if not found then
    raise exception 'Cuenta no válida.';
  end if;
  if not a.active and (tg_op = 'INSERT' or new.bank_account_id is distinct from old.bank_account_id) then
    raise exception 'La cuenta "%" está desactivada.', a.alias;
  end if;
  if a.currency <> new.currency then
    raise exception 'La cuenta "%" es en % y % es en %.', a.alias, a.currency, v_label, new.currency;
  end if;
  if not public.bank_account_accepts(a.account_type, a.wallet, new.method) then
    raise exception 'La cuenta "%" no corresponde al método %.', a.alias, initcap(lower(new.method));
  end if;
  return new;
end;
$$;

create trigger customer_credits_zz_bank_account before insert or update on public.customer_credits
  for each row execute function public.movement_bank_account();

create or replace function public.bank_account_has_movements(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.payments where bank_account_id = p_id)
      or exists (select 1 from public.expenses where bank_account_id = p_id)
      or exists (select 1 from public.customer_credits where bank_account_id = p_id);
$$;

-- ---------------------------------------------------------------------
-- Depósito y devolución con cuenta (última versión anterior: 0026)
-- p_data: {..., bank_account_id}
-- ---------------------------------------------------------------------
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
                                       reference, notes, received_from, receipt_number, bank_account_id, created_by)
  values (v_id, v_org, v_branch, p_customer_id, 'DEPOSITO', v_date, round(v_amount, 2), v_currency, p_data ->> 'method',
          nullif(trim(p_data ->> 'reference'), ''), nullif(trim(p_data ->> 'notes'), ''),
          nullif(trim(p_data ->> 'received_from'), ''), v_receipt, nullif(p_data ->> 'bank_account_id', '')::uuid,
          auth.uid());
  return jsonb_build_object('id', v_id, 'receipt_number', v_receipt);
end;
$$;

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
                                       reference, notes, receipt_number, bank_account_id, created_by)
  values (v_id, v_org, v_branch, p_customer_id, 'DEVOLUCION', v_date, v_amount, v_currency, p_data ->> 'method',
          nullif(trim(p_data ->> 'reference'), ''), nullif(trim(p_data ->> 'notes'), ''), v_receipt,
          nullif(p_data ->> 'bank_account_id', '')::uuid, auth.uid());
  return jsonb_build_object('id', v_id, 'receipt_number', v_receipt);
end;
$$;

-- ---------------------------------------------------------------------
-- Pagos: el excedente toma la cuenta del pago (última versión anterior: 0026)
-- ---------------------------------------------------------------------
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
                                           reference, notes, received_from, receipt_number, payment_id,
                                           bank_account_id, created_by)
      values (new.org_id, new.branch_id, v_customer, 'EXCEDENTE', new.payment_date, new.credit_excess, new.currency,
              new.method, new.reference, 'Excedente del pago del pedido ' || v_number, new.received_from,
              new.receipt_number, new.id, new.bank_account_id, new.created_by);
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
-- Entradas y salidas por cuenta (última versión anterior: 0027)
-- Entradas: cobros vigentes (con su excedente) + depósitos del saldo a favor.
-- Salidas: gastos vigentes + devoluciones del saldo a favor.
-- ---------------------------------------------------------------------
create or replace function public.bank_accounts_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_result jsonb;
begin
  if v_org is null or not public.has_role('ADMIN', 'GERENTE') then
    raise exception 'Solo un administrador o gerente puede ver los movimientos por cuenta.';
  end if;

  with
  income as (
    select bank_account_id, currency, sum(amt) amt, count(*) n from (
      select p.bank_account_id, p.currency, p.amount + p.credit_excess amt
        from public.payments p
       where p.org_id = v_org and not p.voided and p.method <> 'SALDO_A_FAVOR'
         and p.payment_date between p_from and p_to
      union all
      select cc.bank_account_id, cc.currency, cc.amount
        from public.customer_credits cc
       where cc.org_id = v_org and not cc.voided and cc.kind = 'DEPOSITO'
         and cc.movement_date between p_from and p_to) x
     group by 1, 2),
  outflow as (
    select bank_account_id, currency, sum(amt) amt, count(*) n from (
      select e.bank_account_id, e.currency, e.amount amt
        from public.expenses e
       where e.org_id = v_org and not e.voided and e.expense_date between p_from and p_to
      union all
      select cc.bank_account_id, cc.currency, cc.amount
        from public.customer_credits cc
       where cc.org_id = v_org and not cc.voided and cc.kind = 'DEVOLUCION'
         and cc.movement_date between p_from and p_to) x
     group by 1, 2)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', b.id,
                    'income', coalesce(i.amt, 0), 'income_count', coalesce(i.n, 0),
                    'outflow', coalesce(o.amt, 0), 'outflow_count', coalesce(o.n, 0))), '[]'::jsonb)
                   from public.bank_accounts b
                   left join income i on i.bank_account_id = b.id
                   left join outflow o on o.bank_account_id = b.id
                  where b.org_id = v_org),
    'unassigned', (select coalesce(jsonb_agg(jsonb_build_object(
                      'currency', c.currency,
                      'income', coalesce(i.amt, 0), 'income_count', coalesce(i.n, 0),
                      'outflow', coalesce(o.amt, 0), 'outflow_count', coalesce(o.n, 0))), '[]'::jsonb)
                     from (values ('PEN'), ('USD')) c (currency)
                     left join income i on i.bank_account_id is null and i.currency = c.currency
                     left join outflow o on o.bank_account_id is null and o.currency = c.currency
                    where i.n is not null or o.n is not null))
    into v_result;
  return v_result;
end;
$$;

revoke execute on function public.movement_bank_account() from public, anon, authenticated;
revoke execute on function public.bank_account_has_movements(uuid) from public, anon, authenticated;
grant execute on function public.bank_account_has_movements(uuid) to service_role;
