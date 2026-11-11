import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { Currency, Option, PaymentMethod } from './domain';

/** Bancos y cuentas de la empresa (0027_bancos_cuentas.sql). */
export interface Bank {
  id: string;
  /** Código CCE de 3 dígitos: los 3 primeros del CCI. */
  code: string;
  name: string;
  short_name: string;
  active: boolean;
}

export type BankAccountType = 'AHORROS' | 'CORRIENTE' | 'BILLETERA' | 'CAJA';
export type Wallet = 'YAPE' | 'PLIN';
export type HolderDocType = 'RUC' | 'DNI';

export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  AHORROS: 'Cuenta de ahorros',
  CORRIENTE: 'Cuenta corriente',
  BILLETERA: 'Billetera (Yape / Plin)',
  CAJA: 'Caja (efectivo)',
};
export const BANK_ACCOUNT_TYPE_OPTIONS: Option<BankAccountType>[] = (Object.keys(BANK_ACCOUNT_TYPE_LABELS) as BankAccountType[]).map(
  (value) => ({ value, label: BANK_ACCOUNT_TYPE_LABELS[value] }),
);
export const WALLET_OPTIONS: Option<Wallet>[] = [
  { value: 'YAPE', label: 'Yape' },
  { value: 'PLIN', label: 'Plin' },
];
export const HOLDER_DOC_OPTIONS: Option<HolderDocType>[] = [
  { value: 'RUC', label: 'RUC' },
  { value: 'DNI', label: 'DNI' },
];

export interface BankAccount {
  id: string;
  account_type: BankAccountType;
  bank_id: string | null;
  wallet: Wallet | null;
  currency: Currency;
  alias: string;
  account_number: string | null;
  cci: string | null;
  phone: string | null;
  holder_name: string | null;
  holder_doc_type: HolderDocType | null;
  holder_doc: string | null;
  is_default: boolean;
  active: boolean;
  notes: string | null;
  bank?: Pick<Bank, 'id' | 'code' | 'short_name' | 'name'> | null;
}

export type BankAccountInput = Omit<BankAccount, 'id' | 'bank'>;

export interface AccountMovements {
  income: number;
  income_count: number;
  outflow: number;
  outflow_count: number;
}

export interface BankAccountsSummary {
  from: string;
  to: string;
  accounts: (AccountMovements & { id: string })[];
  /** Movimientos sin cuenta (anteriores a las cuentas o sin cuenta compatible configurada). */
  unassigned: (AccountMovements & { currency: Currency })[];
}

/** Misma regla que public.bank_account_accepts: qué cuentas sirven para un método de pago. */
export function accountAcceptsMethod(a: Pick<BankAccount, 'account_type' | 'wallet'>, method: PaymentMethod | null | undefined): boolean {
  switch (method) {
    case 'EFECTIVO':
      return a.account_type === 'CAJA';
    case 'YAPE':
      return a.account_type === 'BILLETERA' && a.wallet === 'YAPE';
    case 'PLIN':
      return a.account_type === 'BILLETERA' && a.wallet === 'PLIN';
    case 'TRANSFERENCIA':
    case 'TARJETA':
    case 'CHEQUE':
      return a.account_type === 'AHORROS' || a.account_type === 'CORRIENTE';
    case 'OTRO':
      return true;
    default:
      return false;
  }
}

/** Cuentas activas que sirven para el método y la moneda; la principal primero. */
export function compatibleAccounts(accounts: BankAccount[], method: PaymentMethod | null | undefined, currency: Currency | string): BankAccount[] {
  return accounts
    .filter((a) => a.active && a.currency === currency && accountAcceptsMethod(a, method))
    .sort((x, y) => Number(y.is_default) - Number(x.is_default) || x.alias.localeCompare(y.alias));
}

/** Cuenta que se propone: la única compatible o la principal. */
export function suggestedAccount(options: BankAccount[]): string | null {
  if (options.length === 1) return options[0].id;
  return options.find((a) => a.is_default)?.id ?? null;
}

/** Texto para selectores: "BCP · Cuenta empresa ••••1234 · S/" (el banco no se repite si ya está en el nombre). */
export function accountLabel(a: BankAccount): string {
  const tail = a.account_number ?? a.phone;
  const bank = a.bank?.short_name;
  const withBank = bank && !a.alias.toLowerCase().includes(bank.toLowerCase()) ? `${bank} · ${a.alias}` : a.alias;
  return [withBank + (tail ? ` ••••${tail.slice(-4)}` : ''), a.currency === 'USD' ? 'US$' : 'S/'].join(' · ');
}

