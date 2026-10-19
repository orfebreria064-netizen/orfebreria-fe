import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { MaterialType, MovementType } from '../../../core/models/domain';
import { AppError, emptyToNull } from '../../../shared/utils/db';
import { mapMovement } from '../../../shared/utils/api-mappers';
import {
  ClientMaterialBalance,
  Material,
  MaterialInput,
  MaterialMovement,
  MaterialPrice,
  MaterialPriceHistory,
  MovementInput,
} from '../models/material.model';

export interface MovementFilters {
  materialId?: string;
  orderId?: string;
  type?: MovementType | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

/** Materiales. Sin sucursal, stock y mínimo son el consolidado de la empresa. */
@Injectable({ providedIn: 'root' })
export class MaterialsService {
  private readonly api = inject(ApiService);

  async list(options: { includeInactive?: boolean; type?: MaterialType | null } = {}): Promise<Material[]> {
    return this.api.post<Material[]>('Material/listarmateriales', {
      include_inactive: options.includeInactive ?? false,
      type: options.type ?? null,
    });
  }

  /** Precio vigente de cada material activo, con el anterior para ver la variación. */
  async currentPrices(): Promise<MaterialPrice[]> {
    return this.api.get<MaterialPrice[]>('Material/preciosvigentes');
  }

  /** Registra (o corrige) los precios de una fecha; por defecto, hoy. */
  async savePrices(prices: { material_id: string; price: number }[], priceDate: string | null = null): Promise<void> {
    await this.api.procesar('Material/registrarprecios', { price_date: priceDate, prices });
  }

  async priceHistory(materialId: string): Promise<MaterialPriceHistory[]> {
    return this.api.get<MaterialPriceHistory[]>(`Material/historialprecios/${materialId}`);
  }

  async get(id: string): Promise<Material> {
    const material = (await this.list({ includeInactive: true })).find((m) => m.id === id);
    if (!material) throw new AppError('Material no encontrado.');
    return material;
  }

  /** El stock inicial se registra como movimiento de entrada "Stock inicial" en la sucursal del usuario. */
  async create(input: MaterialInput): Promise<string | null> {
    const { stock, ...data } = emptyToNull(input);
    const r = await this.api.procesar<{ id: string }>('Material/materialprc', { ...data, initial_stock: stock ?? 0 });
    return r.data?.id ?? null;
  }

  /** El stock no se edita aquí: solo mediante movimientos. */
  async update(id: string, input: Omit<MaterialInput, 'stock'>): Promise<void> {
    await this.api.procesar('Material/materialprc', { ...emptyToNull(input), id });
  }

  async movements(filters: MovementFilters = {}): Promise<MaterialMovement[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Material/kardex', {
      material_id: filters.materialId ?? null,
      order_id: filters.orderId ?? null,
      movement_type: filters.type ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
      limit: filters.limit ?? 500,
    });
    return rows.map(mapMovement);
  }

  /** Registra un movimiento. La base de datos valida stock suficiente y actualiza el stock. */
  async addMovement(input: MovementInput): Promise<void> {
    await this.api.procesar('Material/registrarmovimiento', emptyToNull(input));
  }

  async clientBalances(orderId: string): Promise<ClientMaterialBalance[]> {
    return this.api.get<ClientMaterialBalance[]>(`Material/materialcliente/${orderId}`);
  }
}
