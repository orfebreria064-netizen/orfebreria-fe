import type { OrderDetail } from '../../features/orders/models/order.model';
import type { QuotationDetail } from '../../features/quotations/models/quotation.model';
import { currencySymbol } from '../pipes/money.pipe';
import {
  INK,
  MUTED,
  PdfContext,
  RULE,
  SHADE,
  companyContactLines,
  drawLogo,
  drawSlogan,
  field,
  grams,
  numberBox,
  printedAt,
  shortDate,
  signature,
} from './pdf-kit';

/** Línea de cotización / proforma (CANT · ARTÍCULO · Gr. · P. UNIT · P. TOTAL). */
export interface CommercialLine {
  quantity: number;
  unit: string;
  description: string;
  detail: string | null;
  weight: number | null;
  unit_price: number;
  discount: number;
  subtotal?: number;
}

export interface CommercialDocData {
  title: string;
  number: string;
  date: string | null;
  currency: string;
  customer: { name: string; document: string | null; address: string | null };
  /** Trabajo / producto principal. */
  heading: string | null;
  /** Fila derecha bajo la fecha: "Válida hasta" (cotización) o "Pedido" (proforma). */
  extra: { label: string; value: string | null } | null;
  specs: string | null;
  items: CommercialLine[];
  subtotal: number;
  discount_total: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  /** A cuenta: null deja la línea en blanco (cotización). */
  paid: number | null;
  notes: string | null;
  terms: string | null;
  /** Destino de la copia (proforma): "ORIGINAL – CLIENTE", "COPIA – TALLER"… */
  copyLabel?: string | null;
  footerReference?: string | null;
}

const MIN_ROWS = 10;

const num = (n: number) => Number(n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => Number(n ?? 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });

/** Dibuja una cotización o proforma (A4) en la página actual del documento. */
export function renderCommercialDoc(ctx: PdfContext, d: CommercialDocData): void {
  const { doc, autoTable, brand, width: W, height: H } = ctx;
  const m = 14;
  const top = 10;
  const symbol = currencySymbol(d.currency);

  // ------------------------------------------------------------ Cabecera
  // Logo · eslogan · recuadro del número; debajo, dirección y teléfonos
  const boxW = 56;
  const boxX = W - m - boxW;
  const logoH = drawLogo(ctx, m, top, 58, 20);
  const sloganX = m + 64;
  const sloganH = drawSlogan(ctx, sloganX, top + 3, boxX - sloganX - 3);
  const boxH = numberBox(ctx, d.title, d.number, boxX, top, boxW);
  let y = Math.max(top + logoH + 4, top + 3 + sloganH + 1, top + boxH + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  for (const line of companyContactLines(brand.settings)) {
    const wrapped = doc.splitTextToSize(line, W - 2 * m) as string[];
    doc.text(wrapped, m, y);
    y += wrapped.length * 3.5;
  }
  y += 4;

  // ------------------------------------------------------------ Cliente
  const rightX = m + 124;
  const rightW = W - m - rightX;
  field(ctx, 'Señor(es):', d.customer.name, m, y, 118);
  field(ctx, 'Fecha:', shortDate(d.date), rightX, y, rightW);
  y += 7;
  field(ctx, 'Dirección:', d.customer.address, m, y, 118);
  field(ctx, 'DNI/RUC:', d.customer.document, rightX, y, rightW);
  y += 7;
  field(ctx, 'Trabajo:', d.heading, m, y, 118);
  if (d.extra) field(ctx, `${d.extra.label}:`, d.extra.value, rightX, y, rightW);
  y += 4;
  if (d.specs) {
    y += 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(d.specs, W - 2 * m) as string[], m, y);
    y += 3;
  }

  // ------------------------------------------------------------ Detalle
  const body = d.items.map((it) => {
    const detail = [it.detail, Number(it.discount) ? `Descuento: ${symbol} ${num(it.discount)}` : null].filter(Boolean).join('\n');
    return [
      it.unit && it.unit !== 'und' ? `${qty(it.quantity)} ${it.unit}` : qty(it.quantity),
      detail ? `${it.description}\n${detail}` : it.description,
      grams(it.weight),
      num(it.unit_price),
      num(it.subtotal ?? Number(it.quantity) * Number(it.unit_price) - Number(it.discount)),
    ];
  });
  while (body.length < MIN_ROWS) body.push(['', '', '', '', '']);

  autoTable(doc, {
    startY: y + 2,
    margin: { left: m, right: m, top: 14 },
    theme: 'grid',
    head: [['CANT.', 'ARTÍCULO', 'Gr.', `P. UNIT. ${symbol}`, `P. TOTAL ${symbol}`]],
    body,
    styles: { fontSize: 9, cellPadding: 1.8, textColor: INK, lineColor: RULE, lineWidth: 0.2, minCellHeight: 6.5, valign: 'middle' },
    headStyles: { fillColor: SHADE, textColor: INK, fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 18, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
    },
  });

  // ------------------------------------------------------------ Totales
  let ty = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  if (ty > H - 70) {
    doc.addPage();
    ty = 20;
  }
  const net = Number(d.subtotal) - Number(d.discount_total);
  const money = (n: number) => `${symbol} ${num(n)}`;
  const rows: [string, string | null][] = [];
  if (Number(d.discount_total)) rows.push(['Descuento', `- ${money(d.discount_total)}`]);
  rows.push(['Sub Total', money(net)]);
  if (Number(d.tax_amount)) {
    rows.push([`IGV (${Number(d.tax_rate)}%)`, money(d.tax_amount)]);
    rows.push(['Total', money(d.total)]);
  }
  rows.push(['A cuenta', d.paid === null ? null : money(d.paid)]);
  rows.push(['Saldo', d.paid === null ? null : money(Number(d.total) - Number(d.paid))]);

  const tx = W - m - 72;
  rows.forEach(([label, value], i) => {
    const ry = ty + i * 7;
    const strong = label === 'Saldo' || (label === 'Total' && d.paid === null);
    doc.setFont('helvetica', strong ? 'bold' : 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(label, tx + 26, ry, { align: 'right' });
    doc.setDrawColor(...RULE);
    doc.line(tx + 29, ry + 1, W - m, ry + 1);
    if (value !== null) doc.text(value, W - m - 1, ry, { align: 'right' });
  });

  // Observaciones y condiciones a la izquierda de los totales
  let ny = ty;
  const notesW = W - 2 * m - 80;
  for (const [title, text] of [
    ['Observaciones', d.notes],
    ['Condiciones', d.terms],
  ] as const) {
    if (!text) continue;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(title, m, ny);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(text, notesW) as string[];
    doc.text(lines, m, ny + 3.8);
    ny += 6 + lines.length * 3.4;
  }

  // ------------------------------------------------------------ Firmas
  let sy = Math.max(ty + rows.length * 7, ny) + 22;
  if (sy > H - 18) {
    doc.addPage();
    sy = 40;
  }
  signature(ctx, `p. ${brand.settings?.company_name ?? ''}`, m + 4, sy, 62);
  signature(ctx, 'Aceptado', m + 76, sy, 52);

  if (d.copyLabel) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const w = doc.getTextWidth(d.copyLabel) + 8;
    doc.setDrawColor(...INK);
    doc.rect(W - m - w, H - 13, w, 6.5);
    doc.text(d.copyLabel, W - m - w / 2, H - 8.6, { align: 'center' });
  }
  printedAt(ctx, d.footerReference ?? undefined);
}

