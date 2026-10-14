import { Injectable, inject } from '@angular/core';
import { LookupService } from '../../../core/services/lookup.service';
import { formatMoney } from '../../../shared/pipes/money.pipe';
import { fromIsoDate } from '../../../shared/utils/db';
import { ReportColumn, ReportSummaryItem } from '../models/report.model';

export interface ReportExport {
  title: string;
  /** Filtros aplicados, en texto ("Periodo: 01/10/2026 – 13/10/2026 · Método: Yape"). */
  filters: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: ReportSummaryItem[];
  fileName: string;
}

const INK: [number, number, number] = [31, 36, 48];
const GOLD: [number, number, number] = [176, 138, 58];
const MUTED: [number, number, number] = [110, 110, 110];

const qtyFormat = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const intFormat = new Intl.NumberFormat('es-PE');

/** Texto de una celda tal como se muestra en pantalla y en el PDF. */
export function formatCell(row: Record<string, unknown>, col: ReportColumn): string {
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return '—';
  switch (col.type) {
    case 'money':
      return formatMoney(v as number);
    case 'date': {
      const d = fromIsoDate(String(v).slice(0, 10));
      return d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    }
    case 'number':
      return intFormat.format(Number(v));
    case 'qty': {
      const unit = col.unitKey ? row[col.unitKey] : null;
      return `${qtyFormat.format(Number(v))}${unit ? ' ' + unit : ''}`;
    }
    case 'label':
      return col.labels?.[String(v)] ?? String(v);
    case 'bool':
      return v ? 'Sí' : 'No';
    default:
      return String(v);
  }
}

export function columnTotal(rows: Record<string, unknown>[], col: ReportColumn): number {
  return rows.reduce((acc, r) => acc + Number(r[col.key] ?? 0), 0);
}

/** Exporta un reporte a Excel (ExcelJS) o PDF (jsPDF). Ambas librerías se cargan bajo demanda. */
@Injectable({ providedIn: 'root' })
export class ReportExportService {
  private readonly lookups = inject(LookupService);

