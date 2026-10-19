import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmationService } from 'primeng/api';
import { PAYMENT_METHOD_OPTIONS, PaymentMethod } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { toIsoDate } from '../../../../shared/utils/db';
import { positiveValidator } from '../../../../shared/utils/validators';
import { Order, OrderRow } from '../../../orders/models/order.model';
import { OrderPicker } from '../../../orders/components/order-picker/order-picker';
import { OrdersService } from '../../../orders/services/orders.service';
import { PaymentsService } from '../../services/payments.service';
import { ReceiptPdfService } from '../../services/receipt-pdf.service';

type OrderAmounts = Pick<Order, 'id' | 'number' | 'total' | 'amount_paid' | 'balance' | 'currency'>;

/** Registro de pagos y adelantos. Si el monto supera el saldo, pide confirmación explícita. */
@Component({
  selector: 'app-payment-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    DatePickerModule,
    TextareaModule,
    CheckboxModule,
    FieldError,
    MoneyPipe,
    OrderPicker,
  ],
  templateUrl: './payment-dialog.html',
})
export class PaymentDialog {
  private readonly service = inject(PaymentsService);
  private readonly orders = inject(OrdersService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly receipts = inject(ReceiptPdfService);

  readonly visible = model(false);
  /** Pedido fijo (desde la ficha del pedido). */
  readonly orderId = input<string | null>(null);
  readonly saved = output<void>();

  protected readonly order = signal<OrderAmounts | null>(null);
  protected readonly saving = signal(false);
  protected readonly methods = PAYMENT_METHOD_OPTIONS;
  protected readonly today = new Date();

  protected readonly form = inject(FormBuilder).group({
    order_id: [null as string | null, Validators.required],
    payment_date: [new Date() as Date | null, Validators.required],
    amount: [null as number | null, [Validators.required, positiveValidator]],
    method: ['EFECTIVO' as PaymentMethod, Validators.required],
    reference: ['', Validators.maxLength(80)],
    notes: ['', Validators.maxLength(500)],
    is_advance: [false],
    received_from: ['', Validators.maxLength(150)],
  });

  protected currency(): string {
    return this.order()?.currency ?? 'PEN';
  }

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const fixed = this.orderId();
      // untracked: form.reset() lee signals internos de PrimeNG; rastrearlos reiniciaría el formulario al editar.
      untracked(() => {
        this.form.reset({
          order_id: fixed,
          payment_date: new Date(),
          amount: null,
          method: 'EFECTIVO',
          reference: '',
          notes: '',
          is_advance: false,
          received_from: '',
        });
        this.order.set(null);
        if (fixed) void this.loadOrder(fixed);
      });
    });
  }

  private async loadOrder(id: string): Promise<void> {
    try {
      this.setOrder(await this.orders.get(id));
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el pedido.');
    }
  }

  protected setOrder(o: OrderAmounts | OrderRow | null): void {
    this.order.set(o);
    if (!o) return;
    const balance = Number(o.balance);
    // Primer pago = adelanto; el monto sugerido es el saldo.
    this.form.patchValue({ is_advance: Number(o.amount_paid) === 0, amount: balance > 0 ? balance : null });
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const o = this.order();
    const amount = Number(this.form.controls.amount.value);
    const balance = Number(o?.balance ?? 0);
    if (o && amount > balance) {
      this.confirm.confirm({
        header: 'Monto mayor al saldo',
        message: `El monto ${formatMoney(amount, o.currency)} supera el saldo pendiente de ${formatMoney(balance, o.currency)}. ¿Desea registrarlo de todos modos?`,
        icon: 'pi pi-exclamation-triangle',
        acceptButtonProps: { label: 'Sí, registrar', severity: 'warn' },
        rejectButtonProps: { label: 'Revisar monto', severity: 'secondary', text: true },
        accept: () => void this.persist(true),
      });
      return;
    }
    await this.persist(false);
  }

  private async persist(overpaymentConfirmed: boolean): Promise<void> {
    const v = this.form.getRawValue();
    this.saving.set(true);
    try {
      const paymentId = await this.service.create({
        order_id: v.order_id!,
        payment_date: toIsoDate(v.payment_date)!,
        amount: Number(v.amount),
        method: v.method!,
        reference: v.reference?.trim() || null,
        notes: v.notes?.trim() || null,
        is_advance: !!v.is_advance,
        received_from: v.received_from?.trim() || null,
        overpayment_confirmed: overpaymentConfirmed,
      });
      const remaining = Number(this.order()?.balance ?? 0) - Number(v.amount);
      this.notify.success(
        remaining > 0 ? `Pago registrado. Saldo pendiente: ${formatMoney(remaining, this.currency())}.` : 'Pago registrado. El pedido quedó pagado.',
      );
      this.visible.set(false);
      this.saved.emit();
      this.offerReceipt(v.order_id!, paymentId);
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el pago.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Cada cobro emite su recibo de ingreso: se ofrece imprimirlo al momento. */
  private offerReceipt(orderId: string, paymentId: string): void {
    this.confirm.confirm({
      header: 'Recibo de ingreso',
      message: '¿Desea imprimir el recibo de ingreso de este pago?',
      icon: 'pi pi-print',
      acceptButtonProps: { label: 'Imprimir recibo', icon: 'pi pi-print' },
      rejectButtonProps: { label: 'Ahora no', severity: 'secondary', text: true },
      accept: () => void this.receipts.incomeById(orderId, paymentId).catch((err) => this.notify.error(err, 'No se pudo generar el recibo.')),
    });
  }
}
