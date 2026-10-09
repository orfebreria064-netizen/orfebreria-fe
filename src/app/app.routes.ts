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
        path: 'customers',
        data: { breadcrumb: 'Clientes', roles: MODULE_ROLES.customers },
        canActivate: [roleGuard],
        loadChildren: () => import('./features/customers/customers.routes').then((m) => m.CUSTOMERS_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
