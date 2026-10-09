import { Component, computed, inject, output } from '@angular/core';
import { BreadcrumbModule } from 'primeng/breadcrumb';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { AvatarModule } from 'primeng/avatar';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../../core/auth/auth.service';
import { ROLE_LABELS } from '../../core/models/domain';
import { BreadcrumbService } from '../breadcrumb.service';

@Component({
  selector: 'app-topbar',
  imports: [BreadcrumbModule, ButtonModule, MenuModule, AvatarModule],
  template: `
    <div class="topbar">
      <p-button
        class="topbar__menu"
        icon="pi pi-bars"
        [text]="true"
        severity="secondary"
        ariaLabel="Abrir menú"
        (onClick)="toggleMenu.emit()"
      />
      <p-breadcrumb class="topbar__crumbs" [model]="breadcrumb.items()" [home]="home" />
      <button type="button" class="topbar__user" (click)="userMenu.toggle($event)" aria-label="Menú de usuario">
        <p-avatar [label]="initials()" shape="circle" />
        <span class="topbar__user-text">
          <strong>{{ auth.userName() }}</strong>
          <small>{{ roleLabel() }}</small>
        </span>
        <i class="pi pi-angle-down"></i>
      </button>
      <p-menu #userMenu [model]="menuItems" [popup]="true" appendTo="body" />
    </div>
  `,
  styleUrl: './topbar.scss',
})
export class Topbar {
  protected readonly auth = inject(AuthService);
  protected readonly breadcrumb = inject(BreadcrumbService);
  readonly toggleMenu = output<void>();

  protected readonly home: MenuItem = { icon: 'pi pi-home', routerLink: '/' };
  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });
  protected readonly initials = computed(() =>
    this.auth
      .userName()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(''),
  );

  protected readonly menuItems: MenuItem[] = [
    { label: 'Cerrar sesión', icon: 'pi pi-sign-out', command: () => void this.auth.signOut() },
  ];
}
