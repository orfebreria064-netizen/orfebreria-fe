-- =====================================================================
-- 0027_bancos_cuentas.sql
-- Bancos y cuentas de la empresa (requiere 0026_saldo_a_favor.sql).
--   * banks: catálogo de bancos peruanos con su código CCE de 3 dígitos
--     (son los 3 primeros dígitos del CCI).
--   * bank_accounts: cuentas de la empresa. Tipos:
--       AHORROS / CORRIENTE: banco + n.° de cuenta + CCI (20 dígitos).
--       BILLETERA: Yape o Plin (celular 9xxxxxxxx, solo soles).
--       CAJA: efectivo (sin banco).
--     No se eliminan si tienen movimientos: se desactivan.
--   * payments.bank_account_id y expenses.bank_account_id: a qué cuenta
--     entró / de cuál salió el dinero. Si no se indica, se asigna sola
--     cuando hay una única cuenta compatible o una principal; si existen
--     varias compatibles y ninguna principal, se exige elegirla. Si aún
--     no hay ninguna cuenta compatible configurada, queda sin cuenta.
--     Compatibilidad método → tipo de cuenta:
--       EFECTIVO → CAJA · YAPE/PLIN → BILLETERA de ese tipo ·
--       TRANSFERENCIA/TARJETA/CHEQUE → AHORROS o CORRIENTE · OTRO → cualquiera.
--     La moneda de la cuenta debe ser la del movimiento.
--   * bank_accounts_summary: entradas (cobros) y salidas (gastos) por
--     cuenta en un periodo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo de bancos
-- ---------------------------------------------------------------------
create table public.banks (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^\d{3}$'),
  name        text not null check (length(trim(name)) > 0),
  short_name  text not null check (length(trim(short_name)) between 2 and 20),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.banks (code, name, short_name) values
  ('002', 'Banco de Crédito del Perú', 'BCP'),
  ('003', 'Interbank', 'Interbank'),
  ('007', 'Citibank del Perú', 'Citibank'),
  ('009', 'Scotiabank Perú', 'Scotiabank'),
  ('011', 'BBVA Perú', 'BBVA'),
  ('018', 'Banco de la Nación', 'B. Nación'),
  ('023', 'Banco de Comercio', 'B. Comercio'),
  ('035', 'Banco Pichincha', 'Pichincha'),
  ('038', 'BanBif', 'BanBif'),
  ('049', 'Mibanco', 'Mibanco'),
  ('053', 'Banco GNB Perú', 'GNB');

-- ---------------------------------------------------------------------
-- Cuentas de la empresa
-- ---------------------------------------------------------------------
create table public.bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  account_type     text not null check (account_type in ('AHORROS', 'CORRIENTE', 'BILLETERA', 'CAJA')),
  bank_id          uuid references public.banks (id),
  wallet           text check (wallet in ('YAPE', 'PLIN')),
  currency         text not null check (currency in ('PEN', 'USD')),
  alias            text not null check (length(trim(alias)) between 3 and 60),
  account_number   text check (account_number ~ '^\d{6,20}$'),
  cci              text check (cci ~ '^\d{20}$'),
  phone            text check (phone ~ '^9\d{8}$'),
  holder_name      text check (holder_name is null or length(trim(holder_name)) between 3 and 150),
  holder_doc_type  text check (holder_doc_type in ('RUC', 'DNI')),
  holder_doc       text,
  is_default       boolean not null default false,
  active           boolean not null default true,
  notes            text,
  created_by       uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint bank_accounts_type_fields check (
       (account_type in ('AHORROS', 'CORRIENTE') and bank_id is not null and account_number is not null
          and cci is not null and wallet is null and phone is null)
    or (account_type = 'BILLETERA' and wallet is not null and phone is not null and currency = 'PEN'
          and account_number is null and cci is null)
    or (account_type = 'CAJA' and bank_id is null and wallet is null and phone is null
          and account_number is null and cci is null)),
  constraint bank_accounts_holder_doc check (
       (holder_doc is null and holder_doc_type is null)
    or (holder_doc_type = 'RUC' and holder_doc ~ '^(10|15|17|20)\d{9}$')
    or (holder_doc_type = 'DNI' and holder_doc ~ '^\d{8}$')),
  constraint bank_accounts_default_active check (not is_default or active)
);
create unique index bank_accounts_cci_uidx on public.bank_accounts (org_id, cci) where cci is not null;
create unique index bank_accounts_number_uidx on public.bank_accounts (org_id, bank_id, account_number)
  where account_number is not null;
