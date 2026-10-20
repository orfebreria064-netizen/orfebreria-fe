import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { PasswordModule } from 'primeng/password';
import { strongPasswordValidator } from '../../../shared/utils/validators';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../core/auth/auth.service';
import { FieldError } from '../../../shared/components/field-error/field-error';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  return group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: 'Las contraseñas no coinciden.' };
}

/**
 * Destino de los enlaces de invitación y de recuperación de contraseña.
 * supabase-js toma la sesión del enlace (detectSessionInUrl) antes del arranque;
 * aquí el usuario define su contraseña y entra a la aplicación.
 */
@Component({
  selector: 'app-set-password',
  imports: [ReactiveFormsModule, RouterLink, ButtonModule, PasswordModule, MessageModule, FieldError],
  template: `
    <div class="auth-card">
      <div class="auth-brand">
        <span>Au</span>
        <div>
          <h1>Crear contraseña</h1>
          <p>{{ auth.session()?.user?.email ?? 'Activación de cuenta' }}</p>
        </div>
      </div>

      @if (!auth.isAuthenticated()) {
        <p-message severity="warn" text="El enlace venció o ya fue utilizado. Solicite uno nuevo desde «¿Olvidó su contraseña?»." />
        <p class="auth-footer"><a routerLink="/login">Ir a iniciar sesión</a></p>
      } @else {
        @if (auth.profile(); as p) {
          <p class="muted">Bienvenido(a), <strong>{{ p.full_name }}</strong>. Defina la contraseña con la que ingresará al sistema.</p>
        }
        @if (error()) {
          <p-message severity="error" [text]="error()!" />
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="sp-password">Nueva contraseña</label>
            <p-password
              inputId="sp-password"
              formControlName="password"
              [toggleMask]="true"
              [fluid]="true"
              promptLabel="Mínimo 8 caracteres, con letras y números"
              weakLabel="Débil"
              mediumLabel="Media"
              strongLabel="Fuerte"
              autocomplete="new-password"
            />
            <app-field-error [control]="form.controls.password" />
          </div>
          <div class="field">
            <label for="sp-confirm">Confirmar contraseña</label>
            <p-password inputId="sp-confirm" formControlName="confirm" [feedback]="false" [toggleMask]="true" [fluid]="true" autocomplete="new-password" />
            <app-field-error [control]="form.controls.confirm" groupErrorKey="mismatch" />
          </div>
          <p-button type="submit" label="Guardar e ingresar" icon="pi pi-check" [loading]="loading()" [fluid]="true" />
        </form>
      }
    </div>
  `,
  styleUrl: '../auth-shell.scss',
})
export class SetPassword {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8), strongPasswordValidator]],
      confirm: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.updatePassword(this.form.getRawValue().password);
      await this.auth.loadProfile();
      // Limpia el fragmento con los tokens del enlace.
      await this.router.navigateByUrl(this.auth.isActive() ? this.auth.homeUrl() : '/cuenta-pendiente', { replaceUrl: true });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo guardar la contraseña.');
    } finally {
      this.loading.set(false);
    }
  }
}
