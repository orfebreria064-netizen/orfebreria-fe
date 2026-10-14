import { Component, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { NotifyService } from '../../../../core/services/notify.service';
import { Plan, PlatformOrganization, SUBSCRIPTION_STATUS_OPTIONS, SubscriptionStatus } from '../../../../core/models/subscription.model';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { fromIsoDate } from '../../../../shared/utils/db';
import { PlatformService } from '../../services/platform.service';

/**
 * Ajuste manual de la suscripción (cambio de plan, usuarios extra, extender fecha,
 * suspender o reactivar) e invitación de un nuevo administrador para la empresa.
 */
@Component({
  selector: 'app-subscription-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    TextareaModule,
    MessageModule,
    FieldError,
  ],
  template: `
    <p-dialog [header]="'Suscripción · ' + (org()?.name ?? '')" [(visible)]="visible" [modal]="true" [style]="{ width: '560px' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" class="form-grid" novalidate>
        <div class="field">
          <label for="sd-plan">Plan</label>
          <p-select inputId="sd-plan" [options]="plans()" formControlName="plan_code" optionLabel="name" optionValue="code" appendTo="body" />
        </div>
        <div class="field">
          <label for="sd-status">Estado</label>
          <p-select inputId="sd-status" [options]="statuses" formControlName="status" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="sd-end">Vigente hasta</label>
          <p-datepicker inputId="sd-end" formControlName="current_period_end" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" [fluid]="true" />
        </div>
        <div class="field">
          <label for="sd-grace">Días de gracia</label>
          <p-inputnumber inputId="sd-grace" formControlName="grace_days" [min]="0" [max]="60" [fluid]="true" />
        </div>
        <div class="field">
          <label for="sd-extra">Usuarios adicionales</label>
          <p-inputnumber inputId="sd-extra" formControlName="extra_users" [min]="0" [max]="500" [fluid]="true" />
          <small class="muted">Se suman al límite del plan.</small>
        </div>
        <div class="field field--full">
          <label for="sd-notes">Notas internas</label>
          <textarea pTextarea id="sd-notes" formControlName="notes" rows="2" [autoResize]="true"></textarea>
        </div>
        @if (form.controls.status.value === 'SUSPENDED' || form.controls.status.value === 'CANCELLED') {
          <p-message class="field--full" severity="warn" text="La empresa perderá el acceso a sus datos de inmediato (no se borran)." />
        }
        <div class="form-actions field--full">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>

      <hr class="divider" />
      <form [formGroup]="invite" (ngSubmit)="sendInvite()" class="form-grid" novalidate>
        <p class="field--full muted small" style="margin: 0">
          <strong>Invitar administrador.</strong> Úselo si el dueño no recibió el correo o la empresa cambia de responsable.
          Si el usuario ya existe, pídale usar «¿Olvidó su contraseña?».
        </p>
        <div class="field">
          <label for="sd-inv-name">Nombre</label>
          <input pInputText id="sd-inv-name" formControlName="full_name" />
          <app-field-error [control]="invite.controls.full_name" />
        </div>
        <div class="field">
          <label for="sd-inv-email">Correo</label>
          <input pInputText id="sd-inv-email" type="email" formControlName="email" />
          <app-field-error [control]="invite.controls.email" />
        </div>
        <div class="form-actions field--full">
          <p-button type="submit" label="Enviar invitación" icon="pi pi-send" severity="secondary" [outlined]="true" [loading]="inviting()" />
        </div>
      </form>
    </p-dialog>
  `,
  styles: `
    .divider {
      margin: 1.25rem 0 1rem;
      border: 0;
      border-top: 1px solid var(--p-surface-200);
    }
  `,
})
export class SubscriptionDialog {
  private readonly service = inject(PlatformService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  readonly org = input<PlatformOrganization | null>(null);
  readonly plans = input<Plan[]>([]);
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly inviting = signal(false);
  protected readonly statuses = SUBSCRIPTION_STATUS_OPTIONS;

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    plan_code: ['', Validators.required],
    status: ['ACTIVE' as SubscriptionStatus, Validators.required],
    current_period_end: [new Date(), Validators.required],
    grace_days: [5, [Validators.required, Validators.min(0), Validators.max(60)]],
    extra_users: [0, [Validators.required, Validators.min(0)]],
    notes: [''],
  });
  protected readonly invite = this.fb.group({
    full_name: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const o = this.org();
      if (!o) return;
      this.form.reset({
        plan_code: o.plan_code,
        status: o.status,
        current_period_end: fromIsoDate(o.current_period_end) ?? new Date(),
        grace_days: o.grace_days,
        extra_users: o.extra_users,
        notes: o.notes ?? '',
      });
      this.invite.reset({ full_name: '', email: '' });
    });
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
      await this.service.updateSubscription({
        orgId: o.org_id,
        planCode: v.plan_code,
        status: v.status,
        extraUsers: v.extra_users,
        currentPeriodEnd: v.current_period_end,
        graceDays: v.grace_days,
        notes: v.notes,
      });
      this.notify.success('Suscripción actualizada.');
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo actualizar la suscripción.');
    } finally {
      this.saving.set(false);
    }
  }

  async sendInvite(): Promise<void> {
    const o = this.org();
    if (!o) return;
    if (this.invite.invalid) {
      this.invite.markAllAsTouched();
      return;
    }
    const { full_name, email } = this.invite.getRawValue();
    this.inviting.set(true);
    try {
      await this.service.inviteAdmin(o.org_id, email.trim(), full_name.trim());
      this.notify.success(`Invitación enviada a ${email.trim()}.`);
      this.invite.reset({ full_name: '', email: '' });
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo enviar la invitación.');
    } finally {
      this.inviting.set(false);
    }
  }
}
