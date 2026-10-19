import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { DeliveryStatus } from '../../../core/models/domain';
import { emptyToNull } from '../../../shared/utils/db';
import { mapDelivery } from '../../../shared/utils/api-mappers';
import { Delivery, DeliveryInput } from '../models/delivery.model';

export interface DeliveryFilters {
  statuses?: DeliveryStatus[];
  from?: string | null;
  to?: string | null;
}

/**
 * Entregas. Al marcar ENTREGADA, la base de datos exige control de calidad aprobado y conformidad,
 * registra la fecha real y pasa el pedido a "Entregado".
 */
@Injectable({ providedIn: 'root' })
export class DeliveriesService {
  private readonly api = inject(ApiService);

  async list(filters: DeliveryFilters = {}): Promise<Delivery[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Entrega/listarentregas', {
      statuses: filters.statuses?.length ? filters.statuses : null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    });
    return rows.map(mapDelivery);
  }

  async byOrder(orderId: string): Promise<Delivery[]> {
    const rows = await this.api.post<Record<string, unknown>[]>('Entrega/listarentregas', { order_id: orderId });
    return rows.map(mapDelivery).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async save(id: string | null, input: DeliveryInput): Promise<Delivery> {
    const r = await this.api.procesar<Record<string, unknown>>('Entrega/entregaprc', { ...emptyToNull(input), id });
    return mapDelivery(r.data ?? {});
  }

  /** Sube la firma (PNG) y la asocia a la entrega. */
  async saveSignature(delivery: Delivery, png: Blob): Promise<void> {
    const form = new FormData();
    form.append('archivo', png, `firma-${delivery.number}.png`);
    await this.api.subir(`Entrega/firma/${delivery.id}`, form);
  }

  /** URL local (blob:) de la firma, descargada con el token del usuario. */
  async signatureUrl(path: string): Promise<string | null> {
    try {
      return URL.createObjectURL(await this.api.descargar('Archivo/descargar', { ruta: path }));
    } catch {
      return null;
    }
  }
}
