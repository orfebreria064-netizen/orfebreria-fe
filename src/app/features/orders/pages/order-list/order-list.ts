import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { CheckboxModule } from 'primeng/checkbox';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import {
  ACTIVE_ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_OPTIONS,
  ORDER_STATUS_SEVERITY,
  OrderStatus,
  PRIORITY_LABELS,
  PRIORITY_SEVERITY,
} from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { daysUntil } from '../../../../shared/utils/format';
import { OrderRow } from '../../models/order.model';
import { OrdersService } from '../../services/orders.service';

@Component({
  selector: 'app-order-list',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    TableModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    SelectModule,
    MultiSelectModule,
    CheckboxModule,
    ProgressBarModule,
    TagModule,
    PageHeader,
    StatusTag,
    EmptyState,
    MoneyPipe,
  ],
  templateUrl: './order-list.html',
})
export class OrderList implements OnInit {
  private readonly service = inject(OrdersService);
  protected readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  protected readonly rows = signal<OrderRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly canCreate = this.auth.hasRole(...MODULE_ROLES.ordersWrite);
  protected readonly statusOptions = ORDER_STATUS_OPTIONS;
  protected readonly labels = ORDER_STATUS_LABELS;
  protected readonly severities = ORDER_STATUS_SEVERITY;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly prioritySeverity = PRIORITY_SEVERITY;

  protected search = '';
  protected statuses: OrderStatus[] = [...ACTIVE_ORDER_STATUSES];
  protected assignedTo: string | null = null;
  protected serviceTypeId: string | null = null;
  protected overdueOnly = false;
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('overdue') === '1') this.overdueOnly = true;
    const status = params.get('status');
    if (status) this.statuses = status.split(',') as OrderStatus[];
    void this.lookups.ensureLoaded();
    void this.load();
  }

  protected onSearch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(
        await this.service.list({
          statuses: this.statuses,
          search: this.search,
          assignedTo: this.assignedTo,
          serviceTypeId: this.serviceTypeId,
          overdueOnly: this.overdueOnly,
        }),
      );
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los pedidos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected isOverdue(o: OrderRow): boolean {
    const d = daysUntil(o.due_date);
    return d !== null && d < 0 && !['ENTREGADO', 'CERRADO', 'CANCELADO'].includes(o.status);
  }

  protected open(o: OrderRow): void {
    void this.router.navigate(['/orders', o.id]);
  }
}
