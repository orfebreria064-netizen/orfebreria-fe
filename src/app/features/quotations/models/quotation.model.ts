import { QuotationStatus } from '../../../core/models/domain';

export interface QuotationItem {
  id?: string;
  position: number;
  description: string;
  detail: string | null;
  material_id: string | null;
  material_name: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  discount: number;
  subtotal?: number;
}

export interface Quotation {
  id: string;
  number: string;
  customer_id: string;
  service_type_id: string;
  status: QuotationStatus;
  issue_date: string;
  expiry_date: string;
  title: string;
  main_material: string | null;
  estimated_weight: number | null;
  stone: string | null;
  size: string | null;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discount_total: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  approved_at: string | null;
  order_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila del listado con datos relacionados. */
export interface QuotationRow extends Quotation {
  customer: { id: string; full_name: string } | null;
  service_type: { name: string } | null;
  order: { id: string; number: string } | null;
}

export interface QuotationDetail extends Quotation {
  items: QuotationItem[];
  service_type: { name: string } | null;
  order: { id: string; number: string } | null;
  customer: {
    id: string;
    full_name: string;
    document_type: string;
    document_number: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
}

/** Cabecera enviada a la RPC save_quotation. */
export interface QuotationHeaderInput {
  customer_id: string;
  service_type_id: string;
  issue_date: string;
  expiry_date: string;
  title: string;
  main_material: string | null;
  estimated_weight: number | null;
  stone: string | null;
  size: string | null;
  notes: string | null;
  terms: string | null;
  tax_rate: number;
}