  async excel(r: ReportExport): Promise<void> {
    await this.lookups.ensureLoaded();
    const { default: ExcelJS } = await import('exceljs');
    const company = this.lookups.settings()?.company_name ?? 'Orfebrería';
    const wb = new ExcelJS.Workbook();
    wb.creator = company;
    wb.created = new Date();
    // Excel no admite * ? : \ / [ ] en el nombre de la hoja (máx. 31 caracteres).
    const sheetName = r.title.replace(/[*?:\\/[\]]/g, '-').slice(0, 31);
    const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 6 }] });
    const lastCol = r.columns.length;

    ws.mergeCells(1, 1, 1, lastCol);
    ws.getCell(1, 1).value = company;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF1F2430' } };
    ws.mergeCells(2, 1, 2, lastCol);
    ws.getCell(2, 1).value = r.title;
    ws.getCell(2, 1).font = { bold: true, size: 12, color: { argb: 'FFB08A3A' } };
    ws.mergeCells(3, 1, 3, lastCol);
    ws.getCell(3, 1).value = r.filters;
    ws.getCell(3, 1).font = { italic: true, color: { argb: 'FF6E6E6E' } };
    ws.mergeCells(4, 1, 4, lastCol);
    ws.getCell(4, 1).value = `Generado: ${new Date().toLocaleString('es-PE')} · ${r.summary.map((s) => `${s.label}: ${s.value}`).join(' · ')}`;
    ws.getCell(4, 1).font = { color: { argb: 'FF6E6E6E' } };

    const header = ws.getRow(6);
    r.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2430' } };
      cell.alignment = { vertical: 'middle', horizontal: this.isNumeric(c) ? 'right' : 'left' };
      ws.getColumn(i + 1).width = c.width ?? this.defaultWidth(c);
    });

    r.rows.forEach((row, ri) => {
      const xrow = ws.getRow(7 + ri);
      r.columns.forEach((c, i) => {
        const cell = xrow.getCell(i + 1);
        cell.value = this.excelValue(row, c);
        if (c.type === 'money') cell.numFmt = '"S/" #,##0.00';
        else if (c.type === 'qty') cell.numFmt = '#,##0.000';
        else if (c.type === 'date') cell.numFmt = 'dd/mm/yyyy';
      });
    });

    if (r.columns.some((c) => c.total) && r.rows.length) {
      const trow = ws.getRow(7 + r.rows.length);
      trow.getCell(1).value = 'Total';
      r.columns.forEach((c, i) => {
        if (!c.total) return;
        const cell = trow.getCell(i + 1);
        cell.value = columnTotal(r.rows, c);
        cell.numFmt = c.type === 'money' ? '"S/" #,##0.00' : '#,##0.000';
      });
      trow.font = { bold: true };
      trow.eachCell((cell) => (cell.border = { top: { style: 'thin', color: { argb: 'FF1F2430' } } }));
    }
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: lastCol } };

    const buffer = await wb.xlsx.writeBuffer();
    this.save(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${r.fileName}.xlsx`);
  }

  async pdf(r: ReportExport): Promise<void> {
    await this.lookups.ensureLoaded();
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const s = this.lookups.settings();
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: r.columns.length > 6 ? 'landscape' : 'portrait' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 12;

    doc.setFillColor(...INK);
    doc.rect(0, 0, pageWidth, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(s?.company_name ?? 'Orfebrería', margin, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text([s?.tax_id ? `RUC ${s.tax_id}` : null, s?.address, s?.phone].filter(Boolean).join('  ·  '), margin, 16);
    doc.setTextColor(...GOLD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(r.title.toUpperCase(), pageWidth - margin, 10, { align: 'right' });
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageWidth - margin, 16, { align: 'right' });

    doc.setTextColor(...MUTED);
    doc.setFontSize(8.5);
    doc.text(r.filters, margin, 29);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.text(doc.splitTextToSize(r.summary.map((x) => `${x.label}: ${x.value}`).join('    '), pageWidth - margin * 2), margin, 35);

    const hasTotals = r.columns.some((c) => c.total) && r.rows.length > 0;
    autoTable(doc, {
      startY: 41,
      margin: { left: margin, right: margin },
      head: [r.columns.map((c) => c.header)],
      body: r.rows.map((row) => r.columns.map((c) => formatCell(row, c))),
      foot: hasTotals
        ? [r.columns.map((c, i) => (c.total ? (c.type === 'money' ? formatMoney(columnTotal(r.rows, c)) : qtyFormat.format(columnTotal(r.rows, c))) : i === 0 ? 'Total' : ''))]
        : undefined,
      showFoot: 'lastPage',
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: INK },
      headStyles: { fillColor: INK, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [244, 240, 230], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 246] },
      columnStyles: Object.fromEntries(r.columns.map((c, i) => [i, { halign: this.isNumeric(c) ? 'right' : 'left' }])),
      didDrawPage: () => {
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(`Página ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
      },
    });

    doc.save(`${r.fileName}.pdf`);
  }

  private excelValue(row: Record<string, unknown>, c: ReportColumn): string | number | Date | null {
    const v = row[c.key];
    if (v === null || v === undefined || v === '') return null;
    switch (c.type) {
      case 'money':
      case 'qty':
      case 'number':
        return Number(v);
      case 'date':
        return fromIsoDate(String(v).slice(0, 10));
      default:
        return formatCell(row, c);
    }
  }

  private isNumeric(c: ReportColumn): boolean {
    return c.type === 'money' || c.type === 'qty' || c.type === 'number';
  }

  private defaultWidth(c: ReportColumn): number {
    switch (c.type) {
      case 'money':
      case 'qty':
        return 14;
      case 'date':
        return 12;
      case 'number':
      case 'bool':
        return 9;
      default:
        return Math.max(12, c.header.length + 4);
    }
  }

  private save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
