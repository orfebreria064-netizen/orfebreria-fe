import { Component, computed, input, signal } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { ButtonModule } from 'primeng/button';
import type { Chart, ChartData, ChartOptions, Plugin } from 'chart.js';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';

export interface ChartSeries {
  label: string;
  values: number[];
  /** Un color por serie, o uno por barra (p. ej. rampa ordinal de etapas). */
  color: string | string[];
}

/** Cifra resumen en la cabecera; `color` dibuja la muestra de la serie (identidad) junto al texto. */
export interface ChartSummary {
  label: string;
  value: string;
  color?: string;
}

export type ChartKind = 'bar' | 'area' | 'doughnut';

/** Ink tokens: el texto nunca usa el color de la serie. */
const INK = { text: '#4a4741', strong: '#1f1d1a', muted: '#7b776f', grid: '#ebe9e5', surface: '#ffffff' };
/** Tipografía del gráfico (px), alineada con la escala base del 85%. */
const FONT = { tick: 9.5, legend: 10, tooltip: 10.5, value: 10 };

/** Etiquetas de valor al extremo de cada barra (sustituyen al eje de valores). */
const valueLabels = (format: () => (v: number) => string, horizontal: () => boolean): Plugin<'bar'> => ({
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = `600 ${FONT.value}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = INK.strong;
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((bar, i) => {
        const v = Number(ds.data[i]);
        if (!v) return;
        const { x, y } = bar.getProps(['x', 'y'], true);
        if (horizontal()) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(format()(v), x + 6, y);
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(format()(v), x, y - 4);
        }
      });
    });
    ctx.restore();
  },
});

/** Línea vertical guía bajo el tooltip en gráficos de área. */
const crosshair: Plugin<'line'> = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements() ?? [];
    if (!active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = '#c3c2b7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/** Total en el centro de la dona. */
const centerTotal = (format: () => (v: number) => string, caption: () => string): Plugin<'doughnut'> => ({
  id: 'centerTotal',
  afterDraw(chart: Chart<'doughnut'>) {
    const meta = chart.getDatasetMeta(0);
    const arc = meta.data[0] as unknown as { x: number; y: number } | undefined;
    if (!arc) return;
    const total = (chart.data.datasets[0]?.data ?? []).reduce((a, b) => a + Number(b), 0);
    const { ctx } = chart;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK.strong;
    ctx.font = `650 20px Inter, system-ui, sans-serif`;
    ctx.fillText(format()(total), arc.x, arc.y - 6);
    ctx.fillStyle = INK.muted;
    ctx.font = `${FONT.legend}px Inter, system-ui, sans-serif`;
    ctx.fillText(caption(), arc.x, arc.y + 13);
    ctx.restore();
  },
});

/** Color con opacidad (#rrggbb + alfa) para el lavado del área (~10%). */
const wash = (hex: string, alpha = 0.1) =>
  hex + Math.round(alpha * 255).toString(16).padStart(2, '0');

const first = (c: string | string[]) => (Array.isArray(c) ? c[0] : c);

/**
 * Tarjeta de gráfico (Chart.js vía PrimeNG) con vista de tabla accesible y cifras resumen.
 * - bar: barras finas con extremos redondeados; con `valueLabels` el valor va al extremo y se oculta el eje.
 * - area: línea de 2px con lavado al 10%, guía vertical y tooltip por índice.
 * - doughnut: parte-de-todo (≤6 segmentos), total al centro y leyenda con cantidad y porcentaje.
 */
@Component({
  selector: 'app-chart-card',
  imports: [ChartModule, ButtonModule, EmptyState],
  template: `
    <section class="card chart-card">
      <header class="chart-card__head">
        <h2 class="chart-card__title">{{ title() }}</h2>
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
      @if (hasData() && summary().length) {
        <dl class="chart-card__summary">
          @for (s of summary(); track s.label) {
            <div>
              <dt>
                @if (s.color) {
                  <span class="swatch" [class.swatch--line]="kind() === 'area'" [style.background]="s.color"></span>
                }
                {{ s.label }}
              </dt>
              <dd>{{ s.value }}</dd>
            </div>
          }
        </dl>
      }
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
              @if (kind() === 'doughnut') {
                <th class="text-right">%</th>
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
                @if (kind() === 'doughnut') {
                  <td class="text-right mono">{{ legend()[i].pct }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      } @else if (kind() === 'doughnut') {
        <div class="donut">
          <div class="donut__plot">
            <p-chart type="doughnut" [data]="data()" [options]="options()" [plugins]="plugins()" height="100%" />
          </div>
          <ul class="donut__legend">
            @for (item of legend(); track item.label) {
              <li>
                <span class="swatch" [style.background]="item.color"></span>
                <span class="donut__label">{{ item.label }}</span>
                <span class="mono">{{ item.value }}</span>
                <span class="mono muted">{{ item.pct }}</span>
              </li>
            }
          </ul>
        </div>
      } @else {
        <div class="chart-card__plot" [style.min-height]="height()">
          <p-chart [type]="kind() === 'area' ? 'line' : 'bar'" [data]="data()" [options]="options()" [plugins]="plugins()" height="100%" />
        </div>
      }
    </section>
  `,
  styles: `
    .chart-card {
      height: 100%;
      display: flex;
      flex-direction: column;
      container-type: inline-size;
    }
    .chart-card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .chart-card__title {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .chart-card__summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 1.75rem;
      margin: 0 0 0.9rem;
    }
    .chart-card__summary dt {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: var(--p-surface-500);
    }
    .chart-card__summary dd {
      margin: 0.1rem 0 0;
      font-size: 1.15rem;
      font-weight: 650;
      color: var(--p-surface-900);
    }
    .swatch {
      flex: none;
      width: 9px;
      height: 9px;
      border-radius: 2px;
    }
    .swatch--line {
      width: 12px;
      height: 3px;
      border-radius: 2px;
    }
    /* Ocupa el alto disponible de la tarjeta (p. ej. junto a Alertas) sin dejar huecos. */
    .chart-card__plot {
      position: relative;
      flex: 1;
      min-height: 187px;
    }
    .donut {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }
    .donut__plot {
      position: relative;
      flex: none;
      width: 170px;
      height: 170px;
    }
    .donut__legend {
      flex: 1;
      min-width: 0;
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 0.85rem;
    }
    .donut__legend li {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto 3.2rem;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0;
      border-bottom: 1px solid var(--p-surface-100);
    }
    .donut__legend li:last-child {
      border-bottom: 0;
    }
    .donut__legend .mono {
      text-align: right;
    }
    .donut__label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--p-surface-700);
    }
    /* En columnas angostas (p. ej. fila de tres) la leyenda va debajo de la dona. */
    @container (max-width: 440px) {
      .donut {
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
      }
      .donut__plot {
        align-self: center;
        width: 150px;
        height: 150px;
      }
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
  readonly kind = input<ChartKind>('bar');
  readonly horizontal = input(false);
  /** Valor al extremo de cada barra en lugar del eje de valores. */
  readonly valueLabels = input(false);
  readonly summary = input<ChartSummary[]>([]);
  /** Leyenda bajo el total de la dona. */
  readonly totalCaption = input('total');
  readonly height = input('220px');
  readonly format = input<(v: number) => string>((v) => String(v));

  protected readonly showTable = signal(false);
  protected readonly hasData = computed(() => this.series().some((s) => s.values.some((v) => Number(v) > 0)));

  protected readonly legend = computed(() => {
    const s = this.series()[0];
    if (!s) return [];
    const total = s.values.reduce((a, b) => a + Number(b), 0) || 1;
    return this.labels().map((label, i) => ({
      label,
      color: Array.isArray(s.color) ? s.color[i] : s.color,
      value: this.format()(s.values[i]),
      pct: `${Math.round((Number(s.values[i]) / total) * 100)}%`,
    }));
  });

  protected readonly plugins = computed<Plugin[]>(() => {
    const format = () => this.format();
    switch (this.kind()) {
      case 'area':
        return [crosshair as Plugin];
      case 'doughnut':
        return [centerTotal(format, () => this.totalCaption()) as Plugin];
      default:
        return this.valueLabels() ? [valueLabels(format, () => this.horizontal()) as Plugin] : [];
    }
  });

  protected readonly data = computed<ChartData>(() => {
    const kind = this.kind();
    const series = this.series();
    if (kind === 'doughnut') {
      const s = series[0];
      return {
        labels: this.labels(),
        datasets: [
          {
            label: s.label,
            data: s.values,
            backgroundColor: s.color,
            hoverBackgroundColor: s.color,
            // Separación de 2px con el color de la superficie entre segmentos.
            borderColor: INK.surface,
            borderWidth: 2,
            hoverOffset: 4,
            borderRadius: 3,
          },
        ],
      } as ChartData<'doughnut'>;
    }
    if (kind === 'area') {
      return {
        labels: this.labels(),
        datasets: series.map((s) => {
          const c = first(s.color);
          return {
            label: s.label,
            data: s.values,
            borderColor: c,
            backgroundColor: wash(c),
            fill: 'origin',
            borderWidth: 2,
            tension: 0.35,
            cubicInterpolationMode: 'monotone',
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 12,
            pointBackgroundColor: c,
            // Anillo de superficie alrededor del punto activo.
            pointHoverBorderColor: INK.surface,
            pointHoverBorderWidth: 2,
          };
        }),
      } as ChartData<'line'>;
    }
    return {
      labels: this.labels(),
      datasets: series.map((s) => ({
        label: s.label,
        data: s.values,
        backgroundColor: s.color,
        hoverBackgroundColor: s.color,
        borderRadius: 4,
        borderSkipped: 'start',
        // Sin borde: un borde blanco se come el relleno de las barras estrechas.
        // La separación entre series la da barPercentage.
        borderWidth: 0,
        maxBarThickness: 19,
        categoryPercentage: 0.7,
        barPercentage: series.length > 1 ? 0.78 : 0.85,
      })),
    } as ChartData<'bar'>;
  });

  protected readonly options = computed<ChartOptions>(() => {
    const kind = this.kind();
    const horizontal = this.horizontal();
    const valueLabels = this.valueLabels();
    const format = this.format();
    const tooltip = {
      backgroundColor: '#1f2430',
      padding: 8,
      cornerRadius: 6,
      boxPadding: 4,
      usePointStyle: true,
      titleFont: { size: FONT.tooltip },
      bodyFont: { size: FONT.tooltip },
      callbacks: {
        label: (ctx: { dataset: { label?: string }; raw: unknown; label: string }) =>
          kind === 'doughnut' ? ` ${ctx.label}: ${format(Number(ctx.raw))}` : ` ${ctx.dataset.label}: ${format(Number(ctx.raw))}`,
      },
    };

    if (kind === 'doughnut') {
      return {
        maintainAspectRatio: false,
        responsive: true,
        cutout: '70%',
        animation: false,
        plugins: { legend: { display: false }, tooltip },
      } as ChartOptions<'doughnut'>;
    }

    const valueAxis = {
      display: !valueLabels,
      beginAtZero: true,
      grace: valueLabels ? '15%' : 0,
      grid: { color: INK.grid },
      border: { display: false },
      ticks: { color: INK.muted, font: { size: FONT.tick }, precision: 0, maxTicksLimit: 5, callback: (v: string | number) => format(Number(v)) },
    };
    const categoryAxis = {
      grid: { display: false },
      border: { color: INK.grid },
      ticks: { color: INK.text, font: { size: FONT.tick } },
    };
    // Con resumen (que lleva las muestras de color) la leyenda de Chart.js sobra.
    const showLegend = this.series().length > 1 && !this.summary().some((s) => s.color);
    return {
      indexAxis: horizontal ? 'y' : 'x',
      maintainAspectRatio: false,
      responsive: true,
      // Sin animación: la animación inicial quedaba a medias (barras amontonadas o invisibles)
      // y en un tablero de gestión la lectura inmediata es preferible.
      animation: false,
      layout: { padding: valueLabels ? (horizontal ? { right: 8 } : { top: 4 }) : 0 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: showLegend,
          position: 'top',
          align: 'end',
          labels: { color: INK.text, font: { size: FONT.legend }, boxWidth: 9, boxHeight: 9, useBorderRadius: true, borderRadius: 2 },
        },
        tooltip,
      },
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
    } as ChartOptions;
  });
}
