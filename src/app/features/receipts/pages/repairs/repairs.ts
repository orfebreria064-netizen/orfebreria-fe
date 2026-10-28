import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { ORDER_STATUS_LABELS, ORDER_STATUS_SEVERITY } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { daysUntil } from '../../../../shared/utils/format';
import { ReceiptDialog } from '../../components/receipt-dialog/receipt-dialog';
import { ReturnDialog } from '../../components/return-dialog/return-dialog';
import { CustomerReceipt, CustomerReceiptsService } from '../../services/customer-receipts.service';

/**
 * Reparaciones de piezas de clientes: cada una es un pedido de tipo Reparación con su orden de
 * reparación (acta de recepción). Cobros, taller, entrega y estado de cuenta usan el flujo del pedido.
 */
@Component({
  selector: 'app-repairs',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectButtonModule,
    TableModule,
    EmptyState,
    PageHeader,
    StatCard,
    StatusTag,
    MoneyPipe,
    ReceiptDialog,
    ReturnDialog,
  ],
  template: `
    <app-page-header title="Reparaciones" subtitle="Piezas de clientes recibidas para reparar">
      <p-button label="Nueva reparación" icon="pi pi-plus" (onClick)="dialog = true" />
    </app-page-header>

    <div class="kpis">
      <app-stat-card label="En taller" [value]="String(pending().length)" icon="pi pi-wrench" tone="orange" />
      <app-stat-card label="Listas para entregar" [value]="String(ready())" icon="pi pi-check-circle" tone="green" />
      <app-stat-card label="Atrasadas" [value]="String(late())" icon="pi pi-exclamation-triangle" [tone]="late() ? 'red' : 'ink'" />
    </div>

    <div class="card" style="margin-top: 1rem">
      <div class="toolbar-filters">
        <p-selectbutton [options]="filters" [(ngModel)]="filter" optionLabel="label" optionValue="value" [allowEmpty]="false" (onChange)="load()" />
        <p-iconfield>
          <p-inputicon styleClass="pi pi-search" />
          <input pInputText [(ngModel)]="search" placeholder="Buscar por cliente, pieza o número" />
        </p-iconfield>
      </div>
      <p-table [value]="filtered()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '980px' }" [rowHover]="true">
        <ng-template #header>
          <tr><th>Orden</th><th>Recibida</th><th>Cliente</th><th>Pieza y trabajo</th><th class="text-right">Peso</th><th>Entrega</th><th>Estado</th><th class="text-right">Saldo</th><th></th></tr>
        </ng-template>
        <ng-template #body let-r>
          <tr>
            <td class="nowrap">
              <span class="mono small">{{ r.number }}</span>
              <br /><a class="small" [routerLink]="['/orders', r.order_id]">{{ r.order?.number }}</a>
            </td>
            <td class="nowrap">{{ r.received_at | date: 'dd/MM/yyyy' }}</td>
            <td>{{ r.customer?.full_name }}<br /><span class="small muted">{{ r.customer?.phone ?? '' }}</span></td>
            <td class="small">
              <strong>{{ r.order?.title }}</strong>
              <div class="muted">{{ r.reported_issue }}</div>
            </td>
            <td class="text-right mono nowrap">{{ r.weight_in ? (r.weight_in | number: '1.2-2') + ' g' : '—' }}</td>
            <td class="nowrap" [class.text-danger]="isLate(r)">
              @if (r.returned_at) {
                Devuelta {{ r.returned_at | date: 'dd/MM' }}
              } @else {
                {{ r.order?.due_date ? (r.order.due_date | date: 'dd/MM/yyyy') : '—' }}
              }
            </td>
            <td class="nowrap">
              @if (r.order) {
                <app-status-tag [value]="r.order.status" [labels]="labels" [severities]="severities" />
              }
            </td>
            <td class="text-right mono nowrap" [class.text-danger]="(r.order?.balance ?? 0) > 0">{{ r.order?.balance | money: r.order?.currency }}</td>
            <td class="text-right nowrap">
              <p-button icon="pi pi-print" [text]="true" severity="secondary" ariaLabel="Imprimir orden" title="Imprimir orden" (onClick)="print(r)" />
              @if (!r.returned_at) {
                <p-button icon="pi pi-reply" [text]="true" ariaLabel="Entregar pieza" title="Registrar devolución de la pieza" (onClick)="returning.set(r)" />
              }
              <p-button icon="pi pi-arrow-right" [text]="true" severity="secondary" ariaLabel="Abrir pedido" [routerLink]="['/orders', r.order_id]" />
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr><td colspan="9"><app-empty-state icon="pi pi-wrench" message="No hay reparaciones." /></td></tr>
        </ng-template>
      </p-table>
    </div>

    <app-receipt-dialog [(visible)]="dialog" kind="REPARACION" (saved)="load()" />
    <app-return-dialog [receipt]="returning()" (closed)="returning.set(null)" (saved)="load()" />
  `,
  styles: `
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: var(--app-gap);
    }
  `,
})
export class Repairs implements OnInit {
  private readonly service = inject(CustomerReceiptsService);
  private readonly notify = inject(NotifyService);

  protected readonly String = String;
  protected readonly labels = ORDER_STATUS_LABELS;
  protected readonly severities = ORDER_STATUS_SEVERITY;
  protected readonly filters = [
    { value: 'open', label: 'Pendientes de entregar' },
    { value: 'all', label: 'Todas' },
  ];
  protected filter: 'open' | 'all' = 'open';
  protected search = '';
  protected dialog = false;

  protected readonly rows = signal<CustomerReceipt[]>([]);
  protected readonly loading = signal(true);
  protected readonly returning = signal<CustomerReceipt | null>(null);

  protected readonly pending = computed(() => this.rows().filter((r) => !r.returned_at && r.order?.status !== 'CANCELADO'));
  protected readonly ready = computed(() => this.pending().filter((r) => r.order?.status === 'LISTO_ENTREGA').length);
  protected readonly late = computed(() => this.pending().filter((r) => this.isLate(r)).length);

  protected filtered(): CustomerReceipt[] {
    const t = this.search.trim().toLowerCase();
    if (!t) return this.rows();
    return this.rows().filter((r) =>
      `${r.number} ${r.order?.number ?? ''} ${r.customer?.full_name ?? ''} ${r.order?.title ?? ''} ${r.reported_issue ?? ''}`.toLowerCase().includes(t),
    );
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.service.list('REPARACION', { open: this.filter === 'open' }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar las reparaciones.');
    } finally {
      this.loading.set(false);
    }
  }

  protected isLate(r: CustomerReceipt): boolean {
    return !r.returned_at && !!r.order?.due_date && (daysUntil(r.order.due_date) ?? 0) < 0;
  }

  protected async print(r: CustomerReceipt): Promise<void> {
    try {
      await this.service.print(r);
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el PDF.');
    }
  }
}
