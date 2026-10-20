import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { OrderStatus, Priority } from '../../../core/models/domain';
import { todayIso, unwrap } from '../../../shared/utils/db';
import { OrderDetail, OrderHeaderInput, OrderHistoryEntry, OrderItem, OrderRow, ProductionOrderInput } from '../models/order.model';

export const ORDER_ROW_SELECT =
  '*, customer:customers(id, full_name), service_type:service_types(name), assignee:profiles!orders_assigned_to_fkey(id, full_name)';
const ORDER_DETAIL_SELECT =
  '*, items:order_items(*), service_type:service_types(name), assignee:profiles!orders_assigned_to_fkey(id, full_name), ' +
  'quotation:quotations!orders_quotation_id_fkey(id, number), ' +
  'customer:customers(id, full_name, document_type, document_number, phone, whatsapp, email, address), ' +
  'jeweler:jewelers(id, full_name, document_number, phone)';

export interface OrderFilters {
  statuses?: OrderStatus[];
  search?: string;
  assignedTo?: string | null;
  overdueOnly?: boolean;
  serviceTypeId?: string | null;
}

/**
 * Transiciones manuales sugeridas en la UI. Las reglas duras (producción completa, control de
 * calidad, entrega registrada, pedido cerrado) las valida la base de datos.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  SOLICITUD: ['COTIZADO', 'APROBADO', 'PAUSADO', 'CANCELADO'],
  COTIZADO: ['APROBADO', 'PAUSADO', 'CANCELADO'],
  APROBADO: ['DISENO', 'PRODUCCION', 'LISTO_ENTREGA', 'PAUSADO', 'CANCELADO'],
  DISENO: ['PRODUCCION', 'PAUSADO', 'CANCELADO'],
  PRODUCCION: ['CONTROL_CALIDAD', 'PAUSADO', 'CANCELADO'],
  CONTROL_CALIDAD: ['LISTO_ENTREGA', 'PRODUCCION', 'PAUSADO'],
  LISTO_ENTREGA: ['PRODUCCION', 'PAUSADO'],
  ENTREGADO: ['CERRADO'],
  PAUSADO: ['APROBADO', 'DISENO', 'PRODUCCION', 'CONTROL_CALIDAD', 'CANCELADO'],
  CERRADO: ['ENTREGADO'],
  CANCELADO: ['SOLICITUD'],
};

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly db = inject(SupabaseService).client;

  async list(filters: OrderFilters = {}): Promise<OrderRow[]> {
    let query = this.db.from('orders').select(ORDER_ROW_SELECT).order('created_at', { ascending: false });
    if (filters.statuses?.length) query = query.in('status', filters.statuses);
    if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
    if (filters.serviceTypeId) query = query.eq('service_type_id', filters.serviceTypeId);
    if (filters.overdueOnly) {
      query = query.lt('due_date', todayIso()).not('status', 'in', '(ENTREGADO,CERRADO,CANCELADO,PAUSADO)');
    }
    const term = filters.search?.trim().replace(/[%,()]/g, ' ');
    if (term) query = query.or(`number.ilike.%${term}%,title.ilike.%${term}%`);
    return unwrap(await query) as OrderRow[];
  }

  /** Búsqueda ligera para selects (pagos, movimientos, entregas). */
  async search(term: string, options: { excludeStatuses?: OrderStatus[] } = {}): Promise<OrderRow[]> {
    let query = this.db.from('orders').select(ORDER_ROW_SELECT).order('created_at', { ascending: false }).limit(20);
    if (options.excludeStatuses?.length) query = query.not('status', 'in', `(${options.excludeStatuses.join(',')})`);
    const clean = term.trim().replace(/[%,()]/g, ' ');
    if (clean) query = query.or(`number.ilike.%${clean}%,title.ilike.%${clean}%`);
    return unwrap(await query) as OrderRow[];
  }

  async get(id: string): Promise<OrderDetail> {
    const order = unwrap(await this.db.from('orders').select(ORDER_DETAIL_SELECT).eq('id', id).single()) as OrderDetail;
    order.items = [...order.items].sort((a, b) => a.position - b.position);
    return order;
  }

  async save(id: string | null, header: OrderHeaderInput, items: OrderItem[]): Promise<string> {
    return unwrap(await this.db.rpc('save_order', { p_id: id, p_header: header, p_items: items })) as string;
  }

  async setStatus(id: string, status: OrderStatus): Promise<void> {
    unwrap(await this.db.from('orders').update({ status }).eq('id', id));
  }

  async assign(id: string, userId: string | null): Promise<void> {
    unwrap(await this.db.from('orders').update({ assigned_to: userId }).eq('id', id));
  }

  async updateSchedule(id: string, patch: { due_date?: string | null; priority?: Priority }): Promise<void> {
    unwrap(await this.db.from('orders').update(patch).eq('id', id));
  }

  async history(orderId: string): Promise<OrderHistoryEntry[]> {
    return unwrap(
      await this.db.from('order_history').select('*').eq('order_id', orderId).order('created_at', { ascending: false }),
    ) as OrderHistoryEntry[];
  }

  /** Proforma (PRO) u orden de producción (OP): la primera emisión asigna el número; luego se reutiliza. */
  async issueDocument(orderId: string, docType: 'PRO' | 'OP'): Promise<string> {
    return unwrap(await this.db.rpc('issue_order_document', { p_order_id: orderId, p_doc_type: docType })) as string;
  }

  /** Datos del taller: joyero, material entregado, indicaciones y acabado (se envían todos los campos). */
  async saveProduction(input: ProductionOrderInput): Promise<void> {
    unwrap(
      await this.db.rpc('save_order_production', {
        p_order_id: input.order_id,
        p_jeweler_id: input.jeweler_id,
        p_material_delivered_at: input.material_delivered_at,
        p_material_weight_out: input.material_weight_out,
        p_production_instructions: input.production_instructions,
        p_product_delivered_at: input.product_delivered_at,
        p_weight_returned: input.weight_returned,
        p_production_notes: input.production_notes,
      }),
    );
  }
}
