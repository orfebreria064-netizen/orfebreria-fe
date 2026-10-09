import { Routes } from '@angular/router';

export const QUOTATIONS_ROUTES: Routes = [
  {
    path: '',
    title: 'Cotizaciones',
    loadComponent: () => import('./pages/quotation-list/quotation-list').then((m) => m.QuotationList),
  },
  {
    path: 'new',
    title: 'Nueva cotización',
    data: { breadcrumb: 'Nueva' },
    loadComponent: () => import('./pages/quotation-form/quotation-form').then((m) => m.QuotationForm),
  },
  {
    path: ':id',
    title: 'Cotización',
    data: { breadcrumb: 'Detalle' },
    loadComponent: () => import('./pages/quotation-detail/quotation-detail').then((m) => m.QuotationDetailPage),
  },
  {
    path: ':id/edit',
    title: 'Editar cotización',
    data: { breadcrumb: 'Editar' },
    loadComponent: () => import('./pages/quotation-form/quotation-form').then((m) => m.QuotationForm),
  },
];
