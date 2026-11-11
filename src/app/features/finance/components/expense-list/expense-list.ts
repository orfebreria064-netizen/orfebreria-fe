import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { CURRENCY_OPTIONS, Currency, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_OPTIONS, PaymentMethod } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { BankAccountsService } from '../../../../core/services/bank-accounts.service';
import { accountAcceptsMethod, accountLabel, compatibleAccounts, missingAccountHint, suggestedAccount } from '../../../../core/models/bank.model';
import { AuthService } from '../../../../core/auth/auth.service';
import { RouterLink } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { endOfToday, fromIsoDate, toIsoDate } from '../../../../shared/utils/db';
import { positiveValidator } from '../../../../shared/utils/validators';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_OPTIONS, Expense, ExpenseCategory, FinanceService } from '../../services/finance.service';

/** Registro de gastos de la empresa por periodo; no se eliminan, se anulan con motivo. */
@Component({
  selector: 'app-expense-list',
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
    SelectModule,
    TableModule,
    TagModule,
    TextareaModule,
    EmptyState,
    FieldError,
    LabelPipe,
    MoneyPipe,
    MessageModule,
    RouterLink,
  ],
  template: `
    <div class="toolbar-filters">
      <p-datepicker [(ngModel)]="range" selectionMode="range" dateFormat="dd/mm/yy" [showIcon]="true" placeholder="Periodo" [readonlyInput]="true" (onClose)="load()" />
      <p-select [options]="categories" [(ngModel)]="category" optionLabel="label" optionValue="value" placeholder="Todas las categorías" [showClear]="true" />
      <div class="row">
        <p-checkbox inputId="exp-voided" [(ngModel)]="includeVoided" [binary]="true" (onChange)="load()" />
        <label for="exp-voided" class="small">Mostrar anulados</label>
      </div>
      <span class="spacer"></span>
      <span class="small">Total: <strong class="mono">{{ total() }}</strong></span>
      <p-button label="Nuevo gasto" icon="pi pi-plus" (onClick)="openNew()" />
    </div>

    <p-table [value]="filtered()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '900px' }" [rowHover]="true" [paginator]="filtered().length > 25" [rows]="25">
      <ng-template #header>
        <tr>
          <th>N.°</th><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Proveedor / comprobante</th><th>Método</th><th class="text-right">Monto</th><th></th>
        </tr>
      </ng-template>
      <ng-template #body let-e>
        <tr [class.voided]="e.voided">
          <td class="nowrap mono small">{{ e.number }}</td>
          <td class="nowrap">{{ e.expense_date | date: 'dd/MM/yyyy' }}</td>
          <td>{{ e.category | label: categoryLabels }}</td>
          <td>
            {{ e.description }}
            @if (e.voided) {
              <p-tag value="Anulado" severity="danger" [title]="e.void_reason ?? ''" />
            }
          </td>
          <td class="small">{{ e.supplier ?? '—' }}@if (e.document_ref) {<br /><span class="muted">{{ e.document_ref }}</span>}</td>
          <td>{{ e.method | label: methodLabels }}@if (e.bank_account) {<br /><span class="muted small">{{ e.bank_account.alias }}</span>}</td>
          <td class="text-right mono nowrap">{{ e.amount | money: e.currency }}</td>
          <td class="text-right nowrap">
            @if (!e.voided) {
              <p-button icon="pi pi-pencil" [text]="true" severity="secondary" ariaLabel="Editar" (onClick)="openEdit(e)" />
              <p-button icon="pi pi-ban" [text]="true" severity="danger" ariaLabel="Anular" (onClick)="openVoid(e)" />
            }
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr><td colspan="8"><app-empty-state icon="pi pi-receipt" message="No hay gastos en el periodo." /></td></tr>
      </ng-template>
    </p-table>

    <p-dialog [header]="editing() ? 'Editar gasto ' + editing()!.number : 'Nuevo gasto'" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '600px' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" class="form-grid" novalidate>
        <div class="field">
          <label for="ex-date">Fecha <span class="req">*</span></label>
          <p-datepicker inputId="ex-date" formControlName="expense_date" dateFormat="dd/mm/yy" [maxDate]="today" [showIcon]="true" appendTo="body" [fluid]="true" />
        </div>
        <div class="field">
          <label for="ex-cat">Categoría <span class="req">*</span></label>
          <p-select inputId="ex-cat" [options]="categories" formControlName="category" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field field--full">
          <label for="ex-desc">Descripción <span class="req">*</span></label>
          <input pInputText id="ex-desc" formControlName="description" placeholder="Ej.: Planilla de octubre, recibo de luz" />
          <app-field-error [control]="form.controls.description" />
        </div>
        <div class="field">
          <label for="ex-amount">Monto <span class="req">*</span></label>
          <p-inputnumber inputId="ex-amount" formControlName="amount" mode="currency" [currency]="form.controls.currency.value ?? 'PEN'" locale="es-PE" [min]="0" [fluid]="true" />
          <app-field-error [control]="form.controls.amount" />
        </div>
        <div class="field">
          <label for="ex-cur">Moneda</label>
          <p-select inputId="ex-cur" [options]="currencies" formControlName="currency" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="ex-method">Método de pago <span class="req">*</span></label>
          <p-select inputId="ex-method" [options]="methods" formControlName="method" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="ex-account">
            {{ method() === 'EFECTIVO' ? 'Caja' : 'Banco / cuenta de origen' }} ({{ currency() === 'USD' ? 'US$' : 'S/' }})
            @if (accountOptions().length) {<span class="req">*</span>}
          </label>
          @if (accountOptions().length) {
            <p-select inputId="ex-account" [options]="accountOptions()" formControlName="bank_account_id" optionValue="id" placeholder="¿De qué cuenta salió?" appendTo="body">
              <ng-template #selectedItem let-a>{{ accountLabel(a) }}</ng-template>
              <ng-template #item let-a>{{ accountLabel(a) }}@if (a.is_default) {<span class="muted small"> · principal</span>}</ng-template>
            </p-select>
            <app-field-error [control]="form.controls.bank_account_id" />
          } @else {
            <p-message severity="warn" size="small" icon="pi pi-exclamation-triangle">
              {{ accountHint() }} El gasto quedará sin cuenta.
              @if (canConfigure) {
                <a routerLink="/settings" [queryParams]="{ tab: 'banks' }" (click)="dialogVisible = false">Registrar cuenta</a>
              }
            </p-message>
          }
        </div>
        <div class="field">
          <label for="ex-sup">Proveedor / pagado a</label>
          <input pInputText id="ex-sup" formControlName="supplier" />
        </div>
        <div class="field">
          <label for="ex-doc">Comprobante (factura, boleta, recibo)</label>
          <input pInputText id="ex-doc" formControlName="document_ref" />
        </div>
        <div class="field field--full">
          <label for="ex-notes">Notas</label>
          <textarea pTextarea id="ex-notes" formControlName="notes" rows="2" [autoResize]="true"></textarea>
        </div>
        <div class="form-actions field--full">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="dialogVisible = false" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>

    <p-dialog header="Anular gasto" [(visible)]="voidVisible" [modal]="true" [style]="{ width: '440px' }" [draggable]="false">
      <p class="small" style="margin-top: 0">{{ voidTarget()?.number }} · {{ voidTarget()?.description }}</p>
      <div class="field">
        <label for="ex-void">Motivo de la anulación <span class="req">*</span></label>
        <textarea pTextarea id="ex-void" [(ngModel)]="voidReason" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="voidVisible = false" />
        <p-button label="Anular gasto" severity="danger" icon="pi pi-ban" [disabled]="!voidReason.trim()" [loading]="saving()" (onClick)="confirmVoid()" />
      </div>
    </p-dialog>
  `,
  styles: `
    .spacer {
      flex: 1;
    }
    tr.voided td {
      color: var(--p-surface-400);
      text-decoration: line-through;
    }
    tr.voided td p-tag {
      text-decoration: none;
    }
  `,
})
export class ExpenseList implements OnInit {
  private readonly service = inject(FinanceService);
  private readonly notify = inject(NotifyService);
  private readonly bankAccounts = inject(BankAccountsService);

