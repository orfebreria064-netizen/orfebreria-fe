import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmationService } from 'primeng/api';
import { PAYMENT_METHOD_OPTIONS, PaymentMethod } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { toIsoDate } from '../../../../shared/utils/db';
import { positiveValidator } from '../../../../shared/utils/validators';
import { OrderDetail } from '../../../orders/models/order.model';
import { ReceiptPdfService } from '../../../payments/services/receipt-pdf.service';
import { Jeweler } from '../../models/jeweler.model';
import { JewelersService } from '../../services/jewelers.service';

/** Pago a un joyero por el pedido: emite el recibo de egreso (en la moneda del pedido). */
@Component({
  selector: 'app-jeweler-payment-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    DatePickerModule,
    TextareaModule,
    FieldError,
  ],
  template: `
    <p-dialog header="Pago a joyero" [(visible)]="visible" [modal]="true" [style]="{ width: '520px' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" class="form-grid" novalidate>
        <div class="field field--full">
          <label for="jp-jeweler">Joyero <span class="req">*</span></label>
          <p-select inputId="jp-jeweler" [options]="jewelers()" formControlName="jeweler_id" optionLabel="full_name" optionValue="id" placeholder="Seleccione" [filter]="true" filterBy="full_name" appendTo="body" />
          <app-field-error [control]="form.controls.jeweler_id" />
        </div>
        <div class="field">
          <label for="jp-amount">Monto <span class="req">*</span></label>
          <p-inputnumber inputId="jp-amount" formControlName="amount" mode="currency" [currency]="order().currency" locale="es-PE" [min]="0" [fluid]="true" />
          <app-field-error [control]="form.controls.amount" />
        </div>
        <div class="field">
          <label for="jp-date">Fecha <span class="req">*</span></label>
          <p-datepicker inputId="jp-date" formControlName="payment_date" dateFormat="dd/mm/yy" [maxDate]="today" [showIcon]="true" appendTo="body" [fluid]="true" />
          <app-field-error [control]="form.controls.payment_date" />
        </div>
        <div class="field">
          <label for="jp-method">Método <span class="req">*</span></label>
          <p-select inputId="jp-method" [options]="methods" formControlName="method" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="jp-ref">{{ form.controls.method.value === 'CHEQUE' ? 'N.° de cheque' : 'Referencia / N.° operación' }}</label>
          <input pInputText id="jp-ref" formControlName="reference" />
        </div>
        <div class="field field--full">
          <label for="jp-concept">Detalle <span class="req">*</span></label>
          <textarea pTextarea id="jp-concept" formControlName="concept" rows="3" [autoResize]="true"></textarea>
          <app-field-error [control]="form.controls.concept" />
        </div>
        <div class="form-actions field--full">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" label="Registrar pago" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>
  `,
})
export class JewelerPaymentDialog {
  private readonly service = inject(JewelersService);
  private readonly receipts = inject(ReceiptPdfService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);

  readonly visible = model(false);
  readonly order = input.required<OrderDetail>();
  readonly jewelers = input<Jeweler[]>([]);
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly methods = PAYMENT_METHOD_OPTIONS;
  protected readonly today = new Date();

  protected readonly form = inject(FormBuilder).group({
    jeweler_id: [null as string | null, Validators.required],
    amount: [null as number | null, [Validators.required, positiveValidator]],
    payment_date: [new Date() as Date | null, Validators.required],
    method: ['EFECTIVO' as PaymentMethod, Validators.required],
    reference: ['', Validators.maxLength(80)],
    concept: ['', [Validators.required, Validators.maxLength(1000)]],
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const o = this.order();
      untracked(() =>
        this.form.reset({
          jeweler_id: o.jeweler_id,
          amount: null,
          payment_date: new Date(),
          method: 'EFECTIVO',
          reference: '',
          concept: `Mano de obra: ${o.title}`,
        }),
      );
    });
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const o = this.order();
    this.saving.set(true);
    try {
      const { number } = await this.service.registerPayment({
        order_id: o.id,
        jeweler_id: v.jeweler_id!,
        amount: Number(v.amount),
        method: v.method!,
        concept: v.concept!.trim(),
        payment_date: toIsoDate(v.payment_date)!,
        reference: v.reference?.trim() || null,
      });
      this.notify.success(`Pago registrado. Recibo ${number}.`);
      this.visible.set(false);
      this.saved.emit();
      this.offerReceipt(number);
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el pago.');
    } finally {
      this.saving.set(false);
    }
  }

  private offerReceipt(number: string): void {
    const o = this.order();
    this.confirm.confirm({
      header: 'Recibo de egreso',
      message: `¿Desea imprimir el recibo ${number} para la firma del joyero?`,
      icon: 'pi pi-print',
      acceptButtonProps: { label: 'Imprimir recibo', icon: 'pi pi-print' },
      rejectButtonProps: { label: 'Ahora no', severity: 'secondary', text: true },
      accept: async () => {
        try {
          const payment = (await this.service.payments({ orderId: o.id, includeVoided: true })).find((p) => p.number === number);
          if (payment) await this.receipts.expense(payment, { number: o.number, title: o.title, customer: o.customer?.full_name });
        } catch (err) {
          this.notify.error(err, 'No se pudo generar el recibo.');
        }
      },
    });
  }
}
