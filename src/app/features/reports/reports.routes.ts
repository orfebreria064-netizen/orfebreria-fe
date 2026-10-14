import { Routes } from '@angular/router';

export const REPORTS_ROUTES: Routes = [
  {
    path: '',
    title: 'Reportes',
    loadComponent: () => import('./pages/reports/reports').then((m) => m.Reports),
  },
];
