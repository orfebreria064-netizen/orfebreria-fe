import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { computeTotals, lineSubtotal } from '../../../../shared/utils/totals';
import { MarketService } from '../../../../core/services/market.service';
import { Material } from '../../../materials/models/material.model';
import { ItemFormGroup, UNIT_OPTIONS, createItemGroup } from './item-form';

/**
 * Editor de ítems (producto/servicio, material, cantidad, precio, descuento) con totales en vivo.
 * Se reutiliza en cotizaciones y pedidos.
 */
@Component({
  selector: 'app-items-editor',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, InputNumberModule, SelectModule, FieldError, MoneyPipe],
  templateUrl: './items-editor.html',
  styleUrl: './items-editor.scss',
})
export class ItemsEditor implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly market = inject(MarketService);

  readonly items = input.required<FormArray<ItemFormGroup>>();
  readonly materials = input<Material[]>([]);
  readonly taxRate = input(18);
  /** Moneda del documento (PEN / USD). */
  readonly currency = input<string>('PEN');

  protected readonly units = UNIT_OPTIONS;
  /** TC venta del día: el precio del día de los materiales está en dólares y se convierte en documentos en soles. */
  protected readonly sellRate = signal<number | null>(null);
  /** Versión que cambia con cada edición para recalcular totales (los FormArray no son signals). */
  private readonly version = signal(0);

  protected readonly materialOptions = computed(() =>
    this.materials().map((m) => ({ value: m.id, label: m.purity && !m.name.includes(m.purity) ? `${m.name} ${m.purity}` : m.name })),
  );

  protected readonly totals = computed(() => {
    this.version();
    return computeTotals(this.items().getRawValue(), this.taxRate());
  });

  ngOnInit(): void {
    this.items()
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.version.update((v) => v + 1));
    if (this.items().length === 0) this.add();
    this.market
      .today()
      .then((m) => this.sellRate.set(m.exchange?.sell ? Number(m.exchange.sell) : null))
      .catch(() => this.sellRate.set(null));
  }

  protected lineTotal(group: ItemFormGroup): number {
    return lineSubtotal(group.getRawValue());
  }

  protected add(): void {
    this.items().push(createItemGroup());
  }

  protected remove(index: number): void {
    this.items().removeAt(index);
    if (this.items().length === 0) this.add();
  }

  protected onMaterialChange(group: ItemFormGroup, materialId: string | null): void {
    const material = this.materials().find((m) => m.id === materialId);
    group.controls.material_name.setValue(material ? this.materialOptions().find((o) => o.value === material.id)!.label : null);
    if (material && (material.unit === 'g' || material.unit === 'ct') && group.controls.unit.value === 'und' && !group.controls.description.value) {
      group.controls.description.setValue(material.name);
    }
    // Línea sin precio: se propone el precio del día del material (por su unidad).
    if (material?.day_price != null && !group.controls.unit_price.value && this.dayPriceIn(material) != null) this.applyDayPrice(group);
  }

  /** Precio del día del material de la línea, si tiene. */
  protected dayPriceOf(group: ItemFormGroup): Material | null {
    const material = this.materials().find((m) => m.id === group.controls.material_id.value);
    return material?.day_price != null ? material : null;
  }

  protected dayPriceApplied(group: ItemFormGroup, material: Material): boolean {
    return group.controls.unit.value === material.unit && Number(group.controls.unit_price.value) === this.dayPriceIn(material);
  }

  protected applyDayPrice(group: ItemFormGroup): void {
    const material = this.dayPriceOf(group);
    const price = material ? this.dayPriceIn(material) : null;
    if (!material || price == null) return;
    group.controls.unit.setValue(material.unit);
    group.controls.unit_price.setValue(price);
  }

  /** Precio del día (registrado en US$) en la moneda del documento; null si es en soles y no hay TC del día. */
  protected dayPriceIn(material: Material): number | null {
    const usd = Number(material.day_price);
    if (this.currency() === 'USD') return usd;
    const rate = this.sellRate();
    return rate ? Math.round(usd * rate * 100) / 100 : null;
  }
}
