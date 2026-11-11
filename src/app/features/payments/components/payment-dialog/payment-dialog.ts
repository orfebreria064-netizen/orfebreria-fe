import { Component, DestroyRef, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import { Currency, PAYMENT_METHOD_OPTIONS, PaymentMethod } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { BankAccountsService } from '../../../../core/services/bank-accounts.service';
import { accountLabel, compatibleAccounts, suggestedAccount } from '../../../../core/models/bank.model';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { endOfToday, toIsoDate } from '../../../../shared/utils/db';
import { positiveValidator } from '../../../../shared/utils/validators';
import { Order, OrderRow } from '../../../orders/models/order.model';
import { OrderPicker } from '../../../orders/components/order-picker/order-picker';
import { OrdersService } from '../../../orders/services/orders.service';
import { CustomerCreditsService } from '../../../customers/services/customer-credits.service';
import { PaymentsService } from '../../services/payments.service';
import { ReceiptPdfService } from '../../services/receipt-pdf.service';

type OrderAmounts = Pick<Order, 'id' | 'number' | 'total' | 'amount_paid' | 'balance' | 'currency' | 'customer_id'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Registro de pagos y adelantos. Si el monto supera el saldo, el sobrante pasa solo al saldo a favor del
 * cliente. Con el método "Saldo a favor" se usa el dinero que el cliente dejó a cuenta.
 */
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
    MessageModule,
    FieldError,
    MoneyPipe,
    OrderPicker,
  ],
  templateUrl: './payment-dialog.html',
})
export class PaymentDialog {
  private readonly service = inject(PaymentsService);
  private readonly orders = inject(OrdersService);
  private readonly credits = inject(CustomerCreditsService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly receipts = inject(ReceiptPdfService);
  private readonly bankAccounts = inject(BankAccountsService);

  readonly visible = model(false);
  /** Pedido fijo (desde la ficha del pedido). */
  readonly orderId = input<string | null>(null);
  readonly saved = output<void>();

  protected readonly order = signal<OrderAmounts | null>(null);
  /** Saldo a favor del cliente del pedido, en la moneda del pedido. */
  protected readonly credit = signal(0);
  protected readonly saving = signal(false);
  protected readonly today = endOfToday();

  protected readonly form = inject(FormBuilder).group({
    order_id: [null as string | null, Validators.required],
    payment_date: [new Date() as Date | null, Validators.required],
    amount: [null as number | null, [Validators.required, positiveValidator]],
    method: ['EFECTIVO' as PaymentMethod, Validators.required],
    reference: ['', Validators.maxLength(80)],
    notes: ['', Validators.maxLength(500)],
    is_advance: [false],
    received_from: ['', Validators.maxLength(150)],
    /** Cuenta donde entra el dinero (obligatoria si hay cuentas para el método y la moneda). */
    bank_account_id: [null as string | null],
  });

  private readonly method = toSignal(this.form.controls.method.valueChanges, { initialValue: this.form.controls.method.value });
  /** Cuentas que sirven para el método y la moneda del pedido (el saldo a favor no entra a ninguna). */
  protected readonly accountOptions = computed(() =>
    compatibleAccounts(this.bankAccounts.accounts(), this.method(), this.currency()),
  );
  protected readonly accountLabel = accountLabel;
  private readonly amount = toSignal(this.form.controls.amount.valueChanges, { initialValue: this.form.controls.amount.value });

  protected readonly useCredit = computed(() => this.method() === 'SALDO_A_FAVOR');
  private readonly balance = computed(() => Number(this.order()?.balance ?? 0));
  /** Lo máximo que se puede aplicar del saldo a favor a este pedido. */
  protected readonly creditApplicable = computed(() => round2(Math.max(0, Math.min(this.balance(), this.credit()))));
  /** Lo que pasará al saldo a favor del cliente (monto mayor al saldo del pedido). */
  protected readonly excess = computed(() => {
    if (this.useCredit() || !this.order() || this.balance() <= 0) return 0;
    return round2(Math.max(0, Number(this.amount() ?? 0) - this.balance()));
  });

  protected readonly methods = computed(() =>
    this.credit() > 0
      ? [
          ...PAYMENT_METHOD_OPTIONS,
          { value: 'SALDO_A_FAVOR' as PaymentMethod, label: `Saldo a favor (${formatMoney(this.credit(), this.currency())})` },
        ]
      : PAYMENT_METHOD_OPTIONS,
  );

  protected currency(): Currency {
    return this.order()?.currency ?? 'PEN';
  }

  constructor() {
    // Propone la cuenta (única o principal) y la exige cuando hay opciones
    effect(() => {
      const options = this.accountOptions();
      untracked(() => {
        const ctrl = this.form.controls.bank_account_id;
        ctrl.setValidators(options.length ? [Validators.required] : []);
        if (!options.some((a) => a.id === ctrl.value)) ctrl.setValue(suggestedAccount(options));
        ctrl.updateValueAndValidity({ emitEvent: false });
      });
    });
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
          bank_account_id: null,
        });
        this.order.set(null);
        void this.bankAccounts.ensureLoaded().catch((err) => this.notify.error(err, 'No se pudieron cargar las cuentas.'));
        this.credit.set(0);
        if (fixed) void this.loadOrder(fixed);
      });
    });

    // Al elegir "Saldo a favor" se sugiere lo máximo aplicable; al volver a otro método, el saldo del pedido.
    this.form.controls.method.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((m) => {
      if (!this.order()) return;
      if (m === 'SALDO_A_FAVOR') this.form.patchValue({ amount: this.creditApplicable() || null, reference: '' });
      else if (this.balance() > 0 && Number(this.form.controls.amount.value) === this.creditApplicable())
        this.form.patchValue({ amount: this.balance() });
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
    this.credit.set(0);
    if (this.form.controls.method.value === 'SALDO_A_FAVOR') this.form.patchValue({ method: 'EFECTIVO' });
    if (!o) return;
    const balance = Number(o.balance);
    // Primer pago = adelanto; el monto sugerido es el saldo.
    this.form.patchValue({ is_advance: Number(o.amount_paid) === 0, amount: balance > 0 ? balance : null });
    void this.loadCredit(o);
  }

  private async loadCredit(o: OrderAmounts | OrderRow): Promise<void> {
    try {
      const balances = await this.credits.balances(o.customer_id);
      if (this.order()?.id === o.id) this.credit.set(balances[o.currency] ?? 0);
    } catch {
      this.credit.set(0); // sin permiso o sin saldo: el método no se ofrece
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const o = this.order();
    const amount = Number(this.form.controls.amount.value);
    if (o && this.useCredit() && amount > this.creditApplicable()) {
      this.notify.warn(`Del saldo a favor se pueden aplicar como máximo ${formatMoney(this.creditApplicable(), o.currency)} a este pedido.`);
      return;
    }
    if (o && !this.useCredit() && this.balance() <= 0) {
      this.notify.warn('El pedido no tiene saldo pendiente. Registre el dinero como depósito en la ficha del cliente (pestaña Saldo a favor).');
      return;
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    const v = this.form.getRawValue();
    const excess = this.excess();
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
        bank_account_id: v.bank_account_id || null,
        overpayment_confirmed: true,
      });
      const remaining = round2(this.balance() - Number(v.amount));
      this.notify.success(
        excess > 0
          ? `Pago registrado. El pedido quedó pagado y ${formatMoney(excess, this.currency())} pasaron al saldo a favor del cliente.`
          : remaining > 0
            ? `Pago registrado. Saldo pendiente: ${formatMoney(remaining, this.currency())}.`
            : 'Pago registrado. El pedido quedó pagado.',
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
