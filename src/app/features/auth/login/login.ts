import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../core/auth/auth.service';
import { FieldError } from '../../../shared/components/field-error/field-error';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, ButtonModule, InputTextModule, PasswordModule, MessageModule, FieldError],
  templateUrl: './login.html',
  styleUrl: '../auth-shell.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly mode = signal<'login' | 'reset'>('login');
  protected readonly resetSent = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email.trim(), password);
      // isActive incluye al superadministrador sin empresa (sin perfil)
      const url = !this.auth.isActive() ? '/cuenta-pendiente' : this.auth.isBlocked() ? '/cuenta-suspendida' : this.auth.homeUrl();
      await this.router.navigateByUrl(url);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      this.loading.set(false);
    }
  }

  protected switchMode(mode: 'login' | 'reset'): void {
    this.mode.set(mode);
    this.resetSent.set(false);
    this.error.set(null);
  }

  async sendReset(): Promise<void> {
    const email = this.form.controls.email;
    if (email.invalid) {
      email.markAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.requestPasswordReset(email.value.trim());
      this.resetSent.set(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo enviar el enlace.');
    } finally {
      this.loading.set(false);
    }
  }
}
