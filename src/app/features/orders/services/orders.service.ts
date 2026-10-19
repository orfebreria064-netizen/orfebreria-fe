import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { OrderStatus, Priority } from '../../../core/models/domain';
import { mapHistory, mapOrderDetail, mapOrderRow } from '../../../shared/utils/api-mappers';
import { emptyToNull } from '../../../shared/utils/db';
import { OrderDetail, OrderHeaderInput, OrderHistoryEntry, OrderItem, OrderRow, ProductionOrderInput } from '../models/order.model';

export interface OrderFilters {
  statuses?: OrderStatus[];
  search?: string;
  assignedTo?: string | null;
  overdueOnly?: boolean;
  serviceTypeId?: string | null;
}

/** Pedido completo de Pedido/traeruno (cabecera, ítems, etapas, historial, pagos, entregas, adjuntos, material del cliente). */
export interface OrderSheet {
  pedido: Record<string, unknown>;
  items: OrderItem[];
  etapas: Record<string, unknown>[];
  historial: Record<string, unknown>[];
  pagos: Record<string, unknown>[];
  entregas: Record<string, unknown>[];
  adjuntos: Record<string, unknown>[];
  material_cliente: Record<string, unknown>[];
  /** Recibos de egreso del pedido (solo ADMIN y GERENTE; vacío para el resto). */
  pagos_joyero: Record<string, unknown>[];
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
  private readonly api = inject(ApiService);

  async list(filters: OrderFilters = {}): Promise<OrderRow[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Pedido/listarpedidos', {
      statuses: filters.statuses?.length ? filters.statuses : null,
      assigned_to: filters.assignedTo ?? null,
      service_type_id: filters.serviceTypeId ?? null,
      overdue_only: filters.overdueOnly ?? false,
      search: filters.search?.trim() || null,
    });
    return rows.map(mapOrderRow);
  }

  /** Búsqueda ligera para selects (pagos, movimientos, entregas). */
  async search(term: string, options: { excludeStatuses?: OrderStatus[] } = {}): Promise<OrderRow[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Pedido/listarpedidos', {
      search: term.trim() || null,
      exclude_statuses: options.excludeStatuses?.length ? options.excludeStatuses : null,
      limit: 20,
    });
    return rows.map(mapOrderRow);
  }

  /** Pedido completo tal como lo devuelve la API (lo reutilizan producción, pagos y entregas). */
  sheet(id: string): Promise<OrderSheet> {
    return this.api.get<OrderSheet>(`Pedido/traeruno/${id}`);
  }

  async get(id: string): Promise<OrderDetail> {
    const r = await this.sheet(id);
    return mapOrderDetail(r.pedido, r.items);
  }

  async save(id: string | null, header: OrderHeaderInput, items: OrderItem[]): Promise<string> {
    return (await this.api.procesar('Pedido/pedidoprc', { id, header, items })).resultProceso!;
  }

  async setStatus(id: string, status: OrderStatus): Promise<void> {
    await this.api.procesar('Pedido/cambiarestado', { id, status });
  }

  async assign(id: string, userId: string | null): Promise<void> {
    await this.api.procesar('Pedido/asignar', { id, assigned_to: userId });
  }

  /** La API recibe fecha y prioridad juntas: lo que no viene en el cambio conserva su valor actual. */
  async updateSchedule(id: string, patch: { due_date?: string | null; priority?: Priority }): Promise<void> {
    const actual = (await this.sheet(id)).pedido;
    await this.api.procesar('Pedido/cronograma', {
      id,
      due_date: 'due_date' in patch ? patch.due_date : actual['due_date'],
      priority: patch.priority ?? actual['priority'],
    });
  }

  async history(orderId: string): Promise<OrderHistoryEntry[]> {
    return (await this.sheet(orderId)).historial.map(mapHistory);
  }

  /** Proforma (PRO) u orden de producción (OP): la primera emisión asigna el número; luego se reutiliza. */
  async issueDocument(orderId: string, docType: 'PRO' | 'OP'): Promise<string> {
    return (await this.api.procesar('Pedido/emitirdocumento', { order_id: orderId, doc_type: docType })).resultProceso!;
  }

  /** Datos del taller: joyero, material entregado, indicaciones y acabado (se envían todos los campos). */
  async saveProduction(input: ProductionOrderInput): Promise<void> {
    await this.api.procesar('Pedido/ordenproduccion', emptyToNull(input));
  }
}
