import { Routes } from '@angular/router';
import { roleGuard } from '../../core/guards/auth.guards';
import { MODULE_ROLES } from '../../core/auth/roles';

export const CUSTOMERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Clientes',
    loadComponent: () => import('./pages/customer-list/customer-list').then((m) => m.CustomerList),
  },
  {
    path: 'new',
    title: 'Nuevo cliente',
    data: { breadcrumb: 'Nuevo', roles: MODULE_ROLES.customersWrite },
    canActivate: [roleGuard],
    loadComponent: () => import('./pages/customer-form-page/customer-form-page').then((m) => m.CustomerFormPage),
  },
  {
    path: ':id',
    title: 'Cliente',
    data: { breadcrumb: 'Detalle' },
    loadComponent: () => import('./pages/customer-detail/customer-detail').then((m) => m.CustomerDetail),
  },
  {
    path: ':id/edit',
    title: 'Editar cliente',
    data: { breadcrumb: 'Editar', roles: MODULE_ROLES.customersWrite },
    canActivate: [roleGuard],
    loadComponent: () => import('./pages/customer-form-page/customer-form-page').then((m) => m.CustomerFormPage),
  },
];
