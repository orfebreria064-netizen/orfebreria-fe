import { Component, OnInit, inject, input, model, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { NotifyService } from '../../../../core/services/notify.service';
import { QtyPipe } from '../../../../shared/pipes/qty.pipe';
import { ClientMaterialBalance, MaterialMovement } from '../../models/material.model';
import { MaterialsService } from '../../services/materials.service';
import { MovementDialog } from '../movement-dialog/movement-dialog';
import { MovementsTable } from '../movements-table/movements-table';

/** Pestaña "Materiales" del pedido: consumos, material del cliente y su saldo. */
@Component({
  selector: 'app-order-materials',
  imports: [ButtonModule, TableModule, QtyPipe, MovementDialog, MovementsTable],
  template: `
    <div class="row row--between" style="margin-bottom: 0.75rem">
      <p class="muted small" style="margin: 0">Materiales utilizados, peso, ley, cantidad y origen (empresa o cliente).</p>
      @if (!readonly()) {
        <p-button label="Registrar material" icon="pi pi-plus" size="small" (onClick)="dialog.set(true)" />
      }
    </div>

    @if (balances().length) {
      <h3 class="section-title">Material entregado por el cliente</h3>
      <p-table [value]="balances()" [scrollable]="true" [tableStyle]="{ 'min-width': '560px' }" size="small" styleClass="mb-3">
        <ng-template #header>
          <tr>
            <th>Material</th><th>Ley</th><th class="text-right">Recibido</th><th class="text-right">Utilizado</th>
            <th class="text-right">Devuelto</th><th class="text-right">Saldo</th>
          </tr>
        </ng-template>
        <ng-template #body let-b>
          <tr>
            <td class="strong">{{ b.material_name }}</td>
            <td>{{ b.purity || '—' }}</td>
            <td class="text-right mono">{{ b.received | qty: b.unit }}</td>
            <td class="text-right mono">{{ b.used | qty: b.unit }}</td>
            <td class="text-right mono">{{ b.returned | qty: b.unit }}</td>
            <td class="text-right mono strong" [class.text-warn]="b.balance > 0">{{ b.balance | qty: b.unit }}</td>
          </tr>
        </ng-template>
      </p-table>
    }

    <h3 class="section-title">Movimientos del pedido</h3>
    <app-movements-table [movements]="movements()" [loading]="loading()" [showOrder]="false" [showStock]="false" />

    <app-movement-dialog [(visible)]="dialog" [orderId]="orderId()" (saved)="onSaved()" />
  `,
})
export class OrderMaterials implements OnInit {
  private readonly service = inject(MaterialsService);
  private readonly notify = inject(NotifyService);

  readonly orderId = input.required<string>();
  readonly readonly = input(false);
  /** Permite abrir el diálogo desde la cabecera del pedido. */
  readonly dialog = model(false);
  readonly changed = output<void>();

  protected readonly movements = signal<MaterialMovement[]>([]);
  protected readonly balances = signal<ClientMaterialBalance[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [movements, balances] = await Promise.all([
        this.service.movements({ orderId: this.orderId() }),
        this.service.clientBalances(this.orderId()),
      ]);
      this.movements.set(movements);
      this.balances.set(balances);
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los materiales del pedido.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async onSaved(): Promise<void> {
    await this.load();
    this.changed.emit();
  }
}
