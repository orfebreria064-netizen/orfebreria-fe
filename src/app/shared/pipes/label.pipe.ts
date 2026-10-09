import { Pipe, PipeTransform } from '@angular/core';

/** Traduce un código a su etiqueta: {{ status | label: ORDER_STATUS_LABELS }} */
@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  transform(value: string | null | undefined, labels: Record<string, string>): string {
    if (!value) return '—';
    return labels[value] ?? value;
  }
}
