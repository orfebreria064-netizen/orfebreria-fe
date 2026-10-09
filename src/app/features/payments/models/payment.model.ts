import { PaymentMethod } from '../../../core/models/domain';

export interface Payment {
  id: string;
  order_id: string;
  payment_date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  is_advance: boolean;
  voided: boolean;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  order?: { id: string; number: string; customer: { id: string; full_name: string } | null } | null;
}

export interface PaymentInput {
  order_id: string;
  payment_date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  is_advance: boolean;
  /** Confirmación explícita cuando el monto supera el saldo (lo valida la base de datos). */
  overpayment_confirmed: boolean;
}
