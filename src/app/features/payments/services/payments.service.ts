import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PaymentMethod } from '../../../core/models/domain';
import { emptyToNull, unwrap } from '../../../shared/utils/db';
import { OrderRow } from '../../orders/models/order.model';
import { ORDER_ROW_SELECT } from '../../orders/services/orders.service';
import { Payment, PaymentInput } from '../models/payment.model';

const PAYMENT_SELECT = '*, order:orders(id, number, customer:customers(id, full_name))';

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

  async create(input: PaymentInput): Promise<void> {
    unwrap(await this.db.from('payments').insert(emptyToNull(input)));
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
