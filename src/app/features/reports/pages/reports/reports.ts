import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import {
  MATERIAL_TYPE_LABELS,
  MATERIAL_TYPE_OPTIONS,
  MaterialType,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PRIORITY_LABELS,
  PaymentMethod,
} from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { formatMoney } from '../../../../shared/pipes/money.pipe';
import { toIsoDate } from '../../../../shared/utils/db';
import { CustomerPicker } from '../../../customers/components/customer-picker/customer-picker';
import {
  AGING_LABELS,
  AgingBucket,
  CollectionRow,
  CustodyRow,
  DeadlineRow,
  REPORTS,
  ReceivableRow,
  ReportColumn,
  ReportKey,
  ReportSummaryItem,
  SalesRow,
  StockRow,
} from '../../models/report.model';
import { ReportsService } from '../../services/reports.service';
import { ReportExportService, columnTotal, formatCell } from '../../services/report-export.service';

type Row = Record<string, unknown>;

const qty = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 });

function sum<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((acc, r) => acc + Number(pick(r) ?? 0), 0);
}

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

/** Reportes gerenciales (ADMIN y GERENTE): filtros, totales, detalle y exportación a Excel/PDF. */
@Component({
  selector: 'app-reports',
  imports: [FormsModule, ButtonModule, TableModule, SelectModule, DatePickerModule, CheckboxModule, PageHeader, StatCard, EmptyState, CustomerPicker],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports implements OnInit {
  private readonly service = inject(ReportsService);
  private readonly exporter = inject(ReportExportService);
  private readonly notify = inject(NotifyService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly lookups = inject(LookupService);

  protected readonly reports = REPORTS;
  protected readonly selected = signal<ReportKey>('ventas');
  protected readonly info = computed(() => REPORTS.find((r) => r.key === this.selected())!);
  protected readonly loading = signal(false);
  protected readonly exporting = signal<'excel' | 'pdf' | null>(null);

  private readonly data = signal<Row[]>([]);

  // Filtros
  protected range: Date[] | null = [new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date()];
  protected serviceTypeId: string | null = null;
  protected assignedTo: string | null = null;
  protected customerId: string | null = null;
  protected method: PaymentMethod | null = null;
  protected includeVoided = false;
  protected daysAhead = 7;
  protected materialType: MaterialType | null = null;
  protected includeInactive = false;
  protected readonly bucket = signal<AgingBucket | null>(null);
  protected readonly onlyBelowMin = signal(false);

  protected readonly methods = PAYMENT_METHOD_OPTIONS;
  protected readonly materialTypes = MATERIAL_TYPE_OPTIONS;
  protected readonly buckets = (Object.keys(AGING_LABELS) as AgingBucket[]).map((value) => ({ value, label: AGING_LABELS[value] }));
  protected readonly horizons = [
    { value: 0, label: 'Solo atrasados' },
    { value: 7, label: 'Atrasados + próximos 7 días' },
    { value: 15, label: 'Atrasados + próximos 15 días' },
    { value: 30, label: 'Atrasados + próximos 30 días' },
  ];

  /** Filas visibles (algunos filtros se aplican en el navegador). */
  protected readonly rows = computed<Row[]>(() => {
    const rows = this.data();
    if (this.selected() === 'cobrar' && this.bucket()) return rows.filter((r) => r['bucket'] === this.bucket());
    if (this.selected() === 'stock' && this.onlyBelowMin()) return rows.filter((r) => r['below_min']);
    return rows;
  });

  protected readonly columns = computed<ReportColumn[]>(() => {
    switch (this.selected()) {
      case 'ventas':
        return [
          { key: 'number', header: 'Pedido', width: 18 },
          { key: 'order_date', header: 'Fecha', type: 'date' },
          { key: 'customer_name', header: 'Cliente', width: 28 },
          { key: 'service_name', header: 'Servicio', width: 22 },
          { key: 'title', header: 'Producto', width: 32 },
          { key: 'assignee_name', header: 'Responsable', width: 18 },
          { key: 'status', header: 'Estado', type: 'label', labels: ORDER_STATUS_LABELS, width: 18 },
          { key: 'tax_amount', header: 'IGV', type: 'money', total: true },
          { key: 'total', header: 'Total', type: 'money', total: true },
          { key: 'amount_paid', header: 'Cobrado', type: 'money', total: true },
          { key: 'balance', header: 'Saldo', type: 'money', total: true },
        ];
      case 'cobrar':
        return [
          { key: 'number', header: 'Pedido', width: 18 },
          { key: 'customer_name', header: 'Cliente', width: 28 },
          { key: 'customer_phone', header: 'Teléfono', width: 13 },
          { key: 'title', header: 'Producto', width: 30 },
          { key: 'status', header: 'Estado', type: 'label', labels: ORDER_STATUS_LABELS, width: 18 },
          { key: 'reference_date', header: 'Desde', type: 'date' },
          { key: 'days_old', header: 'Días', type: 'number' },
          { key: 'bucket', header: 'Antigüedad', type: 'label', labels: AGING_LABELS, width: 15 },
          { key: 'total', header: 'Total', type: 'money', total: true },
          { key: 'amount_paid', header: 'Pagado', type: 'money', total: true },
          { key: 'balance', header: 'Saldo', type: 'money', total: true },
        ];
      case 'cobranza':
        return [
          { key: 'payment_date', header: 'Fecha', type: 'date' },
          { key: 'order_number', header: 'Pedido', width: 18 },
          { key: 'customer_name', header: 'Cliente', width: 28 },
          { key: 'method', header: 'Método', type: 'label', labels: PAYMENT_METHOD_LABELS, width: 14 },
          { key: 'reference', header: 'Referencia', width: 16 },
          { key: 'is_advance', header: 'Adelanto', type: 'bool' },
          { key: 'created_by_name', header: 'Registró', width: 18 },
          ...(this.includeVoided
            ? ([
                { key: 'voided', header: 'Anulado', type: 'bool' },
                { key: 'void_reason', header: 'Motivo anulación', width: 26 },
              ] as ReportColumn[])
            : []),
          { key: 'amount', header: 'Monto', type: 'money', total: !this.includeVoided },
        ];
      case 'plazos':
        return [
          { key: 'number', header: 'Pedido', width: 18 },
          { key: 'customer_name', header: 'Cliente', width: 26 },
          { key: 'customer_phone', header: 'Teléfono', width: 13 },
          { key: 'title', header: 'Producto', width: 30 },
          { key: 'priority', header: 'Prioridad', type: 'label', labels: PRIORITY_LABELS },
          { key: 'status', header: 'Estado', type: 'label', labels: ORDER_STATUS_LABELS, width: 18 },
          { key: 'current_stage_name', header: 'Etapa actual', width: 18 },
          { key: 'assignee_name', header: 'Responsable', width: 18 },
          { key: 'due_date', header: 'Entrega', type: 'date' },
          { key: 'days_left', header: 'Días', type: 'number' },
          { key: 'balance', header: 'Saldo', type: 'money', total: true },
        ];
      case 'stock':
        return [
          { key: 'name', header: 'Material', width: 24 },
          { key: 'type', header: 'Tipo', type: 'label', labels: MATERIAL_TYPE_LABELS, width: 18 },
          { key: 'purity', header: 'Ley', width: 10 },
          { key: 'stock', header: 'Stock', type: 'qty', unitKey: 'unit' },
          { key: 'min_stock', header: 'Mínimo', type: 'qty', unitKey: 'unit' },
          { key: 'reference_cost', header: 'Costo ref.', type: 'money' },
          { key: 'stock_value', header: 'Valor', type: 'money', total: true },
          { key: 'below_min', header: 'Bajo mínimo', type: 'bool' },
        ];
      case 'custodia':
        return [
          { key: 'customer_name', header: 'Cliente', width: 26 },
          { key: 'customer_phone', header: 'Teléfono', width: 13 },
          { key: 'order_number', header: 'Pedido', width: 18 },
          { key: 'order_status', header: 'Estado pedido', type: 'label', labels: ORDER_STATUS_LABELS, width: 18 },
          { key: 'material_name', header: 'Material', width: 18 },
          { key: 'purity', header: 'Ley', width: 10 },
          { key: 'received', header: 'Recibido', type: 'qty', unitKey: 'unit' },
          { key: 'used', header: 'Usado', type: 'qty', unitKey: 'unit' },
          { key: 'returned', header: 'Devuelto', type: 'qty', unitKey: 'unit' },
          { key: 'balance', header: 'En custodia', type: 'qty', unitKey: 'unit' },
          { key: 'last_movement', header: 'Último mov.', type: 'date' },
        ];
    }
  });

  protected readonly summary = computed<ReportSummaryItem[]>(() => {
    const rows = this.rows();
    switch (this.selected()) {
      case 'ventas': {
        const r = rows as unknown as SalesRow[];
        const total = sum(r, (x) => x.total);
        return [
          { label: 'Pedidos', value: String(r.length), icon: 'pi pi-briefcase', tone: 'ink' },
          { label: 'Ventas', value: formatMoney(total), hint: `IGV: ${formatMoney(sum(r, (x) => x.tax_amount))}`, icon: 'pi pi-chart-line', tone: 'gold' },
          { label: 'Cobrado', value: formatMoney(sum(r, (x) => x.amount_paid)), icon: 'pi pi-wallet', tone: 'green' },
          { label: 'Ticket promedio', value: formatMoney(r.length ? total / r.length : 0), icon: 'pi pi-tag', tone: 'blue' },
        ];
      }
      case 'cobrar': {
        const r = rows as unknown as ReceivableRow[];
        const by = (b: AgingBucket[]) => formatMoney(sum(r.filter((x) => b.includes(x.bucket)), (x) => x.balance));
        return [
          { label: 'Total por cobrar', value: formatMoney(sum(r, (x) => x.balance)), hint: `${r.length} pedido(s)`, icon: 'pi pi-wallet', tone: 'red' },
          { label: 'Por vencer', value: by(['POR_VENCER']), icon: 'pi pi-calendar', tone: 'blue' },
          { label: '0 – 60 días', value: by(['0_30', '31_60']), icon: 'pi pi-clock', tone: 'orange' },
          { label: 'Más de 60 días', value: by(['61_90', 'MAS_90']), icon: 'pi pi-exclamation-triangle', tone: 'red' },
        ];
      }
      case 'cobranza': {
        const r = (rows as unknown as CollectionRow[]).filter((x) => !x.voided);
        const voided = (rows as unknown as CollectionRow[]).filter((x) => x.voided);
        const byMethod = new Map<string, number>();
        r.forEach((x) => byMethod.set(x.method, (byMethod.get(x.method) ?? 0) + Number(x.amount)));
        const top = [...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([m, t]) => `${PAYMENT_METHOD_LABELS[m as PaymentMethod]}: ${formatMoney(t)}`);
        return [
          { label: 'Cobrado', value: formatMoney(sum(r, (x) => x.amount)), hint: `${r.length} pago(s)`, icon: 'pi pi-wallet', tone: 'green' },
          { label: 'Adelantos', value: formatMoney(sum(r.filter((x) => x.is_advance), (x) => x.amount)), icon: 'pi pi-forward', tone: 'blue' },
          { label: 'Por método', value: top[0] ?? '—', hint: top.slice(1).join(' · ') || undefined, icon: 'pi pi-credit-card', tone: 'gold' },
          { label: 'Anulado', value: formatMoney(sum(voided, (x) => x.amount)), hint: `${voided.length} pago(s)`, icon: 'pi pi-ban', tone: voided.length ? 'red' : 'ink' },
        ];
      }
      case 'plazos': {
        const r = rows as unknown as DeadlineRow[];
        const late = r.filter((x) => x.days_left < 0);
        return [
          { label: 'Atrasados', value: String(late.length), icon: 'pi pi-exclamation-triangle', tone: late.length ? 'red' : 'green' },
          { label: 'Por entregar en el plazo', value: String(r.length - late.length), icon: 'pi pi-calendar-clock', tone: 'blue' },
          { label: 'Atraso máximo', value: late.length ? `${Math.max(...late.map((x) => -x.days_left))} día(s)` : '—', icon: 'pi pi-clock', tone: 'orange' },
          { label: 'Saldo de estos pedidos', value: formatMoney(sum(r, (x) => x.balance)), icon: 'pi pi-wallet', tone: 'gold' },
        ];
      }
      case 'stock': {
        const r = rows as unknown as StockRow[];
        const metal = r.filter((x) => ['ORO', 'PLATA', 'PLATINO'].includes(x.type) && x.unit === 'g');
        const low = r.filter((x) => x.below_min);
        return [
          { label: 'Materiales', value: String(r.length), icon: 'pi pi-box', tone: 'ink' },
          { label: 'Valor del inventario', value: formatMoney(sum(r, (x) => x.stock_value)), icon: 'pi pi-dollar', tone: 'gold' },
          { label: 'Metal en stock', value: `${qty.format(sum(metal, (x) => x.stock))} g`, icon: 'pi pi-database', tone: 'blue' },
          { label: 'Bajo mínimo', value: String(low.length), icon: 'pi pi-exclamation-triangle', tone: low.length ? 'red' : 'green' },
        ];
      }
      case 'custodia': {
        const r = rows as unknown as CustodyRow[];
        const byUnit = (u: string) => sum(r.filter((x) => x.unit === u), (x) => x.balance);
        const closed = r.filter((x) => ['ENTREGADO', 'CERRADO', 'CANCELADO'].includes(x.order_status));
        return [
          { label: 'Clientes', value: String(new Set(r.map((x) => x.customer_name)).size), hint: `${new Set(r.map((x) => x.order_id)).size} pedido(s)`, icon: 'pi pi-users', tone: 'ink' },
          { label: 'Metal en custodia', value: `${qty.format(byUnit('g'))} g`, icon: 'pi pi-database', tone: 'gold' },
          { label: 'Piedras en custodia', value: `${qty.format(byUnit('ct'))} ct · ${qty.format(byUnit('und'))} und`, icon: 'pi pi-star', tone: 'blue' },
          { label: 'En pedidos ya entregados', value: String(closed.length), hint: 'Material por devolver', icon: 'pi pi-exclamation-triangle', tone: closed.length ? 'red' : 'green' },
        ];
      }
    }
  });

  ngOnInit(): void {
    void this.lookups.ensureLoaded();
    const r = this.route.snapshot.queryParamMap.get('r') as ReportKey | null;
    if (r && REPORTS.some((x) => x.key === r)) this.selected.set(r);
    void this.load();
  }

  protected select(key: ReportKey): void {
    if (key === this.selected()) return;
    this.selected.set(key);
    this.data.set([]);
    this.bucket.set(null);
    this.onlyBelowMin.set(false);
    void this.router.navigate([], { queryParams: { r: key }, replaceUrl: true });
    void this.load();
  }

  protected onRange(): void {
    if (!this.range || this.range[1]) void this.load();
  }

  protected async load(): Promise<void> {
    const key = this.selected();
    this.loading.set(true);
    try {
      const from = toIsoDate(this.range?.[0]) ?? toIsoDate(new Date())!;
      const to = toIsoDate(this.range?.[1] ?? this.range?.[0]) ?? from;
      let rows: unknown[];
      switch (key) {
        case 'ventas':
          rows = await this.service.sales({ from, to, serviceTypeId: this.serviceTypeId, customerId: this.customerId, assignedTo: this.assignedTo });
          break;
        case 'cobrar':
          rows = await this.service.receivables(this.customerId);
          break;
        case 'cobranza':
          rows = await this.service.collections({ from, to, method: this.method, includeVoided: this.includeVoided });
          break;
        case 'plazos':
          rows = await this.service.deadlines(this.daysAhead, this.assignedTo);
          break;
        case 'stock':
          rows = await this.service.stock(this.materialType, this.includeInactive);
          break;
        case 'custodia':
          rows = await this.service.custody(this.customerId);
          break;
      }
      if (key === this.selected()) this.data.set(rows as Row[]);
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el reporte.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async export(kind: 'excel' | 'pdf'): Promise<void> {
    this.exporting.set(kind);
    try {
      const payload = {
        title: this.info().title,
        filters: this.filtersText(),
        columns: this.columns(),
        rows: this.rows(),
        summary: this.summary().map((s) => ({ ...s, value: s.hint ? `${s.value} (${s.hint})` : s.value })),
        fileName: `${this.info().title.replace(/[^\p{L}\p{N}]+/gu, '_')}_${toIsoDate(new Date())}`,
      };
      if (kind === 'excel') await this.exporter.excel(payload);
      else await this.exporter.pdf(payload);
    } catch (err) {
      this.notify.error(err, 'No se pudo exportar el reporte.');
    } finally {
      this.exporting.set(null);
    }
  }

  protected cell(row: Row, col: ReportColumn): string {
    return formatCell(row, col);
  }

  protected total(col: ReportColumn): string {
    const t = columnTotal(this.rows(), col);
    return col.type === 'money' ? formatMoney(t) : qty.format(t);
  }

  protected hasTotals(): boolean {
    return this.columns().some((c) => c.total) && this.rows().length > 0;
  }

  protected isNumeric(col: ReportColumn): boolean {
    return col.type === 'money' || col.type === 'qty' || col.type === 'number';
  }

  /** Resalta en rojo saldos, atrasos y bajo mínimo. */
  protected danger(row: Row, col: ReportColumn): boolean {
    switch (this.selected()) {
      case 'plazos':
        return col.key === 'days_left' && Number(row['days_left']) < 0;
      case 'cobrar':
        return col.key === 'days_old' && Number(row['days_old']) > 60;
      case 'stock':
        return col.key === 'stock' && !!row['below_min'];
      case 'cobranza':
        return !!row['voided'];
      default:
        return col.key === 'balance' && Number(row['balance']) > 0;
    }
  }

  protected openRow(row: Row): void {
    const id = (row['order_id'] ?? (this.selected() === 'stock' ? null : row['id'])) as string | null;
    if (this.selected() === 'stock') void this.router.navigate(['/materials', row['id']]);
    else if (id) void this.router.navigate(['/orders', id]);
  }

  private filtersText(): string {
    const parts: string[] = [];
    const key = this.selected();
    if (key === 'ventas' || key === 'cobranza') parts.push(`Periodo: ${fmtDate(this.range?.[0])} – ${fmtDate(this.range?.[1] ?? this.range?.[0])}`);
    if (key === 'ventas' && this.serviceTypeId) parts.push(`Servicio: ${this.lookups.serviceTypes().find((s) => s.id === this.serviceTypeId)?.name}`);
    if ((key === 'ventas' || key === 'plazos') && this.assignedTo) parts.push(`Responsable: ${this.lookups.staff().find((s) => s.id === this.assignedTo)?.full_name}`);
    if ((key === 'ventas' || key === 'cobrar' || key === 'custodia') && this.customerId) {
      const name = (this.data()[0]?.['customer_name'] as string | undefined) ?? 'seleccionado';
      parts.push(`Cliente: ${name}`);
    }
    if (key === 'cobrar' && this.bucket()) parts.push(`Antigüedad: ${AGING_LABELS[this.bucket()!]}`);
    if (key === 'cobranza') {
      if (this.method) parts.push(`Método: ${PAYMENT_METHOD_LABELS[this.method]}`);
      parts.push(this.includeVoided ? 'Incluye anulados' : 'Sin anulados');
    }
    if (key === 'plazos') parts.push(this.horizons.find((h) => h.value === this.daysAhead)?.label ?? '');
    if (key === 'stock') {
      if (this.materialType) parts.push(`Tipo: ${MATERIAL_TYPE_LABELS[this.materialType]}`);
      if (this.onlyBelowMin()) parts.push('Solo bajo mínimo');
    }
    return parts.length ? parts.join(' · ') : 'Sin filtros';
  }
}
