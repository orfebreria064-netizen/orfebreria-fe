export interface ServiceType {
  id: string;
  code: string;
  name: string;
  position: number;
  active: boolean;
}

export interface ProductionStageTemplate {
  id: string;
  name: string;
  position: number;
  is_quality_check: boolean;
  active: boolean;
}

export interface CompanySettings {
  org_id: string;
  company_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  tax_rate: number;
  quote_validity_days: number;
  default_terms: string | null;
}