create unique index bank_accounts_wallet_uidx on public.bank_accounts (org_id, wallet, phone) where wallet is not null;
create unique index bank_accounts_alias_uidx on public.bank_accounts (org_id, lower(trim(alias)));
-- Una principal por moneda y tipo (las billeteras: una por Yape y otra por Plin)
create unique index bank_accounts_default_uidx on public.bank_accounts (org_id, currency, account_type, coalesce(wallet, ''))
  where is_default;
create trigger bank_accounts_updated_at before update on public.bank_accounts
  for each row execute function public.set_updated_at();

-- Cuenta en cobros y gastos (antes de las funciones que la consultan)
alter table public.payments add column bank_account_id uuid references public.bank_accounts (id);
alter table public.expenses add column bank_account_id uuid references public.bank_accounts (id);
create index payments_bank_account_idx on public.payments (bank_account_id, payment_date) where bank_account_id is not null;
create index expenses_bank_account_idx on public.expenses (bank_account_id, expense_date) where bank_account_id is not null;

-- Cajas de efectivo iniciales (principales) para la empresa
insert into public.bank_accounts (org_id, account_type, currency, alias, is_default, created_by)
select o.id, 'CAJA', c.currency, c.alias, true, null
  from public.organizations o
 cross join (values ('PEN', 'Caja soles'), ('USD', 'Caja dólares')) as c (currency, alias);

