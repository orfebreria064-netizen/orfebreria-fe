import { Component, DOCUMENT, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DrawerModule } from 'primeng/drawer';
import { Sidebar } from '../sidebar/sidebar';
import { Topbar } from '../topbar/topbar';
import { SubscriptionBanner } from '../subscription-banner/subscription-banner';
import { LookupService } from '../../core/services/lookup.service';
import { NotifyService } from '../../core/services/notify.service';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, DrawerModule, Sidebar, Topbar, SubscriptionBanner],
  template: `
    <!-- Fuera de .shell: su host ocuparía una celda de la grilla y empujaría el contenido -->
    <p-drawer [(visible)]="drawerOpen" position="left" styleClass="app-drawer" [showCloseIcon]="false">
      <ng-template #headless>
        <app-sidebar (navigate)="drawerOpen.set(false)" />
      </ng-template>
    </p-drawer>
    <div class="shell">
      <aside class="shell__sidebar">
        <app-sidebar />
      </aside>
      <div class="shell__main">
        <app-topbar (toggleMenu)="drawerOpen.set(true)" />
        <main class="shell__content">
          <app-subscription-banner />
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  protected readonly drawerOpen = signal(false);

  constructor() {
    const lookups = inject(LookupService);
    const doc = inject(DOCUMENT);
    // Ícono de la pestaña: el logo de la empresa, o el de Aurum si no tiene
    effect(() => {
      const logo = lookups.settings()?.logo;
      const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) return;
      link.type = logo ? (logo.startsWith('data:image/png') ? 'image/png' : 'image/jpeg') : 'image/x-icon';
      link.href = logo || 'favicon.ico';
    });
    // El superadministrador no tiene empresa: no hay catálogos que cargar.
    if (inject(AuthService).isPlatformOnly()) return;
    const notify = inject(NotifyService);
    lookups.ensureLoaded().catch((err) => notify.error(err, 'No se pudieron cargar los catálogos.'));
  }
}
