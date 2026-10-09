import { Routes } from '@angular/router';

export const MATERIALS_ROUTES: Routes = [
  {
    path: '',
    title: 'Materiales',
    loadComponent: () => import('./pages/material-list/material-list').then((m) => m.MaterialList),
  },
  {
    path: ':id',
    title: 'Material',
    data: { breadcrumb: 'Kardex' },
    loadComponent: () => import('./pages/material-detail/material-detail').then((m) => m.MaterialDetail),
  },
];
