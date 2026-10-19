import { PAYMENT_METHOD_LABELS } from '../../core/models/domain';
import type { JewelerPayment } from '../../features/jewelers/models/jeweler.model';
import type { Payment } from '../../features/payments/models/payment.model';
import { currencySymbol, formatMoney } from '../pipes/money.pipe';
import { amountToWords } from '../utils/number-words';
import { INK, MUTED, PdfContext, RED, checkbox, drawLogo, field, placeAndDate, printedAt, signature, voidStamp } from './pdf-kit';

/**
 * Recibos en media hoja (A5 horizontal), como los talonarios:
 *  - Recibo de ingreso: uno por cada cobro al cliente (adelanto, saldo…). Hace de comprobante de venta
 *    cuando el cliente no pide factura.
 *  - Recibo de egreso: pago a un joyero por un pedido.
 */

/** Cabecera común: logo a la izquierda, título al centro y número en rojo a la derecha. */
function receiptHeader(ctx: PdfContext, title: string, number: string): number {
  const { doc, width: W } = ctx;
  const m = 12;
  drawLogo(ctx, m, 8, 44, 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(title, W / 2 + 6, 16, { align: 'center' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...RED);
  doc.text(`N° ${number}`, W - m, 16, { align: 'right' });
  return 30;
}

/** Casillas S/ y US$ y el recuadro con el importe. */
function amountBox(ctx: PdfContext, amount: number, currency: string, y: number): void {
  const { doc, width: W } = ctx;
  const m = 12;
  const boxW = 52;
  const boxX = W - m - boxW;
  let x = boxX - 46;
  x += checkbox(ctx, 'S/', currency !== 'USD', x, y + 6);
  checkbox(ctx, 'US$', currency === 'USD', x, y + 6);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  doc.roundedRect(boxX, y, boxW, 10, 2, 2);
  doc.setLineWidth(0.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(formatMoney(amount, currency), boxX + boxW - 3, y + 6.8, { align: 'right' });
}

/** Texto largo en varias líneas punteadas (cantidad en letras, concepto). Devuelve la nueva y. */
function wrappedField(ctx: PdfContext, label: string, value: string, x: number, y: number, w: number, maxLines = 2): number {
  const { doc } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const labelW = doc.getTextWidth(label) + 3;
  doc.setFont('helvetica', 'bold');
  const first = doc.splitTextToSize(value, w - labelW - 2) as string[];
  const rest = first.length > 1 ? (doc.splitTextToSize(first.slice(1).join(' '), w - 2) as string[]) : [];
  field(ctx, label, first[0] ?? '', x, y, w);
  let cy = y;
  for (const line of rest.slice(0, maxLines - 1)) {
    cy += 7;
    field(ctx, '', line, x, cy, w);
  }
  return cy + 9;
}

export function renderIncome(ctx: PdfContext, p: Payment): void {
  const { doc, width: W } = ctx;
  const settings = ctx.brand.settings;
  const m = 12;
  const w = W - 2 * m;
  let y = receiptHeader(ctx, 'RECIBO DE INGRESO', p.receipt_number ?? '');
  amountBox(ctx, Number(p.amount), p.currency, y - 4);

  y += 12;
  field(ctx, '', placeAndDate(settings, p.payment_date), m, y, 90);
  y += 9;
  const customer = p.order?.customer;
  const payer = p.received_from || customer?.full_name || '';
  const payerDoc = !p.received_from && customer?.document_number ? `  (${customer.document_type ?? 'DOC'} ${customer.document_number})` : '';
  field(ctx, 'Recibí de :', payer + payerDoc, m, y, w);
  y += 9;
  y = wrappedField(ctx, 'La cantidad de:', amountToWords(p.amount, p.currency), m, y, w);
  // El pago que deja el saldo en cero es la cancelación del pedido; los demás, adelanto o pago a cuenta con su saldo
  const balanceAfter = p.balance_after != null ? Number(p.balance_after) : null;
  const settled = balanceAfter !== null && balanceAfter <= 0;
  const kind = settled ? 'Cancelación' : p.is_advance ? 'Adelanto' : 'Pago a cuenta';
  const concept = [
    `${kind} del pedido ${p.order?.number ?? ''}`,
    p.order?.title ? `– ${p.order.title}` : null,
    p.notes ? `(${p.notes})` : null,
    !settled && balanceAfter !== null && !p.voided ? `· Saldo: ${formatMoney(balanceAfter, p.currency)}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  y = wrappedField(ctx, 'Por concepto de:', concept, m, y, w);

  // Forma de pago
  y += 1;
  let x = m;
  x += checkbox(ctx, 'Efectivo', p.method === 'EFECTIVO', x, y);
  x += checkbox(ctx, 'Cheque', p.method === 'CHEQUE', x, y);
  const other = p.method !== 'EFECTIVO' && p.method !== 'CHEQUE';
  x += checkbox(ctx, other ? PAYMENT_METHOD_LABELS[p.method] : 'Otro', other, x, y);
  field(ctx, p.method === 'CHEQUE' ? 'N° Cheque:' : 'N° Operación:', p.reference, x, y, W - m - x);

  // Firmas
  const sy = 124;
  signature(ctx, 'Entregado por', m + 4, sy, 70, payer);
  signature(ctx, 'Recibí conforme', W - m - 74, sy, 70, p.created_by_name ? `Nombre: ${p.created_by_name}` : null);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('DNI: ________________', W - m - 39, sy + 12, { align: 'center' });

  if (p.voided) voidStamp(ctx, p.void_reason);
  printedAt(ctx, `${currencySymbol(p.currency)} · Pedido ${p.order?.number ?? ''}`);
}

export function renderExpense(ctx: PdfContext, p: JewelerPayment, order: { number: string; title?: string | null; customer?: string | null }): void {
  const { doc, width: W } = ctx;
  const settings = ctx.brand.settings;
  const m = 12;
  const w = W - 2 * m;
  let y = receiptHeader(ctx, 'RECIBO', p.number);
  amountBox(ctx, Number(p.amount), p.currency, y - 4);

  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text('DETALLE:', m, y);
  y += 6;
  const detail = [
    p.concept,
    `Pedido ${order.number}${order.title ? ` – ${order.title}` : ''}${order.customer ? ` (cliente: ${order.customer})` : ''}`,
    `${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` · Ref. ${p.reference}` : ''}`,
  ];
  const lines = detail.flatMap((d) => doc.splitTextToSize(d, w - 2) as string[]).slice(0, 5);
  for (const line of lines) {
    field(ctx, '', line, m, y, w);
    y += 7;
  }
  y = wrappedField(ctx, 'La cantidad de:', amountToWords(p.amount, p.currency), m, y + 1, w, 1);
  field(ctx, '', placeAndDate(settings, p.payment_date), m, y, 90);

  // Firmas: quien autoriza (empresa) y quien recibe (joyero)
  const sy = 124;
  signature(ctx, 'Autorizado por', m + 4, sy, 70, p.created_by_name);
  signature(ctx, 'Firma', W - m - 74, sy, 70, `Nombre: ${p.jeweler_name}`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(`DNI: ${p.jeweler_document ?? '________________'}`, W - m - 39, sy + 12, { align: 'center' });

  if (p.voided) voidStamp(ctx, p.void_reason);
  printedAt(ctx, `Pago a joyero · Pedido ${order.number}`);
}
