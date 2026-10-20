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
  /** Marca para los documentos impresos. logo: data URL (PNG/JPEG). slogan: una línea por viñeta. */
  logo: string | null;
  slogan: string | null;
  mobile: string | null;
  city: string | null;
  /** Correos al cierre del día: estado de cuenta a clientes y cierre de caja (hora de Lima, 0-23). */
  daily_statements_enabled: boolean;
  daily_statements_hour: number;
}

/** Registro de correos automáticos enviados (statement_sends). */
export interface StatementSend {
  id: string;
  kind: 'CLIENTE' | 'CIERRE';
  statement_date: string;
  recipients: string[];
  status: 'ENVIADO' | 'ERROR';
  detail: string | null;
  created_at: string;
  customer: { full_name: string } | null;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  is_main: boolean;
  active: boolean;
  /** Solo en Configuracion/listarsucursales: el usuario ve sus datos. */
  has_access?: boolean;
}
