import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { filter } from 'rxjs';

/**
 * Breadcrumb a partir de `data.breadcrumb` de las rutas. Las páginas de detalle pueden
 * reemplazar la última miga con un valor dinámico (p. ej. el número del pedido).
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);
  readonly items = signal<MenuItem[]>([]);

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.rebuild());
  }

  setDetail(label: string): void {
    const items = [...this.items()];
    if (items.length === 0) return;
    items[items.length - 1] = { ...items[items.length - 1], label };
    this.items.set(items);
  }

  private rebuild(): void {
    const items: MenuItem[] = [];
    let route: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    const segments: string[] = [];
    while (route) {
      segments.push(...route.url.map((u) => u.path));
      const label = route.routeConfig?.data?.['breadcrumb'] as string | undefined;
      if (label && route.routeConfig?.path !== '' && items.at(-1)?.label !== label) {
        items.push({ label, routerLink: '/' + segments.join('/') });
      }
      route = route.firstChild;
    }
    if (items.length) delete items[items.length - 1].routerLink;
    this.items.set(items);
  }
}
