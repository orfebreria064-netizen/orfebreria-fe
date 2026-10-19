import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { NotifyService } from '../../../../core/services/notify.service';
import { AccessRequest, Plan } from '../../../../core/models/subscription.model';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { PlatformService } from '../../services/platform.service';

/** Aprobar (crea la empresa con prueba e invita al dueño) o rechazar una solicitud de acceso. */
@Component({
  selector: 'app-request-dialog',
  imports: [DatePipe, ReactiveFormsModule, ButtonModule, DialogModule, InputNumberModule, SelectModule, TextareaModule, FieldError],
  template: `
    <p-dialog
      [header]="mode() === 'approve' ? 'Aprobar solicitud' : 'Rechazar solicitud'"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '500px' }"
      [draggable]="false"
    >
      @if (request(); as r) {
        <dl class="req">
          <div><dt>Empresa</dt><dd>{{ r.company_name }} @if (r.tax_id) {<span class="muted">· RUC {{ r.tax_id }}</span>}</dd></div>
          <div><dt>Contacto</dt><dd>{{ r.contact_name }} · {{ r.email }} @if (r.phone) {· {{ r.phone }}}</dd></div>
          <div><dt>Recibida</dt><dd>{{ r.created_at | date: 'dd/MM/yyyy HH:mm' }}</dd></div>
          @if (r.message) {
            <div><dt>Mensaje</dt><dd>{{ r.message }}</dd></div>
          }
        </dl>

        @if (mode() === 'approve') {
          <form [formGroup]="approveForm" (ngSubmit)="approve()" class="form-grid" novalidate>
            <div class="field">
              <label for="rq-plan">Plan</label>
              <p-select inputId="rq-plan" [options]="plans()" formControlName="plan_code" optionLabel="name" optionValue="code" appendTo="body" />
            </div>
            <div class="field">
              <label for="rq-trial">Días de prueba</label>
              <p-inputnumber inputId="rq-trial" formControlName="trial_days" [min]="0" [max]="90" suffix=" días" [fluid]="true" />
              <app-field-error [control]="approveForm.controls.trial_days" />
            </div>
            <p class="field--full muted small" style="margin: 0">
              Se creará la empresa con sus catálogos iniciales y se enviará a {{ r.email }} un correo para crear su contraseña como
              administrador.
            </p>
            <div class="form-actions field--full">
              <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
              <p-button type="submit" label="Aprobar e invitar" icon="pi pi-check" [loading]="saving()" />
            </div>
          </form>
        } @else {
          <form [formGroup]="rejectForm" (ngSubmit)="reject()" class="form-grid" novalidate>
            <div class="field field--full">
              <label for="rq-reason">Motivo (interno)</label>
              <textarea pTextarea id="rq-reason" formControlName="reason" rows="2" [autoResize]="true" placeholder="Ej. datos falsos, duplicada…"></textarea>
            </div>
            <div class="form-actions field--full">
              <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
              <p-button type="submit" label="Rechazar" icon="pi pi-times" severity="danger" [loading]="saving()" />
            </div>
          </form>
        }
      }
    </p-dialog>
  `,
  styles: `
    .req {
      display: grid;
      gap: 0.4rem;
      margin: 0 0 1rem;
      padding: 0.75rem;
      border-radius: 0.5rem;
      background: var(--p-surface-50);
      font-size: 0.875rem;
    }
    .req div {
      display: grid;
      grid-template-columns: 5.5rem minmax(0, 1fr);
      gap: 0.5rem;
    }
    .req dt {
      color: var(--p-surface-500);
    }
    .req dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
  `,
})
export class RequestDialog {
  private readonly service = inject(PlatformService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  readonly mode = input<'approve' | 'reject'>('approve');
  readonly request = input<AccessRequest | null>(null);
  readonly plans = input<Plan[]>([]);
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly approveForm = this.fb.group({
    plan_code: ['BASICO', Validators.required],
    trial_days: [14, [Validators.required, Validators.min(0), Validators.max(90)]],
  });
  protected readonly rejectForm = this.fb.group({ reason: [''] });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const planCode = this.request()?.plan_code ?? 'BASICO';
      // untracked: form.reset() lee signals internos de PrimeNG; rastrearlos reiniciaría el formulario al editar.
      untracked(() => {
        this.approveForm.reset({ plan_code: planCode, trial_days: 14 });
        this.rejectForm.reset({ reason: '' });
      });
    });
  }

  async approve(): Promise<void> {
    const r = this.request();
    if (!r) return;
    if (this.approveForm.invalid) {
      this.approveForm.markAllAsTouched();
      return;
    }
    const { plan_code, trial_days } = this.approveForm.getRawValue();
    this.saving.set(true);
    try {
      const email = await this.service.approve(r.id, plan_code, trial_days);
      this.notify.success(`Empresa creada. Invitación enviada a ${email}.`);
      this.visible.set(false);
    } catch (err) {
      // Si falló solo el correo, la empresa ya existe: se reinvita desde «Suscripción».
      this.notify.error(err, 'No se completó la aprobación.');
    } finally {
      this.saving.set(false);
      this.saved.emit();
    }
  }

  async reject(): Promise<void> {
    const r = this.request();
    if (!r) return;
    this.saving.set(true);
    try {
      await this.service.reject(r.id, this.rejectForm.getRawValue().reason);
      this.notify.success('Solicitud rechazada.');
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo rechazar la solicitud.');
    } finally {
      this.saving.set(false);
    }
  }
}
