import { Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_SEVERITY,
  PRIORITY_LABELS,
  PRIORITY_SEVERITY,
} from '../../../../core/models/domain';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { formatMoney } from '../../../../shared/pipes/money.pipe';
import { daysUntil, whatsappLink } from '../../../../shared/utils/format';
import { OrderDetail, OrderStage } from '../../models/order.model';

export type OrderAction = 'stages' | 'production' | 'payment' | 'delivery' | 'status' | 'close';

export interface NextAction {
  text: string;
  action: OrderAction | null;
  label?: string;
}

/** Pestaña "Resumen" del pedido. */
@Component({
  selector: 'app-order-summary',
  imports: [DatePipe, RouterLink, ButtonModule, ProgressBarModule, TableModule, TagModule, MoneyPipe],
  templateUrl: './order-summary.html',
  styleUrl: './order-summary.scss',
})
export class OrderSummary {
  readonly order = input.required<OrderDetail>();
  readonly stages = input<OrderStage[]>([]);
  readonly advance = input(0);
  readonly showMoney = input(true);
  readonly act = output<OrderAction>();

  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly prioritySeverity = PRIORITY_SEVERITY;
  protected readonly paymentLabels = PAYMENT_STATUS_LABELS;
  protected readonly paymentSeverity = PAYMENT_STATUS_SEVERITY;

  protected readonly dueIn = computed(() => daysUntil(this.order().due_date));
  protected readonly whatsapp = computed(() => {
    const c = this.order().customer;
    return whatsappLink(c?.whatsapp || c?.phone, `Hola ${c?.full_name ?? ''}, le escribimos por su pedido ${this.order().number}.`);
  });

  /** Sugiere el siguiente paso según el estado del pedido. */
  protected readonly nextAction = computed<NextAction>(() => {
    const o = this.order();
    const stages = this.stages();
    const current = stages.find((s) => s.is_current);
    switch (o.status) {
      case 'SOLICITUD':
      case 'COTIZADO':
        return { text: 'Confirmar la aprobación del cliente y pasar el pedido a «Aprobado».', action: 'status', label: 'Cambiar estado' };
      case 'APROBADO':
        if (stages.length === 0) {
          return { text: 'Crear las etapas de producción (o pasar a «Listo para entregar» si es una venta sin fabricación).', action: 'stages', label: 'Ver producción' };
        }
        return { text: `Iniciar la etapa «${current?.name ?? stages[0].name}».`, action: 'production', label: 'Ir a producción' };
      case 'DISENO':
      case 'PRODUCCION':
        return { text: `Avanzar la etapa actual: «${current?.name ?? '—'}».`, action: 'production', label: 'Ir a producción' };
      case 'CONTROL_CALIDAD':
        return { text: 'Completar y aprobar el control de calidad.', action: 'production', label: 'Ir a producción' };
      case 'LISTO_ENTREGA':
        return Number(o.balance) > 0
          ? { text: `Registrar la entrega y cobrar el saldo de ${formatMoney(o.balance)}.`, action: 'delivery', label: 'Registrar entrega' }
          : { text: 'Coordinar y registrar la entrega al cliente.', action: 'delivery', label: 'Registrar entrega' };
      case 'ENTREGADO':
        return Number(o.balance) > 0
          ? { text: `Cobrar el saldo pendiente de ${formatMoney(o.balance)} y cerrar el pedido.`, action: 'payment', label: 'Registrar pago' }
          : { text: 'Todo listo: cerrar el pedido.', action: 'close', label: 'Cerrar pedido' };
      case 'PAUSADO':
        return { text: 'El pedido está pausado. Reanúdelo cuando corresponda.', action: 'status', label: 'Cambiar estado' };
      case 'CERRADO':
        return { text: 'Pedido finalizado.', action: null };
      case 'CANCELADO':
        return { text: 'Pedido cancelado.', action: null };
    }
  });
}
