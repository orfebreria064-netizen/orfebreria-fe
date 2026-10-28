import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { CURRENCY_OPTIONS, Currency, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS, PaymentMethod } from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { toIsoDate } from '../../../../shared/utils/db';
import { positiveValidator } from '../../../../shared/utils/validators';
import { Jeweler } from '../../../jewelers/models/jeweler.model';
import { JewelersService } from '../../../jewelers/services/jewelers.service';
import { FinanceService, LOAN_PAYMENT_METHOD_LABELS, Loan, LoanMethod, LoanPayment } from '../../services/finance.service';

/** Préstamos al personal y a joyeros, con sus abonos (efectivo o descuento de planilla / pago al joyero). */
@Component({
  selector: 'app-loan-list',
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    ProgressBarModule,
    SelectButtonModule,
    SelectModule,
    TableModule,
    TagModule,
    TextareaModule,
    EmptyState,
    FieldError,
    LabelPipe,
    MoneyPipe,
  ],
  template: `
    <div class="toolbar-filters">
      <p-selectbutton [options]="statusOptions" [(ngModel)]="status" optionLabel="label" optionValue="value" [allowEmpty]="false" />
      <div class="row">
        <p-checkbox inputId="ln-voided" [(ngModel)]="includeVoided" [binary]="true" (onChange)="load()" />
        <label for="ln-voided" class="small">Mostrar anulados</label>
      </div>
      <span class="spacer"></span>
      <span class="small">Saldo por cobrar: <strong class="mono">{{ outstanding() }}</strong></span>
      <p-button label="Nuevo préstamo" icon="pi pi-plus" (onClick)="openNew()" />
    </div>

    <p-table [value]="filtered()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '920px' }" [rowHover]="true">
      <ng-template #header>
        <tr>
          <th>N.°</th><th>Fecha</th><th>Beneficiario</th><th>Motivo</th><th class="text-right">Monto</th><th style="width: 180px">Pagado</th><th class="text-right">Saldo</th><th></th>
        </tr>
      </ng-template>
      <ng-template #body let-l>
        <tr [class.voided]="l.voided">
          <td class="nowrap mono small">{{ l.number }}</td>
          <td class="nowrap">{{ l.loan_date | date: 'dd/MM/yyyy' }}</td>
          <td>
            <strong>{{ l.beneficiary_name }}</strong>
            <br /><span class="muted small">{{ l.beneficiary_type === 'JOYERO' ? 'Joyero' : 'Trabajador' }}{{ l.document_number ? ' · DNI ' + l.document_number : '' }}</span>
          </td>
          <td class="small">{{ l.reason }}@if (l.installments > 1) {<br /><span class="muted">{{ l.installments }} cuotas de {{ l.amount / l.installments | money: l.currency }}</span>}</td>
          <td class="text-right mono nowrap">{{ l.amount | money: l.currency }}</td>
          <td><p-progressbar [value]="progress(l)" [showValue]="false" styleClass="loan-progress" /><span class="small muted">{{ l.amount_paid | money: l.currency }}</span></td>
          <td class="text-right mono nowrap">
            @if (l.voided) {
              <p-tag value="Anulado" severity="danger" [title]="l.void_reason ?? ''" />
            } @else if (l.balance <= 0) {
              <p-tag value="Pagado" severity="success" />
            } @else {
              <span class="text-danger">{{ l.balance | money: l.currency }}</span>
            }
          </td>
          <td class="text-right nowrap">
            <p-button icon="pi pi-list" [text]="true" severity="secondary" ariaLabel="Abonos" title="Abonos" (onClick)="openDetail(l)" />
            @if (!l.voided && l.balance > 0) {
              <p-button icon="pi pi-plus-circle" [text]="true" ariaLabel="Registrar abono" title="Registrar abono" (onClick)="openPayment(l)" />
            }
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr><td colspan="8"><app-empty-state icon="pi pi-money-bill" message="No hay préstamos registrados." /></td></tr>
      </ng-template>
    </p-table>

    <!-- Nuevo préstamo -->
    <p-dialog header="Nuevo préstamo" [(visible)]="loanVisible" [modal]="true" [style]="{ width: '600px' }" [draggable]="false">
      <form [formGroup]="loanForm" (ngSubmit)="saveLoan()" class="form-grid" novalidate>
        <div class="field field--full">
          <p-selectbutton [options]="typeOptions" formControlName="beneficiary_type" optionLabel="label" optionValue="value" [allowEmpty]="false" />
        </div>
        @if (loanForm.controls.beneficiary_type.value === 'JOYERO') {
          <div class="field field--full">
            <label for="ln-jw">Joyero <span class="req">*</span></label>
            <p-select inputId="ln-jw" [options]="jewelers()" formControlName="jeweler_id" optionLabel="full_name" optionValue="id" placeholder="Seleccione" [filter]="true" filterBy="full_name" appendTo="body" />
          </div>
        } @else {
          <div class="field">
            <label for="ln-user">Usuario del sistema (opcional)</label>
            <p-select inputId="ln-user" [options]="staff()" formControlName="profile_id" optionLabel="full_name" optionValue="id" placeholder="No es usuario" [showClear]="true" [filter]="true" filterBy="full_name" appendTo="body" (onChange)="onProfile($event.value)" />
          </div>
          <div class="field">
            <label for="ln-name">Nombre del trabajador <span class="req">*</span></label>
            <input pInputText id="ln-name" formControlName="beneficiary_name" />
          </div>
          <div class="field">
            <label for="ln-doc">DNI</label>
            <input pInputText id="ln-doc" formControlName="document_number" maxlength="12" />
          </div>
        }
        <div class="field">
          <label for="ln-date">Fecha <span class="req">*</span></label>
          <p-datepicker inputId="ln-date" formControlName="loan_date" dateFormat="dd/mm/yy" [maxDate]="today" [showIcon]="true" appendTo="body" [fluid]="true" />
        </div>
        <div class="field">
          <label for="ln-amount">Monto <span class="req">*</span></label>
          <p-inputnumber inputId="ln-amount" formControlName="amount" mode="currency" [currency]="loanForm.controls.currency.value ?? 'PEN'" locale="es-PE" [min]="0" [fluid]="true" />
          <app-field-error [control]="loanForm.controls.amount" />
        </div>
        <div class="field">
          <label for="ln-cur">Moneda</label>
          <p-select inputId="ln-cur" [options]="currencies" formControlName="currency" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="ln-inst">N.° de cuotas</label>
          <p-inputnumber inputId="ln-inst" formControlName="installments" [min]="1" [max]="60" [showButtons]="true" [fluid]="true" />
        </div>
        <div class="field">
          <label for="ln-method">Entregado en <span class="req">*</span></label>
          <p-select inputId="ln-method" [options]="methods" formControlName="method" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field field--full">
          <label for="ln-reason">Motivo <span class="req">*</span></label>
          <textarea pTextarea id="ln-reason" formControlName="reason" rows="2" [autoResize]="true"></textarea>
          <app-field-error [control]="loanForm.controls.reason" />
        </div>
        <div class="form-actions field--full">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="loanVisible = false" />
          <p-button type="submit" label="Registrar préstamo" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>

    <!-- Abono -->
    <p-dialog [header]="'Abono a ' + (target()?.number ?? '')" [(visible)]="paymentVisible" [modal]="true" [style]="{ width: '460px' }" [draggable]="false">
      @if (target(); as l) {
        <p class="small" style="margin-top: 0">{{ l.beneficiary_name }} · saldo <strong>{{ l.balance | money: l.currency }}</strong></p>
        <div class="form-grid">
          <div class="field">
            <label for="lp-amount">Monto <span class="req">*</span></label>
            <p-inputnumber inputId="lp-amount" [(ngModel)]="payAmount" mode="currency" [currency]="l.currency" locale="es-PE" [min]="0" [max]="l.balance" [fluid]="true" />
          </div>
          <div class="field">
            <label for="lp-date">Fecha</label>
            <p-datepicker inputId="lp-date" [(ngModel)]="payDate" dateFormat="dd/mm/yy" [maxDate]="today" [showIcon]="true" appendTo="body" [fluid]="true" />
          </div>
          <div class="field field--full">
            <label for="lp-method">Forma de pago</label>
            <p-select inputId="lp-method" [options]="loanMethods" [(ngModel)]="payMethod" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field field--full">
            <label for="lp-ref">Referencia</label>
            <input pInputText id="lp-ref" [(ngModel)]="payReference" placeholder="N.° de operación, recibo de egreso, planilla..." />
          </div>
        </div>
      }
      <div class="form-actions">
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="paymentVisible = false" />
        <p-button label="Registrar abono" icon="pi pi-check" [disabled]="!payAmount" [loading]="saving()" (onClick)="savePayment()" />
      </div>
    </p-dialog>

    <!-- Detalle de abonos -->
    <p-dialog [header]="'Préstamo ' + (target()?.number ?? '')" [(visible)]="detailVisible" [modal]="true" [style]="{ width: '640px' }" [draggable]="false">
      @if (target(); as l) {
        <dl class="dl">
          <dt>Beneficiario</dt><dd>{{ l.beneficiary_name }}</dd>
          <dt>Monto</dt><dd class="mono">{{ l.amount | money: l.currency }} ({{ l.method | label: paymentLabels }})</dd>
          <dt>Saldo</dt><dd class="mono">{{ l.balance | money: l.currency }}</dd>
          <dt>Motivo</dt><dd>{{ l.reason }}</dd>
          @if (l.voided) {
            <dt>Anulado</dt><dd class="text-danger">{{ l.void_reason }}</dd>
          }
        </dl>
        <p-table [value]="sortedPayments(l)" size="small" [scrollable]="true">
          <ng-template #header>
            <tr><th>N.°</th><th>Fecha</th><th>Forma</th><th class="text-right">Monto</th><th></th></tr>
          </ng-template>
          <ng-template #body let-p>
            <tr [class.voided]="p.voided">
              <td class="mono small">{{ p.number }}</td>
              <td>{{ p.payment_date | date: 'dd/MM/yyyy' }}</td>
              <td class="small">{{ p.method | label: loanMethodLabels }}{{ p.reference ? ' · ' + p.reference : '' }}</td>
              <td class="text-right mono">{{ p.amount | money: l.currency }}</td>
              <td class="text-right">
                @if (p.voided) {
                  <p-tag value="Anulado" severity="danger" [title]="p.void_reason ?? ''" />
                } @else {
                  <p-button icon="pi pi-ban" [text]="true" severity="danger" size="small" ariaLabel="Anular abono" (onClick)="askVoid('payment', p)" />
                }
              </td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr><td colspan="5" class="muted small">Sin abonos.</td></tr>
          </ng-template>
        </p-table>
        @if (!l.voided) {
          <div class="form-actions">
            <p-button label="Anular préstamo" severity="danger" [text]="true" icon="pi pi-ban" (onClick)="askVoid('loan', null)" />
          </div>
        }
      }
    </p-dialog>

    <p-dialog [header]="voidKind === 'loan' ? 'Anular préstamo' : 'Anular abono'" [(visible)]="voidVisible" [modal]="true" [style]="{ width: '420px' }" [draggable]="false">
      <div class="field">
        <label for="ln-void">Motivo de la anulación <span class="req">*</span></label>
        <textarea pTextarea id="ln-void" [(ngModel)]="voidReason" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="voidVisible = false" />
        <p-button label="Anular" severity="danger" icon="pi pi-ban" [disabled]="!voidReason.trim()" [loading]="saving()" (onClick)="confirmVoid()" />
      </div>
    </p-dialog>
  `,
  styles: `
    .spacer {
      flex: 1;
    }
    tr.voided td {
      color: var(--p-surface-400);
    }
    :host ::ng-deep .loan-progress {
      height: 0.4rem;
      margin-bottom: 0.15rem;
    }
  `,
})
export class LoanList implements OnInit {
  private readonly service = inject(FinanceService);
  private readonly jewelersService = inject(JewelersService);
  private readonly lookup = inject(LookupService);
  private readonly notify = inject(NotifyService);

