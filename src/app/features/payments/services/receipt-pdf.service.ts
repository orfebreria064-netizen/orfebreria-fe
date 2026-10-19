import { Injectable, inject } from '@angular/core';
import { LookupService } from '../../../core/services/lookup.service';
import { createPdf, outputPdf } from '../../../shared/pdf/pdf-kit';
import { renderExpense, renderIncome } from '../../../shared/pdf/receipt-docs';
import { JewelerPayment } from '../../jewelers/models/jeweler.model';
import { Payment } from '../models/payment.model';
import { PaymentsService } from './payments.service';

/** Recibos de ingreso (cobros al cliente) y de egreso (pagos a joyeros) en media hoja A5. */
@Injectable({ providedIn: 'root' })
export class ReceiptPdfService {
  private readonly lookups = inject(LookupService);
  private readonly payments = inject(PaymentsService);

  /** Recibo de ingreso. Si el pago aún no tiene número (pagos anteriores), se le asigna. */
  async income(payment: Payment, mode: 'print' | 'download' = 'print'): Promise<void> {
    const number = payment.receipt_number ?? (await this.payments.issueReceipt(payment.id));
    await this.lookups.ensureLoaded();
    const ctx = await createPdf(this.lookups.settings(), 'a5', 'landscape');
    renderIncome(ctx, { ...payment, receipt_number: number });
    outputPdf(ctx.doc, mode, `${number}.pdf`);
  }

  /** Recibo de ingreso de un pago recién registrado (se busca entre los pagos del pedido). */
  async incomeById(orderId: string, paymentId: string): Promise<void> {
    const payment = (await this.payments.byOrder(orderId)).find((p) => p.id === paymentId);
    if (payment) await this.income(payment);
  }

  /** Recibo de egreso (pago a joyero). */
  async expense(
    payment: JewelerPayment,
    order: { number: string; title?: string | null; customer?: string | null },
    mode: 'print' | 'download' = 'print',
  ): Promise<void> {
    await this.lookups.ensureLoaded();
    const ctx = await createPdf(this.lookups.settings(), 'a5', 'landscape');
    renderExpense(ctx, payment, order);
    outputPdf(ctx.doc, mode, `${payment.number}.pdf`);
  }
}
