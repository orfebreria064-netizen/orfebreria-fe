import { MaterialOwnership, MaterialType, MaterialUnit, MovementType } from '../../../core/models/domain';

export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  purity: string | null;
  unit: MaterialUnit;
  stock: number;
  min_stock: number;
  reference_cost: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  /** Precio de venta vigente por unidad (último registrado con fecha <= hoy). */
  day_price?: number | null;
  day_price_date?: string | null;
}

/** Fila de "Precios del día" (api.usp_material_prices_current). */
export interface MaterialPrice {
  material_id: string;
  name: string;
  type: MaterialType;
  purity: string | null;
  unit: MaterialUnit;
  reference_cost: number;
  price: number | null;
  price_date: string | null;
  previous_price: number | null;
  previous_date: string | null;
  updated_by: string | null;
}

export interface MaterialPriceHistory {
  price_date: string;
  price: number;
  updated_by: string | null;
  updated_at: string;
}

export type MaterialInput = Pick<Material, 'name' | 'type' | 'purity' | 'unit' | 'min_stock' | 'reference_cost' | 'active'> & {
  /** Solo al crear: se registra como movimiento de entrada "Stock inicial". */
  stock?: number;
};

export interface MaterialMovement {
  id: string;
  material_id: string;
  order_id: string | null;
  movement_type: MovementType;
  ownership: MaterialOwnership;
  quantity: number;
  unit_cost: number | null;
  movement_date: string;
  notes: string | null;
  stock_after: number | null;
  created_at: string;
  material?: { id: string; name: string; purity: string | null; unit: MaterialUnit } | null;
  order?: { id: string; number: string } | null;
  creator?: { full_name: string } | null;
}

export interface MovementInput {
  material_id: string;
  order_id: string | null;
  movement_type: MovementType;
  ownership: MaterialOwnership;
  quantity: number;
  unit_cost: number | null;
  movement_date: string;
  notes: string | null;
}

/** Saldo de material entregado por el cliente para un pedido (vista order_client_materials). */
export interface ClientMaterialBalance {
  order_id: string;
  material_id: string;
  material_name: string;
  purity: string | null;
  unit: MaterialUnit;
  received: number;
  used: number;
  returned: number;
  balance: number;
}
