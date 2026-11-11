/** Línea mínima para calcular totales (cotizaciones y pedidos). */
export interface PricedLine {
  quantity: number | null;
  unit_price: number | null;
  discount: number | null;
  unit?: string | null;
  /** Peso en gramos (columna Gr.). */
  weight?: number | null;
}

export interface Totals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Cantidad que se cobra: en líneas por gramos (unit = 'g', p. ej. oro) es el peso;
 * en el resto (und, ct, servicio…) es la cantidad. Igual que public.line_billable_qty.
 */
export function billableQty(line: Pick<PricedLine, 'quantity' | 'unit' | 'weight'>): number {
  const weight = Number(line.weight ?? 0);
  return line.unit === 'g' && weight > 0 ? weight : Number(line.quantity ?? 0);
}

/** ¿Línea en gramos con peso? Entonces la cantidad son piezas y se cobra por el peso. */
export function isWeighedLine(line: Pick<PricedLine, 'unit' | 'weight'>): boolean {
  return line.unit === 'g' && Number(line.weight ?? 0) > 0;
}

/**
 * Unidad que se muestra junto a la cantidad: "pza" en líneas pesadas (el peso va en Gr.),
 * nada para 'und' y la unidad en el resto ("1 ct", "2 par").
 */
export function quantityUnit(line: Pick<PricedLine, 'unit' | 'weight'>): string {
  if (isWeighedLine(line)) return 'pza';
  return line.unit && line.unit !== 'und' ? line.unit : '';
}

/** Importe bruto de la línea (antes de descuento). */
export function lineGross(line: PricedLine): number {
  return round2(billableQty(line) * Number(line.unit_price ?? 0));
}

export function lineSubtotal(line: PricedLine): number {
  return round2(billableQty(line) * Number(line.unit_price ?? 0) - Number(line.discount ?? 0));
}

/**
 * Misma fórmula que los triggers de PostgreSQL (vista previa en el formulario;
 * el valor definitivo lo calcula la base de datos).
 */
export function computeTotals(lines: PricedLine[], taxRate: number): Totals {
  const subtotal = round2(lines.reduce((acc, l) => acc + billableQty(l) * Number(l.unit_price ?? 0), 0));
  const discount = round2(lines.reduce((acc, l) => acc + Number(l.discount ?? 0), 0));
  const taxable = round2(subtotal - discount);
  const tax = round2((taxable * Number(taxRate ?? 0)) / 100);
  return { subtotal, discount, taxable, tax, total: round2(taxable + tax) };
}