  protected readonly categories = EXPENSE_CATEGORY_OPTIONS;
  protected readonly categoryLabels = EXPENSE_CATEGORY_LABELS;
  protected readonly methods = PAYMENT_METHOD_OPTIONS;
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly currencies = CURRENCY_OPTIONS;
  protected readonly today = endOfToday();

  protected range: Date[] | null = [new Date(this.today.getFullYear(), this.today.getMonth(), 1), this.today];
  protected category: ExpenseCategory | null = null;
  protected includeVoided = false;

  protected readonly rows = signal<Expense[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly editing = signal<Expense | null>(null);
  protected readonly voidTarget = signal<Expense | null>(null);
  protected dialogVisible = false;
  protected voidVisible = false;
  protected voidReason = '';

  protected filtered(): Expense[] {
    return this.category ? this.rows().filter((e) => e.category === this.category) : this.rows();
  }

  /** Totales vigentes por moneda. */
  protected readonly total = computed(() => {
    const valid = this.rows().filter((e) => !e.voided);
    const pen = valid.filter((e) => e.currency === 'PEN').reduce((a, e) => a + Number(e.amount), 0);
    const usd = valid.filter((e) => e.currency === 'USD').reduce((a, e) => a + Number(e.amount), 0);
    return usd ? `${formatMoney(pen)} · ${formatMoney(usd, 'USD')}` : formatMoney(pen);
  });

  protected readonly form = inject(FormBuilder).group({
    expense_date: [new Date() as Date | null, Validators.required],
    category: ['SERVICIOS' as ExpenseCategory, Validators.required],
    description: ['', [Validators.required, Validators.maxLength(300)]],
    amount: [null as number | null, [Validators.required, positiveValidator]],
    currency: ['PEN' as Currency, Validators.required],
    method: ['EFECTIVO' as PaymentMethod, Validators.required],
    bank_account_id: [null as string | null],
    supplier: [''],
    document_ref: [''],
    notes: [''],
  });

  protected readonly method = toSignal(this.form.controls.method.valueChanges, { initialValue: this.form.controls.method.value });
  protected readonly currency = toSignal(this.form.controls.currency.valueChanges, { initialValue: this.form.controls.currency.value });
  /** Cuentas activas compatibles con el método y la moneda; al editar se conserva la ya asignada aunque esté desactivada. */
  protected readonly accountOptions = computed(() => {
    const options = compatibleAccounts(this.bankAccounts.accounts(), this.method(), this.currency() ?? 'PEN');
    const current = this.editing()?.bank_account_id;
    const kept = this.bankAccounts.accounts().find((a) => a.id === current && !a.active);
    return kept && kept.currency === this.currency() && accountAcceptsMethod(kept, this.method()) ? [...options, kept] : options;
  });
  protected readonly accountLabel = accountLabel;
  protected readonly accountHint = computed(() => missingAccountHint(this.method(), this.currency() ?? 'PEN'));
  protected readonly canConfigure = inject(AuthService).hasRole('ADMIN');

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
  }

