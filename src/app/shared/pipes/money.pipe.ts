import { Pipe, PipeTransform } from '@angular/core';

const number = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Símbolo de la moneda (igual en todos los navegadores): S/ para soles, US$ para dólares. */
export function currencySymbol(currency: string | null | undefined): string {
  return currency === 'USD' ? 'US$' : 'S/';
}

/** Formato de moneda: S/ 1,500.00 (soles, por defecto) o US$ 1,500.00 (dólares). */
export function formatMoney(value: number | string | null | undefined, currency: string | null | undefined = 'PEN'): string {
  const n = Number(value ?? 0);
  return `${n < 0 ? '-' : ''}${currencySymbol(currency)} ${number.format(Math.abs(n))}`;
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | string | null | undefined, currency?: string | null): string {
    return formatMoney(value, currency);
  }
}
