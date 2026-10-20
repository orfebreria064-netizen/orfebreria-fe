import type { jsPDF } from 'jspdf';
import type autoTableFn from 'jspdf-autotable';
import { CompanySettings } from '../../core/models/catalog.model';
import { fromIsoDate } from '../utils/db';

/**
 * Piezas comunes de los documentos impresos (cotización, proforma, orden de producción y recibos):
 * imitan los talonarios en papel de la empresa con su logo, eslogan, dirección y el número en rojo.
 * jsPDF y jspdf-autotable se cargan bajo demanda.
 */

export type RGB = [number, number, number];
export const INK: RGB = [31, 36, 48];
export const MUTED: RGB = [105, 105, 105];
export const RULE: RGB = [140, 140, 140];
export const SHADE: RGB = [228, 228, 228];
export const RED: RGB = [196, 30, 45];

export type AutoTable = typeof autoTableFn;

export interface Brand {
  settings: CompanySettings | null;
  logo: { data: string; format: 'PNG' | 'JPEG'; ratio: number } | null;
}

export interface PdfContext {
  doc: jsPDF;
  autoTable: AutoTable;
  brand: Brand;
  width: number;
  height: number;
}

export async function createPdf(settings: CompanySettings | null, format: 'a4' | 'a5', orientation: 'portrait' | 'landscape' = 'portrait'): Promise<PdfContext> {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogo(settings?.logo ?? null),
  ]);
  const doc = new jsPDF({ unit: 'mm', format, orientation });
  return {
    doc,
    autoTable,
    brand: { settings, logo },
    width: doc.internal.pageSize.getWidth(),
    height: doc.internal.pageSize.getHeight(),
  };
}

/** Logo (data URL) con su formato y proporción, o null si no hay o no es una imagen válida. */
export async function loadLogo(dataUrl: string | null): Promise<Brand['logo']> {
  if (!dataUrl?.startsWith('data:image/')) return null;
  const format = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
  const ratio = await new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3);
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
  return ratio ? { data: dataUrl, format, ratio } : null;
}

/** Logo dentro de la caja indicada (o el nombre comercial si no hay logo). Devuelve el alto usado. */
export function drawLogo(ctx: PdfContext, x: number, y: number, maxW: number, maxH: number, align: 'left' | 'center' = 'left'): number {
  const { doc, brand } = ctx;
  if (brand.logo) {
    let w = maxW;
    let h = w / brand.logo.ratio;
    if (h > maxH) {
      h = maxH;
      w = h * brand.logo.ratio;
    }
    const left = align === 'center' ? x + (maxW - w) / 2 : x;
    doc.addImage(brand.logo.data, brand.logo.format, left, y, w, h, undefined, 'FAST');
    return h;
  }
  const name = brand.settings?.company_name ?? 'Orfebrería';
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  let size = 18;
  doc.setFontSize(size);
  while (size > 9 && doc.getTextWidth(name) > maxW) doc.setFontSize(--size);
  doc.text(name, align === 'center' ? x + maxW / 2 : x, y + size * 0.3, { align: align === 'center' ? 'center' : 'left' });
  return size * 0.4;
}

/** Viñetas del eslogan (una por línea en Configuración). Devuelve el alto usado. */
export function drawSlogan(ctx: PdfContext, x: number, y: number, maxW: number, fontSize = 8): number {
  const lines = (ctx.brand.settings?.slogan ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return 0;
  const { doc } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(...INK);
  let cy = y;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, maxW - 4) as string[];
    doc.circle(x + 0.8, cy - fontSize * 0.11, 0.55, 'F');
    doc.text(wrapped, x + 3, cy);
    cy += wrapped.length * fontSize * 0.38 + 0.6;
  }
  return cy - y;
}

/** Dirección, teléfonos y RUC de la empresa (líneas cortas). */
export function companyContactLines(settings: CompanySettings | null): string[] {
  if (!settings) return [];
  const first = [settings.address, settings.phone ? `Teléfono: ${settings.phone}` : null].filter(Boolean).join('   ');
  const second = [settings.mobile ? `Cel.: ${settings.mobile}` : null, settings.tax_id ? `RUC ${settings.tax_id}` : null]
    .filter(Boolean)
    .join('   ');
  return [first, second].filter(Boolean);
}

/** Recuadro del documento: título sobre banda de color y número correlativo en rojo. */
export function numberBox(ctx: PdfContext, title: string, number: string, x: number, y: number, w: number, band: RGB = RED): number {
  const { doc } = ctx;
  const bandH = 9;
  const numberH = 9;
  doc.setDrawColor(...band);
  doc.setLineWidth(0.5);
  doc.setFillColor(...band);
  doc.rect(x, y, w, bandH, 'FD');
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y + bandH, w, numberH, 'D');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  let size = 15;
  doc.setFontSize(size);
  while (size > 9 && doc.getTextWidth(title) > w - 4) doc.setFontSize(--size);
  doc.text(title, x + w / 2, y + bandH / 2 + size * 0.13, { align: 'center' });
  doc.setTextColor(...RED);
  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.text(`N° ${number}`, x + w / 2, y + bandH + numberH / 2 + 1.5, { align: 'center' });
  doc.setLineWidth(0.2);
  return bandH + numberH;
}