  protected readonly today = new Date();
  protected readonly methods = PAYMENT_METHOD_OPTIONS;
  protected readonly paymentLabels = PAYMENT_METHOD_LABELS;
  protected readonly loanMethodLabels = LOAN_PAYMENT_METHOD_LABELS;
  protected readonly loanMethods = (Object.keys(LOAN_PAYMENT_METHOD_LABELS) as LoanMethod[]).map((value) => ({ value, label: LOAN_PAYMENT_METHOD_LABELS[value] }));
  protected readonly currencies = CURRENCY_OPTIONS;
  protected readonly typeOptions = [
    { value: 'EMPLEADO', label: 'Trabajador de la empresa' },
    { value: 'JOYERO', label: 'Joyero' },
  ];
  protected readonly statusOptions = [
    { value: 'OPEN', label: 'Con saldo' },
    { value: 'ALL', label: 'Todos' },
  ];

  protected status: 'OPEN' | 'ALL' = 'OPEN';
  protected includeVoided = false;
  protected readonly rows = signal<Loan[]>([]);
  protected readonly jewelers = signal<Jeweler[]>([]);
  protected readonly staff = computed(() => this.lookup.staff().filter((s) => s.active));
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly target = signal<Loan | null>(null);

  protected loanVisible = false;
  protected paymentVisible = false;
  protected detailVisible = false;
  protected voidVisible = false;
  protected voidKind: 'loan' | 'payment' = 'loan';
  private voidPayment: LoanPayment | null = null;
  protected voidReason = '';

