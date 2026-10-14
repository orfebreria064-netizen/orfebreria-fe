import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { MaterialType, PaymentMethod } from '../../../core/models/domain';
import { unwrap } from '../../../shared/utils/db';
import { CollectionRow, CustodyRow, DeadlineRow, ReceivableRow, SalesRow, StockRow } from '../models/report.model';

/** Reportes gerenciales: funciones report_* (0010_reports.sql). RLS aísla por empresa y cada función exige ADMIN o GERENTE. */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly db = inject(SupabaseService).client;

  async sales(f: { from: string; to: string; serviceTypeId?: string | null; customerId?: string | null; assignedTo?: string | null }): Promise<SalesRow[]> {
    return unwrap(
      await this.db.rpc('report_sales', {
        p_from: f.from,
        p_to: f.to,
        p_service_type_id: f.serviceTypeId ?? null,
        p_customer_id: f.customerId ?? null,
        p_assigned_to: f.assignedTo ?? null,
      }),
    ) as SalesRow[];
  }

  async receivables(customerId?: string | null): Promise<ReceivableRow[]> {
    return unwrap(await this.db.rpc('report_receivables', { p_customer_id: customerId ?? null })) as ReceivableRow[];
  }

  async collections(f: { from: string; to: string; method?: PaymentMethod | null; includeVoided?: boolean }): Promise<CollectionRow[]> {
    return unwrap(
      await this.db.rpc('report_collections', {
        p_from: f.from,
        p_to: f.to,
        p_method: f.method ?? null,
        p_include_voided: f.includeVoided ?? false,
      }),
    ) as CollectionRow[];
  }

  async deadlines(daysAhead: number, assignedTo?: string | null): Promise<DeadlineRow[]> {
    return unwrap(await this.db.rpc('report_order_deadlines', { p_days_ahead: daysAhead, p_assigned_to: assignedTo ?? null })) as DeadlineRow[];
  }

  async stock(type?: MaterialType | null, includeInactive = false): Promise<StockRow[]> {
    return unwrap(await this.db.rpc('report_stock', { p_type: type ?? null, p_include_inactive: includeInactive })) as StockRow[];
  }

  async custody(customerId?: string | null): Promise<CustodyRow[]> {
    return unwrap(await this.db.rpc('report_client_custody', { p_customer_id: customerId ?? null })) as CustodyRow[];
  }
}
