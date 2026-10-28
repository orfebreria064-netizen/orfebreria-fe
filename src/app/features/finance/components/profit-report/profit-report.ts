import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { PAYMENT_METHOD_LABELS } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { EXPENSE_CATEGORY_LABELS, FinanceService, ProfitReport } from '../../services/finance.service';

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/**
 * Estado de resultados del mes por caja: cobros recibidos – pagos a joyeros – gastos.
 * Compara con el mes anterior. Montos en soles (los de US$ convertidos al TC de venta del día).
 */
@Component({
  selector: 'app-profit-report',
  imports: [DecimalPipe, ButtonModule, SkeletonModule, StatCard, LabelPipe, MoneyPipe],
  template: `
    <div class="month-nav">
      <p-button icon="pi pi-chevron-left" [text]="true" severity="secondary" ariaLabel="Mes anterior" (onClick)="move(-1)" />
      <h2>{{ monthLabel() }}</h2>
      <p-button icon="pi pi-chevron-right" [text]="true" severity="secondary" ariaLabel="Mes siguiente" [disabled]="isCurrentMonth()" (onClick)="move(1)" />
      <span class="muted small">Por caja: cobros recibidos en el mes. Montos en US$ convertidos al TC de venta de cada día.</span>
    </div>

    @if (!report()) {
      <div class="kpis"><p-skeleton height="5.2rem" /><p-skeleton height="5.2rem" /><p-skeleton height="5.2rem" /><p-skeleton height="5.2rem" /></div>
    } @else {
      @let r = report()!;
      <div class="kpis">
        <app-stat-card label="Cobros del mes" [value]="money(r.income)" icon="pi pi-arrow-down-left" tone="blue" [hint]="delta('income')" />
        <app-stat-card label="Pagos a joyeros" [value]="money(r.labor)" icon="pi pi-id-card" tone="orange" [hint]="delta('labor')" />
        <app-stat-card label="Gastos" [value]="money(r.expenses)" icon="pi pi-receipt" tone="ink" [hint]="delta('expenses')" />
        <app-stat-card
          label="Utilidad neta"
          [value]="money(r.net_profit)"
          icon="pi pi-chart-line"
          [tone]="r.net_profit >= 0 ? 'green' : 'red'"
          [hint]="(r.margin != null ? 'Margen ' + r.margin + '% · ' : '') + delta('net_profit')"
        />
      </div>

      <div class="grid-cols" style="margin-top: 1rem">
        <section class="card">
          <h3 class="card__title">Estado de resultados</h3>
          <table class="pl">
            <tbody>
              <tr class="pl__group"><td>Cobros recibidos</td><td class="mono">{{ r.income | money }}</td></tr>
              @for (m of r.income_by_method; track m.method) {
                <tr class="pl__sub"><td>{{ m.method | label: methodLabels }}</td><td class="mono">{{ m.amount | money }}</td></tr>
              }
              @if (r.income_usd) {
                <tr class="pl__sub"><td colspan="2" class="muted">Incluye {{ r.income_usd | money: 'USD' }} cobrados en dólares</td></tr>
              }
              <tr class="pl__group"><td>(–) Mano de obra (pagos a joyeros)</td><td class="mono">{{ -r.labor | money }}</td></tr>
              <tr class="pl__total"><td>Utilidad bruta</td><td class="mono">{{ r.gross_profit | money }}</td></tr>
              <tr class="pl__group"><td>(–) Gastos operativos</td><td class="mono">{{ -r.expenses | money }}</td></tr>
              @for (c of r.expenses_by_category; track c.category) {
                <tr class="pl__sub"><td>{{ c.category | label: categoryLabels }} <span class="muted">({{ c.count }})</span></td><td class="mono">{{ -c.amount | money }}</td></tr>
              }
              <tr class="pl__total pl__net" [class.text-danger]="r.net_profit < 0">
                <td>Utilidad neta</td><td class="mono">{{ r.net_profit | money }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h3 class="card__title">Gastos por categoría</h3>
          @if (!r.expenses_by_category.length) {
            <p class="muted small">No hay gastos registrados en el mes.</p>
          }
          @for (c of r.expenses_by_category; track c.category) {
            <div class="bar">
              <div class="row row--between small">
                <span>{{ c.category | label: categoryLabels }}</span>
                <span class="mono">{{ c.amount | money }} · {{ (c.amount / r.expenses) * 100 | number: '1.0-0' }}%</span>
              </div>
              <div class="bar__track"><div class="bar__fill" [style.width.%]="(c.amount / maxCategory()) * 100"></div></div>
            </div>
          }

          <h3 class="card__title" style="margin-top: 1.25rem">Préstamos (no afectan la utilidad)</h3>
          <dl class="dl">
            <dt>Prestado en el mes</dt><dd class="mono">{{ r.loans_given | money }}</dd>
            <dt>Abonos recibidos</dt><dd class="mono">{{ r.loans_repaid | money }}</dd>
            @if (r.exchange_rate) {
              <dt>TC venta al cierre</dt><dd class="mono">{{ r.exchange_rate | number: '1.3-3' }}</dd>
            }
          </dl>
        </section>
      </div>
    }
  `,
  styles: `
    .month-nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem 0.5rem;
      margin-bottom: 1rem;
    }
    .month-nav h2 {
      margin: 0;
      font-size: 1.1rem;
      min-width: 10rem;
      text-align: center;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: var(--app-gap);
    }
    .pl {
      width: 100%;
      border-collapse: collapse;
    }
    .pl td {
      padding: 0.4rem 0.25rem;
      border-bottom: 1px solid var(--p-surface-100);
    }
    .pl td:last-child {
      text-align: right;
      white-space: nowrap;
    }
    .pl__group td {
      font-weight: 600;
    }
    .pl__sub td {
      padding-left: 1.25rem;
      font-size: 0.85rem;
      color: var(--p-surface-600);
    }
    .pl__total td {
      font-weight: 700;
      border-top: 2px solid var(--p-surface-300);
    }
    .pl__net td {
      font-size: 1.05rem;
    }
    .bar {
      margin-bottom: 0.6rem;
    }
    .bar__track {
      height: 0.45rem;
      margin-top: 0.2rem;
      border-radius: 1rem;
      background: var(--p-surface-100);
    }
    .bar__fill {
      height: 100%;
      border-radius: 1rem;
      background: #2a78d6;
    }
  `,
})
export class ProfitReportView implements OnInit {
  private readonly service = inject(FinanceService);
  private readonly notify = inject(NotifyService);

  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly categoryLabels = EXPENSE_CATEGORY_LABELS;
  protected readonly money = formatMoney;

