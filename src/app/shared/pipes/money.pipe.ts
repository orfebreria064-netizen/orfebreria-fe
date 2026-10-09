import { Pipe, PipeTransform } from '@angular/core';

const formatter = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 });

/** Formato de moneda peruana: S/ 1,500.00 */
export function formatMoney(value: number | string | null | undefined): string {
  return formatter.format(Number(value ?? 0));
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return formatMoney(value);
  }
}
