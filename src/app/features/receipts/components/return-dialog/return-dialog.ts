import { Component, effect, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { NotifyService } from '../../../../core/services/notify.service';
import { CustomerReceipt, CustomerReceiptsService } from '../../services/customer-receipts.service';

/** Devolución de la pieza reparada o del sobrante del material: peso de salida y observaciones. */
@Component({
  selector: 'app-return-dialog',
  imports: [DecimalPipe, FormsModule, ButtonModule, DialogModule, InputNumberModule, TextareaModule],
  template: `
    <p-dialog [header]="'Devolución · ' + (receipt()?.number ?? '')" [visible]="!!receipt()" (visibleChange)="!$event && closed.emit()" [modal]="true" [style]="{ width: '440px' }" [draggable]="false">
      @if (receipt(); as r) {
        <p class="small" style="margin-top: 0">
          {{ r.kind === 'REPARACION' ? 'Pieza entregada al cliente.' : 'Sobrante de material devuelto al cliente.' }}
          @if (r.weight_in) {
            Peso recibido: <strong>{{ r.weight_in | number: '1.2-2' }} g</strong>.
          }
        </p>
        <div class="field">
          <label for="rt-weight">Peso de salida (g)</label>
          <p-inputnumber inputId="rt-weight" [(ngModel)]="weight" [maxFractionDigits]="2" [min]="0" suffix=" g" [fluid]="true" />
          @if (weight && r.weight_in) {
            <small class="muted">Diferencia: {{ weight - r.weight_in | number: '1.2-2' }} g</small>
          }
        </div>
        <div class="field">
          <label for="rt-notes">Observaciones</label>
          <textarea pTextarea id="rt-notes" [(ngModel)]="notes" rows="2"></textarea>
        </div>
        @if (r.kind === 'MATERIAL') {
          <p class="small muted">Para descontar el sobrante del saldo del cliente, registre además la devolución en Materiales.</p>
        }
      }
      <div class="form-actions">
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="closed.emit()" />
        <p-button label="Registrar devolución" icon="pi pi-check" [loading]="saving()" (onClick)="save()" />
      </div>
    </p-dialog>
  `,
})
export class ReturnDialog {
  private readonly service = inject(CustomerReceiptsService);
  private readonly notify = inject(NotifyService);

  readonly receipt = input<CustomerReceipt | null>(null);
  readonly closed = output<void>();
  readonly saved = output<void>();

  protected weight: number | null = null;
  protected notes = '';
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      const r = this.receipt();
      this.weight = r?.weight_in != null ? Number(r.weight_in) : null;
      this.notes = '';
    });
  }

  async save(): Promise<void> {
    const r = this.receipt();
    if (!r) return;
    this.saving.set(true);
    try {
      await this.service.markReturned(r.id, this.weight || null, this.notes.trim() || null);
      this.notify.success('Devolución registrada.');
      this.saved.emit();
      this.closed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar la devolución.');
    } finally {
      this.saving.set(false);
    }
  }
}
