import { Injectable, inject } from '@angular/core';
import { LookupService } from '../../../core/services/lookup.service';
import { PROFORMA_COPIES, proformaDocData, renderCommercialDoc } from '../../../shared/pdf/commercial-doc';
import { createPdf, outputPdf } from '../../../shared/pdf/pdf-kit';
import { renderProductionOrder } from '../../../shared/pdf/production-order-doc';
import { OrderDetail } from '../models/order.model';
import { OrdersService } from './orders.service';

/**
 * Documentos del pedido:
 *  - Proforma: formato de la cotización con lo pagado (A cuenta) y el saldo, en 4 copias.
 *  - Orden de producción: hoja interna para el joyero (manufactura y acabado).
 * El número se asigna en la base al emitirlos por primera vez.
 */
@Injectable({ providedIn: 'root' })
export class OrderDocumentsService {
  private readonly lookups = inject(LookupService);
  private readonly orders = inject(OrdersService);

  async proforma(order: OrderDetail, mode: 'print' | 'download' = 'print'): Promise<string> {
    const number = await this.orders.issueDocument(order.id, 'PRO');
    await this.lookups.ensureLoaded();
    const settings = this.lookups.settings();
    const ctx = await createPdf(settings, 'a4');
    PROFORMA_COPIES.forEach((copyLabel, i) => {
      if (i > 0) ctx.doc.addPage();
      renderCommercialDoc(ctx, proformaDocData(order, number, copyLabel, settings?.default_terms ?? null));
    });
    outputPdf(ctx.doc, mode, `${number}.pdf`);
    return number;
  }

  async productionOrder(order: OrderDetail, mode: 'print' | 'download' = 'print'): Promise<string> {
    const number = await this.orders.issueDocument(order.id, 'OP');
    await this.lookups.ensureLoaded();
    const ctx = await createPdf(this.lookups.settings(), 'a5');
    renderProductionOrder(ctx, order, number);
    outputPdf(ctx.doc, mode, `${number}.pdf`);
    return number;
  }
}
