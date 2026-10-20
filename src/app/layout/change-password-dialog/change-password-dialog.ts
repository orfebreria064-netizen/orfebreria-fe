import { Component, inject, model, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { PasswordModule } from 'primeng/password';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/services/notify.service';
import { FieldError } from '../../shared/components/field-error/field-error';
import { strongPasswordValidator } from '../../shared/utils/validators';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  return group.get('next')?.value === group.get('confirm')?.value ? null : { mismatch: 'Las contraseñas no coinciden.' };
}

/** Cambio de contraseña con sesión iniciada (menú de usuario). */
@Component({
  selector: 'app-change-password-dialog',
  imports: [ReactiveFormsModule, ButtonModule, DialogModule, PasswordModule, FieldError],
  template: `
    <p-dialog header="Cambiar contraseña" [(visible)]="visible" [modal]="true" [style]="{ width: '420px' }" [draggable]="false" (onHide)="form.reset()">
      <form [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <div class="field field--full">
          <label for="cp-current">Contraseña actual <span class="req">*</span></label>
          <p-password inputId="cp-current" formControlName="current" [feedback]="false" [toggleMask]="true" [fluid]="true" autocomplete="current-password" />
          <app-field-error [control]="form.controls.current" />
        </div>
        <div class="field field--full">
          <label for="cp-next">Nueva contraseña <span class="req">*</span></label>
          <p-password
            inputId="cp-next"
            formControlName="next"
            [toggleMask]="true"
            [fluid]="true"
            promptLabel="Mínimo 8 caracteres, con letras y números"
            weakLabel="Débil"
            mediumLabel="Media"
            strongLabel="Fuerte"
            autocomplete="new-password"
            appendTo="body"
          />
          <app-field-error [control]="form.controls.next" />
        </div>
        <div class="field field--full">
          <label for="cp-confirm">Confirmar nueva contraseña <span class="req">*</span></label>
          <p-password inputId="cp-confirm" formControlName="confirm" [feedback]="false" [toggleMask]="true" [fluid]="true" autocomplete="new-password" />
          <app-field-error [control]="form.controls.confirm" groupErrorKey="mismatch" />
        </div>
        <div class="form-actions field--full">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>
  `,
})
export class ChangePasswordDialog {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  protected readonly saving = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      current: ['', [Validators.required]],
      next: ['', [Validators.required, Validators.minLength(8), strongPasswordValidator]],
      confirm: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const { current, next } = this.form.getRawValue();
      await this.auth.changePassword(current, next);
      this.notify.success('Su contraseña se actualizó.');
      this.visible.set(false);
    } catch (err) {
      this.notify.error(err, 'No se pudo cambiar la contraseña.');
    } finally {
      this.saving.set(false);
    }
  }
}
