import { Routes } from '@angular/router';

export const DELIVERIES_ROUTES: Routes = [
  {
    path: '',
    title: 'Entregas',
    loadComponent: () => import('./pages/delivery-list/delivery-list').then((m) => m.DeliveryList),
  },
];
