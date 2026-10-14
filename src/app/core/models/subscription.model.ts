import { AppRole, Option, TagSeverity } from './domain';

/** Coinciden con los CHECK y funciones de supabase/migrations/0009_saas_platform.sql. */
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
/** Estado efectivo calculado por org_access_state(). */
export type AccessState = SubscriptionStatus | 'GRACE' | 'EXPIRED';

export const ACCESS_STATE_LABELS: Record<AccessState, string> = {
  TRIAL: 'Prueba',
  ACTIVE: 'Activa',
  GRACE: 'En gracia',
  EXPIRED: 'Vencida',
  SUSPENDED: 'Suspendida',
  CANCELLED: 'Cancelada',
};
export const ACCESS_STATE_SEVERITY: Record<AccessState, TagSeverity> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  GRACE: 'warn',
  EXPIRED: 'danger',
  SUSPENDED: 'danger',
  CANCELLED: 'secondary',
};
export const SUBSCRIPTION_STATUS_OPTIONS: Option<SubscriptionStatus>[] = [
  { value: 'TRIAL', label: 'Prueba' },
  { value: 'ACTIVE', label: 'Activa' },
  { value: 'SUSPENDED', label: 'Suspendida' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

export type PaymentMethodSaas = 'YAPE' | 'PLIN' | 'TRANSFERENCIA' | 'EFECTIVO' | 'TARJETA' | 'OTRO';
export const SAAS_PAYMENT_METHOD_LABELS: Record<PaymentMethodSaas, string> = {
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};
export const SAAS_PAYMENT_METHOD_OPTIONS = (Object.keys(SAAS_PAYMENT_METHOD_LABELS) as PaymentMethodSaas[]).map((value) => ({
  value,
  label: SAAS_PAYMENT_METHOD_LABELS[value],
}));

export interface Plan {
  code: string;
  name: string;
  max_users: number;
  price_month: number;
  price_year: number;
  extra_user_price: number | null;
  position: number;
  active: boolean;
}

/** Resultado de my_subscription(). */
export interface MySubscription {
  org_id: string;
  plan_code: string;
  plan_name: string;
  max_users: number;
  extra_users: number;
  seat_limit: number;
  seats_used: number;
  status: SubscriptionStatus;
  state: AccessState;
  current_period_end: string;
  grace_end: string;
  days_left: number;
}

export interface SubscriptionPayment {
  id: string;
  org_id: string;
  plan_code: string;
  amount: number;
  method: PaymentMethodSaas;
  reference: string | null;
  months: number;
  paid_at: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  created_at: string;
  accepted_at: string | null;
}

export type AccessRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface AccessRequest {
  id: string;
  company_name: string;
  tax_id: string | null;
  contact_name: string;
  email: string;
  phone: string | null;
  plan_code: string | null;
  message: string | null;
  status: AccessRequestStatus;
  org_id: string | null;
  reject_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** Fila de platform_organizations(). */
export interface PlatformOrganization {
  org_id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  plan_code: string;
  plan_name: string;
  status: SubscriptionStatus;
  state: AccessState;
  current_period_end: string;
  days_left: number;
  grace_days: number;
  extra_users: number;
  notes: string | null;
  seats_used: number;
  seat_limit: number;
  owner_name: string | null;
  owner_email: string | null;
  last_payment_at: string | null;
  total_paid: number;
  created_at: string;
}

export interface PlatformOverview {
  total: number;
  active: number;
  trial: number;
  grace: number;
  expired: number;
  suspended: number;
  pending_requests: number;
  expiring_7_days: number;
  mrr: number;
  collected_month: number;
  revenue_by_month: { month: string; amount: number }[];
}
