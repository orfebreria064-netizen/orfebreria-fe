import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { MaterialType, PaymentMethod } from '../../../core/models/domain';
import { CollectionRow, CustodyRow, DeadlineRow, ReceivableRow, SalesRow, StockRow } from '../models/report.model';

/** Reportes gerenciales (Reporte/*). La base de datos aísla por empresa y exige ADMIN o GERENTE. */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly api = inject(ApiService);

  async sales(f: { from: string; to: string; serviceTypeId?: string | null; customerId?: string | null; assignedTo?: string | null; currency?: string | null }): Promise<SalesRow[]> {
    return this.api.post<SalesRow[]>('Reporte/ventas', {
      from: f.from,
      to: f.to,
      service_type_id: f.serviceTypeId ?? null,
      customer_id: f.customerId ?? null,
      assigned_to: f.assignedTo ?? null,
      currency: f.currency ?? null,
    });
  }

  async receivables(customerId?: string | null, currency?: string | null): Promise<ReceivableRow[]> {
    return this.api.post<ReceivableRow[]>('Reporte/cuentasporcobrar', { customer_id: customerId ?? null, currency: currency ?? null });
  }

  async collections(f: { from: string; to: string; method?: PaymentMethod | null; includeVoided?: boolean; currency?: string | null }): Promise<CollectionRow[]> {
    return this.api.post<CollectionRow[]>('Reporte/cobranza', {
      from: f.from,
      to: f.to,
      method: f.method ?? null,
      include_voided: f.includeVoided ?? false,
      currency: f.currency ?? null,
    });
  }

  async deadlines(daysAhead: number, assignedTo?: string | null): Promise<DeadlineRow[]> {
    return this.api.post<DeadlineRow[]>('Reporte/plazos', { days_ahead: daysAhead, assigned_to: assignedTo ?? null });
  }

  async stock(type?: MaterialType | null, includeInactive = false): Promise<StockRow[]> {
    return this.api.post<StockRow[]>('Reporte/stock', { type: type ?? null, include_inactive: includeInactive });
  }

  async custody(customerId?: string | null): Promise<CustodyRow[]> {
    return this.api.post<CustodyRow[]>('Reporte/custodia', { customer_id: customerId ?? null });
  }
}
