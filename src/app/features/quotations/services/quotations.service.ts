import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Priority, QuotationStatus } from '../../../core/models/domain';
import { unwrap } from '../../../shared/utils/db';
import { QuotationDetail, QuotationHeaderInput, QuotationItem, QuotationRow } from '../models/quotation.model';

const ROW_SELECT =
  '*, customer:customers(id, full_name), service_type:service_types(name), order:orders!quotations_order_fk(id, number)';
const DETAIL_SELECT =
  '*, items:quotation_items(*), service_type:service_types(name), order:orders!quotations_order_fk(id, number), ' +
  'customer:customers(id, full_name, document_type, document_number, phone, email, address)';

export interface QuotationFilters {
  status?: QuotationStatus | null;
  search?: string;
}

export interface ConvertOptions {
  assignedTo: string | null;
  dueDate: string | null;
  priority: Priority;
  createStages: boolean;
}

@Injectable({ providedIn: 'root' })
export class QuotationsService {
  private readonly db = inject(SupabaseService).client;

  async list(filters: QuotationFilters = {}): Promise<QuotationRow[]> {
    // Marca como vencidas las cotizaciones enviadas fuera de plazo antes de listar.
    await this.db.rpc('expire_quotations');
    let query = this.db.from('quotations').select(ROW_SELECT).order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    const term = filters.search?.trim().replace(/[%,()]/g, ' ');
    if (term) query = query.or(`number.ilike.%${term}%,title.ilike.%${term}%`);
    return unwrap(await query) as QuotationRow[];
  }

  async get(id: string): Promise<QuotationDetail> {
    const detail = unwrap(
      await this.db.from('quotations').select(DETAIL_SELECT).eq('id', id).single(),
    ) as QuotationDetail;
    detail.items = [...detail.items].sort((a, b) => a.position - b.position);
    return detail;
  }

  /** Guarda cabecera + ítems en una sola transacción (RPC). Devuelve el id. */
  async save(id: string | null, header: QuotationHeaderInput, items: QuotationItem[]): Promise<string> {
    return unwrap(
      await this.db.rpc('save_quotation', { p_id: id, p_header: header, p_items: items }),
    ) as string;
  }

  /** Cambia el estado; las transiciones válidas las controla la base de datos. */
  async setStatus(id: string, status: QuotationStatus): Promise<void> {
    unwrap(await this.db.from('quotations').update({ status }).eq('id', id));
  }

  async duplicate(id: string): Promise<string> {
    return unwrap(await this.db.rpc('duplicate_quotation', { p_id: id })) as string;
  }

  /** Convierte una cotización aprobada en pedido. Devuelve el id del pedido. */
  async convertToOrder(id: string, options: ConvertOptions): Promise<string> {
    return unwrap(
      await this.db.rpc('convert_quotation_to_order', {
        p_quotation_id: id,
        p_assigned_to: options.assignedTo,
        p_due_date: options.dueDate,
        p_priority: options.priority,
        p_create_stages: options.createStages,
      }),
    ) as string;
  }
}
