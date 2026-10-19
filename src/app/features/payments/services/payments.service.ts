import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { PaymentMethod } from '../../../core/models/domain';
import { emptyToNull } from '../../../shared/utils/db';
import { mapOrderRow, mapPayment } from '../../../shared/utils/api-mappers';
import { OrderRow } from '../../orders/models/order.model';
import { Payment, PaymentInput } from '../models/payment.model';

export interface PaymentFilters {
  from?: string | null;
  to?: string | null;
  method?: PaymentMethod | null;
  includeVoided?: boolean;
}

/**
 * Pagos de pedidos. El total pagado y el saldo del pedido los recalcula la base de datos; un pago mayor
 * al saldo requiere `overpayment_confirmed = true` (confirmación explícita del usuario).
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly api = inject(ApiService);

  async list(filters: PaymentFilters = {}): Promise<Payment[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Pago/listarpagos', {
      from: filters.from ?? null,
      to: filters.to ?? null,
      method: filters.method ?? null,
      include_voided: filters.includeVoided ?? false,
    });
    return rows.map(mapPayment);
  }

  async byOrder(orderId: string): Promise<Payment[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Pago/listarpagos', { order_id: orderId, include_voided: true });
    return rows.map(mapPayment).sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.created_at.localeCompare(b.created_at));
  }

  /** Registra el pago (la base emite su recibo de ingreso). Devuelve el id del pago. */
  async create(input: PaymentInput): Promise<string> {
    return (await this.api.procesar('Pago/registrar', emptyToNull(input))).resultProceso!;
  }

  /** Número del recibo de ingreso (los pagos anteriores a los recibos lo reciben aquí). */
  async issueReceipt(id: string): Promise<string> {
    return (await this.api.procesar(`Pago/emitirrecibo/${id}`)).resultProceso!;
  }

  /** Los pagos no se eliminan: se anulan con motivo (queda en auditoría). */
  async void(id: string, reason: string): Promise<void> {
    await this.api.procesar('Pago/anular', { payment_id: id, reason: reason.trim() });
  }

  /** Cuentas por cobrar: pedidos no cancelados con saldo pendiente (primero los de entrega más próxima). */
  async receivables(): Promise<OrderRow[]> {
    const rows = (await this.api.get<Record<string, unknown>[]>('Pago/porcobrar')).map(mapOrderRow);
    return rows.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  }
}
