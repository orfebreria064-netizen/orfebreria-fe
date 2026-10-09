import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_SEVERITY, OWNERSHIP_LABELS } from '../../../../core/models/domain';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { QtyPipe } from '../../../../shared/pipes/qty.pipe';
import { MaterialMovement } from '../../models/material.model';

/** Tabla de movimientos (kardex). Reutilizada en materiales y en la ficha del pedido. */
@Component({
  selector: 'app-movements-table',
  imports: [DatePipe, RouterLink, TableModule, TagModule, EmptyState, StatusTag, LabelPipe, QtyPipe],
  template: `
    <p-table [value]="movements()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '820px' }" [paginator]="movements().length > 20" [rows]="20" size="small">
      <ng-template #header>
        <tr>
          <th>Fecha</th>
          @if (showMaterial()) {
            <th>Material</th>
          }
          <th>Movimiento</th>
          <th>Origen</th>
          @if (showOrder()) {
            <th>Pedido</th>
          }
          <th class="text-right">Cantidad</th>
          @if (showStock()) {
            <th class="text-right">Stock después</th>
          }
          <th>Observaciones</th>
          <th>Registró</th>
        </tr>
      </ng-template>
      <ng-template #body let-m>
        <tr>
          <td class="nowrap">{{ m.movement_date | date: 'dd/MM/yyyy' }}</td>
          @if (showMaterial()) {
            <td class="nowrap"><a class="link" [routerLink]="['/materials', m.material_id]">{{ m.material?.name }}</a></td>
          }
          <td class="nowrap"><app-status-tag [value]="m.movement_type" [labels]="typeLabels" [severities]="typeSeverity" /></td>
          <td>
            <p-tag [value]="m.ownership | label: ownershipLabels" [severity]="m.ownership === 'CLIENTE' ? 'info' : 'secondary'" />
          </td>
          @if (showOrder()) {
            <td class="nowrap">
              @if (m.order) {
                <a class="link" [routerLink]="['/orders', m.order.id]">{{ m.order.number }}</a>
              } @else {
                —
              }
            </td>
          }
          <td class="text-right mono nowrap" [class.text-danger]="isOut(m)" [class.text-success]="!isOut(m)">
            {{ isOut(m) ? '−' : '+' }}{{ abs(m.quantity) | qty: m.material?.unit }}
          </td>
          @if (showStock()) {
            <td class="text-right mono nowrap">{{ m.stock_after !== null ? (m.stock_after | qty: m.material?.unit) : '—' }}</td>
          }
          <td>{{ m.notes || '—' }}</td>
          <td class="nowrap small muted">{{ m.creator?.full_name ?? 'Sistema' }}</td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr><td colspan="9"><app-empty-state icon="pi pi-box" message="Sin movimientos registrados." /></td></tr>
      </ng-template>
    </p-table>
  `,
})
export class MovementsTable {
  readonly movements = input.required<MaterialMovement[]>();
  readonly loading = input(false);
  readonly showMaterial = input(true);
  readonly showOrder = input(true);
  readonly showStock = input(true);

  protected readonly typeLabels = MOVEMENT_TYPE_LABELS;
  protected readonly typeSeverity = MOVEMENT_TYPE_SEVERITY;
  protected readonly ownershipLabels = OWNERSHIP_LABELS;

  /** Salida desde el punto de vista del origen del material. */
  protected isOut(m: MaterialMovement): boolean {
    if (m.movement_type === 'AJUSTE') return Number(m.quantity) < 0;
    if (m.ownership === 'CLIENTE') return m.movement_type !== 'ENTRADA';
    return m.movement_type === 'SALIDA' || m.movement_type === 'CONSUMO';
  }

  protected abs(n: number): number {
    return Math.abs(Number(n));
  }
}
