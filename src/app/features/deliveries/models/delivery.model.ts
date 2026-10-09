import { DeliveryStatus, OrderStatus } from '../../../core/models/domain';

export interface Delivery {
  id: string;
  number: string;
  order_id: string;
  customer_id: string;
  status: DeliveryStatus;
  scheduled_date: string;
  delivered_at: string | null;
  responsible_id: string | null;
  received_by: string | null;
  conformity: boolean | null;
  conformity_notes: string | null;
  signature_path: string | null;
  notes: string | null;
  created_at: string;
  order?: { id: string; number: string; title: string; balance: number; status: OrderStatus; qc_approved: boolean } | null;
  customer?: { id: string; full_name: string } | null;
  responsible?: { full_name: string } | null;
}

export interface DeliveryInput {
  order_id: string;
  status: DeliveryStatus;
  scheduled_date: string;
  delivered_at: string | null;
  responsible_id: string | null;
  received_by: string | null;
  conformity: boolean | null;
  conformity_notes: string | null;
  notes: string | null;
}