  ngOnInit(): void {
    void this.load();
    void this.bankAccounts.ensureLoaded().catch((err) => this.notify.error(err, 'No se pudieron cargar las cuentas.'));
  }

  protected async load(): Promise<void> {
    const [from, to] = this.range ?? [];
    if (!from) return;
    this.loading.set(true);
    try {
      this.rows.set(await this.service.expenses(toIsoDate(from)!, toIsoDate(to ?? from)!, this.includeVoided));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los gastos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected openNew(): void {
    this.editing.set(null);
    this.form.reset({ expense_date: new Date(), category: 'SERVICIOS', description: '', amount: null, currency: 'PEN', method: 'EFECTIVO', bank_account_id: null, supplier: '', document_ref: '', notes: '' });
    this.dialogVisible = true;
  }

  protected openEdit(e: Expense): void {
    this.editing.set(e);
    this.form.reset({
      expense_date: fromIsoDate(e.expense_date),
      category: e.category,
      description: e.description,
      amount: Number(e.amount),
      currency: e.currency,
      method: e.method,
      bank_account_id: e.bank_account_id,
      supplier: e.supplier ?? '',
      document_ref: e.document_ref ?? '',
      notes: e.notes ?? '',
    });
    this.dialogVisible = true;
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    try {
      const { number } = await this.service.saveExpense(this.editing()?.id ?? null, {
        expense_date: toIsoDate(v.expense_date)!,
        category: v.category!,
        description: v.description!.trim(),
        amount: Number(v.amount),
        currency: v.currency!,
        method: v.method!,
        bank_account_id: v.bank_account_id || null,
        supplier: v.supplier?.trim() || null,
        document_ref: v.document_ref?.trim() || null,
        notes: v.notes?.trim() || null,
      });
      this.notify.success(this.editing() ? `Gasto ${number} actualizado.` : `Gasto ${number} registrado.`);
      this.dialogVisible = false;
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el gasto.');
    } finally {
      this.saving.set(false);
    }
  }

  protected openVoid(e: Expense): void {
    this.voidTarget.set(e);
    this.voidReason = '';
    this.voidVisible = true;
  }

  protected async confirmVoid(): Promise<void> {
    const e = this.voidTarget();
    if (!e) return;
    this.saving.set(true);
    try {
      await this.service.voidExpense(e.id, this.voidReason.trim());
      this.notify.success(`Gasto ${e.number} anulado.`);
      this.voidVisible = false;
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo anular el gasto.');
    } finally {
      this.saving.set(false);
    }
  }
}
