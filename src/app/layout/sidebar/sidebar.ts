import { Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { MODULE_ROLES, ModuleKey } from '../../core/auth/roles';
import { LookupService } from '../../core/services/lookup.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  module: ModuleKey;
}

const NAV: NavItem[] = [
  { label: 'Dashboard', icon: 'pi pi-chart-bar', route: '/dashboard', module: 'dashboard' },
  { label: 'Clientes', icon: 'pi pi-users', route: '/customers', module: 'customers' },
  { label: 'Cotizaciones', icon: 'pi pi-file-edit', route: '/quotations', module: 'quotations' },
  { label: 'Pedidos', icon: 'pi pi-briefcase', route: '/orders', module: 'orders' },
  { label: 'Producción', icon: 'pi pi-objects-column', route: '/production', module: 'production' },
  { label: 'Joyeros', icon: 'pi pi-id-card', route: '/jewelers', module: 'jewelers' },
  { label: 'Materiales', icon: 'pi pi-box', route: '/materials', module: 'materials' },
  { label: 'Pagos', icon: 'pi pi-wallet', route: '/payments', module: 'payments' },
  { label: 'Entregas', icon: 'pi pi-truck', route: '/deliveries', module: 'deliveries' },
  { label: 'Reportes', icon: 'pi pi-chart-pie', route: '/reports', module: 'reports' },
  { label: 'Configuración', icon: 'pi pi-cog', route: '/settings', module: 'settings' },
];

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="brand">
      @if (company(); as c) {
        @if (c.logo) {
          <img class="brand__logo" [src]="c.logo" [alt]="c.company_name" />
        } @else {
          <span class="brand__mark">{{ c.company_name.slice(0, 2) }}</span>
        }
        <div>
          <strong>{{ c.company_name }}</strong>
          <small>Gestión</small>
        </div>
      } @else {
        <span class="brand__mark">Au</span>
        <div>
          <strong>Aurum</strong>
          <small>Gestión de orfebrería</small>
        </div>
      }
    </div>
    <nav aria-label="Menú principal">
      @for (item of items(); track item.route) {
        <a [routerLink]="item.route" routerLinkActive="active" (click)="navigate.emit()">
          <i [class]="item.icon"></i>
          <span>{{ item.label }}</span>
        </a>
      }
      @if (auth.isPlatformAdmin()) {
        <span class="nav-section">Administración</span>
        <a routerLink="/plataforma" routerLinkActive="active" (click)="navigate.emit()">
          <i class="pi pi-server"></i>
          <span>Plataforma</span>
        </a>
      }
    </nav>
  `,
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  protected readonly auth = inject(AuthService);
  /** Marca de la empresa (logo y nombre); el superadministrador sin empresa ve la de Aurum. */
  protected readonly company = inject(LookupService).settings;
  readonly navigate = output<void>();

  protected readonly items = computed(() => {
    const role = this.auth.role();
    return role ? NAV.filter((i) => (MODULE_ROLES[i.module] as readonly string[]).includes(role)) : [];
  });
}