  protected payAmount: number | null = null;
  protected payDate: Date | null = new Date();
  protected payMethod: LoanMethod = 'EFECTIVO';
  protected payReference = '';

  protected readonly loanForm = inject(FormBuilder).group({
    beneficiary_type: ['EMPLEADO' as 'EMPLEADO' | 'JOYERO'],
    jeweler_id: [null as string | null],
    profile_id: [null as string | null],
    beneficiary_name: [''],
    document_number: [''],
    loan_date: [new Date() as Date | null, Validators.required],
    amount: [null as number | null, [Validators.required, positiveValidator]],
    currency: ['PEN' as Currency],
    installments: [1 as number | null],
    method: ['EFECTIVO' as PaymentMethod, Validators.required],
    reason: ['', [Validators.required, Validators.maxLength(500)]],
  });

  protected filtered(): Loan[] {
    return this.status === 'OPEN' ? this.rows().filter((l) => l.voided || Number(l.balance) > 0) : this.rows();
  }

  protected readonly outstanding = computed(() => {
    const open = this.rows().filter((l) => !l.voided);
    const pen = open.filter((l) => l.currency === 'PEN').reduce((a, l) => a + Number(l.balance), 0);
    const usd = open.filter((l) => l.currency === 'USD').reduce((a, l) => a + Number(l.balance), 0);
    return usd ? `${formatMoney(pen)} · ${formatMoney(usd, 'USD')}` : formatMoney(pen);
  });

