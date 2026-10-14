import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../../core/auth/auth.service';

/** Usuario desactivado por el administrador de su empresa. */
@Component({
  selector: 'app-pending',
  imports: [ButtonModule],
  template: `
    <div class="auth-card">
      <div class="auth-brand">
        <span>Au</span>
        <div>
          <h1>Usuario inactivo</h1>
          <p>{{ auth.session()?.user?.email }}</p>
        </div>
      </div>
      <p>
        Su usuario está desactivado. Pida al administrador de su empresa que lo active desde
        <strong>Configuración → Usuarios</strong>.
      </p>
      <div class="row" style="margin-top: 1.25rem">
        <p-button label="Volver a verificar" icon="pi pi-refresh" [loading]="checking()" (onClick)="check()" />
        <p-button label="Cerrar sesión" severity="secondary" [outlined]="true" (onClick)="auth.signOut()" />
      </div>
    </div>
  `,
  styleUrl: '../auth-shell.scss',
})
export class Pending {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly checking = signal(false);

  async check(): Promise<void> {
    this.checking.set(true);
    try {
      await this.auth.loadProfile();
      if (this.auth.isActive()) await this.router.navigateByUrl(this.auth.homeUrl());
    } finally {
      this.checking.set(false);
    }
  }
}
