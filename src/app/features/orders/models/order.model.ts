import {
  AttachmentCategory,
  HistoryEventType,
  OrderStatus,
  PaymentStatus,
  Priority,
  StageStatus,
} from '../../../core/models/domain';
import { QuotationItem } from '../../quotations/models/quotation.model';

export type OrderItem = QuotationItem;

export interface Order {
  id: string;
  number: string;
  customer_id: string;
  quotation_id: string | null;
  service_type_id: string;
  status: OrderStatus;
  priority: Priority;
  title: string;
  description: string | null;
  main_material: string | null;
  estimated_weight: number | null;
  stone: string | null;
  size: string | null;
  notes: string | null;
  assigned_to: string | null;
  start_date: string;
  due_date: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  subtotal: number;
  discount_total: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance: number;
  payment_status: PaymentStatus;
  progress: number;
  current_stage_name: string | null;
  qc_approved: boolean;
  qc_approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderRow extends Order {
  customer: { id: string; full_name: string } | null;
  service_type: { name: string } | null;
  assignee: { id: string; full_name: string } | null;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
  service_type: { name: string } | null;
  assignee: { id: string; full_name: string } | null;
  quotation: { id: string; number: string } | null;
  customer: {
    id: string;
    full_name: string;
    document_type: string;
    document_number: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
  } | null;
}

export interface OrderHeaderInput {
  customer_id: string;
  service_type_id: string;
  priority: Priority;
  title: string;
  description: string | null;
  main_material: string | null;
  estimated_weight: number | null;
  stone: string | null;
  size: string | null;
  notes: string | null;
  assigned_to: string | null;
  start_date: string;
  due_date: string | null;
  tax_rate: number;
}

export interface OrderStage {
  id: string;
  order_id: string;
  stage_id: string | null;
  name: string;
  position: number;
  is_quality_check: boolean;
  assigned_to: string | null;
  status: StageStatus;
  is_current: boolean;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  assignee?: { id: string; full_name: string } | null;
}

/** Etapa con datos del pedido, para el tablero Kanban. */
export interface BoardStage extends OrderStage {
  order: {
    id: string;
    number: string;
    title: string;
    status: OrderStatus;
    priority: Priority;
    due_date: string | null;
    progress: number;
    customer: { full_name: string } | null;
  };
}

export interface OrderHistoryEntry {
  id: string;
  order_id: string;
  event_type: HistoryEventType;
  description: string;
  old_value: string | null;
  new_value: string | null;
  actor_name: string;
  created_at: string;
  order?: { number: string } | null;
}

export interface Attachment {
  id: string;
  order_id: string;
  category: AttachmentCategory;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
  /** URL firmada temporal (solo en cliente). */
  url?: string;
}
