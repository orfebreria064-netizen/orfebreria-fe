import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_SEVERITY,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PaymentMethod,
} from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { toIsoDate } from '../../../../shared/utils/db';
import { daysUntil } from '../../../../shared/utils/format';
import { OrderRow } from '../../../orders/models/order.model';
import { Payment } from '../../models/payment.model';
import { PaymentsService } from '../../services/payments.service';
import { PaymentDialog } from '../../components/payment-dialog/payment-dialog';

/** Cobranza: pagos recibidos y cuentas por cobrar. */
@Component({
  selector: 'app-payment-list',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    TableModule,
    TabsModule,
    SelectModule,
    DatePickerModule,
    CheckboxModule,
    TagModule,
    PageHeader,
    StatCard,
    StatusTag,
    EmptyState,
    LabelPipe,
    MoneyPipe,
    PaymentDialog,
  ],
  templateUrl: './payment-list.html',
})
export class PaymentList implements OnInit {
  private readonly service = inject(PaymentsService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  protected readonly payments = signal<Payment[]>([]);
  protected readonly receivables = signal<OrderRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly dialog = signal(false);

  protected readonly methods = PAYMENT_METHOD_OPTIONS;
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly orderLabels = ORDER_STATUS_LABELS;
  protected readonly orderSeverity = ORDER_STATUS_SEVERITY;

  protected range: Date[] | null = [new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date()];
  protected method: PaymentMethod | null = null;
  protected includeVoided = false;

  protected readonly collected = computed(() =>
    formatMoney(this.payments().filter((p) => !p.voided).reduce((acc, p) => acc + Number(p.amount), 0)),
  );
  protected readonly receivableTotal = computed(() =>
    formatMoney(this.receivables().reduce((acc, o) => acc + Number(o.balance), 0)),
  );
  protected readonly byMethod = computed(() => {
    const totals = new Map<PaymentMethod, number>();
    for (const p of this.payments()) {
      if (!p.voided) totals.set(p.method, (totals.get(p.method) ?? 0) + Number(p.amount));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([method, total]) => ({ method, total }));
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [payments, receivables] = await Promise.all([
        this.service.list({
          from: toIsoDate(this.range?.[0]),
          to: toIsoDate(this.range?.[1] ?? this.range?.[0]),
          method: this.method,
          includeVoided: this.includeVoided,
        }),
        this.service.receivables(),
      ]);
      this.payments.set(payments);
      this.receivables.set(receivables);
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los pagos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected onRange(): void {
    if (!this.range || this.range[1]) void this.load();
  }

  protected overdue(o: OrderRow): boolean {
    const d = daysUntil(o.due_date);
    return d !== null && d < 0;
  }

  protected openOrder(id: string): void {
    void this.router.navigate(['/orders', id]);
  }
}
