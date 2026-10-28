import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ExpenseList } from '../../components/expense-list/expense-list';
import { LoanList } from '../../components/loan-list/loan-list';
import { ProfitReportView } from '../../components/profit-report/profit-report';

/** Finanzas (ADMIN y GERENTE): utilidad del mes, gastos de la empresa y préstamos. */
@Component({
  selector: 'app-finance',
  imports: [TabsModule, PageHeader, ProfitReportView, ExpenseList, LoanList],
  template: `
    <app-page-header title="Finanzas" subtitle="Utilidad del mes, gastos de la empresa y préstamos al personal" />
    <div class="card">
      <p-tabs [value]="tab">
        <p-tablist>
          <p-tab value="profit"><i class="pi pi-chart-line"></i> Utilidad del mes</p-tab>
          <p-tab value="expenses"><i class="pi pi-receipt"></i> Gastos</p-tab>
          <p-tab value="loans"><i class="pi pi-money-bill"></i> Préstamos</p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="profit"><app-profit-report /></p-tabpanel>
          <p-tabpanel value="expenses"><app-expense-list /></p-tabpanel>
          <p-tabpanel value="loans"><app-loan-list /></p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </div>
  `,
})
export class Finance {
  protected readonly tab = inject(ActivatedRoute).snapshot.queryParamMap.get('tab') ?? 'profit';
}
