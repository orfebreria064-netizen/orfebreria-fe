import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { emptyToNull } from '../../../shared/utils/db';
import { Jeweler, JewelerInput, JewelerPayment, JewelerPaymentFilters, JewelerPaymentInput } from '../models/jeweler.model';

/** Joyeros externos y recibos de egreso (pagos por pedido). Los permisos los valida la base de datos. */
@Injectable({ providedIn: 'root' })
export class JewelersService {
  private readonly api = inject(ApiService);

  list(includeInactive = false): Promise<Jeweler[]> {
    return this.api.get<Jeweler[]>('Joyero/listarjoyeros', { incluirinactivos: includeInactive });
  }

  async save(input: JewelerInput): Promise<string> {
    return (await this.api.procesar('Joyero/joyeroprc', emptyToNull(input))).resultProceso!;
  }

  payments(filters: JewelerPaymentFilters = {}): Promise<JewelerPayment[]> {
    return this.api.post<JewelerPayment[]>('Joyero/listarpagos', {
      jeweler_id: filters.jewelerId ?? null,
      order_id: filters.orderId ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
      include_voided: filters.includeVoided ?? false,
    });
  }

  /** Registra el pago y devuelve el recibo de egreso creado (para imprimirlo). */
  async registerPayment(input: JewelerPaymentInput): Promise<{ id: string; number: string }> {
    const r = await this.api.procesar<{ id: string; number: string }>('Joyero/registrarpago', emptyToNull(input));
    return { id: r.data?.id ?? r.resultProceso!, number: r.data?.number ?? '' };
  }

  async voidPayment(id: string, reason: string): Promise<void> {
    await this.api.procesar('Joyero/anularpago', { id, reason: reason.trim() });
  }
}
