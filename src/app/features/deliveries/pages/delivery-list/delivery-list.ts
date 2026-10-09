import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { MultiSelectModule } from 'primeng/multiselect';
import { TagModule } from 'primeng/tag';
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_OPTIONS, DELIVERY_STATUS_SEVERITY, DeliveryStatus } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { daysUntil } from '../../../../shared/utils/format';
import { Delivery } from '../../models/delivery.model';
import { DeliveriesService } from '../../services/deliveries.service';
import { DeliveryDialog } from '../../components/delivery-dialog/delivery-dialog';

@Component({
  selector: 'app-delivery-list',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    TableModule,
    MultiSelectModule,
    TagModule,
    PageHeader,
    StatCard,
    StatusTag,
    EmptyState,
    MoneyPipe,
    DeliveryDialog,
  ],
  template: `
    <app-page-header title="Entregas" subtitle="Programación y registro de entregas a clientes">
      <p-button label="Programar entrega" icon="pi pi-plus" (onClick)="openNew()" />
    </app-page-header>

    <div class="grid-cols grid-cols--3" style="margin-bottom: 1rem">
      <app-stat-card label="Pendientes / listas" [value]="pendingCount()" icon="pi pi-clock" tone="orange" />
      <app-stat-card label="Para hoy" [value]="todayCount()" icon="pi pi-calendar" tone="blue" />
      <app-stat-card label="Atrasadas" [value]="lateCount()" icon="pi pi-exclamation-triangle" [tone]="lateCount() ? 'red' : 'green'" />
    </div>

    <div class="card">
      <div class="toolbar-filters">
        <p-multiselect
          [options]="statusOptions"
          [(ngModel)]="statuses"
          (onChange)="load()"
          optionLabel="label"
          optionValue="value"
          placeholder="Todos los estados"
          [style]="{ minWidth: '220px' }"
        />
      </div>
      <p-table [value]="rows()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '980px' }" [rowHover]="true" [paginator]="rows().length > 20" [rows]="20">
        <ng-template #header>
          <tr>
            <th>Número</th><th>Pedido</th><th>Cliente</th><th pSortableColumn="scheduled_date">Programada <p-sortIcon field="scheduled_date" /></th>
            <th>Real</th><th>Estado</th><th>Responsable</th><th>Conformidad</th><th class="text-right">Saldo</th><th></th>
          </tr>
        </ng-template>
        <ng-template #body let-d>
          <tr>
            <td class="strong nowrap">{{ d.number }}</td>
            <td class="nowrap"><a class="link" [routerLink]="['/orders', d.order_id]">{{ d.order?.number }}</a><br /><small class="muted">{{ d.order?.title }}</small></td>
            <td>{{ d.customer?.full_name }}</td>
            <td class="nowrap" [class.text-danger]="isLate(d)">{{ d.scheduled_date | date: 'dd/MM/yyyy' }}</td>
            <td class="nowrap">{{ d.delivered_at ? (d.delivered_at | date: 'dd/MM/yyyy HH:mm') : '—' }}</td>
            <td><app-status-tag [value]="d.status" [labels]="labels" [severities]="severities" /></td>
            <td>{{ d.responsible?.full_name ?? '—' }}</td>
            <td>
              @if (d.conformity === true) {
                <p-tag value="Conforme" severity="success" />
              } @else if (d.conformity === false) {
                <p-tag value="No conforme" severity="danger" />
              } @else {
                —
              }
            </td>
            <td class="text-right mono nowrap" [class.text-danger]="(d.order?.balance ?? 0) > 0">{{ d.order?.balance | money }}</td>
            <td class="text-right nowrap">
              @if (d.status !== 'ENTREGADA') {
                <p-button label="Entregar" icon="pi pi-check" size="small" [text]="true" (onClick)="deliver(d)" />
              }
              <p-button icon="pi pi-pencil" size="small" [text]="true" severity="secondary" ariaLabel="Editar" (onClick)="edit(d)" />
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr><td colspan="10"><app-empty-state icon="pi pi-truck" message="No hay entregas con esos filtros." /></td></tr>
        </ng-template>
      </p-table>
    </div>

    <app-delivery-dialog [(visible)]="dialog" [delivery]="editing()" [markDelivered]="markDelivered()" (saved)="load()" />
  `,
})
export class DeliveryList implements OnInit {
  private readonly service = inject(DeliveriesService);
  private readonly notify = inject(NotifyService);

  protected readonly rows = signal<Delivery[]>([]);
  protected readonly loading = signal(true);
  protected readonly dialog = signal(false);
  protected readonly editing = signal<Delivery | null>(null);
  protected readonly markDelivered = signal(false);

  protected readonly statusOptions = DELIVERY_STATUS_OPTIONS;
  protected readonly labels = DELIVERY_STATUS_LABELS;
  protected readonly severities = DELIVERY_STATUS_SEVERITY;
  protected statuses: DeliveryStatus[] = ['PENDIENTE', 'LISTA', 'NO_ENTREGADA'];

  protected readonly pendingCount = computed(() => this.rows().filter((d) => d.status === 'PENDIENTE' || d.status === 'LISTA').length);
  protected readonly todayCount = computed(() => this.rows().filter((d) => d.status !== 'ENTREGADA' && daysUntil(d.scheduled_date) === 0).length);
  protected readonly lateCount = computed(() => this.rows().filter((d) => this.isLate(d)).length);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.service.list({ statuses: this.statuses }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar las entregas.');
    } finally {
      this.loading.set(false);
    }
  }

  protected isLate(d: Delivery): boolean {
    const days = daysUntil(d.scheduled_date);
    return d.status !== 'ENTREGADA' && days !== null && days < 0;
  }

  protected openNew(): void {
    this.editing.set(null);
    this.markDelivered.set(false);
    this.dialog.set(true);
  }

  protected edit(d: Delivery): void {
    this.editing.set(d);
    this.markDelivered.set(false);
    this.dialog.set(true);
  }

  protected deliver(d: Delivery): void {
    this.editing.set(d);
    this.markDelivered.set(true);
    this.dialog.set(true);
  }
}
