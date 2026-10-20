import { Currency, PaymentMethod } from '../../../core/models/domain';

/** Joyero externo (no usa el sistema). Se le paga por pedido. */
export interface Jeweler {
  id: string;
  full_name: string;
  document_number: string | null;
  phone: string | null;
  specialty: string | null;
  notes: string | null;
  active: boolean;
  /** Pedidos en curso asignados al joyero. */
  active_orders: number;
  /** Total pagado (solo ADMIN y GERENTE; null para el resto). */
  paid_pen: number | null;
  paid_usd: number | null;
  created_at: string;
}

export interface JewelerInput {
  id: string | null;
  full_name: string;
  document_number: string | null;
  phone: string | null;
  specialty: string | null;
  notes: string | null;
  active: boolean;
}

/** Recibo de egreso: pago a un joyero por un pedido (en la moneda del pedido). */
export interface JewelerPayment {
  id: string;
  number: string;
  jeweler_id: string;
  jeweler_name: string;
  jeweler_document: string | null;
  order_id: string;
  order_number?: string;
  order_title?: string;
  customer_name?: string;
  payment_date: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  reference: string | null;
  concept: string;
  voided: boolean;
  voided_at: string | null;
  void_reason: string | null;
  voided_by_name?: string | null;
  branch_name?: string;
  /** Autorizado por. */
  created_by_name: string | null;
  created_at: string;
}

export interface JewelerPaymentInput {
  order_id: string;
  jeweler_id: string;
  amount: number;
  method: PaymentMethod;
  concept: string;
  payment_date: string;
  reference: string | null;
}

export interface JewelerPaymentFilters {
  jewelerId?: string | null;
  orderId?: string | null;
  from?: string | null;
  to?: string | null;
  includeVoided?: boolean;
}
