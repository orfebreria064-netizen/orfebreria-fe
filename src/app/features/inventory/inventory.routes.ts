import { Routes } from '@angular/router';

export const INVENTORY_ROUTES: Routes = [
  {
    path: '',
    title: 'Vitrina',
    loadComponent: () => import('./pages/inventory/inventory').then((m) => m.Inventory),
  },
];
