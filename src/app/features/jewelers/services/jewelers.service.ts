import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { unwrap } from '../../../shared/utils/db';
import { Jeweler, JewelerInput, JewelerPayment, JewelerPaymentFilters, JewelerPaymentInput } from '../models/jeweler.model';

/** Joyeros externos y recibos de egreso (pagos por pedido). Los permisos los valida PostgreSQL. */
@Injectable({ providedIn: 'root' })
export class JewelersService {
  private readonly db = inject(SupabaseService).client;

  async list(includeInactive = false): Promise<Jeweler[]> {
    return unwrap(await this.db.rpc('jewelers_list', { p_include_inactive: includeInactive })) as Jeweler[];
  }

  async save(input: JewelerInput): Promise<string> {
    return unwrap(
      await this.db.rpc('save_jeweler', {
        p_id: input.id,
        p_full_name: input.full_name,
        p_document_number: input.document_number,
        p_phone: input.phone,
        p_specialty: input.specialty,
        p_notes: input.notes,
        p_active: input.active,
      }),
    ) as string;
  }

  async payments(filters: JewelerPaymentFilters = {}): Promise<JewelerPayment[]> {
    return unwrap(
      await this.db.rpc('jeweler_payments_list', {
        p_jeweler_id: filters.jewelerId ?? null,
        p_order_id: filters.orderId ?? null,
        p_from: filters.from ?? null,
        p_to: filters.to ?? null,
        p_include_voided: filters.includeVoided ?? false,
      }),
    ) as JewelerPayment[];
  }

  /** Registra el pago y devuelve el recibo de egreso creado (para imprimirlo). */
  async registerPayment(input: JewelerPaymentInput): Promise<{ id: string; number: string }> {
    return unwrap(
      await this.db.rpc('register_jeweler_payment', {
        p_order_id: input.order_id,
        p_jeweler_id: input.jeweler_id,
        p_amount: input.amount,
        p_method: input.method,
        p_concept: input.concept,
        p_payment_date: input.payment_date,
        p_reference: input.reference?.trim() || null,
      }),
    ) as { id: string; number: string };
  }

  async voidPayment(id: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('void_jeweler_payment', { p_id: id, p_reason: reason.trim() }));
  }
}
