import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { TextareaModule } from 'primeng/textarea';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_SEVERITY } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { Order } from '../../../orders/models/order.model';
import { Payment } from '../../models/payment.model';
import { PaymentsService } from '../../services/payments.service';
import { PaymentDialog } from '../payment-dialog/payment-dialog';

/** Pestaña "Pagos" del pedido: total, pagos, saldo y anulaciones. */
@Component({
  selector: 'app-order-payments',
  imports: [DatePipe, FormsModule, ButtonModule, TableModule, TagModule, DialogModule, TextareaModule, EmptyState, LabelPipe, MoneyPipe, PaymentDialog],
  template: `
    <div class="amounts" style="margin-bottom: 1rem">
      <div><small>Total pedido</small><strong>{{ order().total | money }}</strong></div>
      <div><small>Total pagos</small><strong class="text-success">{{ order().amount_paid | money }}</strong></div>
      <div>
        <small>Saldo</small>
        <strong [class.text-danger]="order().balance > 0">{{ order().balance | money }}</strong>
        <p-tag [value]="statusLabels[order().payment_status]" [severity]="statusSeverity[order().payment_status]" [style]="{ 'align-self': 'flex-start', 'margin-top': '0.25rem' }" />
      </div>
    </div>

    <div class="row row--between" style="margin-bottom: 0.5rem">
      <h3 class="section-title" style="margin: 0">Pagos registrados</h3>
      @if (!readonly()) {
        <p-button label="Registrar pago" icon="pi pi-plus" size="small" (onClick)="dialog.set(true)" />
      }
    </div>

    <p-table [value]="payments()" [scrollable]="true" [tableStyle]="{ 'min-width': '680px' }" size="small">
      <ng-template #header>
        <tr><th>Fecha</th><th>Método</th><th>Referencia</th><th>Observaciones</th><th class="text-right">Monto</th><th></th></tr>
      </ng-template>
      <ng-template #body let-p>
        <tr [style.opacity]="p.voided ? 0.55 : 1">
          <td class="nowrap">{{ p.payment_date | date: 'dd/MM/yyyy' }}</td>
          <td class="nowrap">
            {{ p.method | label: methodLabels }}
            @if (p.is_advance) {
              <p-tag value="Adelanto" severity="info" />
            }
            @if (p.voided) {
              <p-tag value="Anulado" severity="danger" [title]="p.void_reason" />
            }
          </td>
          <td>{{ p.reference || '—' }}</td>
          <td>{{ p.voided ? 'Anulado: ' + p.void_reason : p.notes || '—' }}</td>
          <td class="text-right mono nowrap strong" [style.text-decoration]="p.voided ? 'line-through' : 'none'">{{ p.amount | money }}</td>
          <td class="text-right">
            @if (canVoid && !p.voided && !readonly()) {
              <p-button icon="pi pi-ban" [text]="true" severity="danger" size="small" ariaLabel="Anular pago" (onClick)="openVoid(p)" />
            }
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr><td colspan="6"><app-empty-state icon="pi pi-wallet" message="Aún no hay pagos registrados." /></td></tr>
      </ng-template>
    </p-table>

    <app-payment-dialog [(visible)]="dialog" [orderId]="order().id" (saved)="changed.emit()" />

    <p-dialog header="Anular pago" [(visible)]="voidDialog" [modal]="true" [style]="{ width: '440px' }" [draggable]="false">
      <div class="field">
        <label for="void-reason">Motivo de la anulación <span class="req">*</span></label>
        <textarea pTextarea id="void-reason" [(ngModel)]="voidReason" rows="3"></textarea>
      </div>
      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="voidDialog.set(false)" />
        <p-button label="Anular pago" severity="danger" icon="pi pi-ban" [disabled]="!voidReason.trim()" [loading]="voiding()" (onClick)="confirmVoid()" />
      </ng-template>
    </p-dialog>
  `,
})
export class OrderPayments {
  private readonly service = inject(PaymentsService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  readonly order = input.required<Order>();
  readonly payments = input.required<Payment[]>();
  readonly readonly = input(false);
  readonly dialog = model(false);
  readonly changed = output<void>();

  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly statusLabels = PAYMENT_STATUS_LABELS;
  protected readonly statusSeverity = PAYMENT_STATUS_SEVERITY;
  protected readonly canVoid = this.auth.hasRole(...MODULE_ROLES.paymentsVoid);

  protected readonly voidDialog = signal(false);
  protected readonly voiding = signal(false);
  protected voidReason = '';
  private voidTarget: Payment | null = null;

  protected readonly validCount = computed(() => this.payments().filter((p) => !p.voided).length);

  protected openVoid(p: Payment): void {
    this.voidTarget = p;
    this.voidReason = '';
    this.voidDialog.set(true);
  }

  protected async confirmVoid(): Promise<void> {
    if (!this.voidTarget) return;
    this.voiding.set(true);
    try {
      await this.service.void(this.voidTarget.id, this.voidReason);
      this.notify.success('Pago anulado.');
      this.voidDialog.set(false);
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo anular el pago.');
    } finally {
      this.voiding.set(false);
    }
  }
}
