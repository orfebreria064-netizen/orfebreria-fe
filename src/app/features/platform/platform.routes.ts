import { Routes } from '@angular/router';

export const PLATFORM_ROUTES: Routes = [
  {
    path: '',
    title: 'Plataforma',
    loadComponent: () => import('./pages/platform/platform').then((m) => m.Platform),
  },
];
