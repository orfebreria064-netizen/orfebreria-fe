import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TimelineModule } from 'primeng/timeline';
import { HISTORY_EVENT_ICONS, HistoryEventType } from '../../../core/models/domain';
import { EmptyState } from '../empty-state/empty-state';

export interface HistoryItem {
  id: string;
  order_id: string;
  event_type: HistoryEventType;
  description: string;
  actor_name: string;
  created_at: string;
  order?: { number: string } | null;
}

/** Línea de tiempo de auditoría (order_history). */
@Component({
  selector: 'app-history-timeline',
  imports: [TimelineModule, DatePipe, RouterLink, EmptyState],
  template: `
    @if (items().length === 0) {
      <app-empty-state icon="pi pi-history" message="Sin movimientos registrados." />
    } @else {
      <p-timeline [value]="items()" align="left" styleClass="history">
        <ng-template #marker let-e>
          <span class="history__marker" [attr.data-type]="e.event_type"><i [class]="iconFor(e.event_type)"></i></span>
        </ng-template>
        <ng-template #content let-e>
          <div class="history__item">
            <p>{{ e.description }}</p>
            <small>
              {{ e.created_at | date: 'dd/MM/yyyy HH:mm' }}
              @if (showOrder() && e.order) {
                · <a class="link" [routerLink]="['/orders', e.order_id]">{{ e.order.number }}</a>
              }
            </small>
          </div>
        </ng-template>
      </p-timeline>
    }
  `,
  styles: `
    :host ::ng-deep .history .p-timeline-event-opposite {
      display: none;
    }
    .history__marker {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      background: var(--p-surface-100);
      color: var(--p-surface-600);
      font-size: 0.85rem;
    }
    .history__marker[data-type='PAGO'] {
      background: var(--p-green-100);
      color: var(--p-green-700);
    }
    .history__marker[data-type='ESTADO'],
    .history__marker[data-type='CIERRE'] {
      background: var(--p-primary-100);
      color: var(--p-primary-700);
    }
    .history__marker[data-type='ENTREGA'] {
      background: var(--p-sky-100);
      color: var(--p-sky-700);
    }
    .history__marker[data-type='PRODUCCION'] {
      background: var(--p-orange-100);
      color: var(--p-orange-700);
    }
    .history__item {
      padding-bottom: 1rem;
    }
    .history__item p {
      margin: 0.3rem 0 0.15rem;
    }
    .history__item small {
      color: var(--p-surface-500);
    }
  `,
})
export class HistoryTimeline {
  readonly items = input.required<HistoryItem[]>();
  readonly showOrder = input(false);
  protected iconFor(type: string): string {
    return HISTORY_EVENT_ICONS[type as HistoryEventType] ?? 'pi pi-circle';
  }
}
