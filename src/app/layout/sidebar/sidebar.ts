import { Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { MODULE_ROLES, ModuleKey } from '../../core/auth/roles';

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
  { label: 'Materiales', icon: 'pi pi-box', route: '/materials', module: 'materials' },
  { label: 'Pagos', icon: 'pi pi-wallet', route: '/payments', module: 'payments' },
  { label: 'Entregas', icon: 'pi pi-truck', route: '/deliveries', module: 'deliveries' },
  { label: 'Configuración', icon: 'pi pi-cog', route: '/settings', module: 'settings' },
];

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="brand">
      <span class="brand__mark">Au</span>
      <div>
        <strong>Aurum</strong>
        <small>Gestión de orfebrería</small>
      </div>
    </div>
    <nav aria-label="Menú principal">
      @for (item of items(); track item.route) {
        <a [routerLink]="item.route" routerLinkActive="active" (click)="navigate.emit()">
          <i [class]="item.icon"></i>
          <span>{{ item.label }}</span>
        </a>
      }
    </nav>
  `,
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  private readonly auth = inject(AuthService);
  readonly navigate = output<void>();

  protected readonly items = computed(() => {
    const role = this.auth.role();
    return role ? NAV.filter((i) => (MODULE_ROLES[i.module] as readonly string[]).includes(role)) : [];
  });
}
