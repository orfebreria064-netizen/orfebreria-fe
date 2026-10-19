import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { PAYMENT_METHOD_LABELS } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { toIsoDate } from '../../../../shared/utils/db';
import { ReceiptPdfService } from '../../../payments/services/receipt-pdf.service';
import { JewelerDialog } from '../../components/jeweler-dialog/jeweler-dialog';
import { Jeweler, JewelerPayment } from '../../models/jeweler.model';
import { JewelersService } from '../../services/jewelers.service';

/** Joyeros externos: catálogo y reporte de pagos (recibos de egreso) por joyero y periodo. */
@Component({
  selector: 'app-jeweler-list',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    TableModule,
    TabsModule,
    SelectModule,
    DatePickerModule,
    CheckboxModule,
    TagModule,
    PageHeader,
    StatCard,
    EmptyState,
    LabelPipe,
    MoneyPipe,
    JewelerDialog,
  ],
  template: `
    <app-page-header title="Joyeros" subtitle="Joyeros externos del taller y pagos por pedido">
      @if (canWrite) {
        <p-button label="Nuevo joyero" icon="pi pi-plus" (onClick)="openNew()" />
      }
    </app-page-header>

    <div class="card">
      <p-tabs [(value)]="tab">
        <p-tablist>
          <p-tab value="jewelers"><i class="pi pi-id-card"></i> Joyeros</p-tab>
          @if (canSeePayments) {
            <p-tab value="payments"><i class="pi pi-arrow-up-right"></i> Pagos a joyeros</p-tab>
          }
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="jewelers">
            <div class="toolbar-filters">
              <div class="row">
                <p-checkbox inputId="jw-inactive" [(ngModel)]="includeInactive" [binary]="true" (onChange)="loadJewelers()" />
                <label for="jw-inactive" class="small">Mostrar inactivos</label>
              </div>
            </div>
            <p-table [value]="jewelers()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '760px' }" [rowHover]="true">
              <ng-template #header>
                <tr>
                  <th>Nombre</th><th>DNI</th><th>Teléfono</th><th>Especialidad</th><th class="text-right">Pedidos en curso</th>
                  @if (canSeePayments) {
                    <th class="text-right">Total pagado</th>
                  }
                  <th></th>
                </tr>
              </ng-template>
              <ng-template #body let-j>
                <tr [style.opacity]="j.active ? 1 : 0.55">
                  <td class="strong">
                    {{ j.full_name }}
                    @if (!j.active) {
                      <p-tag value="Inactivo" severity="secondary" />
                    }
                  </td>
                  <td class="mono">{{ j.document_number || '—' }}</td>
                  <td>{{ j.phone || '—' }}</td>
                  <td>{{ j.specialty || '—' }}</td>
                  <td class="text-right">{{ j.active_orders }}</td>
                  @if (canSeePayments) {
                    <td class="text-right mono nowrap">
                      {{ j.paid_pen | money }}
                      @if (j.paid_usd) {
                        <br /><small>{{ j.paid_usd | money: 'USD' }}</small>
                      }
                    </td>
                  }
                  <td class="text-right nowrap">
                    @if (canSeePayments) {
                      <p-button icon="pi pi-list" [text]="true" severity="secondary" size="small" ariaLabel="Ver pagos" (onClick)="showPayments(j)" />
                    }
                    @if (canWrite) {
                      <p-button icon="pi pi-pencil" [text]="true" severity="secondary" size="small" ariaLabel="Editar joyero" (onClick)="openEdit(j)" />
                    }
                  </td>
                </tr>
              </ng-template>
              <ng-template #emptymessage>
                <tr><td colspan="7"><app-empty-state icon="pi pi-id-card" message="Aún no hay joyeros registrados." /></td></tr>
              </ng-template>
            </p-table>
          </p-tabpanel>

          @if (canSeePayments) {
            <p-tabpanel value="payments">
              <div class="grid-cols grid-cols--3" style="margin-bottom: 1rem">
                <app-stat-card label="Pagado en el periodo" [value]="paidLabel()" icon="pi pi-arrow-up-right" tone="orange" [hint]="validPayments().length + ' recibo(s)'" />
                <div class="card" style="display: flex; flex-direction: column; gap: 0.35rem; padding: 1rem 1.1rem; grid-column: span 2">
                  <small class="muted">Por joyero</small>
                  @for (row of byJeweler(); track row.name) {
                    <div class="row row--between"><span>{{ row.name }}</span><strong class="mono">{{ row.label }}</strong></div>
                  } @empty {
                    <span class="muted small">Sin pagos en el periodo.</span>
                  }
                </div>
              </div>
              <div class="toolbar-filters">
                <p-datepicker [(ngModel)]="range" selectionMode="range" dateFormat="dd/mm/yy" [showIcon]="true" [readonlyInput]="true" placeholder="Rango de fechas" (onSelect)="onRange()" (onClear)="loadPayments()" [showClear]="true" />
                <p-select [options]="jewelers()" [(ngModel)]="jewelerFilter" (onChange)="loadPayments()" optionLabel="full_name" optionValue="id" placeholder="Todos los joyeros" [showClear]="true" [filter]="true" filterBy="full_name" [style]="{ minWidth: '220px' }" />
                <div class="row">
                  <p-checkbox inputId="jp-voided" [(ngModel)]="includeVoided" [binary]="true" (onChange)="loadPayments()" />
                  <label for="jp-voided" class="small">Incluir anulados</label>
                </div>
              </div>
              <p-table [value]="payments()" [loading]="loadingPayments()" [scrollable]="true" [tableStyle]="{ 'min-width': '900px' }" [paginator]="payments().length > 20" [rows]="20" [rowHover]="true">
                <ng-template #header>
                  <tr>
                    <th>Fecha</th><th>Recibo</th><th>Joyero</th><th>Pedido</th><th>Detalle</th><th>Método</th>
                    <th class="text-right">Monto</th><th></th>
                  </tr>
                </ng-template>
                <ng-template #body let-p>
                  <tr class="p-datatable-row-clickable" (click)="openOrder(p.order_id)" [style.opacity]="p.voided ? 0.55 : 1">
                    <td class="nowrap">{{ p.payment_date | date: 'dd/MM/yyyy' }}</td>
                    <td class="nowrap mono">{{ p.number }}</td>
                    <td>{{ p.jeweler_name }}</td>
                    <td class="nowrap"><span class="strong">{{ p.order_number }}</span><br /><small class="muted">{{ p.customer_name }}</small></td>
                    <td>
                      {{ p.concept }}
                      @if (p.voided) {
                        <p-tag value="Anulado" severity="danger" [title]="p.void_reason" />
                      }
                    </td>
                    <td class="nowrap">{{ p.method | label: methodLabels }}</td>
                    <td class="text-right mono nowrap strong" [style.text-decoration]="p.voided ? 'line-through' : 'none'">{{ p.amount | money: p.currency }}</td>
                    <td class="text-right">
                      <p-button icon="pi pi-print" [text]="true" severity="secondary" size="small" ariaLabel="Imprimir recibo" (onClick)="$event.stopPropagation(); print(p)" />
                    </td>
                  </tr>
                </ng-template>
                <ng-template #emptymessage>
                  <tr><td colspan="8"><app-empty-state icon="pi pi-arrow-up-right" message="Sin pagos a joyeros en el periodo seleccionado." /></td></tr>
                </ng-template>
              </p-table>
            </p-tabpanel>
          }
        </p-tabpanels>
      </p-tabs>
    </div>

    <app-jeweler-dialog [(visible)]="dialog" [jeweler]="editing()" (saved)="loadJewelers()" />
  `,
})
export class JewelerList implements OnInit {
  private readonly service = inject(JewelersService);
  private readonly receipts = inject(ReceiptPdfService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly canWrite = this.auth.hasRole(...MODULE_ROLES.jewelersWrite);
  protected readonly canSeePayments = this.auth.hasRole(...MODULE_ROLES.jewelerPayments);
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;

  protected readonly jewelers = signal<Jeweler[]>([]);
  protected readonly payments = signal<JewelerPayment[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingPayments = signal(false);
  protected readonly dialog = signal(false);
  protected readonly editing = signal<Jeweler | null>(null);
  protected readonly tab = signal<string | number>('jewelers');

  protected includeInactive = false;
  protected includeVoided = false;
  protected jewelerFilter: string | null = null;
  protected range: Date[] | null = [new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date()];

  protected readonly validPayments = computed(() => this.payments().filter((p) => !p.voided));
  protected readonly paidLabel = computed(() => sumLabel(this.validPayments()));
  protected readonly byJeweler = computed(() => {
    const groups = new Map<string, JewelerPayment[]>();
    for (const p of this.validPayments()) groups.set(p.jeweler_name, [...(groups.get(p.jeweler_name) ?? []), p]);
    return [...groups.entries()]
      .map(([name, rows]) => ({ name, total: rows.reduce((acc, r) => acc + Number(r.amount), 0), label: sumLabel(rows) }))
      .sort((a, b) => b.total - a.total);
  });

  ngOnInit(): void {
    void this.loadJewelers();
    if (this.canSeePayments) void this.loadPayments();
  }

  protected async loadJewelers(): Promise<void> {
    this.loading.set(true);
    try {
      this.jewelers.set(await this.service.list(this.includeInactive));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los joyeros.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadPayments(): Promise<void> {
    this.loadingPayments.set(true);
    try {
      this.payments.set(
        await this.service.payments({
          jewelerId: this.jewelerFilter,
          from: toIsoDate(this.range?.[0]),
          to: toIsoDate(this.range?.[1] ?? this.range?.[0]),
          includeVoided: this.includeVoided,
        }),
      );
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los pagos.');
    } finally {
      this.loadingPayments.set(false);
    }
  }

  protected onRange(): void {
    if (!this.range || this.range[1]) void this.loadPayments();
  }

  protected openNew(): void {
    this.editing.set(null);
    this.dialog.set(true);
  }

  protected openEdit(j: Jeweler): void {
    this.editing.set(j);
    this.dialog.set(true);
  }

  /** Pasa a la pestaña de pagos filtrando por el joyero (todo el historial). */
  protected showPayments(j: Jeweler): void {
    this.jewelerFilter = j.id;
    this.range = null;
    void this.loadPayments();
    this.tab.set('payments');
  }

  protected openOrder(id: string): void {
    void this.router.navigate(['/orders', id]);
  }

  protected async print(p: JewelerPayment): Promise<void> {
    try {
      await this.receipts.expense(p, { number: p.order_number ?? '', title: p.order_title, customer: p.customer_name });
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el recibo.');
    }
  }
}

function sumLabel(rows: JewelerPayment[]): string {
  const pen = rows.filter((r) => r.currency !== 'USD').reduce((acc, r) => acc + Number(r.amount), 0);
  const usd = rows.filter((r) => r.currency === 'USD').reduce((acc, r) => acc + Number(r.amount), 0);
  return usd ? `${formatMoney(pen)} · ${formatMoney(usd, 'USD')}` : formatMoney(pen);
}
