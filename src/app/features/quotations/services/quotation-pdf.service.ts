import { Injectable, inject } from '@angular/core';
import type { jsPDF } from 'jspdf';
import { LookupService } from '../../../core/services/lookup.service';
import { QUOTATION_STATUS_LABELS } from '../../../core/models/domain';
import { formatMoney } from '../../../shared/pipes/money.pipe';
import { fromIsoDate } from '../../../shared/utils/db';
import { QuotationDetail } from '../models/quotation.model';

const INK: [number, number, number] = [31, 36, 48];
const GOLD: [number, number, number] = [176, 138, 58];
const MUTED: [number, number, number] = [110, 110, 110];

function formatDate(iso: string | null): string {
  const d = fromIsoDate(iso);
  return d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

/** Genera el PDF de una cotización en el navegador (jsPDF se carga bajo demanda). */
@Injectable({ providedIn: 'root' })
export class QuotationPdfService {
  private readonly lookups = inject(LookupService);

  async download(q: QuotationDetail): Promise<void> {
    const doc = await this.build(q);
    doc.save(`${q.number}.pdf`);
  }

  async print(q: QuotationDetail): Promise<void> {
    const doc = await this.build(q);
    doc.autoPrint();
    const url = doc.output('bloburl');
    window.open(url.toString(), '_blank');
  }

  private async build(q: QuotationDetail): Promise<jsPDF> {
    await this.lookups.ensureLoaded();
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const s = this.lookups.settings();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    // Cabecera de empresa
    doc.setFillColor(...INK);
    doc.rect(0, 0, pageWidth, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(s?.company_name ?? 'Orfebrería', margin, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const companyLine = [s?.tax_id ? `RUC ${s.tax_id}` : null, s?.address, s?.phone, s?.email].filter(Boolean).join('  ·  ');
    doc.text(companyLine, margin, 20);

    doc.setTextColor(...GOLD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('COTIZACIÓN', pageWidth - margin, 12, { align: 'right' });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(q.number, pageWidth - margin, 19, { align: 'right' });

    // Datos de cliente y cotización
    let y = 40;
    doc.setTextColor(...INK);
    doc.setFontSize(9);
    const left: [string, string][] = [
      ['Cliente', q.customer?.full_name ?? '—'],
      ['Documento', q.customer?.document_number ? `${q.customer.document_type} ${q.customer.document_number}` : '—'],
      ['Teléfono', q.customer?.phone ?? '—'],
      ['Correo', q.customer?.email ?? '—'],
    ];
    const right: [string, string][] = [
      ['Fecha', formatDate(q.issue_date)],
      ['Válida hasta', formatDate(q.expiry_date)],
      ['Servicio', q.service_type?.name ?? '—'],
      ['Estado', QUOTATION_STATUS_LABELS[q.status]],
    ];
    left.forEach(([k, v], i) => this.pair(doc, k, v, margin, y + i * 5.5));
    right.forEach(([k, v], i) => this.pair(doc, k, v, pageWidth / 2 + 10, y + i * 5.5));
    y += left.length * 5.5 + 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(q.title, margin, y);
    y += 5;
    const specs = [
      q.main_material ? `Material: ${q.main_material}` : null,
      q.estimated_weight ? `Peso estimado: ${Number(q.estimated_weight).toFixed(2)} g` : null,
      q.stone ? `Piedra: ${q.stone}` : null,
      q.size ? `Talla: ${q.size}` : null,
    ].filter(Boolean);
    if (specs.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(specs.join('   ·   '), margin, y);
      y += 4;
    }

    autoTable(doc, {
      startY: y + 2,
      margin: { left: margin, right: margin },
      head: [['#', 'Producto / servicio', 'Material', 'Cant.', 'P. unit.', 'Desc.', 'Subtotal']],
      body: q.items.map((it, i) => [
        String(i + 1),
        it.detail ? `${it.description}\n${it.detail}` : it.description,
        it.material_name ?? '',
        `${Number(it.quantity)} ${it.unit}`,
        formatMoney(it.unit_price),
        Number(it.discount) ? formatMoney(it.discount) : '',
        formatMoney(it.subtotal),
      ]),
      styles: { fontSize: 8.5, cellPadding: 2.2, textColor: INK },
      headStyles: { fillColor: [240, 239, 237], textColor: INK, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 8 },
        3: { halign: 'right', cellWidth: 20 },
        4: { halign: 'right', cellWidth: 24 },
        5: { halign: 'right', cellWidth: 20 },
        6: { halign: 'right', cellWidth: 26 },
      },
    });

    // Totales
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    const totals: [string, string][] = [
      ['Subtotal', formatMoney(q.subtotal)],
      ['Descuento', `- ${formatMoney(q.discount_total)}`],
      [`IGV (${Number(q.tax_rate)}%)`, formatMoney(q.tax_amount)],
    ];
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    totals.forEach(([k, v], i) => {
      doc.text(k, pageWidth - margin - 55, finalY + i * 5.5);
      doc.text(v, pageWidth - margin, finalY + i * 5.5, { align: 'right' });
    });
    const totalY = finalY + totals.length * 5.5 + 2;
    doc.setDrawColor(...GOLD);
    doc.line(pageWidth - margin - 55, totalY - 4, pageWidth - margin, totalY - 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL', pageWidth - margin - 55, totalY + 1);
    doc.text(formatMoney(q.total), pageWidth - margin, totalY + 1, { align: 'right' });

    // Observaciones y condiciones
    let notesY = totalY + 12;
    for (const [title, text] of [
      ['Observaciones', q.notes],
      ['Condiciones', q.terms],
    ] as const) {
      if (!text) continue;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(title, margin, notesY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      const lines = doc.splitTextToSize(text, pageWidth - margin * 2) as string[];
      doc.text(lines, margin, notesY + 5);
      notesY += 8 + lines.length * 4;
    }

    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Documento generado el ${new Date().toLocaleString('es-PE')}`, margin, doc.internal.pageSize.getHeight() - 8);
    return doc;
  }

  private pair(doc: jsPDF, label: string, value: string, x: number, y: number): void {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...MUTED);
    doc.text(`${label}:`, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(value, x + 24, y);
  }
}
