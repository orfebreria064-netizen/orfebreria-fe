import { Pipe, PipeTransform } from '@angular/core';

const formatter = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Cantidad con unidad: 125.50 g */
@Pipe({ name: 'qty' })
export class QtyPipe implements PipeTransform {
  transform(value: number | string | null | undefined, unit?: string | null): string {
    if (value === null || value === undefined || value === '') return '—';
    return `${formatter.format(Number(value))}${unit ? ' ' + unit : ''}`;
  }
}
