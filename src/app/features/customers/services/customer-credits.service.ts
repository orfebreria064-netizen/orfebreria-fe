import { Injectable, inject } from '@angular/core';
import { CreditKind, Currency, PaymentMethod } from '../../../core/models/domain';
import { SupabaseService } from '../../../core/services/supabase.service';
import { unwrap } from '../../../shared/utils/db';

/** Movimiento del saldo a favor del cliente (0026_saldo_a_favor.sql). */
export interface CustomerCredit {
  id: string;
  customer_id: string;
  branch_id: string;
  kind: CreditKind;
  movement_date: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
  received_from: string | null;
  receipt_number: string | null;
  payment_id: string | null;
  bank_account_id?: string | null;
  bank_account?: { id: string; alias: string } | null;
  voided: boolean;
  void_reason: string | null;
  created_at: string;
  creator?: { full_name: string } | null;
  payment?: { order: { id: string; number: string; title?: string | null } | null } | null;
}

export interface CreditMovementInput {
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  movement_date: string;
  reference: string | null;
  notes: string | null;
  received_from?: string | null;
  bank_account_id?: string | null;
}

export type CreditBalances = Record<Currency, number>;

/**
 * Saldo a favor: depósitos, devoluciones y anulaciones van por funciones de la base. El excedente de un pago
 * y la aplicación a un pedido los crea el trigger de pagos (se anulan anulando el pago).
 */
@Injectable({ providedIn: 'root' })
export class CustomerCreditsService {
  private readonly db = inject(SupabaseService).client;

  async balances(customerId: string): Promise<CreditBalances> {
    const r = unwrap(await this.db.rpc('customer_credit_balances', { p_customer_id: customerId })) as CreditBalances;
    return { PEN: Number(r?.PEN ?? 0), USD: Number(r?.USD ?? 0) };
  }

  async list(customerId: string): Promise<CustomerCredit[]> {
    return unwrap(
      await this.db
        .from('customer_credits')
        .select('*, creator:profiles!customer_credits_created_by_fkey(full_name), payment:payments(order:orders(id, number, title)), bank_account:bank_accounts(id, alias)')
        .eq('customer_id', customerId)
        .order('movement_date', { ascending: false })
        .order('created_at', { ascending: false }),
    ) as CustomerCredit[];
  }

  async deposit(customerId: string, input: CreditMovementInput): Promise<{ id: string; receipt_number: string }> {
    return unwrap(await this.db.rpc('register_customer_deposit', { p_customer_id: customerId, p_data: input })) as {
      id: string;
      receipt_number: string;
    };
  }

  async refund(customerId: string, input: CreditMovementInput): Promise<{ id: string; receipt_number: string }> {
    return unwrap(await this.db.rpc('refund_customer_credit', { p_customer_id: customerId, p_data: input })) as {
      id: string;
      receipt_number: string;
    };
  }

  async void(id: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('void_customer_credit', { p_id: id, p_reason: reason.trim() }));
  }
}
