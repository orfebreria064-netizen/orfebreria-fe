import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../../core/auth/auth.service';
import { PLATFORM, whatsappLink } from '../../../core/config/platform';

/** Empresa suspendida o cancelada por la plataforma: sin acceso a los datos. */
@Component({
  selector: 'app-suspended',
  imports: [ButtonModule],
  template: `
    <div class="auth-card">
      <div class="auth-brand">
        <span>Au</span>
        <div>
          <h1>{{ auth.subscription()?.state === 'CANCELLED' ? 'Cuenta cancelada' : 'Cuenta suspendida' }}</h1>
          <p>{{ auth.session()?.user?.email }}</p>
        </div>
      </div>
      <p>
        El acceso de su empresa a {{ platform.name }} está suspendido. Su información se conserva; para reactivar el servicio
        comuníquese con nosotros.
      </p>
      <p class="muted small">
        <i class="pi pi-envelope"></i> {{ platform.supportEmail }}
      </p>
      <div class="row" style="margin-top: 1.25rem; flex-wrap: wrap">
        <a class="p-button p-component" [href]="whatsapp" target="_blank" rel="noopener">
          <i class="pi pi-whatsapp"></i>&nbsp; Escribir por WhatsApp
        </a>
        <p-button label="Volver a verificar" icon="pi pi-refresh" severity="secondary" [outlined]="true" [loading]="checking()" (onClick)="check()" />
        <p-button label="Cerrar sesión" severity="secondary" [text]="true" (onClick)="auth.signOut()" />
      </div>
    </div>
  `,
  styleUrl: '../auth-shell.scss',
})
export class Suspended {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly platform = PLATFORM;
  protected readonly whatsapp = whatsappLink('Hola, quiero reactivar el acceso de mi empresa a Aurum.');
  protected readonly checking = signal(false);

  async check(): Promise<void> {
    this.checking.set(true);
    try {
      await this.auth.loadProfile();
      if (!this.auth.isBlocked()) await this.router.navigateByUrl(this.auth.homeUrl());
    } finally {
      this.checking.set(false);
    }
  }
}
