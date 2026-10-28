import { Routes } from '@angular/router';

export const REPAIRS_ROUTES: Routes = [
  {
    path: '',
    title: 'Reparaciones',
    loadComponent: () => import('./pages/repairs/repairs').then((m) => m.Repairs),
  },
];
