import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SkeletonModule } from 'primeng/skeleton';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { BreadcrumbService } from '../../../../layout/breadcrumb.service';
import { CustomerForm } from '../../components/customer-form/customer-form';
import { Customer } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';

/** Alta (/customers/new) y edición (/customers/:id/edit) de clientes. */
@Component({
  selector: 'app-customer-form-page',
  imports: [SkeletonModule, PageHeader, CustomerForm],
  template: `
    <app-page-header
      [title]="id() ? 'Editar cliente' : 'Nuevo cliente'"
      [subtitle]="customer()?.full_name ?? null"
      [backLink]="id() ? ['/customers', id()] : '/customers'"
    />
    <div class="card">
      @if (loading()) {
        <p-skeleton height="18rem" />
      } @else {
        <app-customer-form [customer]="customer()" (saved)="onSaved($event)" (cancelled)="back()" />
      }
    </div>
  `,
})
export class CustomerFormPage implements OnInit {
  private readonly service = inject(CustomersService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);

  readonly id = input<string>();
  protected readonly customer = signal<Customer | null>(null);
  protected readonly loading = signal(false);

  async ngOnInit(): Promise<void> {
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    try {
      const customer = await this.service.get(id);
      this.customer.set(customer);
      this.breadcrumb.setDetail(`Editar · ${customer.full_name}`);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el cliente.');
      void this.router.navigate(['/customers']);
    } finally {
      this.loading.set(false);
    }
  }

  protected onSaved(customer: Customer): void {
    void this.router.navigate(['/customers', customer.id]);
  }

  protected back(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/customers', id] : ['/customers']);
  }
}