/** ¿El método mueve dinero por una cuenta? (el saldo a favor no). */
export function methodUsesAccount(method: PaymentMethod | null | undefined): boolean {
  return !!method && method !== 'SALDO_A_FAVOR';
}

/** Qué tipo de cuenta falta registrar para un método (para el aviso cuando no hay opciones). */
export function missingAccountHint(method: PaymentMethod | null | undefined, currency: Currency | string): string {
  const cur = currency === 'USD' ? 'dólares' : 'soles';
  switch (method) {
    case 'EFECTIVO':
      return `No hay una caja en ${cur} activa.`;
    case 'YAPE':
    case 'PLIN':
      return `No hay una billetera ${method === 'YAPE' ? 'Yape' : 'Plin'} activa${currency === 'USD' ? ' (solo operan en soles)' : ''}.`;
    default:
      return `No hay cuentas bancarias en ${cur} activas.`;
  }
}

export const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

// ---------------------------------------------------------------- Dígitos de control

/** Dígito de control del CCI (CCE): pesos 1-2 alternados, se suman las cifras de cada producto. */
function cciCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const p = Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
    sum += p > 9 ? p - 9 : p;
  }
  return (10 - (sum % 10)) % 10;
}

/** ¿Los 2 últimos dígitos del CCI cuadran con la entidad+oficina y con la cuenta? */
export function cciCheckDigitsOk(cci: string): boolean {
  if (!/^\d{20}$/.test(cci)) return false;
  return cciCheckDigit(cci.slice(0, 6)) === Number(cci[18]) && cciCheckDigit(cci.slice(6, 18)) === Number(cci[19]);
}

/** RUC: módulo 11 con pesos 5 4 3 2 7 6 5 4 3 2 (igual que public.ruc_is_valid). */
export function rucIsValid(ruc: string): boolean {
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = w.reduce((acc, wi, i) => acc + wi * Number(ruc[i]), 0);
  let dv = 11 - (s % 11);
  if (dv === 10) dv = 0;
  else if (dv === 11) dv = 1;
  return dv === Number(ruc[10]);
}

// ---------------------------------------------------------------- Validadores de formulario

/** CCI: 20 dígitos y, si se conoce el banco, que empiece con su código. */
export function cciValidator(bankCode: () => string | null): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = onlyDigits(control.value);
    if (!v) return null;
    if (v.length !== 20) return { cci: `El CCI debe tener 20 dígitos (tiene ${v.length}).` };
    const code = bankCode();
    if (code && !v.startsWith(code)) return { cci: `El CCI de este banco debe empezar con ${code}.` };
    return null;
  };
}

export const accountNumberValidator: ValidatorFn = (control) => {
  const raw = String(control.value ?? '').trim();
  if (!raw) return null;
  if (!/^[\d\s-]+$/.test(raw)) return { accountNumber: 'Use solo números (puede separarlos con guiones).' };
  const len = onlyDigits(raw).length;
  return len >= 6 && len <= 20 ? null : { accountNumber: 'El número de cuenta debe tener entre 6 y 20 dígitos.' };
};

export const walletPhoneValidator: ValidatorFn = (control) => {
  const raw = String(control.value ?? '').trim();
  if (!raw) return null;
  const d = onlyDigits(raw).replace(/^51(?=9\d{8}$)/, '');
  return /^9\d{8}$/.test(d) ? null : { phone: 'Celular de 9 dígitos que empiece con 9.' };
};

/** Documento del titular según el tipo elegido en el mismo grupo. */
export function holderDocValidator(typeControlName: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = onlyDigits(control.value);
    if (!String(control.value ?? '').trim()) return null;
    const type = control.parent?.get(typeControlName)?.value as HolderDocType | null;
    if (type === 'DNI') return /^\d{8}$/.test(v) ? null : { doc: 'El DNI debe tener 8 dígitos.' };
    if (type === 'RUC') {
      if (!/^(10|15|17|20)\d{9}$/.test(v)) return { doc: 'El RUC debe tener 11 dígitos y empezar con 10, 15, 17 o 20.' };
      return rucIsValid(v) ? null : { doc: 'El RUC no es válido (dígito verificador incorrecto).' };
    }
    return { doc: 'Seleccione si es RUC o DNI.' };
  };
}
