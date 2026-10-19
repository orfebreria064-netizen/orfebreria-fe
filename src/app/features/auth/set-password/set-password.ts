import { Component, OnInit, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { ActivationType, AuthService } from '../../../core/auth/auth.service';
import { FieldError } from '../../../shared/components/field-error/field-error';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  return group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: 'Las contraseñas no coinciden.' };
}

/**
 * Destino de los enlaces de invitación y de recuperación de contraseña:
 * /activar-cuenta?tipo=invitacion|recuperacion&token=...
 * El usuario define su contraseña y entra a la aplicación.
 */
@Component({
  selector: 'app-set-password',
  imports: [ReactiveFormsModule, RouterLink, ButtonModule, PasswordModule, MessageModule, FieldError],
  template: `
    <div class="auth-card">
      <div class="auth-brand">
        <span>Au</span>
        <div>
          <h1>{{ type === 'recuperacion' ? 'Nueva contraseña' : 'Crear contraseña' }}</h1>
          <p>{{ invitation()?.email ?? 'Activación de cuenta' }}</p>
        </div>
      </div>

      @if (checking()) {
        <p class="muted">Verificando el enlace…</p>
      } @else if (!valid()) {
        <p-message severity="warn" text="El enlace venció o ya fue utilizado. Solicite uno nuevo desde «¿Olvidó su contraseña?»." />
        <p class="auth-footer"><a routerLink="/login">Ir a iniciar sesión</a></p>
      } @else {
        @if (invitation(); as inv) {
          <p class="muted">
            Bienvenido(a){{ inv.full_name ? ', ' : '' }}<strong>{{ inv.full_name }}</strong>. Defina la contraseña con la que
            ingresará a {{ inv.company_name }}.
          </p>
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
              promptLabel="Mínimo 8 caracteres"
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
export class SetPassword implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly type: ActivationType = this.params.get('tipo') === 'recuperacion' ? 'recuperacion' : 'invitacion';
  private readonly token = this.params.get('token') ?? '';

  protected readonly checking = signal(true);
  protected readonly valid = signal(false);
  protected readonly invitation = signal<{ email: string; full_name: string | null; company_name: string } | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirm: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  async ngOnInit(): Promise<void> {
    if (!this.token) {
      this.checking.set(false);
      return;
    }
    if (this.type === 'invitacion') {
      const inv = await this.auth.invitation(this.token);
      this.invitation.set(inv);
      this.valid.set(inv !== null);
    } else {
      // La recuperación se valida al guardar (el token solo se consume una vez).
      this.valid.set(true);
    }
    this.checking.set(false);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.activateAccount(this.type, this.token, this.form.getRawValue().password);
      // replaceUrl: el token no queda en el historial del navegador.
      await this.router.navigateByUrl(this.auth.isActive() ? this.auth.homeUrl() : '/cuenta-pendiente', { replaceUrl: true });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo guardar la contraseña.');
    } finally {
      this.loading.set(false);
    }
  }
}
