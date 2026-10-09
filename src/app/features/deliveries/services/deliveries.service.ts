import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { DeliveryStatus } from '../../../core/models/domain';
import { emptyToNull, toAppError, unwrap } from '../../../shared/utils/db';
import { Delivery, DeliveryInput } from '../models/delivery.model';

const DELIVERY_SELECT =
  '*, order:orders(id, number, title, balance, status, qc_approved), customer:customers(id, full_name), ' +
  'responsible:profiles!deliveries_responsible_id_fkey(full_name)';

export interface DeliveryFilters {
  statuses?: DeliveryStatus[];
  from?: string | null;
  to?: string | null;
}

/**
 * Entregas. Al marcar ENTREGADA, PostgreSQL exige control de calidad aprobado y conformidad,
 * registra la fecha real y pasa el pedido a "Entregado".
 */
@Injectable({ providedIn: 'root' })
export class DeliveriesService {
  private readonly db = inject(SupabaseService).client;

  async list(filters: DeliveryFilters = {}): Promise<Delivery[]> {
    let query = this.db.from('deliveries').select(DELIVERY_SELECT).order('scheduled_date', { ascending: true });
    if (filters.statuses?.length) query = query.in('status', filters.statuses);
    if (filters.from) query = query.gte('scheduled_date', filters.from);
    if (filters.to) query = query.lte('scheduled_date', filters.to);
    return unwrap(await query) as unknown as Delivery[];
  }

  async byOrder(orderId: string): Promise<Delivery[]> {
    return unwrap(
      await this.db.from('deliveries').select(DELIVERY_SELECT).eq('order_id', orderId).order('created_at', { ascending: false }),
    ) as unknown as Delivery[];
  }

  async save(id: string | null, input: DeliveryInput): Promise<Delivery> {
    const data = emptyToNull(input);
    const res = id
      ? await this.db.from('deliveries').update(data).eq('id', id).select(DELIVERY_SELECT).single()
      : await this.db.from('deliveries').insert(data).select(DELIVERY_SELECT).single();
    return unwrap(res) as unknown as Delivery;
  }

  /** Sube la firma (PNG) al bucket del pedido y la asocia a la entrega. */
  async saveSignature(delivery: Delivery, png: Blob): Promise<void> {
    const path = `${delivery.order_id}/firma-${delivery.number}-${Date.now()}.png`;
    const { error } = await this.db.storage.from('orders').upload(path, png, { contentType: 'image/png' });
    if (error) throw toAppError(error);
    unwrap(await this.db.from('deliveries').update({ signature_path: path }).eq('id', delivery.id));
  }

  async signatureUrl(path: string): Promise<string | null> {
    const { data } = await this.db.storage.from('orders').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }
}
