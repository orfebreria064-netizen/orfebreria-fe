import { Routes } from '@angular/router';
import { authGuard, guestGuard, homeRedirectGuard, platformGuard, roleGuard } from './core/guards/auth.guards';
import { MODULE_ROLES } from './core/auth/roles';
import { MainLayout } from './layout/main-layout/main-layout';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login/login').then((m) => m.Login), title: 'Iniciar sesión' },
  {
    path: 'solicitar-acceso',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/request-access/request-access').then((m) => m.RequestAccess),
    title: 'Solicitar acceso',
  },
  { path: 'registro', redirectTo: 'solicitar-acceso' },
  // Destino de los enlaces de invitación y recuperación: sin guard, la sesión viene en el enlace.
  { path: 'activar-cuenta', loadComponent: () => import('./features/auth/set-password/set-password').then((m) => m.SetPassword), title: 'Crear contraseña' },
  { path: 'cuenta-pendiente', loadComponent: () => import('./features/auth/pending/pending').then((m) => m.Pending), title: 'Usuario inactivo' },
  { path: 'cuenta-suspendida', loadComponent: () => import('./features/auth/suspended/suspended').then((m) => m.Suspended), title: 'Cuenta suspendida' },
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
        path: 'jewelers',
        data: { breadcrumb: 'Joyeros', roles: MODULE_ROLES.jewelers },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/jewelers/jewelers.routes').then((m) => m.JEWELERS_ROUTES),
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
      {
        path: 'reports',
        data: { breadcrumb: 'Reportes', roles: MODULE_ROLES.reports },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/reports/reports.routes').then((m) => m.REPORTS_ROUTES),
      },
      {
        path: 'settings',
        data: { breadcrumb: 'Configuración', roles: MODULE_ROLES.settings },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
      {
        path: 'plataforma',
        data: { breadcrumb: 'Plataforma' },
        canActivate: [platformGuard],
        loadChildren: () => import('./features/platform/platform.routes').then((m) => m.PLATFORM_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
