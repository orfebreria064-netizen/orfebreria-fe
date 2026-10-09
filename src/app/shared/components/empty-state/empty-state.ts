import { Component, input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  template: `
    <div class="empty">
      <i [class]="icon()"></i>
      <p>{{ message() }}</p>
      <ng-content />
    </div>
  `,
  styles: `
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2rem 1rem;
      color: var(--p-surface-500);
      text-align: center;
    }
    i {
      font-size: 1.75rem;
      color: var(--p-surface-400);
    }
    p {
      margin: 0;
    }
  `,
})
export class EmptyState {
  readonly icon = input('pi pi-inbox');
  readonly message = input('No hay registros para mostrar.');
}
