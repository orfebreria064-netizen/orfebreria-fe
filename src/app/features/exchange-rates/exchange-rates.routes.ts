import { Routes } from '@angular/router';

export const EXCHANGE_RATES_ROUTES: Routes = [
  {
    path: '',
    title: 'Tipo de cambio',
    loadComponent: () => import('./pages/exchange-calendar/exchange-calendar').then((m) => m.ExchangeCalendar),
  },
];
