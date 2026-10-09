import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { PERSON_TYPE_LABELS } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { Customer } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';

@Component({
  selector: 'app-customer-list',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    TableModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    CheckboxModule,
    TagModule,
    SkeletonModule,
    PageHeader,
    EmptyState,
    LabelPipe,
  ],
  templateUrl: './customer-list.html',
})
export class CustomerList implements OnInit {
  private readonly service = inject(CustomersService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly customers = signal<Customer[]>([]);
  protected readonly loading = signal(true);
  protected readonly canWrite = this.auth.hasRole(...MODULE_ROLES.customersWrite);
  protected readonly personTypeLabels = PERSON_TYPE_LABELS;
  protected search = '';
  protected includeInactive = false;
  private searchTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    void this.load();
  }

  protected onSearch(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 300);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.customers.set(await this.service.list({ search: this.search, includeInactive: this.includeInactive }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los clientes.');
    } finally {
      this.loading.set(false);
    }
  }

  protected open(customer: Customer): void {
    void this.router.navigate(['/customers', customer.id]);
  }
}
