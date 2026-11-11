import { Component, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BankAccountsService } from '../../../../core/services/bank-accounts.service';
import { accountLabel, compatibleAccounts, suggestedAccount } from '../../../../core/models/bank.model';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from 'primeng/api';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import {
  CREDIT_KIND_LABELS,
  CREDIT_KIND_SEVERITY,
  CURRENCY_OPTIONS,
  Currency,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PaymentMethod,
} from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { endOfToday, toIsoDate } from '../../../../shared/utils/db';
import { positiveValidator } from '../../../../shared/utils/validators';
import { ReceiptPdfService } from '../../../payments/services/receipt-pdf.service';
import { Customer } from '../../models/customer.model';
import { CreditBalances, CustomerCredit, CustomerCreditsService } from '../../services/customer-credits.service';

type MovementMode = 'DEPOSITO' | 'DEVOLUCION';

/**
 * Saldo a favor del cliente: dinero que deja a cuenta para descontarlo de pedidos futuros.
 * Se aplica desde "Registrar pago" del pedido con el método "Saldo a favor".
 */
@Component({
  selector: 'app-customer-credits',
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    DatePickerModule,
    TextareaModule,
    TableModule,
    TagModule,
    EmptyState,
    FieldError,
    MoneyPipe,
    LabelPipe,
  ],
  templateUrl: './customer-credits.html',
})
export class CustomerCredits implements OnInit {
  private readonly service = inject(CustomerCreditsService);
  private readonly receipts = inject(ReceiptPdfService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly auth = inject(AuthService);

  readonly customer = input.required<Customer>();
  /** Saldo vigente (para la tarjeta de la ficha). */
  readonly balancesChange = output<CreditBalances>();

  protected readonly balances = signal<CreditBalances>({ PEN: 0, USD: 0 });
  protected readonly movements = signal<CustomerCredit[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly canDeposit = this.auth.hasRole(...MODULE_ROLES.payments);
  protected readonly canManage = this.auth.hasRole(...MODULE_ROLES.paymentsVoid);

  protected readonly kindLabels = CREDIT_KIND_LABELS;
  protected readonly kindSeverity = CREDIT_KIND_SEVERITY;
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly methods = PAYMENT_METHOD_OPTIONS;
  protected readonly currencies = CURRENCY_OPTIONS;
  protected readonly today = endOfToday();

  protected readonly hasBalance = computed(() => this.balances().PEN > 0 || this.balances().USD > 0);

  // Depósito / devolución
  protected readonly dialog = signal(false);
  protected readonly mode = signal<MovementMode>('DEPOSITO');
  protected readonly form = inject(FormBuilder).group({
    currency: ['PEN' as Currency, Validators.required],
    amount: [null as number | null, [Validators.required, positiveValidator]],
    movement_date: [new Date() as Date | null, Validators.required],
    method: ['EFECTIVO' as PaymentMethod, Validators.required],
    reference: ['', Validators.maxLength(80)],
    received_from: ['', Validators.maxLength(150)],
    notes: ['', Validators.maxLength(500)],
    bank_account_id: [null as string | null],
  });

  // Cuenta donde entra (depósito) o de donde sale (devolución) el dinero
  private readonly bankAccounts = inject(BankAccountsService);
  private readonly formMethod = toSignal(this.form.controls.method.valueChanges, { initialValue: this.form.controls.method.value });
  private readonly formCurrency = toSignal(this.form.controls.currency.valueChanges, { initialValue: this.form.controls.currency.value });
  protected readonly accountOptions = computed(() =>
    compatibleAccounts(this.bankAccounts.accounts(), this.formMethod(), this.formCurrency() ?? 'PEN'),
  );
  protected readonly accountLabel = accountLabel;

  constructor() {
    effect(() => {
      const options = this.accountOptions();
      untracked(() => {
        const ctrl = this.form.controls.bank_account_id;
        ctrl.setValidators(options.length ? [Validators.required] : []);
        if (!options.some((a) => a.id === ctrl.value)) ctrl.setValue(suggestedAccount(options));
        ctrl.updateValueAndValidity({ emitEvent: false });
      });
    });
  }

  // Anulación
  protected readonly voidDialog = signal(false);
  protected readonly voiding = signal(false);
  protected voidReason = '';
  private voidTarget: CustomerCredit | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [balances, movements] = await Promise.all([
        this.service.balances(this.customer().id),
        this.service.list(this.customer().id),
      ]);
      this.balances.set(balances);
      this.movements.set(movements);
      this.balancesChange.emit(balances);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el saldo a favor.');
    } finally {
      this.loading.set(false);
    }
  }

