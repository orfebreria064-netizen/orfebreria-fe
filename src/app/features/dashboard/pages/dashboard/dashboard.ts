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
import { ChartCard, ChartSeries } from '../../components/chart-card/chart-card';
import { DashboardData, DashboardService } from '../../services/dashboard.service';

/** Paleta categórica validada (CVD y contraste) — ver skill dataviz / docs. */
const SERIES = { primary: '#2a78d6', secondary: '#eb6834' };
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
  protected readonly compactMoney = compactMoney;
  protected readonly integer = integer;
  protected readonly today = new Date();

  protected readonly statusChart = computed(() => {
    const rows = this.data()?.orders_by_status ?? [];
    return {
      labels: rows.map((r) => ORDER_STATUS_LABELS[r.status] ?? r.status),
      series: [{ label: 'Pedidos', values: rows.map((r) => r.count), color: SERIES.primary }] as ChartSeries[],
    };
  });

  protected readonly salesChart = computed(() => {
    const rows = this.data()?.sales_by_month ?? [];
    return {
      labels: rows.map((r) => {
        const [y, m] = r.month.split('-').map(Number);
        return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
      }),
      series: [
        { label: 'Ventas', values: rows.map((r) => Number(r.sales)), color: SERIES.primary },
        { label: 'Cobrado', values: rows.map((r) => Number(r.collected)), color: SERIES.secondary },
      ] as ChartSeries[],
    };
  });

  protected readonly serviceChart = computed(() => {
    const rows = this.data()?.orders_by_service ?? [];
    return {
      labels: rows.map((r) => r.service),
      series: [{ label: 'Pedidos', values: rows.map((r) => r.count), color: SERIES.primary }] as ChartSeries[],
    };
  });

  protected readonly stageChart = computed(() => {
    const rows = this.data()?.production_by_stage ?? [];
    return {
      labels: rows.map((r) => r.stage),
      series: [{ label: 'Pedidos en la etapa', values: rows.map((r) => r.count), color: SERIES.primary }] as ChartSeries[],
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
