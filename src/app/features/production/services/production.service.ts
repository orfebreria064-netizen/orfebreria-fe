import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { OrderStatus, StageStatus } from '../../../core/models/domain';
import { emptyToNull, unwrap } from '../../../shared/utils/db';
import { BoardStage, OrderStage } from '../../orders/models/order.model';

const STAGE_SELECT = '*, assignee:profiles!order_production_stages_assigned_to_fkey(id, full_name)';
const BOARD_SELECT =
  STAGE_SELECT +
  ', order:orders!inner(id, number, title, status, priority, due_date, progress, customer:customers(full_name))';

/** Pedidos cuyo trabajo de taller sigue abierto (se muestran en el tablero). */
export const BOARD_ORDER_STATUSES: OrderStatus[] = ['APROBADO', 'DISENO', 'PRODUCCION', 'CONTROL_CALIDAD', 'LISTO_ENTREGA', 'PAUSADO'];

export interface BoardFilters {
  onlyCurrent?: boolean;
  assignedTo?: string | null;
  stageName?: string | null;
}

/**
 * Etapas de producción por pedido. La etapa actual, el avance (%) y el estado del pedido
 * los recalcula PostgreSQL (trigger sync_order_production) tras cada cambio.
 */
@Injectable({ providedIn: 'root' })
export class ProductionService {
  private readonly db = inject(SupabaseService).client;

  async stages(orderId: string): Promise<OrderStage[]> {
    return unwrap(
      await this.db.from('order_production_stages').select(STAGE_SELECT).eq('order_id', orderId).order('position'),
    ) as OrderStage[];
  }

  async board(filters: BoardFilters = {}): Promise<BoardStage[]> {
    let query = this.db
      .from('order_production_stages')
      .select(BOARD_SELECT)
      .in('order.status', BOARD_ORDER_STATUSES)
      .order('position');
    if (filters.onlyCurrent) query = query.eq('is_current', true);
    if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
    if (filters.stageName) query = query.eq('name', filters.stageName);
    return unwrap(await query) as unknown as BoardStage[];
  }

  /** Copia la plantilla de etapas al pedido. */
  async createFromTemplate(orderId: string): Promise<number> {
    return unwrap(await this.db.rpc('create_order_stages', { p_order_id: orderId })) as number;
  }

  async add(orderId: string, name: string, position: number, isQualityCheck = false): Promise<void> {
    unwrap(
      await this.db
        .from('order_production_stages')
        .insert({ order_id: orderId, name: name.trim(), position, is_quality_check: isQualityCheck }),
    );
  }

  async update(
    id: string,
    patch: Partial<Pick<OrderStage, 'status' | 'assigned_to' | 'notes' | 'name' | 'position'>>,
  ): Promise<void> {
    unwrap(await this.db.from('order_production_stages').update(emptyToNull(patch)).eq('id', id));
  }

  async setStatus(id: string, status: StageStatus): Promise<void> {
    await this.update(id, { status });
  }

  async remove(id: string): Promise<void> {
    unwrap(await this.db.from('order_production_stages').delete().eq('id', id));
  }
}
