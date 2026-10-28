import { Routes } from '@angular/router';

export const FINANCE_ROUTES: Routes = [
  {
    path: '',
    title: 'Finanzas',
    loadComponent: () => import('./pages/finance/finance').then((m) => m.Finance),
  },
];