/** "Etiqueta: valor" sobre una línea punteada que llega hasta x + w. */
export function field(ctx: PdfContext, label: string, value: string | null | undefined, x: number, y: number, w: number, fontSize = 9.5): void {
  const { doc } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(...MUTED);
  doc.text(label, x, y);
  const start = x + doc.getTextWidth(label) + 2;
  doc.setDrawColor(...RULE);
  doc.setLineDashPattern([0.4, 0.8], 0);
  doc.line(start, y + 1, x + w, y + 1);
  doc.setLineDashPattern([], 0);
  if (value) {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    const text = doc.splitTextToSize(value, x + w - start - 1) as string[];
    doc.text(text[0], start + 1, y);
  }
}

/** Casilla marcada o vacía con su etiqueta. Devuelve el ancho usado. */
export function checkbox(ctx: PdfContext, label: string, checked: boolean, x: number, y: number): number {
  const { doc } = ctx;
  const s = 4;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.rect(x, y - s + 0.8, s, s);
  if (checked) {
    doc.setLineWidth(0.6);
    doc.line(x + 0.8, y - 1.2, x + 1.7, y + 0.1);
    doc.line(x + 1.7, y + 0.1, x + 3.4, y - 2.6);
  }
  doc.setLineWidth(0.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(label, x + s + 1.5, y);
  return s + 1.5 + doc.getTextWidth(label) + 6;
}

/** Línea de firma con su leyenda centrada debajo. */
export function signature(ctx: PdfContext, caption: string, x: number, y: number, w: number, detail?: string | null): void {
  const { doc } = ctx;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + w, y);
  doc.setLineWidth(0.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(caption, x + w / 2, y + 4, { align: 'center' });
  if (detail) {
    doc.setTextColor(...INK);
    doc.text(detail, x + w / 2, y + 8, { align: 'center' });
  }
}

/** Banda gris con un título centrado (secciones de la orden de producción). */
export function sectionBand(ctx: PdfContext, title: string, x: number, y: number, w: number, h = 6): void {
  const { doc } = ctx;
  doc.setFillColor(...SHADE);
  doc.setDrawColor(...INK);
  doc.rect(x, y, w, h, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(title, x + w / 2, y + h / 2 + 1.4, { align: 'center' });
}

/** Marca de agua para documentos anulados. */
export function voidStamp(ctx: PdfContext, reason?: string | null): void {
  const { doc, width, height } = ctx;
  doc.saveGraphicsState();
  // GState existe en la instancia de jsPDF pero sus tipos no declaran el constructor
  const GState = (doc as unknown as { GState: new (o: { opacity: number }) => Parameters<jsPDF['setGState']>[0] }).GState;
  doc.setGState(new GState({ opacity: 0.22 }));
  doc.setTextColor(...RED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(64);
  doc.text('ANULADO', width / 2, height / 2 + 8, { align: 'center', angle: 18 });
  doc.restoreGraphicsState();
  if (reason) {
    doc.setTextColor(...RED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`ANULADO · Motivo: ${reason}`, width / 2, height - 30, { align: 'center' });
  }
}

/** Pie con la fecha de impresión. */
export function printedAt(ctx: PdfContext, extra?: string): void {
  const { doc, height } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text([extra, `Impreso el ${new Date().toLocaleString('es-PE')}`].filter(Boolean).join('  ·  '), 8, height - 4);
}

export function shortDate(iso: string | null | undefined): string {
  const d = fromIsoDate(iso ?? null);
  return d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

/** "Lima, 16 de octubre del 2026" (la ciudad sale de Configuración). */
export function placeAndDate(settings: CompanySettings | null, iso: string | null | undefined): string {
  const d = fromIsoDate(iso ?? null) ?? new Date();
  const month = d.toLocaleDateString('es-PE', { month: 'long' }).toLowerCase();
  return `${settings?.city || 'Lima'}, ${d.getDate()} de ${month} del ${d.getFullYear()}`;
}

export function grams(value: number | string | null | undefined): string {
  return value != null && Number(value) ? `${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 })} g` : '';
}

/** Abre el diálogo de impresión del navegador o descarga el archivo. */
export function outputPdf(doc: jsPDF, mode: 'print' | 'download', fileName: string): void {
  if (mode === 'download') {
    doc.save(fileName);
    return;
  }
  doc.autoPrint();
  window.open(doc.output('bloburl').toString(), '_blank');
}
