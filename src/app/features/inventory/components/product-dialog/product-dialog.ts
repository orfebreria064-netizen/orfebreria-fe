import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { CURRENCY_OPTIONS, Currency } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { Material } from '../../../materials/models/material.model';
import {
  GEM_ROLE_OPTIONS,
  Gem,
  InventoryService,
  METAL_COLOR_OPTIONS,
  MetalColor,
  PRODUCT_CATEGORY_OPTIONS,
  Product,
  ProductCategory,
  ProductGem,
  gemSummary,
} from '../../services/inventory.service';

/** Alta y edición de una joya de vitrina, con las piedras que lleva (registradas o descritas en grupo). */
@Component({
  selector: 'app-product-dialog',
  imports: [FormsModule, ReactiveFormsModule, ButtonModule, DialogModule, InputNumberModule, InputTextModule, SelectModule, TextareaModule, FieldError],
  template: `
    <p-dialog [header]="product() ? 'Joya ' + product()!.code : 'Nueva joya'" [(visible)]="visible" [modal]="true" [style]="{ width: '780px' }" [breakpoints]="{ '820px': '96vw' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="form-grid form-grid--3">
          <div class="field field--span-2">
            <label for="pr-name">Nombre <span class="req">*</span></label>
            <input pInputText id="pr-name" formControlName="name" placeholder="Ej.: Solitario clásico 4 garras" />
            <app-field-error [control]="form.controls.name" />
          </div>
          <div class="field">
            <label for="pr-code">Código</label>
            <input pInputText id="pr-code" formControlName="code" placeholder="Automático (JY-000001)" />
          </div>
          <div class="field">
            <label for="pr-cat">Categoría <span class="req">*</span></label>
            <p-select inputId="pr-cat" [options]="categories" formControlName="category" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field">
            <label for="pr-mat">Metal</label>
            <p-select inputId="pr-mat" [options]="metalOptions()" formControlName="material_id" optionLabel="label" optionValue="value" [showClear]="true" placeholder="Seleccione" appendTo="body" />
          </div>
          <div class="field">
            <label for="pr-color">Color del metal</label>
            <p-select inputId="pr-color" [options]="metalColors" formControlName="metal_color" optionLabel="label" optionValue="value" [showClear]="true" appendTo="body" />
          </div>
          <div class="field">
            <label for="pr-weight">Peso (g)</label>
            <p-inputnumber inputId="pr-weight" formControlName="weight_g" [maxFractionDigits]="2" [min]="0" suffix=" g" [fluid]="true" />
          </div>
          <div class="field">
            <label for="pr-size">Talla / largo</label>
            <input pInputText id="pr-size" formControlName="size" />
          </div>
          <div class="field">
            <label for="pr-cur">Moneda</label>
            <p-select inputId="pr-cur" [options]="currencies" formControlName="currency" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field">
            <label for="pr-cost">Costo</label>
            <p-inputnumber inputId="pr-cost" formControlName="cost" mode="currency" [currency]="form.controls.currency.value ?? 'PEN'" locale="es-PE" [min]="0" [fluid]="true" />
          </div>
          <div class="field">
            <label for="pr-price">Precio de venta <span class="req">*</span></label>
            <p-inputnumber inputId="pr-price" formControlName="price" mode="currency" [currency]="form.controls.currency.value ?? 'PEN'" locale="es-PE" [min]="0" [fluid]="true" />
            <app-field-error [control]="form.controls.price" />
          </div>
          <div class="field">
            <label for="pr-qty">Cantidad <span class="req">*</span></label>
            <p-inputnumber inputId="pr-qty" formControlName="quantity" [min]="product() ? 0 : 1" [max]="hasRegisteredGems() ? 1 : null" [useGrouping]="false" suffix=" und." [fluid]="true" />
            @if (hasRegisteredGems()) {
              <small class="muted">Con piedras registradas la joya es única.</small>
            } @else if (product()) {
              <small class="muted">Unidades disponibles (sin las reservadas o vendidas).</small>
            }
            <app-field-error [control]="form.controls.quantity" />
          </div>
          <div class="field">
            <label for="pr-photo">Foto</label>
            <input id="pr-photo" type="file" accept="image/jpeg,image/png,image/webp" (change)="onFile($event)" />
          </div>
          <div class="field field--full">
            <label for="pr-desc">Descripción</label>
            <textarea pTextarea id="pr-desc" formControlName="description" rows="2" [autoResize]="true"></textarea>
          </div>
        </div>

        <h3 class="section-title">Piedras</h3>
        @for (g of stones; track $index) {
          <div class="stone-row">
            <p-select [options]="roles" [(ngModel)]="g.role" [ngModelOptions]="{ standalone: true }" optionLabel="label" optionValue="value" appendTo="body" ariaLabel="Posición" />
            <p-select
              [options]="gemOptions()"
              [(ngModel)]="g.gem_id"
              [ngModelOptions]="{ standalone: true }"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              [filter]="true"
              placeholder="Piedra registrada (opcional)"
              appendTo="body"
              ariaLabel="Piedra registrada"
              (onChange)="g.quantity = 1"
            />
            @if (!g.gem_id) {
              <input pInputText [(ngModel)]="g.description" [ngModelOptions]="{ standalone: true }" placeholder="Ej.: brillantes G-H SI" aria-label="Descripción" />
              <p-inputnumber [(ngModel)]="g.quantity" [ngModelOptions]="{ standalone: true }" [min]="1" ariaLabel="Cantidad" placeholder="Cant." [fluid]="true" />
              <p-inputnumber [(ngModel)]="g.total_carat" [ngModelOptions]="{ standalone: true }" [maxFractionDigits]="3" [min]="0" ariaLabel="Quilates totales" placeholder="ct total" [fluid]="true" />
            }
            <p-button icon="pi pi-trash" [text]="true" severity="danger" ariaLabel="Quitar piedra" (onClick)="stones.splice($index, 1)" />
          </div>
        }
        <p-button label="Agregar piedra" icon="pi pi-plus" [text]="true" size="small" (onClick)="addStone()" />

        <div class="form-actions">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>
  `,
  styles: `
    .stone-row {
      display: grid;
      grid-template-columns: 120px minmax(0, 2fr) minmax(0, 1.5fr) 80px 100px auto;
      gap: 0.4rem;
      align-items: center;
      margin-bottom: 0.4rem;
    }
    @media (max-width: 700px) {
      .stone-row {
        grid-template-columns: 1fr 1fr;
      }
    }
  `,
})
export class ProductDialog {
  private readonly service = inject(InventoryService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  readonly product = input<Product | null>(null);
  readonly materials = input<Material[]>([]);
  /** Piedras en stock que se pueden montar. */
  readonly gems = input<Gem[]>([]);
  readonly saved = output<void>();

  protected readonly categories = PRODUCT_CATEGORY_OPTIONS;
  protected readonly metalColors = METAL_COLOR_OPTIONS;
  protected readonly currencies = CURRENCY_OPTIONS;
  protected readonly roles = GEM_ROLE_OPTIONS;
  protected readonly saving = signal(false);
  protected stones: ProductGem[] = [];
  private file: File | null = null;

  protected readonly metalOptions = computed(() =>
    this.materials()
      .filter((m) => ['ORO', 'PLATA', 'PLATINO', 'OTRO'].includes(m.type))
      .map((m) => ({ value: m.id, label: m.purity && !m.name.includes(m.purity) ? `${m.name} ${m.purity}` : m.name })),
  );

  /** Piedras en stock más las ya montadas en esta joya. */
  protected readonly gemOptions = computed(() => {
    const own = (this.product()?.gems ?? []).map((g) => g.gem).filter((g): g is Gem => !!g);
    const all = [...own, ...this.gems().filter((g) => !own.some((o) => o.id === g.id))];
    return all.map((g) => ({ value: g.id, label: `${g.code} · ${gemSummary(g)}` }));
  });

  protected readonly form = inject(FormBuilder).group({
    code: [''],
    name: ['', [Validators.required, Validators.maxLength(150)]],
    category: ['ANILLO' as ProductCategory, Validators.required],
    material_id: [null as string | null],
    metal_color: [null as MetalColor | null],
    weight_g: [null as number | null],
    size: [''],
    description: [''],
    cost: [0 as number | null],
    price: [null as number | null, Validators.required],
    currency: ['PEN' as Currency],
    quantity: [1 as number | null, [Validators.required, Validators.min(0)]],
  });

  /** Una joya con piedras registradas montadas es única (cantidad 1). */
  protected hasRegisteredGems(): boolean {
    return this.stones.some((s) => !!s.gem_id);
  }

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const p = this.product();
      untracked(() => {
        this.file = null;
        this.stones = (p?.gems ?? []).map((g) => ({ ...g, total_carat: g.total_carat != null ? Number(g.total_carat) : null }));
        this.form.reset(
          p
            ? {
                code: p.code,
                name: p.name,
                category: p.category,
                material_id: p.material_id,
                metal_color: p.metal_color,
                weight_g: p.weight_g != null ? Number(p.weight_g) : null,
                size: p.size ?? '',
                description: p.description ?? '',
                cost: Number(p.cost),
                price: Number(p.price),
                currency: p.currency,
                quantity: p.quantity ?? 1,
              }
            : { code: '', name: '', category: 'ANILLO', cost: 0, price: null, currency: 'PEN', quantity: 1, size: '', description: '' },
        );
      });
    });
  }

  protected addStone(): void {
    this.stones.push({ gem_id: null, role: this.stones.length ? 'LATERAL' : 'CENTRAL', description: '', quantity: 1, total_carat: null });
  }

  protected onFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const stones = this.stones.filter((s) => s.gem_id || s.description?.trim());
    const v = this.form.getRawValue();
    const quantity = Math.trunc(Number(v.quantity ?? 0));
    if (!this.product() && quantity < 1) {
      this.notify.warn('Indique al menos 1 unidad.');
      return;
    }
    if (quantity > 1 && stones.some((s) => s.gem_id)) {
      this.notify.warn('Una joya con piedras registradas es única: la cantidad debe ser 1.');
      return;
    }
    const material = this.materials().find((m) => m.id === v.material_id);
    this.saving.set(true);
    try {
      const id = await this.service.saveProduct(
        this.product()?.id ?? null,
        {
          code: v.code?.trim() || this.product()?.code || '',
          name: v.name!.trim(),
          category: v.category!,
          material_id: v.material_id,
          metal: material ? (material.purity && !material.name.includes(material.purity) ? `${material.name} ${material.purity}` : material.name) : null,
          metal_color: v.metal_color,
          weight_g: v.weight_g,
          size: v.size?.trim() || null,
          description: v.description?.trim() || null,
          cost: Number(v.cost ?? 0),
          price: Number(v.price ?? 0),
          currency: v.currency!,
          quantity,
          notes: null,
        },
        stones,
      );
      if (this.file) await this.service.uploadPhoto('products', id, this.file, this.product()?.photo_path ?? null);
      this.notify.success('Joya guardada.');
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar la joya.');
    } finally {
      this.saving.set(false);
    }
  }
}