-- ---------------------------------------------------------------------
-- Validaciones auxiliares
-- ---------------------------------------------------------------------
-- RUC: dígito verificador (módulo 11, pesos 5 4 3 2 7 6 5 4 3 2)
create or replace function public.ruc_is_valid(p_ruc text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  w   int[] := array[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  s   int := 0;
  dv  int;
begin
  if p_ruc is null or p_ruc !~ '^(10|15|17|20)\d{9}$' then
    return false;
  end if;
  for i in 1..10 loop
    s := s + substr(p_ruc, i, 1)::int * w[i];
  end loop;
  dv := 11 - (s % 11);
  if dv = 10 then dv := 0; elsif dv = 11 then dv := 1; end if;
  return dv = substr(p_ruc, 11, 1)::int;
end;
$$;

-- ¿La cuenta (tipo/billetera) sirve para un método de pago?
create or replace function public.bank_account_accepts(p_type text, p_wallet text, p_method text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_method
           when 'EFECTIVO'      then p_type = 'CAJA'
           when 'YAPE'          then p_type = 'BILLETERA' and p_wallet = 'YAPE'
           when 'PLIN'          then p_type = 'BILLETERA' and p_wallet = 'PLIN'
           when 'TRANSFERENCIA' then p_type in ('AHORROS', 'CORRIENTE')
           when 'TARJETA'       then p_type in ('AHORROS', 'CORRIENTE')
           when 'CHEQUE'        then p_type in ('AHORROS', 'CORRIENTE')
           when 'OTRO'          then true
           else false
         end;
$$;

create or replace function public.bank_account_has_movements(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.payments where bank_account_id = p_id)
      or exists (select 1 from public.expenses where bank_account_id = p_id);
$$;

-- ---------------------------------------------------------------------
-- Registro y edición de cuentas (solo ADMIN)
-- p_data: {account_type, bank_id, wallet, currency, alias, account_number, cci, phone,
--          holder_name, holder_doc_type, holder_doc, is_default, active, notes}
-- ---------------------------------------------------------------------
create or replace function public.save_bank_account(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_id       uuid := coalesce(p_id, gen_random_uuid());
  v_type     text := nullif(p_data ->> 'account_type', '');
  v_bank     uuid := nullif(p_data ->> 'bank_id', '')::uuid;
  v_wallet   text := nullif(p_data ->> 'wallet', '');
  v_currency text := coalesce(nullif(p_data ->> 'currency', ''), 'PEN');
  v_alias    text := nullif(trim(p_data ->> 'alias'), '');
  v_number   text := nullif(regexp_replace(coalesce(p_data ->> 'account_number', ''), '\D', '', 'g'), '');
  v_cci      text := nullif(regexp_replace(coalesce(p_data ->> 'cci', ''), '\D', '', 'g'), '');
  v_phone    text := nullif(regexp_replace(regexp_replace(coalesce(p_data ->> 'phone', ''), '\D', '', 'g'), '^51(9\d{8})$', '\1'), '');
  v_holder   text := nullif(trim(p_data ->> 'holder_name'), '');
  v_doc_type text := nullif(p_data ->> 'holder_doc_type', '');
  v_doc      text := nullif(regexp_replace(coalesce(p_data ->> 'holder_doc', ''), '\D', '', 'g'), '');
  v_active   boolean := coalesce((p_data ->> 'active')::boolean, true);
  v_default  boolean := coalesce((p_data ->> 'is_default')::boolean, false) and coalesce((p_data ->> 'active')::boolean, true);
  v_bank_code text;
  a          public.bank_accounts%rowtype;
begin
  if v_org is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador puede registrar cuentas.';
  end if;
  if v_type is null or v_type not in ('AHORROS', 'CORRIENTE', 'BILLETERA', 'CAJA') then
    raise exception 'Seleccione el tipo de cuenta.';
  end if;
  if v_currency not in ('PEN', 'USD') then
    raise exception 'Moneda no válida.';
  end if;
  if v_alias is null or length(v_alias) not between 3 and 60 then
    raise exception 'El nombre de la cuenta debe tener entre 3 y 60 caracteres.';
  end if;

  -- Campos según el tipo
  if v_type in ('AHORROS', 'CORRIENTE') then
    v_wallet := null;
    v_phone := null;
    select code into v_bank_code from public.banks where id = v_bank;
    if v_bank_code is null then
      raise exception 'Seleccione el banco.';
    end if;
    if v_number is null or length(v_number) not between 6 and 20 then
      raise exception 'El número de cuenta debe tener entre 6 y 20 dígitos.';
    end if;
    if v_cci is null or length(v_cci) <> 20 then
      raise exception 'El CCI debe tener exactamente 20 dígitos.';
    end if;
    if left(v_cci, 3) <> v_bank_code then
      raise exception 'El CCI de una cuenta de este banco debe empezar con %.', v_bank_code;
    end if;
  elsif v_type = 'BILLETERA' then
    v_number := null;
    v_cci := null;
    if v_wallet is null or v_wallet not in ('YAPE', 'PLIN') then
      raise exception 'Indique si la billetera es Yape o Plin.';
    end if;
    if v_phone is null or v_phone !~ '^9\d{8}$' then
      raise exception 'El celular de la billetera debe tener 9 dígitos y empezar con 9.';
    end if;
    if v_currency <> 'PEN' then
      raise exception 'Yape y Plin solo operan en soles.';
    end if;
    if v_bank is not null and not exists (select 1 from public.banks where id = v_bank) then
      raise exception 'Banco no válido.';
    end if;
  else -- CAJA
    v_bank := null;
    v_wallet := null;
    v_phone := null;
    v_number := null;
    v_cci := null;
  end if;

  -- Titular
  if v_doc is null then
    v_doc_type := null;
  elsif v_doc_type = 'RUC' then
    if not public.ruc_is_valid(v_doc) then
      raise exception 'El RUC del titular no es válido (revise sus 11 dígitos).';
    end if;
  elsif v_doc_type = 'DNI' then
    if v_doc !~ '^\d{8}$' then
      raise exception 'El DNI del titular debe tener 8 dígitos.';
    end if;
  else
    raise exception 'Indique si el documento del titular es RUC o DNI.';
  end if;

  -- Duplicados (mensajes claros en lugar del error de índice)
  if v_cci is not null and exists (select 1 from public.bank_accounts
                                    where org_id = v_org and cci = v_cci and id <> v_id) then
    raise exception 'Ya existe una cuenta registrada con el CCI %.', v_cci;
  end if;
  if v_number is not null and exists (select 1 from public.bank_accounts
                                       where org_id = v_org and bank_id = v_bank and account_number = v_number
                                         and id <> v_id) then
    raise exception 'Ya existe una cuenta de este banco con el número %.', v_number;
  end if;
  if v_wallet is not null and exists (select 1 from public.bank_accounts
                                       where org_id = v_org and wallet = v_wallet and phone = v_phone and id <> v_id) then
    raise exception 'Ya existe una billetera % con el celular %.', initcap(lower(v_wallet)), v_phone;
  end if;
  if exists (select 1 from public.bank_accounts
              where org_id = v_org and lower(trim(alias)) = lower(v_alias) and id <> v_id) then
    raise exception 'Ya existe una cuenta con el nombre "%".', v_alias;
  end if;

  if p_id is not null then
    select * into a from public.bank_accounts where id = p_id and org_id = v_org for update;
    if not found then
      raise exception 'Cuenta no encontrada.';
    end if;
    if public.bank_account_has_movements(p_id)
       and (a.account_type, a.currency, coalesce(a.wallet, '')) is distinct from (v_type, v_currency, coalesce(v_wallet, '')) then
      raise exception 'La cuenta ya tiene movimientos: no se puede cambiar su tipo ni su moneda. Desactívela y registre una nueva.';
    end if;
  end if;

  -- Solo una principal por moneda y tipo
  if v_default then
    update public.bank_accounts
       set is_default = false
     where org_id = v_org and is_default and id <> v_id
       and currency = v_currency and account_type = v_type and coalesce(wallet, '') = coalesce(v_wallet, '');
  end if;

  if p_id is null then
    insert into public.bank_accounts (id, org_id, account_type, bank_id, wallet, currency, alias, account_number, cci, phone,
                                      holder_name, holder_doc_type, holder_doc, is_default, active, notes, created_by)
    values (v_id, v_org, v_type, v_bank, v_wallet, v_currency, v_alias, v_number, v_cci, v_phone,
            v_holder, v_doc_type, v_doc, v_default, v_active, nullif(trim(p_data ->> 'notes'), ''), auth.uid());
  else
    update public.bank_accounts
       set account_type = v_type, bank_id = v_bank, wallet = v_wallet, currency = v_currency, alias = v_alias,
           account_number = v_number, cci = v_cci, phone = v_phone, holder_name = v_holder,
           holder_doc_type = v_doc_type, holder_doc = v_doc, is_default = v_default, active = v_active,
           notes = nullif(trim(p_data ->> 'notes'), '')
     where id = p_id;
  end if;
  return v_id;
end;
$$;

-- Elimina una cuenta sin movimientos (con movimientos solo se desactiva)
create or replace function public.delete_bank_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador puede eliminar cuentas.';
  end if;
  if public.bank_account_has_movements(p_id) then
    raise exception 'La cuenta tiene movimientos registrados: desactívela en lugar de eliminarla.';
  end if;
  delete from public.bank_accounts where id = p_id and org_id = v_org;
  if not found then
    raise exception 'Cuenta no encontrada.';
  end if;
end;
$$;

-- Alta o edición de un banco del catálogo (solo ADMIN). p_data: {code, name, short_name, active}
create or replace function public.save_bank(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid := coalesce(p_id, gen_random_uuid());
  v_code  text := nullif(trim(p_data ->> 'code'), '');
  v_name  text := nullif(trim(p_data ->> 'name'), '');
  v_short text := nullif(trim(p_data ->> 'short_name'), '');
begin
  if public.current_org_id() is null or not public.has_role('ADMIN') then
    raise exception 'Solo un administrador puede registrar bancos.';
  end if;
  if v_code is null or v_code !~ '^\d{3}$' then
    raise exception 'El código del banco debe tener 3 dígitos (son los 3 primeros del CCI).';
  end if;
  if v_name is null then
    raise exception 'Indique el nombre del banco.';
  end if;
  if v_short is null or length(v_short) not between 2 and 20 then
    raise exception 'El nombre corto debe tener entre 2 y 20 caracteres.';
  end if;
  if exists (select 1 from public.banks where code = v_code and id <> v_id) then
    raise exception 'Ya existe un banco con el código %.', v_code;
  end if;
  if p_id is not null and exists (select 1 from public.banks where id = p_id and code <> v_code)
     and exists (select 1 from public.bank_accounts where bank_id = p_id and cci is not null) then
    raise exception 'El banco tiene cuentas con CCI registradas: su código no se puede cambiar.';
  end if;

  if p_id is null then
    insert into public.banks (id, code, name, short_name, active)
    values (v_id, v_code, v_name, v_short, coalesce((p_data ->> 'active')::boolean, true));
  else
    update public.banks
       set code = v_code, name = v_name, short_name = v_short, active = coalesce((p_data ->> 'active')::boolean, true)
     where id = p_id;
    if not found then
      raise exception 'Banco no encontrado.';
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Cuenta en cobros y gastos
-- ---------------------------------------------------------------------

-- Valida (o asigna) la cuenta de un cobro o un gasto. Corre después de los demás triggers
-- "before" (orden alfabético: ..._zz_...), cuando payments.currency ya tomó la moneda del pedido.
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
    if tg_table_name = 'payments' then
      if new.bank_account_id is distinct from old.bank_account_id then
        raise exception 'La cuenta de un pago registrado no se puede cambiar; anúlelo y regístrelo de nuevo.';
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
  if new.method = 'SALDO_A_FAVOR' then
    new.bank_account_id := null;
    return new;
  end if;

  v_label := case tg_table_name when 'payments' then 'el cobro' else 'el gasto' end;

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

create trigger payments_zz_bank_account before insert or update on public.payments
  for each row execute function public.movement_bank_account();
create trigger expenses_zz_bank_account before insert or update on public.expenses
  for each row execute function public.movement_bank_account();

-- Gastos: ahora con la cuenta de origen (última versión anterior: 0019_gastos_prestamos.sql)
-- p_data: {expense_date, category, description, supplier, document_ref, amount, currency, method,
--          bank_account_id, notes, branch_id}
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
  v_account uuid := nullif(p_data ->> 'bank_account_id', '')::uuid;
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
                                 document_ref, amount, currency, method, bank_account_id, notes, created_by)
    values (v_id, v_org, v_branch, v_number, v_date, p_data ->> 'category', trim(p_data ->> 'description'),
            nullif(trim(p_data ->> 'supplier'), ''), nullif(trim(p_data ->> 'document_ref'), ''),
            (p_data ->> 'amount')::numeric, coalesce(nullif(p_data ->> 'currency', ''), 'PEN'), p_data ->> 'method',
            v_account, nullif(trim(p_data ->> 'notes'), ''), auth.uid());
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
           bank_account_id = v_account, notes = nullif(trim(p_data ->> 'notes'), '')
     where id = p_id;
  end if;
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

-- ---------------------------------------------------------------------
-- Entradas y salidas por cuenta en un periodo
-- Entradas: cobros de pedidos vigentes (incluye el excedente que pasó al saldo a favor;
-- los pagos con saldo a favor no son dinero nuevo). Salidas: gastos vigentes.
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
    select p.bank_account_id, p.currency, sum(p.amount + p.credit_excess) amt, count(*) n
      from public.payments p
     where p.org_id = v_org and not p.voided and p.method <> 'SALDO_A_FAVOR'
       and p.payment_date between p_from and p_to
     group by 1, 2),
  outflow as (
    select e.bank_account_id, e.currency, sum(e.amount) amt, count(*) n
      from public.expenses e
     where e.org_id = v_org and not e.voided and e.expense_date between p_from and p_to
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

-- ---------------------------------------------------------------------
-- RLS (escritura solo vía funciones)
-- ---------------------------------------------------------------------
alter table public.banks         enable row level security;
alter table public.bank_accounts enable row level security;

create policy banks_select on public.banks for select to authenticated using (true);
create policy bank_accounts_select on public.bank_accounts for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('ADMIN', 'GERENTE', 'VENDEDOR'));

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.movement_bank_account() from public, anon, authenticated;
revoke execute on function public.bank_account_has_movements(uuid) from public, anon, authenticated;
grant execute on function public.bank_account_has_movements(uuid) to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ruc_is_valid(text)',
    'public.bank_account_accepts(text, text, text)',
    'public.save_bank_account(uuid, jsonb)',
    'public.delete_bank_account(uuid)',
    'public.save_bank(uuid, jsonb)',
    'public.save_expense(uuid, jsonb)',
    'public.bank_accounts_summary(date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
