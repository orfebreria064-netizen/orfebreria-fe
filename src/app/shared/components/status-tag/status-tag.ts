import { Component, computed, input } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { TagSeverity } from '../../../core/models/domain';

/** Tag de estado con etiqueta y color según los mapas de dominio. */
@Component({
  selector: 'app-status-tag',
  imports: [TagModule],
  template: `<p-tag [value]="text()" [severity]="severity()" [rounded]="rounded()" [icon]="icon() ?? undefined" />`,
})
export class StatusTag {
  readonly value = input.required<string | null | undefined>();
  readonly labels = input.required<Record<string, string>>();
  readonly severities = input<Record<string, TagSeverity>>({});
  readonly rounded = input(false);
  readonly icon = input<string | null>(null);

  protected readonly text = computed(() => {
    const v = this.value();
    return v ? (this.labels()[v] ?? v) : '—';
  });
  protected readonly severity = computed<TagSeverity>(() => {
    const v = this.value();
    return (v && this.severities()[v]) || 'secondary';
  });
}
