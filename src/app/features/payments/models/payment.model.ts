import { Currency, PaymentMethod } from '../../../core/models/domain';

export interface Payment {
  id: string;
  order_id: string;
  payment_date: string;
  amount: number;
  /** Moneda del pedido. */
  currency: Currency;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  is_advance: boolean;
  /** Recibo de ingreso (RI-...). Los pagos anteriores lo reciben al imprimirse. */
  receipt_number: string | null;
  /** Quién entregó el dinero, si no fue el cliente. */
  received_from: string | null;
  /** Saldo del pedido después de este pago (0 o menos = este pago lo canceló). */
  balance_after?: number | null;
  voided: boolean;
  voided_at: string | null;
  void_reason: string | null;
  created_by_name?: string | null;
  created_at: string;
  order?: {
    id: string;
    number: string;
    title?: string;
    customer: { id: string; full_name: string; document_type?: string | null; document_number?: string | null } | null;
  } | null;
}

export interface PaymentInput {
  order_id: string;
  payment_date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  is_advance: boolean;
  received_from: string | null;
  /** Confirmación explícita cuando el monto supera el saldo (lo valida la base de datos). */
  overpayment_confirmed: boolean;
}
