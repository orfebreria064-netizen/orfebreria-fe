import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { emptyToNull } from '../../../shared/utils/db';
import { mapHistory, mapOrderRow, mapPayment, mapQuotationRow, orEmpty } from '../../../shared/utils/api-mappers';
import { Customer, CustomerContact, CustomerInput, CustomerOption, CustomerStats } from '../models/customer.model';
import { QuotationRow } from '../../quotations/models/quotation.model';
import { OrderHistoryEntry, OrderRow } from '../../orders/models/order.model';
import { Payment } from '../../payments/models/payment.model';

export interface CustomerFilters {
  search?: string;
  includeInactive?: boolean;
}

/** Ficha 360° de Cliente/traeruno: cliente, resumen, contactos y pedidos. */
interface CustomerSheet {
  cliente: Customer;
  resumen: Omit<CustomerStats, 'customer_id'> | null;
  contactos: Omit<CustomerContact, 'customer_id'>[];
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly api = inject(ApiService);

  async list(filters: CustomerFilters = {}): Promise<Customer[]> {
    return this.api.post<Customer[]>('Cliente/listarclientes', {
      search: filters.search?.trim() || null,
      include_inactive: filters.includeInactive ?? false,
    });
  }

  /** Búsqueda ligera para selects de cliente en cotizaciones/pedidos. */
  async search(term: string, limit = 20): Promise<CustomerOption[]> {
    const rows = await this.list({ search: term });
    return rows.slice(0, limit).map(({ id, full_name, document_number, phone }) => ({ id, full_name, document_number, phone }));
  }

  async get(id: string): Promise<Customer> {
    return (await this.sheet(id)).cliente;
  }

  async create(input: CustomerInput): Promise<Customer> {
    const r = await this.api.procesar('Cliente/clienteprc', emptyToNull(input));
    return this.get(r.resultProceso!);
  }

  /** La API recibe el cliente completo: se combina el cambio con los datos actuales. */
  async update(id: string, input: Partial<CustomerInput>): Promise<Customer> {
    const actual = await this.get(id);
    await this.api.procesar('Cliente/clienteprc', { ...actual, ...emptyToNull(input), id });
    return this.get(id);
  }

  /** Baja lógica (no se elimina información crítica). */
  async setActive(id: string, active: boolean): Promise<void> {
    await this.update(id, { active });
  }

  async stats(id: string): Promise<CustomerStats | null> {
    const resumen = (await this.sheet(id)).resumen;
    return resumen ? { ...resumen, customer_id: id } : null;
  }

  // ------------------------------------------------------------ Ficha 360°
  async quotations(customerId: string): Promise<QuotationRow[]> {
    const rows = await orEmpty(this.api.post<Record<string, unknown>[]>('Cotizacion/listarcotizaciones', { customer_id: customerId }));
    return rows.map(mapQuotationRow);
  }

  async orders(customerId: string): Promise<OrderRow[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Pedido/listarpedidos', { customer_id: customerId });
    return rows.map(mapOrderRow);
  }

  async payments(customerId: string): Promise<Payment[]> {
    const rows = await orEmpty(this.api.post<Record<string, unknown>[]>('Pago/listarpagos', { customer_id: customerId }));
    return rows.map(mapPayment);
  }

  async history(customerId: string, limit = 100): Promise<OrderHistoryEntry[]> {
    const rows = await this.api.get<Record<string, unknown>[]>(`Cliente/historial/${customerId}`, { limite: limit });
    return rows.map(mapHistory);
  }

  // ------------------------------------------------------------ Contactos
  async contacts(customerId: string): Promise<CustomerContact[]> {
    return (await this.sheet(customerId)).contactos.map((c) => ({ ...c, customer_id: customerId }));
  }

  async saveContact(contact: Omit<CustomerContact, 'id'> & { id?: string }): Promise<void> {
    await this.api.procesar('Cliente/contactoprc', emptyToNull(contact));
  }

  async deleteContact(id: string): Promise<void> {
    await this.api.procesar(`Cliente/eliminarcontacto/${id}`);
  }

  private sheet(id: string): Promise<CustomerSheet> {
    return this.api.get<CustomerSheet>(`Cliente/traeruno/${id}`);
  }
}
