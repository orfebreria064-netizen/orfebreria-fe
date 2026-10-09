import { DocumentType, PersonType } from '../../../core/models/domain';

export interface Customer {
  id: string;
  person_type: PersonType;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  full_name: string;
  document_type: DocumentType;
  document_number: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type CustomerInput = Omit<Customer, 'id' | 'full_name' | 'created_at' | 'updated_at'>;

export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface CustomerStats {
  customer_id: string;
  orders_count: number;
  total_purchased: number;
  balance: number;
  last_order_at: string | null;
  last_interaction_at: string | null;
}

/** Opción ligera para selects/autocompletes. */
export interface CustomerOption {
  id: string;
  full_name: string;
  document_number: string | null;
  phone: string | null;
}
