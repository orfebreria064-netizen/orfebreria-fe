import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Cabecera de página: título, subtítulo, enlace "volver" y acciones proyectadas. */
@Component({
  selector: 'app-page-header',
  imports: [RouterLink],
  template: `
    <header class="page-header">
      <div class="page-header__text">
        @if (backLink()) {
          <a class="page-header__back" [routerLink]="backLink()"><i class="pi pi-arrow-left"></i> {{ backLabel() }}</a>
        }
        <h1>{{ title() }}</h1>
        @if (subtitle()) {
          <p>{{ subtitle() }}</p>
        }
        <ng-content select="[meta]" />
      </div>
      <div class="page-header__actions">
        <ng-content />
      </div>
    </header>
  `,
  styles: `
    .page-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 650;
      letter-spacing: -0.01em;
      color: var(--p-surface-900);
    }
    p {
      margin: 0.25rem 0 0;
      color: var(--p-surface-500);
    }
    .page-header__back {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
      color: var(--p-surface-500);
      text-decoration: none;
      margin-bottom: 0.35rem;
    }
    .page-header__back:hover {
      color: var(--p-primary-700);
    }
    .page-header__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    @media (max-width: 640px) {
      .page-header__actions {
        width: 100%;
      }
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly backLink = input<string | unknown[] | null>(null);
  readonly backLabel = input('Volver');
}
