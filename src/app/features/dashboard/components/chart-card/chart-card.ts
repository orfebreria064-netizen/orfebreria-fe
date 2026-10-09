import { Component, computed, input, signal } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { ButtonModule } from 'primeng/button';
import type { ChartData, ChartOptions } from 'chart.js';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';

export interface ChartSeries {
  label: string;
  values: number[];
  color: string;
}

/** Ink tokens: el texto nunca usa el color de la serie. */
const INK = { text: '#4a4741', muted: '#7b776f', grid: '#ebe9e5' };

/**
 * Tarjeta de gráfico de barras (Chart.js vía PrimeNG) con vista de tabla accesible.
 * Barras finas con extremos redondeados de 4px, separación entre barras, una sola escala,
 * leyenda solo con 2+ series y tooltip por barra.
 */
@Component({
  selector: 'app-chart-card',
  imports: [ChartModule, ButtonModule, EmptyState],
  template: `
    <section class="card chart-card">
      <header class="card__title">
        <span>{{ title() }}</span>
        @if (hasData()) {
          <p-button
            [icon]="showTable() ? 'pi pi-chart-bar' : 'pi pi-table'"
            [text]="true"
            size="small"
            severity="secondary"
            [ariaLabel]="showTable() ? 'Ver gráfico' : 'Ver tabla'"
            (onClick)="showTable.set(!showTable())"
          />
        }
      </header>
      @if (!hasData()) {
        <app-empty-state icon="pi pi-chart-bar" message="Sin datos para mostrar." />
      } @else if (showTable()) {
        <table class="chart-table">
          <thead>
            <tr>
              <th></th>
              @for (s of series(); track s.label) {
                <th class="text-right">{{ s.label }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (l of labels(); track $index; let i = $index) {
              <tr>
                <td>{{ l }}</td>
                @for (s of series(); track s.label) {
                  <td class="text-right mono">{{ format()(s.values[i]) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <div class="chart-card__plot" [style.height]="height()">
          <p-chart type="bar" [data]="data()" [options]="options()" height="100%" />
        </div>
      }
    </section>
  `,
  styles: `
    .chart-card {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .chart-card__plot {
      position: relative;
      min-height: 220px;
    }
    .chart-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .chart-table th,
    .chart-table td {
      padding: 0.35rem 0.5rem;
      border-bottom: 1px solid var(--p-surface-100);
    }
    .chart-table th {
      color: var(--p-surface-500);
      font-weight: 500;
    }
  `,
})
export class ChartCard {
  readonly title = input.required<string>();
  readonly labels = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly horizontal = input(false);
  readonly height = input('260px');
  readonly format = input<(v: number) => string>((v) => String(v));

  protected readonly showTable = signal(false);
  protected readonly hasData = computed(() => this.series().some((s) => s.values.some((v) => Number(v) > 0)));

  protected readonly data = computed<ChartData<'bar'>>(() => ({
    labels: this.labels(),
    datasets: this.series().map((s) => ({
      label: s.label,
      data: s.values,
      backgroundColor: s.color,
      hoverBackgroundColor: s.color,
      borderRadius: 4,
      borderSkipped: 'start',
      borderColor: '#ffffff',
      borderWidth: this.series().length > 1 ? 2 : 0,
      maxBarThickness: 22,
      categoryPercentage: 0.7,
      barPercentage: 0.85,
    })),
  }));

  protected readonly options = computed<ChartOptions<'bar'>>(() => {
    const horizontal = this.horizontal();
    const format = this.format();
    const valueAxis = {
      beginAtZero: true,
      grid: { color: INK.grid },
      border: { display: false },
      ticks: { color: INK.muted, font: { size: 11 }, precision: 0, callback: (v: string | number) => format(Number(v)) },
    };
    const categoryAxis = {
      grid: { display: false },
      border: { color: INK.grid },
      ticks: { color: INK.text, font: { size: 11 } },
    };
    return {
      indexAxis: horizontal ? 'y' : 'x',
      maintainAspectRatio: false,
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: this.series().length > 1,
          position: 'top',
          align: 'end',
          labels: { color: INK.text, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 },
        },
        tooltip: {
          backgroundColor: '#1f2430',
          padding: 10,
          cornerRadius: 6,
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${format(Number(ctx.raw))}` },
        },
      },
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
    };
  });
}
