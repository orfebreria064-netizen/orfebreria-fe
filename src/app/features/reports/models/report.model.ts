import { MaterialType, MaterialUnit, OrderStatus, PaymentMethod, Priority } from '../../../core/models/domain';

export type ReportKey = 'ventas' | 'cobrar' | 'cobranza' | 'plazos' | 'stock' | 'custodia';

export interface ReportInfo {
  key: ReportKey;
  title: string;
  description: string;
  icon: string;
}

export const REPORTS: ReportInfo[] = [
  { key: 'ventas', title: 'Ventas por periodo', description: 'Pedidos del periodo con IGV, cobrado y saldo', icon: 'pi pi-chart-line' },
  { key: 'cobrar', title: 'Cuentas por cobrar', description: 'Saldos pendientes por antigüedad de la deuda', icon: 'pi pi-clock' },
  { key: 'cobranza', title: 'Cobranza / caja', description: 'Pagos recibidos por día y método', icon: 'pi pi-wallet' },
  { key: 'plazos', title: 'Atrasados y por entregar', description: 'Pedidos vencidos o con entrega próxima', icon: 'pi pi-calendar-clock' },
  { key: 'stock', title: 'Stock valorizado', description: 'Inventario, valor referencial y bajo mínimo', icon: 'pi pi-box' },
  { key: 'custodia', title: 'Material de clientes', description: 'Material recibido de clientes aún en custodia', icon: 'pi pi-shield' },
];

export type AgingBucket = 'POR_VENCER' | '0_30' | '31_60' | '61_90' | 'MAS_90';

export const AGING_LABELS: Record<AgingBucket, string> = {
  POR_VENCER: 'Por vencer',
  '0_30': '0 – 30 días',
  '31_60': '31 – 60 días',
  '61_90': '61 – 90 días',
  MAS_90: 'Más de 90 días',
};

export interface SalesRow {
  id: string;
  number: string;
  order_date: string;
  customer_name: string;
  service_name: string;
  title: string;
  assignee_name: string | null;
  status: OrderStatus;
  subtotal: number;
  discount_total: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance: number;
}

export interface ReceivableRow {
  id: string;
  number: string;
  customer_name: string;
  customer_phone: string | null;
  title: string;
  status: OrderStatus;
  due_date: string | null;
  delivered_at: string | null;
  reference_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  days_old: number;
  bucket: AgingBucket;
}

export interface CollectionRow {
  id: string;
  payment_date: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  method: PaymentMethod;
  reference: string | null;
  is_advance: boolean;
  amount: number;
  voided: boolean;
  void_reason: string | null;
  voided_by_name: string | null;
  created_by_name: string | null;
}

export interface DeadlineRow {
  id: string;
  number: string;
  customer_name: string;
  customer_phone: string | null;
  title: string;
  status: OrderStatus;
  priority: Priority;
  current_stage_name: string | null;
  progress: number;
  assignee_name: string | null;
  due_date: string;
  days_left: number;
  balance: number;
}

export interface StockRow {
  id: string;
  name: string;
  type: MaterialType;
  purity: string | null;
  unit: MaterialUnit;
  stock: number;
  min_stock: number;
  reference_cost: number;
  stock_value: number;
  below_min: boolean;
  active: boolean;
}

export interface CustodyRow {
  order_id: string;
  order_number: string;
  order_status: OrderStatus;
  customer_name: string;
  customer_phone: string | null;
  material_name: string;
  purity: string | null;
  unit: MaterialUnit;
  received: number;
  used: number;
  returned: number;
  balance: number;
  last_movement: string | null;
}

/** Columna de reporte: se usa igual para la tabla en pantalla, Excel y PDF. */
export type ColumnType = 'text' | 'money' | 'date' | 'number' | 'qty' | 'label' | 'bool';

export interface ReportColumn {
  key: string;
  header: string;
  type?: ColumnType;
  labels?: Record<string, string>;
  /** Para `qty`: campo con la unidad. */
  unitKey?: string;
  /** Suma la columna en la fila de totales. */
  total?: boolean;
  /** Ancho relativo para Excel (caracteres). */
  width?: number;
}

export interface ReportSummaryItem {
  label: string;
  value: string;
  hint?: string;
  tone?: 'gold' | 'ink' | 'green' | 'red' | 'blue' | 'orange';
  icon?: string;
}
