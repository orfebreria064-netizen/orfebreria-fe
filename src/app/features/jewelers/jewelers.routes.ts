import { Routes } from '@angular/router';

export const JEWELERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Joyeros',
    loadComponent: () => import('./pages/jeweler-list/jeweler-list').then((m) => m.JewelerList),
  },
];
