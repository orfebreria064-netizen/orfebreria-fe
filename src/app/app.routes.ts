import { Routes } from '@angular/router';
import { authGuard, guestGuard, homeRedirectGuard, roleGuard } from './core/guards/auth.guards';
import { MODULE_ROLES } from './core/auth/roles';
import { MainLayout } from './layout/main-layout/main-layout';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login/login').then((m) => m.Login), title: 'Iniciar sesión' },
  { path: 'registro', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register/register').then((m) => m.Register), title: 'Solicitar acceso' },
  { path: 'cuenta-pendiente', loadComponent: () => import('./features/auth/pending/pending').then((m) => m.Pending), title: 'Cuenta pendiente' },
  {
    path: '',
    component: MainLayout,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [homeRedirectGuard], children: [] },
      {
        path: 'dashboard',
        data: { breadcrumb: 'Dashboard', roles: MODULE_ROLES.dashboard },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        path: 'customers',
        data: { breadcrumb: 'Clientes', roles: MODULE_ROLES.customers },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/customers/customers.routes').then((m) => m.CUSTOMERS_ROUTES),
      },
      {
        path: 'quotations',
        data: { breadcrumb: 'Cotizaciones', roles: MODULE_ROLES.quotations },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/quotations/quotations.routes').then((m) => m.QUOTATIONS_ROUTES),
      },
      {
        path: 'orders',
        data: { breadcrumb: 'Pedidos', roles: MODULE_ROLES.orders },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/orders/orders.routes').then((m) => m.ORDERS_ROUTES),
      },
      {
        path: 'production',
        data: { breadcrumb: 'Producción', roles: MODULE_ROLES.production },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/production/production.routes').then((m) => m.PRODUCTION_ROUTES),
      },
      {
        path: 'materials',
        data: { breadcrumb: 'Materiales', roles: MODULE_ROLES.materials },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/materials/materials.routes').then((m) => m.MATERIALS_ROUTES),
      },
      {
        path: 'payments',
        data: { breadcrumb: 'Pagos', roles: MODULE_ROLES.payments },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/payments/payments.routes').then((m) => m.PAYMENTS_ROUTES),
      },
      {
        path: 'deliveries',
        data: { breadcrumb: 'Entregas', roles: MODULE_ROLES.deliveries },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/deliveries/deliveries.routes').then((m) => m.DELIVERIES_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
