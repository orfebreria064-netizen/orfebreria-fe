import { Routes } from '@angular/router';
import { roleGuard } from '../../core/guards/auth.guards';
import { MODULE_ROLES } from '../../core/auth/roles';

export const ORDERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Pedidos',
    loadComponent: () => import('./pages/order-list/order-list').then((m) => m.OrderList),
  },
  {
    path: 'new',
    title: 'Nuevo pedido',
    data: { breadcrumb: 'Nuevo', roles: MODULE_ROLES.ordersWrite },
    canActivate: [roleGuard],
    loadComponent: () => import('./pages/order-form/order-form').then((m) => m.OrderForm),
  },
  {
    path: ':id',
    title: 'Pedido',
    data: { breadcrumb: 'Detalle' },
    loadComponent: () => import('./pages/order-detail/order-detail').then((m) => m.OrderDetailPage),
  },
  {
    path: ':id/edit',
    title: 'Editar pedido',
    data: { breadcrumb: 'Editar', roles: MODULE_ROLES.ordersWrite },
    canActivate: [roleGuard],
    loadComponent: () => import('./pages/order-form/order-form').then((m) => m.OrderForm),
  },
];
