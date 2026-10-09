/** Línea mínima para calcular totales (cotizaciones y pedidos). */
export interface PricedLine {
  quantity: number | null;
  unit_price: number | null;
  discount: number | null;
}

export interface Totals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineSubtotal(line: PricedLine): number {
  return round2(Number(line.quantity ?? 0) * Number(line.unit_price ?? 0) - Number(line.discount ?? 0));
}

/**
 * Misma fórmula que los triggers de PostgreSQL (vista previa en el formulario;
 * el valor definitivo lo calcula la base de datos).
 */
export function computeTotals(lines: PricedLine[], taxRate: number): Totals {
  const subtotal = round2(lines.reduce((acc, l) => acc + Number(l.quantity ?? 0) * Number(l.unit_price ?? 0), 0));
  const discount = round2(lines.reduce((acc, l) => acc + Number(l.discount ?? 0), 0));
  const taxable = round2(subtotal - discount);
  const tax = round2((taxable * Number(taxRate ?? 0)) / 100);
  return { subtotal, discount, taxable, tax, total: round2(taxable + tax) };
}
