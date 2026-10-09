import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../core/auth/auth.service';
import { FieldError } from '../../../shared/components/field-error/field-error';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  return group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: 'Las contraseñas no coinciden.' };
}

/**
 * Registro. El primer usuario del sistema queda como Administrador; los siguientes quedan
 * pendientes de activación. Lo decide la base de datos (trigger handle_new_user), no el cliente.
 */
@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, ButtonModule, InputTextModule, PasswordModule, MessageModule, FieldError],
  templateUrl: './register.html',
  styleUrl: '../auth-shell.scss',
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmEmail = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      fullName: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
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
      const { fullName, email, password } = this.form.getRawValue();
      const signedIn = await this.auth.signUp(fullName.trim(), email.trim(), password);
      if (!signedIn) {
        this.confirmEmail.set(true);
        return;
      }
      await this.router.navigateByUrl(this.auth.isActive() ? this.auth.homeUrl() : '/cuenta-pendiente');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo crear la cuenta.');
    } finally {
      this.loading.set(false);
    }
  }
}
