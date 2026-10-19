import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';
import { ORDER_STATUS_LABELS, ORDER_STATUS_SEVERITY } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { daysUntil } from '../../../../shared/utils/format';
import { ChartCard, ChartSeries, ChartSummary } from '../../components/chart-card/chart-card';
import { DashboardData, DashboardService } from '../../services/dashboard.service';

/** Paleta categórica validada (CVD y contraste) — ver skill dataviz / docs. */
const SERIES = { primary: '#2a78d6', secondary: '#eb6834' };
/** Orden categórico fijo (nunca ciclado); el 6.º segmento de la dona es siempre "Otros". */
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const OTHER = '#a9a69e';
/** Rampa ordinal azul (250→600) para etapas: más oscuro = más avanzado en el flujo. */
const ORDINAL = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];

const ordinal = (n: number) =>
  Array.from({ length: n }, (_, i) => ORDINAL[n === 1 ? ORDINAL.length - 1 : Math.round((i * (ORDINAL.length - 1)) / (n - 1))]);
const sum = (xs: number[]) => xs.reduce((a, b) => a + Number(b), 0);
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const compactMoney = (v: number) =>
  v >= 1000 ? `S/ ${(v / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} mil` : formatMoney(v);
const integer = (v: number) => String(Math.round(v));

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, ButtonModule, TableModule, SkeletonModule, PageHeader, StatCard, StatusTag, EmptyState, MoneyPipe, ChartCard],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private readonly service = inject(DashboardService);
  private readonly notify = inject(NotifyService);
  protected readonly auth = inject(AuthService);

  protected readonly data = signal<DashboardData | null>(null);
  protected readonly loading = signal(true);
  protected readonly labels = ORDER_STATUS_LABELS;
  protected readonly severities = ORDER_STATUS_SEVERITY;
  protected readonly money = formatMoney;

  /** Monto en soles y, si hay pedidos en dólares, también su monto en US$. */
  protected withUsd(pen: number, usd: number | null | undefined): string {
    return Number(usd) ? `${formatMoney(pen)} · ${formatMoney(usd, 'USD')}` : formatMoney(pen);
  }
  protected readonly compactMoney = compactMoney;
  protected readonly integer = integer;
  protected readonly today = new Date();

  protected readonly statusChart = computed(() => {
    const rows = this.data()?.orders_by_status ?? [];
    const values = rows.map((r) => r.count);
    return {
      labels: rows.map((r) => ORDER_STATUS_LABELS[r.status] ?? r.status),
      series: [{ label: 'Pedidos', values, color: SERIES.primary }] as ChartSeries[],
      summary: [{ label: 'Total de pedidos', value: integer(sum(values)) }] as ChartSummary[],
    };
  });

  protected readonly salesChart = computed(() => {
    const rows = this.data()?.sales_by_month ?? [];
    const sales = rows.map((r) => Number(r.sales));
    const collected = rows.map((r) => Number(r.collected));
    const totalSales = sum(sales);
    const totalCollected = sum(collected);
    return {
      labels: rows.map((r) => {
        const [y, m] = r.month.split('-').map(Number);
        return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
      }),
      series: [
        { label: 'Ventas (S/)', values: sales, color: SERIES.primary },
        { label: 'Cobrado (S/)', values: collected, color: SERIES.secondary },
      ] as ChartSeries[],
      summary: [
        { label: 'Ventas del periodo', value: formatMoney(totalSales), color: SERIES.primary },
        { label: 'Cobrado', value: formatMoney(totalCollected), color: SERIES.secondary },
        { label: 'Tasa de cobranza', value: totalSales ? `${Math.round((totalCollected / totalSales) * 100)}%` : '—' },
      ] as ChartSummary[],
    };
  });

  /** Parte-de-todo: hasta 6 segmentos; si hay más, los 5 principales y el resto en "Otros". */
  protected readonly serviceChart = computed(() => {
    const rows = [...(this.data()?.orders_by_service ?? [])].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
    const fold = rows.length > 6;
    const top = fold ? rows.slice(0, 5) : rows;
    const labels = top.map((r) => r.service);
    const values = top.map((r) => r.count);
    const colors = top.map((_, i) => CATEGORICAL[i] ?? OTHER);
    if (fold) {
      labels.push('Otros');
      values.push(sum(rows.slice(5).map((r) => r.count)));
      colors.push(OTHER);
    }
    return { labels, series: [{ label: 'Pedidos', values, color: colors }] as ChartSeries[] };
  });

  protected readonly stageChart = computed(() => {
    const rows = [...(this.data()?.production_by_stage ?? [])].sort((a, b) => a.position - b.position);
    const values = rows.map((r) => r.count);
    return {
      labels: rows.map((r) => r.stage),
      series: [{ label: 'Pedidos en la etapa', values, color: ordinal(rows.length) }] as ChartSeries[],
      summary: [{ label: 'En taller', value: integer(sum(values)) }] as ChartSummary[],
    };
  });

  protected readonly alertCount = computed(() => {
    const a = this.data()?.alerts;
    return a ? a.overdue.length + a.pending_quotations.length + a.pending_payments.length + a.upcoming.length : 0;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.service.load());
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el dashboard.');
    } finally {
      this.loading.set(false);
    }
  }

  protected daysLabel(iso: string): string {
    const d = daysUntil(iso) ?? 0;
    if (d < 0) return `atrasado ${-d} día(s)`;
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    return `en ${d} días`;
  }

  protected isLate(iso: string): boolean {
    return (daysUntil(iso) ?? 0) < 0;
  }
}
