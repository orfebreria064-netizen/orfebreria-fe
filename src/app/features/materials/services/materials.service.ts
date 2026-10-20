import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { MaterialType, MovementType } from '../../../core/models/domain';
import { emptyToNull, unwrap } from '../../../shared/utils/db';
import {
  ClientMaterialBalance,
  Material,
  MaterialInput,
  MaterialMovement,
  MaterialPrice,
  MaterialPriceHistory,
  MovementInput,
} from '../models/material.model';

/** Columnas calculadas day_price / day_price_date: precio de venta vigente (0012_taller_joyeros_precios.sql). */
const MATERIAL_SELECT = '*, day_price, day_price_date';

const MOVEMENT_SELECT =
  '*, material:materials(id, name, purity, unit), order:orders(id, number), creator:profiles!material_movements_created_by_fkey(full_name)';

export interface MovementFilters {
  materialId?: string;
  orderId?: string;
  type?: MovementType | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class MaterialsService {
  private readonly db = inject(SupabaseService).client;

  async list(options: { includeInactive?: boolean; type?: MaterialType | null } = {}): Promise<Material[]> {
    let query = this.db.from('materials').select(MATERIAL_SELECT).order('type').order('name');
    if (!options.includeInactive) query = query.eq('active', true);
    if (options.type) query = query.eq('type', options.type);
    return unwrap(await query) as Material[];
  }

  /** Precio vigente de cada material activo, con el anterior para ver la variación. */
  async currentPrices(): Promise<MaterialPrice[]> {
    return unwrap(await this.db.rpc('material_prices_current')) as MaterialPrice[];
  }

  /** Registra (o corrige) los precios de una fecha; por defecto, hoy. */
  async savePrices(prices: { material_id: string; price: number }[], priceDate: string | null = null): Promise<void> {
    unwrap(await this.db.rpc('save_material_prices', { p_price_date: priceDate, p_prices: prices }));
  }

  async priceHistory(materialId: string): Promise<MaterialPriceHistory[]> {
    return unwrap(await this.db.rpc('material_price_history', { p_material_id: materialId })) as MaterialPriceHistory[];
  }

  async get(id: string): Promise<Material> {
    return unwrap(await this.db.from('materials').select(MATERIAL_SELECT).eq('id', id).single()) as Material;
  }

  /** Devuelve el id del material creado (el stock inicial lo registra la base como entrada). */
  async create(input: MaterialInput): Promise<string> {
    return (unwrap(await this.db.from('materials').insert(emptyToNull(input)).select('id').single()) as { id: string }).id;
  }

  /** El stock no se edita aquí: solo mediante movimientos. */
  async update(id: string, input: Omit<MaterialInput, 'stock'>): Promise<Material> {
    return unwrap(await this.db.from('materials').update(emptyToNull(input)).eq('id', id).select().single()) as Material;
  }

  async movements(filters: MovementFilters = {}): Promise<MaterialMovement[]> {
    let query = this.db
      .from('material_movements')
      .select(MOVEMENT_SELECT)
      .order('movement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(filters.limit ?? 500);
    if (filters.materialId) query = query.eq('material_id', filters.materialId);
    if (filters.orderId) query = query.eq('order_id', filters.orderId);
    if (filters.type) query = query.eq('movement_type', filters.type);
    if (filters.from) query = query.gte('movement_date', filters.from);
    if (filters.to) query = query.lte('movement_date', filters.to);
    return unwrap(await query) as MaterialMovement[];
  }

  /** Registra un movimiento. La base de datos valida stock suficiente y actualiza el stock. */
  async addMovement(input: MovementInput): Promise<MaterialMovement> {
    return unwrap(
      await this.db.from('material_movements').insert(emptyToNull(input)).select(MOVEMENT_SELECT).single(),
    ) as MaterialMovement;
  }

  async clientBalances(orderId: string): Promise<ClientMaterialBalance[]> {
    return unwrap(
      await this.db.from('order_client_materials').select('*').eq('order_id', orderId).order('material_name'),
    ) as ClientMaterialBalance[];
  }
}
