import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export type StatTone = 'gold' | 'ink' | 'green' | 'red' | 'blue' | 'orange';

/** Tarjeta KPI: etiqueta, valor destacado, icono y nota opcional. */
@Component({
  selector: 'app-stat-card',
  imports: [RouterLink],
  template: `
    <a class="stat" [class]="'stat stat--' + tone()" [routerLink]="link()" [queryParams]="queryParams()" [class.stat--static]="!link()">
      <span class="stat__icon"><i [class]="icon()"></i></span>
      <span class="stat__body">
        <span class="stat__label">{{ label() }}</span>
        <span class="stat__value" [title]="value()">{{ value() }}</span>
        @if (hint()) {
          <span class="stat__hint">{{ hint() }}</span>
        }
      </span>
    </a>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .stat {
      display: flex;
      align-items: center;
      gap: 0.9rem;
      height: 100%;
      padding: 1rem 1.1rem;
      background: var(--p-surface-0);
      border: 1px solid var(--p-surface-200);
      border-radius: var(--app-radius);
      color: inherit;
      text-decoration: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .stat:not(.stat--static):hover {
      border-color: var(--p-primary-300);
      box-shadow: 0 4px 14px rgba(31, 36, 48, 0.06);
    }
    .stat--static {
      pointer-events: none;
    }
    .stat__icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 2.6rem;
      height: 2.6rem;
      border-radius: 0.65rem;
      font-size: 1.1rem;
    }
    .stat__body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      container-type: inline-size;
    }
    .stat__label {
      font-size: 0.8rem;
      color: var(--p-surface-500);
    }
    .stat__value {
      /* Se reduce con el ancho de la tarjeta para que montos y códigos largos no se corten. */
      font-size: clamp(1rem, 11cqi, 1.35rem);
      line-height: 1.25;
      font-weight: 650;
      color: var(--p-surface-900);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .stat__hint {
      font-size: 0.75rem;
      color: var(--p-surface-500);
    }
    .stat--gold .stat__icon {
      background: var(--p-primary-100);
      color: var(--p-primary-700);
    }
    .stat--ink .stat__icon {
      background: #e4e6eb;
      color: #1f2430;
    }
    .stat--green .stat__icon {
      background: var(--p-green-100);
      color: var(--p-green-700);
    }
    .stat--red .stat__icon {
      background: var(--p-red-100);
      color: var(--p-red-700);
    }
    .stat--blue .stat__icon {
      background: var(--p-sky-100);
      color: var(--p-sky-700);
    }
    .stat--orange .stat__icon {
      background: var(--p-orange-100);
      color: var(--p-orange-700);
    }
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly icon = input('pi pi-chart-line');
  readonly tone = input<StatTone>('gold');
  readonly hint = input<string | null>(null);
  readonly link = input<string | unknown[] | null>(null);
  readonly queryParams = input<Record<string, string> | null>(null);
}
