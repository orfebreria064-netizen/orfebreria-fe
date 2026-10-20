import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PaymentMethod } from '../../../core/models/domain';
import { emptyToNull, unwrap } from '../../../shared/utils/db';
import { OrderRow } from '../../orders/models/order.model';
import { ORDER_ROW_SELECT } from '../../orders/services/orders.service';
import { Payment, PaymentInput } from '../models/payment.model';

/** balance_after y created_by_name son columnas calculadas para el recibo (0012_taller_joyeros_precios.sql). */
const PAYMENT_SELECT =
  '*, balance_after, created_by_name, order:orders(id, number, title, customer:customers(id, full_name, document_type, document_number))';

export interface PaymentFilters {
  from?: string | null;
  to?: string | null;
  method?: PaymentMethod | null;
  includeVoided?: boolean;
}

/**
 * Pagos de pedidos. El total pagado y el saldo del pedido los recalcula PostgreSQL; un pago mayor
 * al saldo requiere `overpayment_confirmed = true` (confirmación explícita del usuario).
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly db = inject(SupabaseService).client;

  async list(filters: PaymentFilters = {}): Promise<Payment[]> {
    let query = this.db
      .from('payments')
      .select(PAYMENT_SELECT)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (filters.from) query = query.gte('payment_date', filters.from);
    if (filters.to) query = query.lte('payment_date', filters.to);
    if (filters.method) query = query.eq('method', filters.method);
    if (!filters.includeVoided) query = query.eq('voided', false);
    return unwrap(await query) as Payment[];
  }

  async byOrder(orderId: string): Promise<Payment[]> {
    return unwrap(
      await this.db.from('payments').select(PAYMENT_SELECT).eq('order_id', orderId).order('payment_date').order('created_at'),
    ) as Payment[];
  }

  /** Registra el pago (la base emite su recibo de ingreso). Devuelve el id del pago. */
  async create(input: PaymentInput): Promise<string> {
    return (unwrap(await this.db.from('payments').insert(emptyToNull(input)).select('id').single()) as { id: string }).id;
  }

  /** Número del recibo de ingreso (los pagos anteriores a los recibos lo reciben aquí). */
  async issueReceipt(id: string): Promise<string> {
    return unwrap(await this.db.rpc('issue_payment_receipt', { p_payment_id: id })) as string;
  }

  /** Los pagos no se eliminan: se anulan con motivo (queda en auditoría). */
  async void(id: string, reason: string): Promise<void> {
    unwrap(await this.db.from('payments').update({ voided: true, void_reason: reason.trim() }).eq('id', id));
  }

  /** Cuentas por cobrar: pedidos no cancelados con saldo pendiente. */
  async receivables(): Promise<OrderRow[]> {
    return unwrap(
      await this.db
        .from('orders')
        .select(ORDER_ROW_SELECT)
        .gt('balance', 0)
        .neq('status', 'CANCELADO')
        .order('due_date', { ascending: true, nullsFirst: false }),
    ) as OrderRow[];
  }
}