  protected readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected readonly report = signal<ProfitReport | null>(null);
  private readonly previous = signal<ProfitReport | null>(null);

  protected readonly monthLabel = computed(() => `${MONTH_NAMES[this.month().getMonth()]} ${this.month().getFullYear()}`);
  protected readonly isCurrentMonth = computed(() => {
    const now = new Date();
    return this.month().getFullYear() === now.getFullYear() && this.month().getMonth() === now.getMonth();
  });
  protected readonly maxCategory = computed(() => Math.max(1, ...(this.report()?.expenses_by_category ?? []).map((c) => Number(c.amount))));

  ngOnInit(): void {
    void this.load();
  }

  protected move(delta: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
    void this.load();
  }

  /** Variación respecto del mes anterior. */
  protected delta(key: 'income' | 'labor' | 'expenses' | 'net_profit'): string {
    const prev = this.previous();
    const cur = this.report();
    if (!prev || !cur) return '';
    const diff = Number(cur[key]) - Number(prev[key]);
    return `${diff >= 0 ? '+' : ''}${formatMoney(diff)} vs. mes anterior`;
  }

  private async load(): Promise<void> {
    const m = this.month();
    const prev = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    this.report.set(null);
    try {
      const [cur, before] = await Promise.all([
        this.service.profit(m.getFullYear(), m.getMonth() + 1),
        this.service.profit(prev.getFullYear(), prev.getMonth() + 1),
      ]);
      this.previous.set(before);
      this.report.set(cur);
    } catch (err) {
      this.notify.error(err, 'No se pudo calcular la utilidad del mes.');
    }
  }
}
