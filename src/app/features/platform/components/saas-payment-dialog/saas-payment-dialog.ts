import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { NotifyService } from '../../../../core/services/notify.service';
import { PaymentMethodSaas, Plan, PlatformOrganization, SAAS_PAYMENT_METHOD_OPTIONS } from '../../../../core/models/subscription.model';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { fromIsoDate } from '../../../../shared/utils/db';
import { PlatformService } from '../../services/platform.service';

const MONTH_OPTIONS = [
  { value: 1, label: '1 mes' },
  { value: 3, label: '3 meses' },
  { value: 6, label: '6 meses' },
  { value: 12, label: '12 meses (precio anual)' },
];

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * Registra un pago de suscripción y extiende el periodo. El monto se sugiere según el plan
 * (12 meses = precio anual); el cálculo definitivo del periodo lo hace platform_register_payment().
 */
@Component({
  selector: 'app-saas-payment-dialog',
  imports: [DatePipe, ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule, InputNumberModule, SelectModule, DatePickerModule, FieldError],
  template: `
    <p-dialog header="Registrar pago" [(visible)]="visible" [modal]="true" [style]="{ width: '520px' }" [draggable]="false">
      @if (org(); as o) {
        <p class="muted" style="margin-top: 0">
          <strong>{{ o.name }}</strong> · vence {{ o.current_period_end | date: 'dd/MM/yyyy' }}
        </p>
        <form [formGroup]="form" (ngSubmit)="save()" class="form-grid" novalidate>
          <div class="field">
            <label for="sp-plan">Plan <span class="req">*</span></label>
            <p-select inputId="sp-plan" [options]="plans()" formControlName="plan_code" optionLabel="name" optionValue="code" appendTo="body" />
          </div>
          <div class="field">
            <label for="sp-months">Periodo <span class="req">*</span></label>
            <p-select inputId="sp-months" [options]="monthOptions" formControlName="months" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field">
            <label for="sp-amount">Monto recibido <span class="req">*</span></label>
            <p-inputnumber inputId="sp-amount" formControlName="amount" mode="currency" currency="PEN" locale="es-PE" [min]="0" [fluid]="true" />
            <app-field-error [control]="form.controls.amount" />
          </div>
          <div class="field">
            <label for="sp-method">Medio <span class="req">*</span></label>
            <p-select inputId="sp-method" [options]="methods" formControlName="method" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field">
            <label for="sp-date">Fecha de pago <span class="req">*</span></label>
            <p-datepicker inputId="sp-date" formControlName="paid_at" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" [fluid]="true" />
          </div>
          <div class="field">
            <label for="sp-ref">N.° de operación</label>
            <input pInputText id="sp-ref" formControlName="reference" />
          </div>
          @if (preview(); as p) {
            <p class="field--full preview">
              <i class="pi pi-calendar"></i>
              Nuevo periodo: <strong>{{ p.start | date: 'dd/MM/yyyy' }}</strong> al <strong>{{ p.end | date: 'dd/MM/yyyy' }}</strong>
              @if (p.continues) {
                <small class="muted">(continúa desde el vencimiento actual)</small>
              }
            </p>
          }
          <div class="form-actions field--full">
            <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
            <p-button type="submit" label="Registrar pago" icon="pi pi-check" [loading]="saving()" />
          </div>
        </form>
      }
    </p-dialog>
  `,
  styles: `
    .preview {
      margin: 0;
      padding: 0.6rem 0.75rem;
      border-radius: 0.5rem;
      background: var(--p-surface-50);
      font-size: 0.875rem;
    }
  `,
})
export class SaasPaymentDialog {
  private readonly service = inject(PlatformService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  readonly org = input<PlatformOrganization | null>(null);
  readonly plans = input<Plan[]>([]);
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly monthOptions = MONTH_OPTIONS;
  protected readonly methods = SAAS_PAYMENT_METHOD_OPTIONS;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    plan_code: ['', Validators.required],
    months: [1, Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    method: ['YAPE' as PaymentMethodSaas, Validators.required],
    paid_at: [new Date(), Validators.required],
    reference: [''],
  });

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** Misma regla que platform_register_payment(): vigente o en gracia continúa; prueba o vencida empieza al pagar. */
  protected readonly preview = computed(() => {
    const o = this.org();
    const v = this.value();
    if (!o || !v.paid_at || !v.months) return null;
    const end = fromIsoDate(o.current_period_end)!;
    const paid = new Date(v.paid_at.getFullYear(), v.paid_at.getMonth(), v.paid_at.getDate());
    const continues = o.status !== 'TRIAL' && paid <= addDays(end, o.grace_days);
    const start = continues ? addDays(end, 1) : paid;
    const last = addDays(new Date(start.getFullYear(), start.getMonth() + v.months, start.getDate()), -1);
    return { start, end: last, continues };
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const o = this.org();
      this.form.reset({ plan_code: o?.plan_code ?? '', months: 1, amount: 0, method: 'YAPE', paid_at: new Date(), reference: '' });
      this.suggestAmount();
    });
    this.form.controls.plan_code.valueChanges.subscribe(() => this.suggestAmount());
    this.form.controls.months.valueChanges.subscribe(() => this.suggestAmount());
  }

  private suggestAmount(): void {
    const plan = this.plans().find((p) => p.code === this.form.controls.plan_code.value);
    if (!plan) return;
    const months = this.form.controls.months.value;
    const extra = (this.org()?.extra_users ?? 0) * Number(plan.extra_user_price ?? 0);
    const base = months === 12 ? Number(plan.price_year) : Number(plan.price_month) * months;
    this.form.controls.amount.setValue(base + extra * months, { emitEvent: false });
  }

  async save(): Promise<void> {
    const o = this.org();
    if (!o) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    try {
      const end = await this.service.registerPayment({
        orgId: o.org_id,
        planCode: v.plan_code,
        amount: v.amount,
        method: v.method,
        months: v.months,
        paidAt: v.paid_at,
        reference: v.reference,
      });
      this.notify.success(`Pago registrado. ${o.name} queda activa hasta el ${end.split('-').reverse().join('/')}.`);
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el pago.');
    } finally {
      this.saving.set(false);
    }
  }
}
