import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { OrderStatus } from '../../../core/models/domain';
import { unwrap } from '../../../shared/utils/db';

export interface DashboardData {
  kpis: {
    active_orders: number;
    in_production: number;
    ready_to_deliver: number;
    pending_quotations: number;
    /** Montos en soles; los de pedidos en dólares van en *_usd. */
    sales_month: number;
    sales_month_usd: number;
    collected_month: number;
    collected_month_usd: number;
    receivable: number;
    receivable_usd: number;
    overdue_orders: number;
  };
  orders_by_status: { status: OrderStatus; count: number }[];
  sales_by_month: { month: string; sales: number; collected: number }[];
  orders_by_service: { service: string; count: number }[];
  production_by_stage: { stage: string; position: number; count: number }[];
  upcoming_deliveries: {
    id: string;
    number: string;
    customer_name: string;
    title: string;
    due_date: string;
    status: OrderStatus;
    balance: number;
    currency: string;
  }[];
  alerts: {
    overdue: { id: string; number: string; customer_name: string; due_date: string }[];
    pending_quotations: { id: string; number: string; customer_name: string; expiry_date: string; total: number; currency: string }[];
    pending_payments: { id: string; number: string; customer_name: string; balance: number; currency: string }[];
    upcoming: { id: string; number: string; customer_name: string; due_date: string }[];
  };
}

/** Dashboard gerencial: una sola llamada RPC (get_dashboard), filtrada por RLS. */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly db = inject(SupabaseService).client;

  async load(): Promise<DashboardData> {
    await this.db.rpc('expire_quotations');
    return unwrap(await this.db.rpc('get_dashboard')) as DashboardData;
  }
}
