import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  MATERIAL_TYPE_OPTIONS,
  MATERIAL_UNIT_OPTIONS,
  METAL_TYPES,
  MaterialType,
  MaterialUnit,
} from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { Material } from '../../models/material.model';
import { MaterialsService } from '../../services/materials.service';

/** Alta y edición de materiales. El stock inicial se registra como movimiento de entrada. */
@Component({
  selector: 'app-material-dialog',
  imports: [ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule, InputNumberModule, SelectModule, ToggleSwitchModule, FieldError],
  template: `
    <p-dialog [header]="material() ? 'Editar material' : 'Nuevo material'" [(visible)]="visible" [modal]="true" [style]="{ width: '520px' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" class="form-grid" novalidate>
        <div class="field field--full">
          <label for="mt-name">Nombre <span class="req">*</span></label>
          <input pInputText id="mt-name" formControlName="name" placeholder="Ej. Oro 18K" />
          <app-field-error [control]="form.controls.name" />
        </div>
        <div class="field">
          <label for="mt-type">Tipo <span class="req">*</span></label>
          <p-select inputId="mt-type" [options]="types" formControlName="type" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="mt-purity">{{ isMetal() ? 'Ley' : 'Calidad / ley' }}</label>
          <input pInputText id="mt-purity" formControlName="purity" [placeholder]="isMetal() ? '18K, 14K, 925, 950' : 'VS1, AAA…'" />
        </div>
        <div class="field">
          <label for="mt-unit">Unidad <span class="req">*</span></label>
          <p-select inputId="mt-unit" [options]="units" formControlName="unit" optionLabel="label" optionValue="value" appendTo="body" />
        </div>
        <div class="field">
          <label for="mt-price">Precio de venta del día</label>
          <p-inputnumber inputId="mt-price" formControlName="day_price" mode="currency" currency="PEN" locale="es-PE" [min]="0" [fluid]="true" />
          <small class="muted">Por {{ unitLabel() }}. Se sugiere en cotizaciones y pedidos.</small>
        </div>
        <div class="field">
          <label for="mt-cost">Costo de compra (referencial)</label>
          <p-inputnumber inputId="mt-cost" formControlName="reference_cost" mode="currency" currency="PEN" locale="es-PE" [min]="0" [fluid]="true" />
          <small class="muted">Valoriza el inventario; no se cobra al cliente.</small>
          <app-field-error [control]="form.controls.reference_cost" />
        </div>
        @if (!material()) {
          <div class="field">
            <label for="mt-stock">Stock inicial</label>
            <p-inputnumber inputId="mt-stock" formControlName="stock" [minFractionDigits]="2" [maxFractionDigits]="3" [min]="0" [suffix]="' ' + form.controls.unit.value" locale="es-PE" [fluid]="true" />
            <app-field-error [control]="form.controls.stock" />
          </div>
        } @else {
          <div class="field">
            <label>Stock actual</label>
            <span class="strong" style="padding-top: 0.5rem">{{ material()!.stock }} {{ material()!.unit }} <small class="muted">(se ajusta con movimientos)</small></span>
          </div>
        }
        <div class="field">
          <label for="mt-min">Stock mínimo (alerta)</label>
          <p-inputnumber inputId="mt-min" formControlName="min_stock" [minFractionDigits]="2" [maxFractionDigits]="3" [min]="0" locale="es-PE" [fluid]="true" />
        </div>
        @if (material()) {
          <div class="field">
            <label for="mt-active">Activo</label>
            <p-toggleswitch inputId="mt-active" formControlName="active" />
          </div>
        }
        <div class="form-actions field--full" style="margin-top: 0.25rem">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>
  `,
})
export class MaterialDialog {
  private readonly service = inject(MaterialsService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  readonly material = input<Material | null>(null);
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly types = MATERIAL_TYPE_OPTIONS;
  protected readonly units = MATERIAL_UNIT_OPTIONS;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    type: ['ORO' as MaterialType, Validators.required],
    purity: [''],
    unit: ['g' as MaterialUnit, Validators.required],
    stock: [0, [Validators.min(0)]],
    min_stock: [0, [Validators.min(0)]],
    reference_cost: [0, [Validators.min(0)]],
    day_price: [null as number | null, [Validators.min(0)]],
    active: [true],
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const m = this.material();
      // untracked: form.reset() lee signals internos de PrimeNG; rastrearlos reiniciaría el formulario al editar.
      untracked(() => this.form.reset({
        name: m?.name ?? '',
        type: m?.type ?? 'ORO',
        purity: m?.purity ?? '',
        unit: m?.unit ?? 'g',
        stock: 0,
        min_stock: Number(m?.min_stock ?? 0),
        reference_cost: Number(m?.reference_cost ?? 0),
        day_price: m?.day_price != null ? Number(m.day_price) : null,
        active: m?.active ?? true,
      }));
    });
    // Metales en gramos y piedras en quilates por defecto.
    this.form.controls.type.valueChanges.subscribe((type) => {
      if (this.material()) return;
      this.form.controls.unit.setValue(METAL_TYPES.includes(type) ? 'g' : type.startsWith('PIEDRA') ? 'ct' : 'und');
    });
  }

  protected isMetal(): boolean {
    return METAL_TYPES.includes(this.form.controls.type.value);
  }

  protected unitLabel(): string {
    return { g: 'gramo', ct: 'quilate', und: 'unidad' }[this.form.controls.unit.value];
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const { stock, day_price, ...rest } = this.form.getRawValue();
    const data = { ...rest, name: rest.name.trim(), purity: rest.purity.trim() || null };
    try {
      const current = this.material();
      let id = current?.id ?? null;
      if (current) await this.service.update(current.id, data);
      else id = await this.service.create({ ...data, stock });
      // El precio de venta se guarda como precio de hoy solo si cambió.
      if (id && day_price && day_price !== Number(current?.day_price ?? 0)) {
        await this.service.savePrices([{ material_id: id, price: day_price }]);
      }
      this.notify.success(current ? 'Material actualizado correctamente.' : 'Material creado correctamente.');
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el material.');
    } finally {
      this.saving.set(false);
    }
  }
}