  protected severity(c: CustomerCredit) {
    return this.kindSeverity[c.kind];
  }

  /** Signo del movimiento en el saldo. */
  protected sign(c: CustomerCredit): 1 | -1 {
    return c.kind === 'DEPOSITO' || c.kind === 'EXCEDENTE' ? 1 : -1;
  }

  protected open(mode: MovementMode): void {
    this.mode.set(mode);
    const currency: Currency = mode === 'DEVOLUCION' && this.balances().PEN <= 0 && this.balances().USD > 0 ? 'USD' : 'PEN';
    this.form.reset({
      currency,
      amount: mode === 'DEVOLUCION' ? this.balances()[currency] || null : null,
      movement_date: new Date(),
      method: 'EFECTIVO',
      reference: '',
      received_from: '',
      notes: '',
      bank_account_id: null,
    });
    void this.bankAccounts.ensureLoaded().catch((err) => this.notify.error(err, 'No se pudieron cargar las cuentas.'));
    this.dialog.set(true);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const currency = v.currency!;
    const amount = Number(v.amount);
    const refund = this.mode() === 'DEVOLUCION';
    if (refund && amount > this.balances()[currency]) {
      this.notify.warn(`La devolución supera el saldo a favor (${formatMoney(this.balances()[currency], currency)}).`);
      return;
    }
    this.saving.set(true);
    try {
      const input = {
        amount,
        currency,
        method: v.method!,
        movement_date: toIsoDate(v.movement_date)!,
        reference: v.reference?.trim() || null,
        notes: v.notes?.trim() || null,
        received_from: refund ? null : v.received_from?.trim() || null,
        bank_account_id: v.bank_account_id || null,
      };
      const r = refund ? await this.service.refund(this.customer().id, input) : await this.service.deposit(this.customer().id, input);
      this.notify.success(
        refund
          ? `Devolución registrada (${r.receipt_number}).`
          : `Depósito registrado (${r.receipt_number}). ${formatMoney(amount, currency)} quedan a favor del cliente.`,
      );
      this.dialog.set(false);
      await this.load();
      const created = this.movements().find((m) => m.id === r.id);
      if (created) this.offerReceipt(created);
    } catch (err) {
      this.notify.error(err, refund ? 'No se pudo registrar la devolución.' : 'No se pudo registrar el depósito.');
    } finally {
      this.saving.set(false);
    }
  }

  private offerReceipt(c: CustomerCredit): void {
    this.confirm.confirm({
      header: c.kind === 'DEVOLUCION' ? 'Recibo de egreso' : 'Recibo de ingreso',
      message: '¿Desea imprimir el recibo?',
      icon: 'pi pi-print',
      acceptButtonProps: { label: 'Imprimir recibo', icon: 'pi pi-print' },
      rejectButtonProps: { label: 'Ahora no', severity: 'secondary', text: true },
      accept: () => void this.print(c),
    });
  }

  protected async print(c: CustomerCredit): Promise<void> {
    try {
      await this.receipts.credit(c, this.customer());
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el recibo.');
    }
  }

  protected openVoid(c: CustomerCredit): void {
    this.voidTarget = c;
    this.voidReason = '';
    this.voidDialog.set(true);
  }

  protected async confirmVoid(): Promise<void> {
    if (!this.voidTarget || !this.voidReason.trim()) return;
    this.voiding.set(true);
    try {
      await this.service.void(this.voidTarget.id, this.voidReason);
      this.notify.success('Movimiento anulado.');
      this.voidDialog.set(false);
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo anular el movimiento.');
    } finally {
      this.voiding.set(false);
    }
  }
}
