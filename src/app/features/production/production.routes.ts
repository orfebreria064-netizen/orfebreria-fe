import { Routes } from '@angular/router';

export const PRODUCTION_ROUTES: Routes = [
  {
    path: '',
    title: 'Producción',
    loadComponent: () => import('./pages/production-board/production-board').then((m) => m.ProductionBoard),
  },
];