  ngOnInit(): void {
    void this.load();
    void this.lookup.ensureLoaded().catch(() => undefined);
    this.jewelersService.list().then((j) => this.jewelers.set(j), () => undefined);
  }

  protected progress(l: Loan): number {
    return Number(l.amount) ? Math.round((Number(l.amount_paid) / Number(l.amount)) * 100) : 0;
  }

  protected sortedPayments(l: Loan): LoanPayment[] {
    return [...(l.payments ?? [])].sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.number.localeCompare(b.number));
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.service.loans(this.includeVoided));
      const t = this.target();
      if (t) this.target.set(this.rows().find((l) => l.id === t.id) ?? null);
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los préstamos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected openNew(): void {
    this.loanForm.reset({
      beneficiary_type: 'EMPLEADO',
      jeweler_id: null,
      profile_id: null,
      beneficiary_name: '',
      document_number: '',
      loan_date: new Date(),
      amount: null,
      currency: 'PEN',
      installments: 1,
      method: 'EFECTIVO',
      reason: '',
    });
    this.loanVisible = true;
  }

  protected onProfile(id: string | null): void {
    const s = this.staff().find((x) => x.id === id);
    if (s) this.loanForm.controls.beneficiary_name.setValue(s.full_name);
  }

  protected async saveLoan(): Promise<void> {
    const v = this.loanForm.getRawValue();
    if (this.loanForm.invalid) {
      this.loanForm.markAllAsTouched();
      return;
    }
    if (v.beneficiary_type === 'JOYERO' ? !v.jeweler_id : !v.beneficiary_name?.trim()) {
      this.notify.warn(v.beneficiary_type === 'JOYERO' ? 'Seleccione el joyero.' : 'Indique el nombre del trabajador.');
      return;
    }
    this.saving.set(true);
    try {
      const { number } = await this.service.registerLoan({
        beneficiary_type: v.beneficiary_type!,
        jeweler_id: v.beneficiary_type === 'JOYERO' ? v.jeweler_id : null,
        profile_id: v.beneficiary_type === 'EMPLEADO' ? v.profile_id : null,
        beneficiary_name: v.beneficiary_name?.trim() || null,
        document_number: v.document_number?.trim() || null,
        loan_date: toIsoDate(v.loan_date)!,
        amount: Number(v.amount),
        currency: v.currency!,
        installments: v.installments ?? 1,
        method: v.method!,
        reason: v.reason!.trim(),
      });
      this.notify.success(`Préstamo ${number} registrado.`);
      this.loanVisible = false;
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el préstamo.');
    } finally {
      this.saving.set(false);
    }
  }

  protected openPayment(l: Loan): void {
    this.target.set(l);
    this.payAmount = Number(l.installments) > 1 ? Math.min(Number(l.balance), Math.round((Number(l.amount) / l.installments) * 100) / 100) : Number(l.balance);
    this.payDate = new Date();
    this.payMethod = l.beneficiary_type === 'JOYERO' ? 'DESCUENTO_PAGO_JOYERO' : 'DESCUENTO_PLANILLA';
    this.payReference = '';
    this.paymentVisible = true;
  }

  protected async savePayment(): Promise<void> {
    const l = this.target();
    if (!l || !this.payAmount) return;
    this.saving.set(true);
    try {
      const { number } = await this.service.registerLoanPayment(l.id, this.payAmount, this.payMethod, toIsoDate(this.payDate ?? new Date())!, this.payReference.trim() || null);
      this.notify.success(`Abono ${number} registrado.`);
      this.paymentVisible = false;
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el abono.');
    } finally {
      this.saving.set(false);
    }
  }

  protected openDetail(l: Loan): void {
    this.target.set(l);
    this.detailVisible = true;
  }

  protected askVoid(kind: 'loan' | 'payment', payment: LoanPayment | null): void {
    this.voidKind = kind;
    this.voidPayment = payment;
    this.voidReason = '';
    this.voidVisible = true;
  }

  protected async confirmVoid(): Promise<void> {
    const l = this.target();
    if (!l) return;
    this.saving.set(true);
    try {
      if (this.voidKind === 'loan') await this.service.voidLoan(l.id, this.voidReason.trim());
      else await this.service.voidLoanPayment(this.voidPayment!.id, this.voidReason.trim());
      this.notify.success(this.voidKind === 'loan' ? 'Préstamo anulado.' : 'Abono anulado.');
      this.voidVisible = false;
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo anular.');
    } finally {
      this.saving.set(false);
    }
  }
}
