import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { OrderStatus, StageStatus } from '../../../core/models/domain';
import { mapStage } from '../../../shared/utils/api-mappers';
import { BoardStage, OrderStage } from '../../orders/models/order.model';
import { OrdersService } from '../../orders/services/orders.service';

/** Pedidos cuyo trabajo de taller sigue abierto (se muestran en el tablero). */
export const BOARD_ORDER_STATUSES: OrderStatus[] = ['APROBADO', 'DISENO', 'PRODUCCION', 'CONTROL_CALIDAD', 'LISTO_ENTREGA', 'PAUSADO'];

export interface BoardFilters {
  onlyCurrent?: boolean;
  assignedTo?: string | null;
  stageName?: string | null;
}

/**
 * Etapas de producción por pedido. La etapa actual, el avance (%) y el estado del pedido
 * los recalcula la base de datos tras cada cambio.
 */
@Injectable({ providedIn: 'root' })
export class ProductionService {
  private readonly api = inject(ApiService);
  private readonly orders = inject(OrdersService);

  async stages(orderId: string): Promise<OrderStage[]> {
    const etapas = (await this.orders.sheet(orderId)).etapas;
    return etapas.map((s) => mapStage(s, orderId)).sort((a, b) => a.position - b.position);
  }

  async board(filters: BoardFilters = {}): Promise<BoardStage[]> {
    const rows = await this.api.post<Record<string, any>[]>('Pedido/produccion', {}); // eslint-disable-line @typescript-eslint/no-explicit-any
    return rows
      .filter((r) => BOARD_ORDER_STATUSES.includes(r['order_status']))
      .filter((r) => !filters.onlyCurrent || r['is_current'])
      .filter((r) => !filters.assignedTo || r['assigned_to'] === filters.assignedTo)
      .filter((r) => !filters.stageName || r['name'] === filters.stageName)
      .map(
        (r) =>
          ({
            ...mapStage(r, r['order_id']),
            stage_id: null,
            order: {
              id: r['order_id'],
              number: r['order_number'],
              title: r['order_title'],
              status: r['order_status'],
              priority: r['priority'],
              due_date: r['due_date'],
              progress: r['progress'],
              customer: r['customer_name'] ? { full_name: r['customer_name'] } : null,
            },
          }) as BoardStage,
      )
      .sort((a, b) => a.position - b.position);
  }

  /** Copia la plantilla de etapas al pedido. */
  async createFromTemplate(orderId: string): Promise<number> {
    const r = await this.api.procesar<{ stages: number }>(`Pedido/generaretapas/${orderId}`);
    return Number(r.data?.stages ?? r.resultProceso ?? 0);
  }

  async add(orderId: string, name: string, position: number, isQualityCheck = false): Promise<void> {
    await this.api.procesar('Pedido/agregaretapa', { order_id: orderId, name: name.trim(), position, is_quality_check: isQualityCheck });
  }

  /** Actualización parcial: solo cambia lo que viene en el patch. */
  async update(
    id: string,
    patch: Partial<Pick<OrderStage, 'status' | 'assigned_to' | 'notes' | 'name' | 'position'>>,
  ): Promise<void> {
    await this.api.procesar('Pedido/actualizaretapa', {
      stage_id: id,
      status: patch.status ?? null,
      assigned_to: patch.assigned_to ?? null,
      update_assigned: 'assigned_to' in patch,
      notes: patch.notes?.trim() || null,
      update_notes: 'notes' in patch,
      name: patch.name?.trim() || null,
      position: patch.position ?? null,
    });
  }

  async setStatus(id: string, status: StageStatus): Promise<void> {
    await this.update(id, { status });
  }

  async remove(id: string): Promise<void> {
    await this.api.procesar(`Pedido/eliminaretapa/${id}`);
  }
}
