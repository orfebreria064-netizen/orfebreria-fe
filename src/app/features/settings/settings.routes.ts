import { Routes } from '@angular/router';

export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    title: 'Configuración',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
  },
];
