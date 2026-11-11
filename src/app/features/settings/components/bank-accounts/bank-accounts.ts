import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { CURRENCY_OPTIONS, Currency } from '../../../../core/models/domain';
import {
  AccountMovements,
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_ACCOUNT_TYPE_OPTIONS,
  Bank,
  BankAccount,
  BankAccountType,
  BankAccountsSummary,
  HOLDER_DOC_OPTIONS,
  HolderDocType,
  WALLET_OPTIONS,
  Wallet,
  accountNumberValidator,
  cciCheckDigitsOk,
  cciValidator,
  holderDocValidator,
  onlyDigits,
  walletPhoneValidator,
} from '../../../../core/models/bank.model';
import { BankAccountsService } from '../../../../core/services/bank-accounts.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { endOfToday, toIsoDate } from '../../../../shared/utils/db';

/** Configuración → Bancos y cuentas: cuentas de la empresa (banco, billetera o caja) y sus movimientos del periodo. */
@Component({
  selector: 'app-bank-accounts',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    TableModule,
    TagModule,
    TextareaModule,
    ToggleSwitchModule,
    TooltipModule,
    EmptyState,
    FieldError,
    LabelPipe,
    MoneyPipe,
  ],
  template: `
    <p class="muted small" style="margin-top: 0">
      Cuentas donde entra y sale el dinero. Al registrar un cobro o un gasto se elige la cuenta según el método:
      efectivo → caja, Yape/Plin → su billetera, transferencia, tarjeta o cheque → cuenta bancaria. La cuenta principal se propone sola.
    </p>

    <div class="toolbar-filters">
      <p-datepicker [(ngModel)]="range" selectionMode="range" dateFormat="dd/mm/yy" [showIcon]="true" placeholder="Periodo" [readonlyInput]="true" (onClose)="loadSummary()" pTooltip="Periodo de las entradas y salidas" />
      <div class="row">
        <p-checkbox inputId="ba-inactive" [(ngModel)]="showInactive" [binary]="true" />
        <label for="ba-inactive" class="small">Mostrar desactivadas</label>
      </div>
      <span class="spacer"></span>
      <p-button label="Bancos" icon="pi pi-building-columns" severity="secondary" [outlined]="true" (onClick)="openBanks()" />
      <p-button label="Nueva cuenta" icon="pi pi-plus" (onClick)="openNew()" />
    </div>

    <p-table [value]="visible()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '1000px' }" [rowHover]="true" size="small">
      <ng-template #header>
        <tr>
          <th>Cuenta</th><th>Tipo</th><th>N.° de cuenta / celular</th><th>CCI</th><th>Titular</th>
          <th class="text-right">Entradas</th><th class="text-right">Salidas</th><th></th>
        </tr>
      </ng-template>
      <ng-template #body let-a>
        <tr [style.opacity]="a.active ? 1 : 0.5">
          <td>
            <span class="strong">{{ a.alias }}</span>
            <span class="muted small"> · {{ a.currency === 'USD' ? 'US$' : 'S/' }}</span>
            @if (a.is_default) {
              <p-tag value="Principal" severity="info" [style]="{ 'margin-left': '0.35rem' }" />
            }
            @if (!a.active) {
              <p-tag value="Desactivada" severity="secondary" [style]="{ 'margin-left': '0.35rem' }" />
            }
            @if (a.bank) {
              <br /><span class="muted small">{{ a.bank.short_name }}</span>
            }
          </td>
          <td class="small">{{ a.account_type === 'BILLETERA' ? (a.wallet === 'YAPE' ? 'Yape' : 'Plin') : (a.account_type | label: typeLabels) }}</td>
          <td class="mono small nowrap">{{ a.account_number ?? a.phone ?? '—' }}</td>
          <td class="mono small nowrap">
            @if (a.cci) {
              {{ formatCci(a.cci) }}
              <p-button icon="pi pi-copy" [text]="true" size="small" severity="secondary" ariaLabel="Copiar CCI" pTooltip="Copiar CCI" (onClick)="copy(a.cci)" />
            } @else {
              —
            }
          </td>
          <td class="small">{{ a.holder_name ?? '—' }}@if (a.holder_doc) {<br /><span class="muted">{{ a.holder_doc_type }} {{ a.holder_doc }}</span>}</td>
          <td class="text-right mono nowrap text-success">{{ mov(a.id)?.income ?? 0 | money: a.currency }}</td>
          <td class="text-right mono nowrap text-danger">{{ mov(a.id)?.outflow ?? 0 | money: a.currency }}</td>
          <td class="text-right nowrap">
            <p-button icon="pi pi-pencil" [text]="true" severity="secondary" ariaLabel="Editar" (onClick)="openEdit(a)" />
            <p-button icon="pi pi-trash" [text]="true" severity="danger" ariaLabel="Eliminar" pTooltip="Eliminar (solo si no tiene movimientos)" (onClick)="remove(a)" />
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr><td colspan="8"><app-empty-state icon="pi pi-wallet" message="No hay cuentas registradas." /></td></tr>
      </ng-template>
    </p-table>

    @for (u of summary()?.unassigned ?? []; track u.currency) {
      <p class="muted small">
        Sin cuenta asignada en el periodo ({{ u.currency === 'USD' ? 'dólares' : 'soles' }}):
        entradas {{ u.income | money: u.currency }} ({{ u.income_count }}) · salidas {{ u.outflow | money: u.currency }} ({{ u.outflow_count }}).
        Son movimientos anteriores a las cuentas o sin una cuenta compatible.
      </p>
    }

    <!-- Cuenta -->
    <p-dialog [header]="editing() ? 'Editar cuenta' : 'Nueva cuenta'" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '640px' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" class="form-grid" novalidate>
        <div class="field">
          <label for="ba-type">Tipo <span class="req">*</span></label>
          <p-select inputId="ba-type" [options]="typeOptions" formControlName="account_type" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="ba-cur">Moneda <span class="req">*</span></label>
          <p-select inputId="ba-cur" [options]="currencies" formControlName="currency" optionLabel="label" optionValue="value" appendTo="body" />
          @if (type() === 'BILLETERA') {
            <small class="muted">Yape y Plin solo operan en soles.</small>
          }
        </div>

        @if (type() === 'BILLETERA') {
          <div class="field">
            <label for="ba-wallet">Billetera <span class="req">*</span></label>
            <p-select inputId="ba-wallet" [options]="wallets" formControlName="wallet" optionLabel="label" optionValue="value" appendTo="body" />
            <app-field-error [control]="form.controls.wallet" />
          </div>
          <div class="field">
            <label for="ba-phone">Celular <span class="req">*</span></label>
            <input pInputText id="ba-phone" formControlName="phone" inputmode="numeric" placeholder="987654321" />
            <app-field-error [control]="form.controls.phone" />
          </div>
        }

        @if (type() !== 'CAJA') {
          <div class="field field--full">
            <label for="ba-bank">Banco @if (isBankType()) {<span class="req">*</span>}</label>
            <p-select inputId="ba-bank" [options]="activeBanks()" formControlName="bank_id" optionLabel="name" optionValue="id" [filter]="true" filterBy="name,short_name,code" [showClear]="!isBankType()" placeholder="Seleccione el banco" appendTo="body">
              <ng-template #item let-b><span class="mono muted small">{{ b.code }}</span> {{ b.name }}</ng-template>
            </p-select>
            <app-field-error [control]="form.controls.bank_id" />
          </div>
        }

        @if (isBankType()) {
          <div class="field">
            <label for="ba-number">N.° de cuenta <span class="req">*</span></label>
            <input pInputText id="ba-number" formControlName="account_number" inputmode="numeric" placeholder="191-12345678-0-12" />
            <app-field-error [control]="form.controls.account_number" />
          </div>
          <div class="field">
            <label for="ba-cci">CCI (20 dígitos) <span class="req">*</span></label>
            <input pInputText id="ba-cci" formControlName="cci" inputmode="numeric" maxlength="26" [placeholder]="(bankCode() ?? '002') + '...'" />
            <app-field-error [control]="form.controls.cci" />
            @if (cciWarning()) {
              <small class="text-warn">Los dígitos de control del CCI no cuadran: revíselo con el voucher o la app del banco.</small>
            }
          </div>
        }

        <div class="field field--full">
          <label for="ba-alias">Nombre de la cuenta <span class="req">*</span></label>
          <input pInputText id="ba-alias" formControlName="alias" [placeholder]="aliasHint()" />
          <app-field-error [control]="form.controls.alias" />
        </div>

        @if (type() !== 'CAJA') {
          <div class="field field--full">
            <label for="ba-holder">Titular</label>
            <input pInputText id="ba-holder" formControlName="holder_name" placeholder="Razón social o nombre" />
            <app-field-error [control]="form.controls.holder_name" />
          </div>
          <div class="field">
            <label for="ba-doctype">Documento del titular</label>
            <p-select inputId="ba-doctype" [options]="docTypes" formControlName="holder_doc_type" optionLabel="label" optionValue="value" [showClear]="true" placeholder="RUC o DNI" appendTo="body" />
          </div>
          <div class="field">
            <label for="ba-doc">N.° de documento</label>
            <input pInputText id="ba-doc" formControlName="holder_doc" inputmode="numeric" />
            <app-field-error [control]="form.controls.holder_doc" />
          </div>
        }

        <div class="field field--full">
          <label for="ba-notes">Notas</label>
          <textarea pTextarea id="ba-notes" formControlName="notes" rows="2" [autoResize]="true"></textarea>
        </div>
        <div class="field row">
          <p-toggleswitch inputId="ba-default" formControlName="is_default" />
          <label for="ba-default">Principal para {{ type() === 'BILLETERA' ? 'esta billetera' : 'este tipo' }} y moneda</label>
        </div>
        <div class="field row">
          <p-toggleswitch inputId="ba-active" formControlName="active" />
          <label for="ba-active">Activa</label>
        </div>
        <div class="form-actions field--full">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="dialogVisible = false" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>

    <!-- Bancos -->
    <p-dialog header="Bancos" [(visible)]="banksVisible" [modal]="true" [style]="{ width: '620px' }" [draggable]="false">
      <p class="muted small" style="margin-top: 0">El código (3 dígitos) son los 3 primeros dígitos del CCI de las cuentas de ese banco.</p>
      <p-table [value]="allBanks()" size="small" [scrollable]="true" scrollHeight="320px">
        <ng-template #header>
          <tr><th>Código</th><th>Banco</th><th>Nombre corto</th><th>Activo</th><th></th></tr>
        </ng-template>
        <ng-template #body let-b>
          <tr [style.opacity]="b.active ? 1 : 0.5">
            <td class="mono">{{ b.code }}</td>
            <td>{{ b.name }}</td>
            <td>{{ b.short_name }}</td>
            <td><p-toggleswitch [ngModel]="b.active" (ngModelChange)="toggleBank(b)" /></td>
            <td><p-button icon="pi pi-pencil" [text]="true" size="small" severity="secondary" ariaLabel="Editar" (onClick)="editBank(b)" /></td>
          </tr>
        </ng-template>
      </p-table>
      <form [formGroup]="bankForm" (ngSubmit)="saveBank()" class="bank-form" novalidate>
        <div class="field">
          <label for="bk-code">Código</label>
          <input pInputText id="bk-code" formControlName="code" maxlength="3" inputmode="numeric" placeholder="002" />
        </div>
        <div class="field">
          <label for="bk-name">Banco</label>
          <input pInputText id="bk-name" formControlName="name" placeholder="Caja Arequipa" />
        </div>
        <div class="field">
          <label for="bk-short">Nombre corto</label>
          <input pInputText id="bk-short" formControlName="short_name" maxlength="20" />
        </div>
        <div class="row">
          @if (editingBank()) {
            <p-button icon="pi pi-times" [text]="true" severity="secondary" ariaLabel="Cancelar" (onClick)="resetBankForm()" />
          }
          <p-button type="submit" [label]="editingBank() ? 'Guardar' : 'Agregar'" [icon]="editingBank() ? 'pi pi-check' : 'pi pi-plus'" [disabled]="bankForm.invalid" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>
  `,
  styles: `
    .spacer {
      flex: 1;
    }
    .text-warn {
      color: var(--p-orange-600);
      font-size: 0.8rem;
      display: block;
      margin-top: 0.25rem;
    }
    .bank-form {
      display: grid;
      grid-template-columns: 80px 1fr 140px auto;
      gap: 0.5rem;
      align-items: end;
      margin-top: 1rem;
    }
    @media (max-width: 560px) {
      .bank-form {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class BankAccounts implements OnInit {
  private readonly service = inject(BankAccountsService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly fb = inject(FormBuilder);

  protected readonly typeOptions = BANK_ACCOUNT_TYPE_OPTIONS;
  protected readonly typeLabels = BANK_ACCOUNT_TYPE_LABELS;
  protected readonly wallets = WALLET_OPTIONS;
  protected readonly docTypes = HOLDER_DOC_OPTIONS;
  protected readonly currencies = CURRENCY_OPTIONS;

  private readonly today = endOfToday();
  protected range: Date[] | null = [new Date(this.today.getFullYear(), this.today.getMonth(), 1), this.today];
  protected showInactive = false;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly allBanks = signal<Bank[]>([]);
  protected readonly activeBanks = computed(() => this.allBanks().filter((b) => b.active));
  protected readonly summary = signal<BankAccountsSummary | null>(null);
  protected readonly editing = signal<BankAccount | null>(null);
  protected readonly editingBank = signal<Bank | null>(null);
  protected dialogVisible = false;
  protected banksVisible = false;

  protected visible(): BankAccount[] {
    const rows = this.service.accounts();
    return this.showInactive ? rows : rows.filter((a) => a.active);
  }

  private readonly movements = computed(() => new Map((this.summary()?.accounts ?? []).map((m) => [m.id, m])));
  protected mov(id: string): AccountMovements | undefined {
    return this.movements().get(id);
  }

  protected readonly form = this.fb.group({
    account_type: ['AHORROS' as BankAccountType, Validators.required],
    currency: ['PEN' as Currency, Validators.required],
    bank_id: [null as string | null],
    wallet: [null as Wallet | null],
    phone: [''],
    account_number: [''],
    cci: [''],
    alias: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(60)]],
    holder_name: ['', [Validators.minLength(3), Validators.maxLength(150)]],
    holder_doc_type: [null as HolderDocType | null],
    holder_doc: ['', holderDocValidator('holder_doc_type')],
    notes: [''],
    is_default: [false],
    active: [true],
  });

  protected readonly bankForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{3}$/)]],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    short_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(20)]],
  });

  // Estado del formulario como signals (para el template)
  protected readonly type = signal<BankAccountType>('AHORROS');
  protected readonly isBankType = computed(() => this.type() === 'AHORROS' || this.type() === 'CORRIENTE');
  private readonly bankId = signal<string | null>(null);
  protected readonly bankCode = computed(() => this.allBanks().find((b) => b.id === this.bankId())?.code ?? null);
  private readonly cciValue = signal('');
  /** Aviso (no bloquea): dígitos de control del CCI. */
  protected readonly cciWarning = computed(() => {
    const v = onlyDigits(this.cciValue());
    return v.length === 20 && !cciCheckDigitsOk(v);
  });
  protected readonly aliasHint = computed(() => {
    const cur = this.form.controls.currency.value === 'USD' ? 'dólares' : 'soles';
    switch (this.type()) {
      case 'CAJA':
        return `Ej.: Caja ${cur} tienda`;
      case 'BILLETERA':
        return 'Ej.: Yape tienda';
      default:
        return `Ej.: ${this.allBanks().find((b) => b.id === this.bankId())?.short_name ?? 'BCP'} ${cur}`;
    }
  });

  constructor() {
    this.form.controls.account_type.valueChanges.subscribe((t) => this.applyType(t ?? 'AHORROS'));
    this.form.controls.bank_id.valueChanges.subscribe((id) => {
      this.bankId.set(id);
      this.form.controls.cci.updateValueAndValidity({ emitEvent: false });
    });
    this.form.controls.cci.valueChanges.subscribe((v) => this.cciValue.set(v ?? ''));
    this.form.controls.holder_doc_type.valueChanges.subscribe(() => this.form.controls.holder_doc.updateValueAndValidity({ emitEvent: false }));
    this.form.controls.wallet.valueChanges.subscribe((w) => {
      // Yape es del BCP: se propone el banco si está vacío
      if (w === 'YAPE' && !this.form.controls.bank_id.value) {
        const bcp = this.allBanks().find((b) => b.code === '002');
        if (bcp) this.form.controls.bank_id.setValue(bcp.id);
      }
    });
    this.form.controls.active.valueChanges.subscribe((on) => {
      if (!on) this.form.controls.is_default.setValue(false, { emitEvent: false });
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const [banks] = await Promise.all([this.service.banks(true), this.service.ensureLoaded(true)]);
      this.allBanks.set(banks);
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar las cuentas.');
    } finally {
      this.loading.set(false);
    }
    await this.loadSummary();
  }

  protected async loadSummary(): Promise<void> {
    const [from, to] = this.range ?? [];
    if (!from) return;
    try {
      this.summary.set(await this.service.summary(toIsoDate(from)!, toIsoDate(to ?? from)!));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los movimientos por cuenta.');
    }
  }

  /** Validadores obligatorios según el tipo. */
  private applyType(t: BankAccountType): void {
    this.type.set(t);
    const c = this.form.controls;
    const set = (ctrl: (typeof c)[keyof typeof c], validators: ValidatorFn[]) => {
      ctrl.setValidators(validators);
      ctrl.updateValueAndValidity({ emitEvent: false });
    };
    const bank = t === 'AHORROS' || t === 'CORRIENTE';
    set(c.bank_id, bank ? [Validators.required] : []);
    set(c.account_number, bank ? [Validators.required, accountNumberValidator] : []);
    set(c.cci, bank ? [Validators.required, cciValidator(() => this.bankCode())] : []);
    set(c.wallet, t === 'BILLETERA' ? [Validators.required] : []);
    set(c.phone, t === 'BILLETERA' ? [Validators.required, walletPhoneValidator] : []);
    if (t === 'BILLETERA') c.currency.setValue('PEN');
    if (t === 'BILLETERA') c.currency.disable({ emitEvent: false });
    else c.currency.enable({ emitEvent: false });
  }

  protected openNew(): void {
    this.editing.set(null);
    this.form.reset({
      account_type: 'AHORROS', currency: 'PEN', bank_id: null, wallet: null, phone: '', account_number: '', cci: '', alias: '',
      holder_name: '', holder_doc_type: null, holder_doc: '', notes: '', is_default: false, active: true,
    });
    this.applyType('AHORROS');
    this.dialogVisible = true;
  }

  protected openEdit(a: BankAccount): void {
    this.editing.set(a);
    this.form.reset({
      account_type: a.account_type, currency: a.currency, bank_id: a.bank_id, wallet: a.wallet, phone: a.phone ?? '',
      account_number: a.account_number ?? '', cci: a.cci ?? '', alias: a.alias, holder_name: a.holder_name ?? '',
      holder_doc_type: a.holder_doc_type, holder_doc: a.holder_doc ?? '', notes: a.notes ?? '', is_default: a.is_default, active: a.active,
    });
    this.applyType(a.account_type);
    this.dialogVisible = true;
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const t = v.account_type!;
    const bank = t === 'AHORROS' || t === 'CORRIENTE';
    const hasDoc = t !== 'CAJA' && !!onlyDigits(v.holder_doc);
    this.saving.set(true);
    try {
      await this.service.save(this.editing()?.id ?? null, {
        account_type: t,
        currency: t === 'BILLETERA' ? 'PEN' : v.currency!,
        bank_id: t === 'CAJA' ? null : v.bank_id,
        wallet: t === 'BILLETERA' ? v.wallet : null,
        phone: t === 'BILLETERA' ? onlyDigits(v.phone).replace(/^51(?=9\d{8}$)/, '') : null,
        account_number: bank ? onlyDigits(v.account_number) : null,
        cci: bank ? onlyDigits(v.cci) : null,
        alias: v.alias!.trim(),
        holder_name: t !== 'CAJA' ? v.holder_name?.trim() || null : null,
        holder_doc_type: hasDoc ? v.holder_doc_type : null,
        holder_doc: hasDoc ? onlyDigits(v.holder_doc) : null,
        notes: v.notes?.trim() || null,
        is_default: !!v.is_default && !!v.active,
        active: !!v.active,
      });
      this.notify.success(this.editing() ? 'Cuenta actualizada.' : 'Cuenta registrada.');
      this.dialogVisible = false;
      await this.loadSummary();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar la cuenta.');
    } finally {
      this.saving.set(false);
    }
  }

  protected remove(a: BankAccount): void {
    this.confirm.confirm({
      header: 'Eliminar cuenta',
      message: `¿Eliminar la cuenta "${a.alias}"? Solo se puede si no tiene cobros ni gastos registrados; si los tiene, desactívela.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: 'Eliminar', severity: 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: async () => {
        try {
          await this.service.remove(a.id);
          this.notify.success('Cuenta eliminada.');
        } catch (err) {
          this.notify.error(err, 'No se pudo eliminar la cuenta.');
        }
      },
    });
  }

  protected formatCci(cci: string): string {
    return `${cci.slice(0, 3)}-${cci.slice(3, 6)}-${cci.slice(6, 18)}-${cci.slice(18)}`;
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.notify.success('CCI copiado.');
    } catch {
      this.notify.error(new Error('No se pudo copiar.'), 'No se pudo copiar.');
    }
  }

  // ---------------------------------------------------------------- Bancos
  protected openBanks(): void {
    this.resetBankForm();
    this.banksVisible = true;
  }

  protected resetBankForm(): void {
    this.editingBank.set(null);
    this.bankForm.reset({ code: '', name: '', short_name: '' });
  }

  protected editBank(b: Bank): void {
    this.editingBank.set(b);
    this.bankForm.reset({ code: b.code, name: b.name, short_name: b.short_name });
  }

  protected async saveBank(): Promise<void> {
    if (this.bankForm.invalid) return;
    const v = this.bankForm.getRawValue();
    const b = this.editingBank();
    this.saving.set(true);
    try {
      await this.service.saveBank(b?.id ?? null, { code: v.code.trim(), name: v.name.trim(), short_name: v.short_name.trim(), active: b?.active ?? true });
      this.allBanks.set(await this.service.banks(true));
      this.notify.success(b ? 'Banco actualizado.' : 'Banco agregado.');
      this.resetBankForm();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el banco.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleBank(b: Bank): Promise<void> {
    try {
      await this.service.saveBank(b.id, { code: b.code, name: b.name, short_name: b.short_name, active: !b.active });
      this.allBanks.set(await this.service.banks(true));
    } catch (err) {
      this.notify.error(err, 'No se pudo actualizar el banco.');
    }
  }
}
