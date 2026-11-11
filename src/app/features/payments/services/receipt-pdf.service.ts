import { Injectable, inject } from '@angular/core';
import { LookupService } from '../../../core/services/lookup.service';
import { createPdf, outputPdf } from '../../../shared/pdf/pdf-kit';
import { renderExpense, renderIncome, renderRefund } from '../../../shared/pdf/receipt-docs';
import { CustomerCredit } from '../../customers/services/customer-credits.service';
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

  /** Recibo de ingreso de un depósito a cuenta o de egreso de una devolución del saldo a favor. */
  async credit(
    c: CustomerCredit,
    customer: { id: string; full_name: string; document_type?: string | null; document_number?: string | null },
    mode: 'print' | 'download' = 'print',
  ): Promise<void> {
    if (!c.receipt_number || !c.method) return;
    await this.lookups.ensureLoaded();
    const ctx = await createPdf(this.lookups.settings(), 'a5', 'landscape');
    const createdBy = c.creator?.full_name ?? null;
    if (c.kind === 'DEVOLUCION') {
      renderRefund(ctx, { ...c, receipt_number: c.receipt_number, method: c.method, created_by_name: createdBy }, customer);
    } else {
      const concept = ['Depósito a cuenta · queda como saldo a favor del cliente', c.notes ? `(${c.notes})` : null]
        .filter(Boolean)
        .join(' ');
      renderIncome(
        ctx,
        {
          id: c.id,
          order_id: '',
          payment_date: c.movement_date,
          amount: c.amount,
          currency: c.currency,
          method: c.method,
          reference: c.reference,
          notes: null,
          is_advance: false,
          receipt_number: c.receipt_number,
          received_from: c.received_from,
          balance_after: null,
          voided: c.voided,
          voided_at: null,
          void_reason: c.void_reason,
          created_by_name: createdBy,
          created_at: c.created_at,
          order: { id: '', number: '', customer },
        },
        concept,
      );
    }
    outputPdf(ctx.doc, mode, `${c.receipt_number}.pdf`);
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
