import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { emptyToNull, unwrap } from '../../../shared/utils/db';
import { Customer, CustomerContact, CustomerInput, CustomerOption, CustomerStats } from '../models/customer.model';
import { QuotationRow } from '../../quotations/models/quotation.model';
import { OrderHistoryEntry, OrderRow } from '../../orders/models/order.model';
import { Payment } from '../../payments/models/payment.model';

export interface CustomerFilters {
  search?: string;
  includeInactive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly db = inject(SupabaseService).client;

  async list(filters: CustomerFilters = {}): Promise<Customer[]> {
    let query = this.db.from('customers').select('*').order('full_name');
    if (!filters.includeInactive) query = query.eq('active', true);
    const term = filters.search?.trim().replace(/[%,()]/g, ' ');
    if (term) {
      query = query.or(
        `full_name.ilike.%${term}%,document_number.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`,
      );
    }
    return unwrap(await query) as Customer[];
  }

  /** Búsqueda ligera para selects de cliente en cotizaciones/pedidos. */
  async search(term: string, limit = 20): Promise<CustomerOption[]> {
    let query = this.db
      .from('customers')
      .select('id, full_name, document_number, phone')
      .eq('active', true)
      .order('full_name')
      .limit(limit);
    const clean = term.trim().replace(/[%,()]/g, ' ');
    if (clean) query = query.or(`full_name.ilike.%${clean}%,document_number.ilike.%${clean}%`);
    return unwrap(await query) as CustomerOption[];
  }

  async get(id: string): Promise<Customer> {
    return unwrap(await this.db.from('customers').select('*').eq('id', id).single()) as Customer;
  }

  async create(input: CustomerInput): Promise<Customer> {
    return unwrap(await this.db.from('customers').insert(emptyToNull(input)).select().single()) as Customer;
  }

  async update(id: string, input: Partial<CustomerInput>): Promise<Customer> {
    return unwrap(await this.db.from('customers').update(emptyToNull(input)).eq('id', id).select().single()) as Customer;
  }

  /** Baja lógica (no se elimina información crítica). */
  async setActive(id: string, active: boolean): Promise<void> {
    unwrap(await this.db.from('customers').update({ active }).eq('id', id));
  }

  async stats(id: string): Promise<CustomerStats | null> {
    return unwrap(await this.db.from('customer_stats').select('*').eq('customer_id', id).maybeSingle()) as CustomerStats | null;
  }

  // ------------------------------------------------------------ Ficha 360°
  async quotations(customerId: string): Promise<QuotationRow[]> {
    return unwrap(
      await this.db
        .from('quotations')
        .select('*, customer:customers(id, full_name), service_type:service_types(name), order:orders!quotations_order_fk(id, number)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
    ) as QuotationRow[];
  }

  async orders(customerId: string): Promise<OrderRow[]> {
    return unwrap(
      await this.db
        .from('orders')
        .select('*, customer:customers(id, full_name), service_type:service_types(name), assignee:profiles!orders_assigned_to_fkey(id, full_name)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
    ) as OrderRow[];
  }

  async payments(customerId: string): Promise<Payment[]> {
    return unwrap(
      await this.db
        .from('payments')
        .select('*, order:orders!inner(id, number, customer_id, customer:customers(id, full_name))')
        .eq('order.customer_id', customerId)
        .order('payment_date', { ascending: false }),
    ) as Payment[];
  }

  async history(customerId: string, limit = 100): Promise<OrderHistoryEntry[]> {
    return unwrap(
      await this.db
        .from('order_history')
        .select('*, order:orders!inner(number, customer_id)')
        .eq('order.customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ) as OrderHistoryEntry[];
  }

  // ------------------------------------------------------------ Contactos
  async contacts(customerId: string): Promise<CustomerContact[]> {
    return unwrap(
      await this.db.from('customer_contacts').select('*').eq('customer_id', customerId).order('name'),
    ) as CustomerContact[];
  }

  async saveContact(contact: Omit<CustomerContact, 'id'> & { id?: string }): Promise<void> {
    const { id, ...data } = emptyToNull(contact);
    if (id) unwrap(await this.db.from('customer_contacts').update(data).eq('id', id));
    else unwrap(await this.db.from('customer_contacts').insert(data));
  }

  async deleteContact(id: string): Promise<void> {
    unwrap(await this.db.from('customer_contacts').delete().eq('id', id));
  }
}