/** Destino de cada copia de la proforma (reemplaza al papel carbón del talonario). */
export const PROFORMA_COPIES = ['ORIGINAL – CLIENTE', 'COPIA – TALLER', 'COPIA – CAJA', 'COPIA – ARCHIVO'];

/** Material, peso, piedra y talla del trabajo en una línea. */
export function specsLine(x: { main_material: string | null; estimated_weight: number | null; stone: string | null; size: string | null }): string | null {
  const parts = [
    x.main_material ? `Material: ${x.main_material}` : null,
    x.estimated_weight ? `Peso estimado: ${Number(x.estimated_weight).toFixed(2)} g` : null,
    x.stone ? `Piedra: ${x.stone}` : null,
    x.size ? `Talla: ${x.size}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join('   ·   ') : null;
}

function customerOf(c: { full_name: string; document_type: string; document_number: string | null; address: string | null } | null) {
  return {
    name: c?.full_name ?? '',
    document: c?.document_number ? `${c.document_type} ${c.document_number}` : null,
    address: c?.address ?? null,
  };
}

export function quotationDocData(q: QuotationDetail): CommercialDocData {
  return {
    title: 'COTIZACIÓN',
    number: q.number,
    date: q.issue_date,
    currency: q.currency,
    customer: customerOf(q.customer),
    heading: q.title,
    extra: { label: 'Válida hasta', value: shortDate(q.expiry_date) },
    specs: specsLine(q),
    items: q.items,
    subtotal: q.subtotal,
    discount_total: q.discount_total,
    tax_rate: q.tax_rate,
    tax_amount: q.tax_amount,
    total: q.total,
    paid: null,
    notes: q.notes,
    terms: q.terms,
    footerReference: `Cotización ${q.number}`,
  };
}

/** Proforma del pedido: A cuenta = lo pagado; Saldo = lo pendiente. */
export function proformaDocData(o: OrderDetail, number: string, copyLabel: string | null, terms: string | null): CommercialDocData {
  return {
    title: 'PROFORMA',
    number,
    date: o.start_date,
    currency: o.currency,
    customer: customerOf(o.customer),
    heading: o.title,
    extra: { label: 'Pedido', value: o.number },
    specs: [specsLine(o), o.due_date ? `Entrega: ${shortDate(o.due_date)}` : null].filter(Boolean).join('   ·   ') || null,
    items: o.items,
    subtotal: o.subtotal,
    discount_total: o.discount_total,
    tax_rate: o.tax_rate,
    tax_amount: o.tax_amount,
    total: o.total,
    paid: Number(o.amount_paid),
    notes: o.notes,
    terms,
    copyLabel,
    footerReference: `Proforma ${number} · Pedido ${o.number}`,
  };
}
