import { Routes } from '@angular/router';

export const PAYMENTS_ROUTES: Routes = [
  {
    path: '',
    title: 'Pagos',
    loadComponent: () => import('./pages/payment-list/payment-list').then((m) => m.PaymentList),
  },
];
