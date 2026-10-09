import { Component, input, model, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_SEVERITY } from '../../../../core/models/domain';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { Delivery } from '../../models/delivery.model';
import { DeliveryDialog } from '../delivery-dialog/delivery-dialog';

/** Entregas del pedido (dentro del Resumen). */
@Component({
  selector: 'app-order-deliveries',
  imports: [DatePipe, ButtonModule, TableModule, TagModule, StatusTag, DeliveryDialog],
  template: `
    <h3 class="section-title row row--between">
      Entregas
      @if (canManage() && !readonly()) {
        <p-button label="Registrar entrega" icon="pi pi-truck" size="small" [text]="true" (onClick)="openNew()" />
      }
    </h3>
    @if (deliveries().length === 0) {
      <p class="muted small">Sin entregas programadas.</p>
    } @else {
      <p-table [value]="deliveries()" [scrollable]="true" [tableStyle]="{ 'min-width': '640px' }" size="small">
        <ng-template #header>
          <tr><th>Número</th><th>Programada</th><th>Real</th><th>Estado</th><th>Recibió</th><th>Conformidad</th><th></th></tr>
        </ng-template>
        <ng-template #body let-d>
          <tr>
            <td class="strong nowrap">{{ d.number }}</td>
            <td class="nowrap">{{ d.scheduled_date | date: 'dd/MM/yyyy' }}</td>
            <td class="nowrap">{{ d.delivered_at ? (d.delivered_at | date: 'dd/MM/yyyy HH:mm') : '—' }}</td>
            <td><app-status-tag [value]="d.status" [labels]="labels" [severities]="severities" /></td>
            <td>{{ d.received_by || '—' }}</td>
            <td>
              @if (d.conformity === true) {
                <p-tag value="Conforme" severity="success" />
              } @else if (d.conformity === false) {
                <p-tag value="No conforme" severity="danger" />
              } @else {
                —
              }
              @if (d.signature_path) {
                <i class="pi pi-pen-to-square muted" title="Con firma" style="margin-left: 0.35rem"></i>
              }
            </td>
            <td class="text-right">
              @if (canManage() && !readonly()) {
                <p-button icon="pi pi-pencil" [text]="true" size="small" severity="secondary" ariaLabel="Editar entrega" (onClick)="edit(d)" />
              }
            </td>
          </tr>
        </ng-template>
      </p-table>
    }

    <app-delivery-dialog [(visible)]="dialog" [orderId]="orderId()" [delivery]="editing()" [markDelivered]="markDelivered()" (saved)="onSaved()" />
  `,
})
export class OrderDeliveries {
  readonly orderId = input.required<string>();
  readonly deliveries = input.required<Delivery[]>();
  readonly canManage = input(false);
  readonly readonly = input(false);
  /** Si el pedido está listo, la nueva entrega se abre como "entregada". */
  readonly readyToDeliver = input(false);
  readonly dialog = model(false);
  readonly changed = output<void>();

  protected readonly labels = DELIVERY_STATUS_LABELS;
  protected readonly severities = DELIVERY_STATUS_SEVERITY;
  protected readonly editing = signal<Delivery | null>(null);
  protected readonly markDelivered = signal(false);

  openNew(): void {
    const pending = this.deliveries().find((d) => d.status === 'PENDIENTE' || d.status === 'LISTA');
    this.editing.set(pending ?? null);
    this.markDelivered.set(this.readyToDeliver());
    this.dialog.set(true);
  }

  protected edit(d: Delivery): void {
    this.editing.set(d);
    this.markDelivered.set(false);
    this.dialog.set(true);
  }

  protected onSaved(): void {
    this.changed.emit();
  }
}
