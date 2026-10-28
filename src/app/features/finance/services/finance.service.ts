import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Currency, Option, PaymentMethod } from '../../../core/models/domain';
import { unwrap } from '../../../shared/utils/db';

// ---------------------------------------------------------------- Gastos
export type ExpenseCategory =
  | 'PLANILLA'
  | 'SERVICIOS'
  | 'ALQUILER'
  | 'IMPUESTOS'
  | 'COMPRA_MATERIAL'
  | 'HONORARIOS'
  | 'MARKETING'
  | 'MANTENIMIENTO'
  | 'TRANSPORTE'
  | 'BANCARIOS'
  | 'OTROS';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  PLANILLA: 'Planilla / sueldos',
  SERVICIOS: 'Servicios (luz, agua, internet, teléfono)',
  ALQUILER: 'Alquiler',
  IMPUESTOS: 'Impuestos y tributos',
  COMPRA_MATERIAL: 'Compra de material',
  HONORARIOS: 'Honorarios (contador, asesores)',
  MARKETING: 'Publicidad y marketing',
  MANTENIMIENTO: 'Mantenimiento y equipos',
  TRANSPORTE: 'Transporte y movilidad',
  BANCARIOS: 'Gastos bancarios y comisiones',
  OTROS: 'Otros',
};
export const EXPENSE_CATEGORY_OPTIONS: Option<ExpenseCategory>[] = (Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((value) => ({
  value,
  label: EXPENSE_CATEGORY_LABELS[value],
}));

export interface Expense {
  id: string;
  number: string;
  branch_id: string;
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  supplier: string | null;
  document_ref: string | null;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  notes: string | null;
  voided: boolean;
  void_reason: string | null;
  creator?: { full_name: string } | null;
}

export type ExpenseInput = Pick<Expense, 'expense_date' | 'category' | 'description' | 'supplier' | 'document_ref' | 'amount' | 'currency' | 'method' | 'notes'>;

// ---------------------------------------------------------------- Préstamos
export type LoanMethod = PaymentMethod | 'DESCUENTO_PLANILLA' | 'DESCUENTO_PAGO_JOYERO';
export const LOAN_PAYMENT_METHOD_LABELS: Record<LoanMethod, string> = {
  EFECTIVO: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  CHEQUE: 'Cheque',
  DESCUENTO_PLANILLA: 'Descuento de planilla',
  DESCUENTO_PAGO_JOYERO: 'Descuento del pago al joyero',
  OTRO: 'Otro',
};

export interface Loan {
  id: string;
  number: string;
  beneficiary_type: 'EMPLEADO' | 'JOYERO';
  jeweler_id: string | null;
  profile_id: string | null;
  beneficiary_name: string;
  document_number: string | null;
  loan_date: string;
  amount: number;
  currency: Currency;
  installments: number;
  method: PaymentMethod;
  reason: string;
  amount_paid: number;
  balance: number;
  voided: boolean;
  void_reason: string | null;
  payments?: LoanPayment[];
}

export interface LoanPayment {
  id: string;
  number: string;
  payment_date: string;
  amount: number;
  method: LoanMethod;
  reference: string | null;
  voided: boolean;
  void_reason: string | null;
}

export interface LoanInput {
  beneficiary_type: 'EMPLEADO' | 'JOYERO';
  jeweler_id: string | null;
  profile_id: string | null;
  beneficiary_name: string | null;
  document_number: string | null;
  loan_date: string;
  amount: number;
  currency: Currency;
  installments: number;
  method: PaymentMethod;
  reason: string;
}

// ---------------------------------------------------------------- Utilidad
export interface ProfitReport {
  from: string;
  to: string;
  income: number;
  income_usd: number;
  income_by_method: { method: PaymentMethod; amount: number }[];
  labor: number;
  gross_profit: number;
  expenses: number;
  expenses_by_category: { category: ExpenseCategory; amount: number; count: number }[];
  net_profit: number;
  margin: number | null;
  loans_given: number;
  loans_repaid: number;
  exchange_rate: number | null;
}

/** Gastos, préstamos y estado de resultados (0019_gastos_prestamos.sql). Solo ADMIN y GERENTE. */
@Injectable({ providedIn: 'root' })
export class FinanceService {
  private readonly db = inject(SupabaseService).client;

  async expenses(from: string, to: string, includeVoided = false): Promise<Expense[]> {
    let query = this.db
      .from('expenses')
      .select('*, creator:profiles!expenses_created_by_fkey(full_name)')
      .gte('expense_date', from)
      .lte('expense_date', to)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (!includeVoided) query = query.eq('voided', false);
    return unwrap(await query) as Expense[];
  }

  async saveExpense(id: string | null, input: ExpenseInput): Promise<{ id: string; number: string }> {
    return unwrap(await this.db.rpc('save_expense', { p_id: id, p_data: input })) as { id: string; number: string };
  }

  async voidExpense(id: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('void_expense', { p_id: id, p_reason: reason }));
  }

  async loans(includeVoided = false): Promise<Loan[]> {
    let query = this.db
      .from('loans')
      .select('*, payments:loan_payments(*)')
      .order('loan_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (!includeVoided) query = query.eq('voided', false);
    return unwrap(await query) as Loan[];
  }

  async registerLoan(input: LoanInput): Promise<{ id: string; number: string }> {
    return unwrap(await this.db.rpc('register_loan', { p_data: input })) as { id: string; number: string };
  }

  async voidLoan(id: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('void_loan', { p_id: id, p_reason: reason }));
  }

  async registerLoanPayment(loanId: string, amount: number, method: LoanMethod, date: string, reference: string | null): Promise<{ number: string }> {
    return unwrap(
      await this.db.rpc('register_loan_payment', {
        p_loan_id: loanId,
        p_amount: amount,
        p_method: method,
        p_payment_date: date,
        p_reference: reference,
      }),
    ) as { number: string };
  }

  async voidLoanPayment(id: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('void_loan_payment', { p_id: id, p_reason: reason }));
  }

  async profit(year: number, month: number): Promise<ProfitReport> {
    return unwrap(await this.db.rpc('report_profit', { p_year: year, p_month: month, p_branch_id: null })) as ProfitReport;
  }
}
