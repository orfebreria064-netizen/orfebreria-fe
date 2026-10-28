import { INK, MUTED, PdfContext, RED, drawLogo, field, grams, placeAndDate, printedAt, signature, voidStamp } from '../../../shared/pdf/pdf-kit';
import type { CustomerReceipt } from '../services/customer-receipts.service';

/**
 * Acta de recepción en media hoja (A5 horizontal): lo que el cliente deja en la empresa (materia
 * prima o pieza para reparar), con el detalle, el estado en que se recibe y las firmas.
 */
export function renderCustomerReceipt(ctx: PdfContext, r: CustomerReceipt, signaturePng: string | null): void {
  const { doc, width: W, autoTable } = ctx;
  const settings = ctx.brand.settings;
  const m = 12;
  const w = W - 2 * m;
  const repair = r.kind === 'REPARACION';

  drawLogo(ctx, m, 8, 44, 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(repair ? 'ORDEN DE REPARACIÓN' : 'ACTA DE RECEPCIÓN DE MATERIAL', W / 2 + 6, 15, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`Pedido ${r.order?.number ?? ''}`, W / 2 + 6, 20, { align: 'center' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...RED);
  doc.text(`N° ${r.number}`, W - m, 15, { align: 'right' });

  let y = 31;
  field(ctx, '', placeAndDate(settings, r.received_at.slice(0, 10)), m, y, 80);
  if (repair && r.order?.due_date) {
    field(ctx, 'Fecha de entrega aprox.:', new Date(r.order.due_date + 'T00:00:00').toLocaleDateString('es-PE'), W - m - 80, y, 80);
  }
  y += 8;
  const c = r.customer;
  const doc_ = c?.document_number ? `  (${c.document_type ?? 'DOC'} ${c.document_number})` : '';
  field(ctx, 'Cliente:', (c?.full_name ?? '') + doc_, m, y, w * 0.68);
  field(ctx, 'Tel.:', c?.phone ?? '', m + w * 0.7, y, w * 0.3);
  if (r.delivered_by) {
    y += 8;
    field(ctx, 'Entregado por:', `${r.delivered_by}${r.delivered_by_doc ? ` (DNI ${r.delivered_by_doc})` : ''}`, m, y, w);
  }

  y += 4;
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m },
    head: [['#', 'Descripción', 'Ley', 'Cant.', 'Peso', 'Quilates']],
    body: r.items.map((it, i) => [
      String(i + 1),
      it.description,
      it.purity ?? '',
      String(it.quantity),
      grams(it.weight_g),
      it.carats ? `${Number(it.carats).toFixed(2)} ct` : '',
    ]),
    foot: r.weight_in ? [['', 'Peso total recibido', '', '', grams(r.weight_in), '']] : undefined,
    styles: { fontSize: 8.5, cellPadding: 1.4, textColor: INK, lineColor: [180, 180, 180], lineWidth: 0.1 },
    headStyles: { fillColor: [228, 228, 228], textColor: INK, fontStyle: 'bold' },
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 18 }, 3: { cellWidth: 14, halign: 'right' }, 4: { cellWidth: 22, halign: 'right' }, 5: { cellWidth: 22, halign: 'right' } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const notes: [string, string | null][] = [
    [repair ? 'Trabajo / daño reportado:' : 'Para:', repair ? r.reported_issue : (r.order?.title ?? null)],
    ['Estado en que se recibe:', r.condition_notes],
  ];
  if (r.returned_at) {
    notes.push([
      repair ? 'Devuelta el:' : 'Sobrante devuelto el:',
      `${new Date(r.returned_at).toLocaleDateString('es-PE')}${r.returned_weight ? ` · peso de salida ${grams(r.returned_weight)}` : ''}${r.return_notes ? ` · ${r.return_notes}` : ''}`,
    ]);
  }
  doc.setFontSize(8.5);
  for (const [label, value] of notes) {
    if (!value) continue;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(label, m, y);
    doc.setFont('helvetica', 'normal');
    const lines = (doc.splitTextToSize(value, w - doc.getTextWidth(label) - 3) as string[]).slice(0, 2);
    doc.text(lines, m + doc.getTextWidth(label) + 2, y);
    y += 4.5 * lines.length + 1;
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  const terms = repair
    ? 'El cliente declara entregar la pieza en el estado descrito. Las piezas no recogidas en 90 días desde la fecha de entrega acordada podrán generar costos de custodia. Presente esta orden para retirar la pieza.'
    : 'El material se recibe para la elaboración del pedido indicado. La merma propia del trabajo se descuenta del peso recibido; el sobrante se devuelve al cliente al entregar el producto.';
  doc.text(doc.splitTextToSize(terms, w) as string[], m, Math.min(y + 1, 112));

  const sy = 130;
  if (signaturePng) doc.addImage(signaturePng, 'PNG', m + 12, sy - 15, 46, 14);
  signature(ctx, 'Firma del cliente', m + 4, sy, 70, c?.full_name ?? null);
  signature(ctx, 'Recibido por', W - m - 74, sy, 70, r.creator?.full_name ?? null);

  if (r.voided) voidStamp(ctx, r.void_reason);
  printedAt(ctx, `${r.number} · Pedido ${r.order?.number ?? ''}`);
}
