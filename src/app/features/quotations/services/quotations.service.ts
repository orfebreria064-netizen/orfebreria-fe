import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { Priority, QuotationStatus } from '../../../core/models/domain';
import { mapQuotationDetail, mapQuotationRow } from '../../../shared/utils/api-mappers';
import { QuotationDetail, QuotationHeaderInput, QuotationItem, QuotationRow } from '../models/quotation.model';

export interface QuotationFilters {
  status?: QuotationStatus | null;
  search?: string;
}

export interface ConvertOptions {
  assignedTo: string | null;
  dueDate: string | null;
  priority: Priority;
  createStages: boolean;
}

@Injectable({ providedIn: 'root' })
export class QuotationsService {
  private readonly api = inject(ApiService);

  async list(filters: QuotationFilters = {}): Promise<QuotationRow[]> {
    // Marca como vencidas las enviadas fuera de plazo antes de listar (no bloquea si falla)
    await this.api.procesar('Cotizacion/vencer').catch(() => undefined);
    const rows = await this.api.post<Record<string, unknown>[]>('Cotizacion/listarcotizaciones', {
      status: filters.status ?? null,
      search: filters.search?.trim() || null,
    });
    return rows.map(mapQuotationRow);
  }

  async get(id: string): Promise<QuotationDetail> {
    const r = await this.api.get<{ cotizacion: Record<string, unknown>; items: QuotationItem[] }>(`Cotizacion/traeruno/${id}`);
    return mapQuotationDetail(r.cotizacion, r.items);
  }

  /** Guarda cabecera + ítems en una sola transacción. Devuelve el id. */
  async save(id: string | null, header: QuotationHeaderInput, items: QuotationItem[]): Promise<string> {
    const r = await this.api.procesar('Cotizacion/cotizacionprc', { id, header, items });
    return r.resultProceso!;
  }

  /** Cambia el estado; las transiciones válidas las controla la base de datos. */
  async setStatus(id: string, status: QuotationStatus): Promise<void> {
    await this.api.procesar('Cotizacion/cambiarestado', { id, status });
  }

  async duplicate(id: string): Promise<string> {
    return (await this.api.procesar(`Cotizacion/duplicar/${id}`)).resultProceso!;
  }

  /** Convierte una cotización aprobada en pedido. Devuelve el id del pedido. */
  async convertToOrder(id: string, options: ConvertOptions): Promise<string> {
    const r = await this.api.procesar('Cotizacion/convertirpedido', {
      quotation_id: id,
      assigned_to: options.assignedTo,
      due_date: options.dueDate,
      priority: options.priority,
      create_stages: options.createStages,
    });
    return r.resultProceso!;
  }
}
