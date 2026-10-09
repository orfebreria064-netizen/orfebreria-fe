import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/auth/auth.service';
import { ORDER_STATUS_LABELS, OrderStatus } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { formatMoney } from '../../../../shared/pipes/money.pipe';
import { Order } from '../../models/order.model';
import { ORDER_TRANSITIONS, OrdersService } from '../../services/orders.service';

/** Cambio manual de estado del pedido, con advertencias de negocio. */
@Component({
  selector: 'app-status-dialog',
  imports: [FormsModule, ButtonModule, DialogModule, SelectModule, MessageModule],
  template: `
    <p-dialog header="Cambiar estado" [(visible)]="visible" [modal]="true" [style]="{ width: '460px' }" [draggable]="false">
      <div class="stack">
        <p class="muted" style="margin: 0">
          Estado actual: <strong>{{ labels[order().status] }}</strong>
        </p>
        <div class="field">
          <label for="next-status">Nuevo estado</label>
          <p-select inputId="next-status" [options]="options()" [(ngModel)]="next" optionLabel="label" optionValue="value" placeholder="Seleccione" appendTo="body" />
        </div>
        @if (warning(); as w) {
          <p-message severity="warn" [text]="w" />
        }
        @if (next === 'ENTREGADO') {
          <p-message severity="info" text="Para marcar como entregado registre la entrega desde «Registrar entrega»." />
        }
      </div>
      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
        <p-button label="Cambiar estado" icon="pi pi-check" [disabled]="!next" [loading]="saving()" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
})
export class StatusDialog {
  private readonly service = inject(OrdersService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  readonly order = input.required<Order>();
  readonly visible = model(false);
  readonly changed = output<void>();

  protected readonly labels = ORDER_STATUS_LABELS;
  protected readonly saving = signal(false);
  protected next: OrderStatus | null = null;

  protected readonly options = computed(() => {
    const current = this.order().status;
    let targets = ORDER_TRANSITIONS[current];
    if ((current === 'CERRADO' || current === 'CANCELADO') && !this.auth.hasRole('ADMIN')) targets = [];
    return targets.map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));
  });

  protected warning(): string | null {
    const o = this.order();
    if (this.next === 'CERRADO' && Number(o.balance) > 0) {
      return `El pedido tiene un saldo pendiente de ${formatMoney(o.balance)}. Puede cerrarlo, pero quedará registrado.`;
    }
    if (this.next === 'CANCELADO') return 'Un pedido cancelado solo puede reabrirlo un administrador.';
    if (this.next === 'CERRADO') return 'Un pedido cerrado no podrá modificarse sin permisos de administrador.';
    return null;
  }

  async save(): Promise<void> {
    if (!this.next) return;
    this.saving.set(true);
    try {
      await this.service.setStatus(this.order().id, this.next);
      this.notify.success(`Pedido actualizado a "${ORDER_STATUS_LABELS[this.next]}".`);
      if (this.next === 'CERRADO' && Number(this.order().balance) > 0) {
        this.notify.warn(`El pedido tiene un saldo pendiente de ${formatMoney(this.order().balance)}.`);
      }
      this.next = null;
      this.visible.set(false);
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo cambiar el estado.');
    } finally {
      this.saving.set(false);
    }
  }
}
