import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { ConfirmationService } from 'primeng/api';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_SEVERITY,
  PAYMENT_METHOD_LABELS,
  PERSON_TYPE_LABELS,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_SEVERITY,
} from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { BreadcrumbService } from '../../../../layout/breadcrumb.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { HistoryTimeline } from '../../../../shared/components/history-timeline/history-timeline';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { whatsappLink } from '../../../../shared/utils/format';
import { phoneValidator } from '../../../../shared/utils/validators';
import { Customer, CustomerContact, CustomerStats } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';
import { QuotationRow } from '../../../quotations/models/quotation.model';
import { OrderHistoryEntry, OrderRow } from '../../../orders/models/order.model';
import { Payment } from '../../../payments/models/payment.model';

/** Ficha 360° del cliente. */
@Component({
  selector: 'app-customer-detail',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    TabsModule,
    TableModule,
    TagModule,
    SkeletonModule,
    DialogModule,
    InputTextModule,
    ProgressBarModule,
    PageHeader,
    StatCard,
    StatusTag,
    EmptyState,
    FieldError,
    HistoryTimeline,
    MoneyPipe,
    LabelPipe,
  ],
  templateUrl: './customer-detail.html',
})
export class CustomerDetail implements OnInit {
  private readonly service = inject(CustomersService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly customer = signal<Customer | null>(null);
  protected readonly stats = signal<CustomerStats | null>(null);
  protected readonly quotations = signal<QuotationRow[]>([]);
  protected readonly orders = signal<OrderRow[]>([]);
  protected readonly payments = signal<Payment[]>([]);
  protected readonly history = signal<OrderHistoryEntry[]>([]);
  protected readonly contacts = signal<CustomerContact[]>([]);
  protected readonly loading = signal(true);

  protected readonly canWrite = this.auth.hasRole(...MODULE_ROLES.customersWrite);
  protected readonly canQuote = this.auth.hasRole(...MODULE_ROLES.quotations);
  protected readonly canCreateOrder = this.auth.hasRole(...MODULE_ROLES.ordersWrite);
  protected readonly canSeePayments = this.auth.hasRole(...MODULE_ROLES.payments);

  protected readonly labels = {
    person: PERSON_TYPE_LABELS,
    quotation: QUOTATION_STATUS_LABELS,
    quotationSeverity: QUOTATION_STATUS_SEVERITY,
    order: ORDER_STATUS_LABELS,
    orderSeverity: ORDER_STATUS_SEVERITY,
    method: PAYMENT_METHOD_LABELS,
  };

  protected readonly whatsapp = computed(() => {
    const c = this.customer();
    return whatsappLink(c?.whatsapp || c?.phone, c ? `Hola ${c.first_name ?? c.full_name}, ` : undefined);
  });
  protected readonly lastOrder = computed(() => this.orders().at(0) ?? null);
  protected readonly totalPurchased = computed(() => formatMoney(this.stats()?.total_purchased));
  protected readonly balance = computed(() => formatMoney(this.stats()?.balance));

  // Contactos
  protected readonly contactDialog = signal(false);
  protected readonly savingContact = signal(false);
  private editingContactId: string | null = null;
  protected readonly contactForm = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    position: [''],
    phone: ['', [phoneValidator]],
    email: ['', [Validators.email]],
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const id = this.id();
    try {
      const [customer, stats, orders, history, contacts] = await Promise.all([
        this.service.get(id),
        this.service.stats(id),
        this.service.orders(id),
        this.service.history(id),
        this.service.contacts(id),
      ]);
      this.customer.set(customer);
      this.stats.set(stats);
      this.orders.set(orders);
      this.history.set(history);
      this.contacts.set(contacts);
      this.breadcrumb.setDetail(customer.full_name);

      const [quotations, payments] = await Promise.all([
        this.canQuote ? this.service.quotations(id) : Promise.resolve([]),
        this.canSeePayments ? this.service.payments(id) : Promise.resolve([]),
      ]);
      this.quotations.set(quotations);
      this.payments.set(payments);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el cliente.');
      void this.router.navigate(['/customers']);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggleActive(): void {
    const c = this.customer();
    if (!c) return;
    const activate = !c.active;
    this.confirm.confirm({
      header: activate ? 'Reactivar cliente' : 'Desactivar cliente',
      message: activate
        ? `¿Reactivar a ${c.full_name}?`
        : `¿Desactivar a ${c.full_name}? No se eliminará su información; solo dejará de aparecer en las búsquedas.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: activate ? 'Reactivar' : 'Desactivar', severity: activate ? 'primary' : 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: async () => {
        try {
          await this.service.setActive(c.id, activate);
          this.customer.set({ ...c, active: activate });
          this.notify.success(activate ? 'Cliente reactivado.' : 'Cliente desactivado.');
        } catch (err) {
          this.notify.error(err, 'No se pudo actualizar el cliente.');
        }
      },
    });
  }

  protected openContact(contact?: CustomerContact): void {
    this.editingContactId = contact?.id ?? null;
    this.contactForm.reset({
      name: contact?.name ?? '',
      position: contact?.position ?? '',
      phone: contact?.phone ?? '',
      email: contact?.email ?? '',
    });
    this.contactDialog.set(true);
  }

  protected async saveContact(): Promise<void> {
    if (this.contactForm.invalid) {
      this.contactForm.markAllAsTouched();
      return;
    }
    this.savingContact.set(true);
    try {
      const value = this.contactForm.getRawValue();
      await this.service.saveContact({
        id: this.editingContactId ?? undefined,
        customer_id: this.id(),
        name: value.name,
        position: value.position,
        phone: value.phone,
        email: value.email,
        notes: null,
      });
      this.contacts.set(await this.service.contacts(this.id()));
      this.contactDialog.set(false);
      this.notify.success('Contacto guardado.');
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el contacto.');
    } finally {
      this.savingContact.set(false);
    }
  }

  protected deleteContact(contact: CustomerContact): void {
    this.confirm.confirm({
      header: 'Eliminar contacto',
      message: `¿Eliminar el contacto ${contact.name}?`,
      acceptButtonProps: { label: 'Eliminar', severity: 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: async () => {
        try {
          await this.service.deleteContact(contact.id);
          this.contacts.update((list) => list.filter((c) => c.id !== contact.id));
        } catch (err) {
          this.notify.error(err, 'No se pudo eliminar el contacto.');
        }
      },
    });
  }
}
