import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { QUOTATION_STATUS_LABELS, QUOTATION_STATUS_OPTIONS, QUOTATION_STATUS_SEVERITY, QuotationStatus } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { QuotationRow } from '../../models/quotation.model';
import { QuotationsService } from '../../services/quotations.service';

@Component({
  selector: 'app-quotation-list',
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
    PageHeader,
    StatusTag,
    EmptyState,
    MoneyPipe,
  ],
  template: `
    <app-page-header title="Cotizaciones" subtitle="Propuestas económicas para ventas, fabricaciones y reparaciones">
      <p-button label="Nueva cotización" icon="pi pi-plus" routerLink="/quotations/new" />
    </app-page-header>

    <div class="card">
      <div class="toolbar-filters">
        <p-iconfield>
          <p-inputicon styleClass="pi pi-search" />
          <input pInputText type="search" placeholder="Buscar por número o trabajo" [(ngModel)]="search" (ngModelChange)="onSearch()" />
        </p-iconfield>
        <p-select
          [options]="statusOptions"
          [(ngModel)]="status"
          (onChange)="load()"
          optionLabel="label"
          optionValue="value"
          placeholder="Todos los estados"
          [showClear]="true"
          [style]="{ minWidth: '200px' }"
        />
      </div>

      <p-table
        [value]="rows()"
        [loading]="loading()"
        [paginator]="rows().length > 15"
        [rows]="15"
        [scrollable]="true"
        [tableStyle]="{ 'min-width': '960px' }"
        [rowHover]="true"
        dataKey="id"
      >
        <ng-template #header>
          <tr>
            <th pSortableColumn="number">Número <p-sortIcon field="number" /></th>
            <th pSortableColumn="customer.full_name">Cliente <p-sortIcon field="customer.full_name" /></th>
            <th>Trabajo</th>
            <th>Servicio</th>
            <th pSortableColumn="issue_date">Fecha <p-sortIcon field="issue_date" /></th>
            <th pSortableColumn="expiry_date">Vence <p-sortIcon field="expiry_date" /></th>
            <th>Estado</th>
            <th class="text-right" pSortableColumn="total">Total <p-sortIcon field="total" /></th>
          </tr>
        </ng-template>
        <ng-template #body let-q>
          <tr class="p-datatable-row-clickable" (click)="open(q)">
            <td class="strong nowrap">{{ q.number }}</td>
            <td>{{ q.customer?.full_name }}</td>
            <td>{{ q.title }}</td>
            <td>{{ q.service_type?.name }}</td>
            <td class="nowrap">{{ q.issue_date | date: 'dd/MM/yyyy' }}</td>
            <td class="nowrap">{{ q.expiry_date | date: 'dd/MM/yyyy' }}</td>
            <td class="nowrap">
              <app-status-tag [value]="q.status" [labels]="labels" [severities]="severities" />
              @if (q.order) {
                <span class="muted small"> → {{ q.order.number }}</span>
              }
            </td>
            <td class="text-right mono nowrap">{{ q.total | money }}</td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr><td colspan="8"><app-empty-state icon="pi pi-file-edit" message="No hay cotizaciones con esos filtros." /></td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
})
export class QuotationList implements OnInit {
  private readonly service = inject(QuotationsService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  protected readonly rows = signal<QuotationRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly statusOptions = QUOTATION_STATUS_OPTIONS;
  protected readonly labels = QUOTATION_STATUS_LABELS;
  protected readonly severities = QUOTATION_STATUS_SEVERITY;
  protected search = '';
  protected status: QuotationStatus | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    void this.load();
  }

  protected onSearch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.service.list({ status: this.status, search: this.search }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar las cotizaciones.');
    } finally {
      this.loading.set(false);
    }
  }

  protected open(q: QuotationRow): void {
    void this.router.navigate(['/quotations', q.id]);
  }
}
