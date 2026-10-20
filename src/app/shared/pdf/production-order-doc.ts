import type { OrderDetail } from '../../features/orders/models/order.model';
import { INK, MUTED, PdfContext, RED, drawLogo, field, grams, printedAt, sectionBand, shortDate } from './pdf-kit';

/** Orden de producción (A5), como el talonario: cabecera, datos del trabajo, MANUFACTURA y ACABADO. */
export function renderProductionOrder(ctx: PdfContext, o: OrderDetail, number: string): void {
  const { doc, width: W } = ctx;
  const m = 8;
  const w = W - 2 * m;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);

  // Cabecera en tres celdas: logo · título · número
  const hy = 8;
  const hh = 20;
  const c1 = 38;
  const c3 = 42;
  doc.rect(m, hy, w, hh);
  doc.line(m + c1, hy, m + c1, hy + hh);
  doc.line(W - m - c3, hy, W - m - c3, hy + hh);
  drawLogo(ctx, m + 2, hy + 2, c1 - 4, hh - 4, 'center');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  const midX = m + c1 + (w - c1 - c3) / 2;
  doc.text('ORDEN DE', midX, hy + 8.5, { align: 'center' });
  doc.text('PRODUCCIÓN', midX, hy + 14, { align: 'center' });
  doc.setFont('courier', 'bold');
  doc.setTextColor(...RED);
  doc.setFontSize(10);
  doc.text('N°', W - m - c3 + 3, hy + hh / 2 + 1.5);
  doc.setFontSize(number.length > 14 ? 8.5 : 10);
  doc.text(number, W - m - 2, hy + hh / 2 + 1.5, { align: 'right' });

  // Datos del trabajo
  const infoY = hy + hh + 2;
  let y = infoY;
  const totalQty = o.items.reduce((acc, it) => acc + Number(it.quantity ?? 0), 0);
  doc.rect(m, y, w, 24);
  y += 5.5;
  field(ctx, 'MODELO:', o.title, m + 2, y, w * 0.58 - 4, 8.5);
  field(ctx, 'CANTIDAD:', String(totalQty), m + w * 0.62, y, w * 0.38 - 2, 8.5);
  y += 5.5;
  field(ctx, 'MATERIAL:', [o.main_material, o.stone].filter(Boolean).join(' · '), m + 2, y, w * 0.58 - 4, 8.5);
  field(ctx, 'PEDIDO:', o.number, m + w * 0.62, y, w * 0.38 - 2, 8.5);
  y += 5.5;
  field(ctx, 'CLIENTE:', o.customer?.full_name ?? '', m + 2, y, w - 4, 8.5);
  y += 5.5;
  field(ctx, 'FECHA DE ENTREGA AL CLIENTE:', shortDate(o.due_date), m + 2, y, w - 4, 8.5);
  y = infoY + 24;

  // MANUFACTURA
  sectionBand(ctx, 'MANUFACTURA', m, y, w);
  y += 6;
  doc.rect(m, y, w, 12);
  y += 5;
  field(ctx, 'Joyero:', o.jeweler ? o.jeweler.full_name + (o.jeweler.document_number ? ` (DNI ${o.jeweler.document_number})` : '') : null, m + 2, y, w - 4, 8.5);
  y += 5;
  field(ctx, 'Fecha de entrega del material:', shortDate(o.material_delivered_at), m + 2, y, w * 0.6 - 4, 8.5);
  field(ctx, 'Peso:', grams(o.material_weight_out), m + w * 0.62, y, w * 0.38 - 2, 8.5);
  y += 2;

  // Indicaciones: texto libre + detalle de los ítems
  const boxH = 70;
  doc.rect(m, y, w, boxH);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('Indicaciones:', m + 2, y + 4.5);
  doc.setTextColor(...INK);
  const lines: string[] = [];
  if (o.production_instructions) lines.push(...(doc.splitTextToSize(o.production_instructions, w - 6) as string[]), '');
  for (const it of o.items) {
    const text = `• ${Number(it.quantity)} ${it.unit !== 'und' ? it.unit + ' ' : ''}${it.description}` +
      `${it.detail ? ` — ${it.detail}` : ''}${it.material_name ? ` · ${it.material_name}` : ''}${it.weight ? ` · ${grams(it.weight)}` : ''}`;
    lines.push(...(doc.splitTextToSize(text, w - 6) as string[]));
  }
  if (o.size) lines.push(`Talla / medida: ${o.size}`);
  if (o.estimated_weight) lines.push(`Peso estimado: ${grams(o.estimated_weight)}`);
  const maxLines = Math.floor((boxH - 8) / 3.6);
  doc.text(lines.slice(0, maxLines), m + 3, y + 9);
  y += boxH;

  // ACABADO
  sectionBand(ctx, 'ACABADO', m, y, w);
  y += 6;
  doc.rect(m, y, w, 7);
  field(ctx, 'Fecha de entrega del producto:', shortDate(o.product_delivered_at), m + 2, y + 5, w - 4, 8.5);
  y += 7;
  const colA = w * 0.45;
  const colB = w * 0.27;
  doc.rect(m, y, w, 11);
  doc.line(m + colA, y, m + colA, y + 11);
  doc.line(m + colA + colB, y, m + colA + colB, y + 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('Resp.:', m + 2, y + 4);
  doc.text('Fecha:', m + colA + 2, y + 4);
  doc.text('Firma:', m + colA + colB + 2, y + 4);
  doc.setTextColor(...INK);
  if (o.jeweler) doc.text(doc.splitTextToSize(o.jeweler.full_name, colA - 4)[0] as string, m + 2, y + 9);
  if (o.product_delivered_at) doc.text(shortDate(o.product_delivered_at), m + colA + 2, y + 9);
  y += 11;
  doc.rect(m, y, w, 7);
  field(ctx, 'Peso entregado:', grams(o.weight_returned), m + 2, y + 5, w * 0.55 - 4, 8.5);
  field(ctx, 'Merma:', o.waste_weight != null ? grams(o.waste_weight) || '0 g' : null, m + w * 0.58, y + 5, w * 0.42 - 2, 8.5);
  y += 7;
  doc.rect(m, y, w, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('Observaciones:', m + 2, y + 4.5);
  if (o.production_notes) {
    doc.setTextColor(...INK);
    doc.text((doc.splitTextToSize(o.production_notes, w - 6) as string[]).slice(0, 3), m + 3, y + 8.5);
  }

  printedAt(ctx, `Pedido ${o.number}`);
}
