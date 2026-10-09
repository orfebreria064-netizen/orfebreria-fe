import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DrawerModule } from 'primeng/drawer';
import { Sidebar } from '../sidebar/sidebar';
import { Topbar } from '../topbar/topbar';
import { LookupService } from '../../core/services/lookup.service';
import { NotifyService } from '../../core/services/notify.service';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, DrawerModule, Sidebar, Topbar],
  template: `
    <div class="shell">
      <aside class="shell__sidebar">
        <app-sidebar />
      </aside>
      <p-drawer [(visible)]="drawerOpen" position="left" styleClass="app-drawer" [showCloseIcon]="false">
        <ng-template #headless>
          <app-sidebar (navigate)="drawerOpen.set(false)" />
        </ng-template>
      </p-drawer>
      <div class="shell__main">
        <app-topbar (toggleMenu)="drawerOpen.set(true)" />
        <main class="shell__content">
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
    const notify = inject(NotifyService);
    inject(LookupService)
      .ensureLoaded()
      .catch((err) => notify.error(err, 'No se pudieron cargar los catálogos.'));
  }
}
