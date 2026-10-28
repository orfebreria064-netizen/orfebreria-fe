import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { CURRENCY_OPTIONS, Currency } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { positiveValidator } from '../../../../shared/utils/validators';
import { CustomerPicker } from '../../../customers/components/customer-picker/customer-picker';
import {
  CLARITY_OPTIONS,
  Clarity,
  DIAMOND_COLOR_OPTIONS,
  FLUORESCENCE_OPTIONS,
  Fluorescence,
  GEM_SHAPE_OPTIONS,
  GEM_TYPE_OPTIONS,
  GRADE_OPTIONS,
  Gem,
  GemShape,
  GemType,
  Grade,
  InventoryService,
  LAB_OPTIONS,
} from '../../services/inventory.service';

/** Alta y edición de una piedra con las 4C (escala GIA) y su certificado. */
@Component({
  selector: 'app-gem-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    SelectButtonModule,
    SelectModule,
    TextareaModule,
    FieldError,
    CustomerPicker,
  ],
  template: `
    <p-dialog [header]="gem() ? 'Piedra ' + gem()!.code : 'Nueva piedra'" [(visible)]="visible" [modal]="true" [style]="{ width: '760px' }" [breakpoints]="{ '800px': '96vw' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h3 class="section-title">Identificación</h3>
        <div class="form-grid form-grid--3">
          <div class="field">
            <label for="gm-type">Tipo <span class="req">*</span></label>
            <p-select inputId="gm-type" [options]="types" formControlName="gem_type" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-shape">Forma <span class="req">*</span></label>
            <p-select inputId="gm-shape" [options]="shapes" formControlName="shape" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-code">Código</label>
            <input pInputText id="gm-code" formControlName="code" placeholder="Automático (PD-000001)" />
          </div>
        </div>

        <h3 class="section-title">Las 4C</h3>
        <div class="form-grid form-grid--4">
          <div class="field">
            <label for="gm-carat">Quilates (ct) <span class="req">*</span></label>
            <p-inputnumber inputId="gm-carat" formControlName="carat" [minFractionDigits]="2" [maxFractionDigits]="3" [min]="0" suffix=" ct" [fluid]="true" />
            <app-field-error [control]="form.controls.carat" />
          </div>
          <div class="field">
            <label for="gm-color">Color</label>
            @if (isDiamond()) {
              <p-select inputId="gm-color" [options]="colors" formControlName="color" optionLabel="label" optionValue="value" [showClear]="true" placeholder="D – Z" appendTo="body" />
            } @else {
              <input pInputText id="gm-color" formControlName="color" placeholder="Ej.: verde intenso" />
            }
          </div>
          <div class="field">
            <label for="gm-clarity">Claridad</label>
            <p-select inputId="gm-clarity" [options]="clarities" formControlName="clarity" optionLabel="label" optionValue="value" [showClear]="true" placeholder="FL – I3" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-cut">Talla (cut)</label>
            <p-select inputId="gm-cut" [options]="grades" formControlName="cut_grade" optionLabel="label" optionValue="value" [showClear]="true" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-polish">Pulido</label>
            <p-select inputId="gm-polish" [options]="grades" formControlName="polish" optionLabel="label" optionValue="value" [showClear]="true" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-sym">Simetría</label>
            <p-select inputId="gm-sym" [options]="grades" formControlName="symmetry" optionLabel="label" optionValue="value" [showClear]="true" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-fluo">Fluorescencia</label>
            <p-select inputId="gm-fluo" [options]="fluorescences" formControlName="fluorescence" optionLabel="label" optionValue="value" [showClear]="true" appendTo="body" />
          </div>
          <div class="field">
            <label>Medidas (mm)</label>
            <div class="mm">
              <p-inputnumber formControlName="length_mm" [maxFractionDigits]="2" [min]="0" placeholder="L" ariaLabel="Largo en mm" [fluid]="true" />
              <p-inputnumber formControlName="width_mm" [maxFractionDigits]="2" [min]="0" placeholder="A" ariaLabel="Ancho en mm" [fluid]="true" />
              <p-inputnumber formControlName="depth_mm" [maxFractionDigits]="2" [min]="0" placeholder="P" ariaLabel="Profundidad en mm" [fluid]="true" />
            </div>
          </div>
        </div>

        <h3 class="section-title">Certificado y procedencia</h3>
        <div class="form-grid form-grid--3">
          <div class="field">
            <label for="gm-lab">Laboratorio</label>
            <p-select inputId="gm-lab" [options]="labs" formControlName="lab" optionLabel="label" optionValue="value" [showClear]="true" placeholder="Sin certificado" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-cert">N.° de certificado</label>
            <input pInputText id="gm-cert" formControlName="certificate_number" />
          </div>
          <div class="field">
            <label>Propietario</label>
            <p-selectbutton [options]="origins" formControlName="origin" optionLabel="label" optionValue="value" [allowEmpty]="false" />
          </div>
          @if (form.controls.origin.value === 'CLIENTE') {
            <div class="field field--full">
              <label for="gm-customer">Cliente dueño de la piedra <span class="req">*</span></label>
              <app-customer-picker inputId="gm-customer" formControlName="customer_id" />
            </div>
          }
        </div>

        <h3 class="section-title">Precio</h3>
        <div class="form-grid form-grid--3">
          <div class="field">
            <label for="gm-cur">Moneda</label>
            <p-select inputId="gm-cur" [options]="currencies" formControlName="currency" optionLabel="label" optionValue="value" appendTo="body" />
          </div>
          <div class="field">
            <label for="gm-cost">Costo</label>
            <p-inputnumber inputId="gm-cost" formControlName="cost" mode="currency" [currency]="form.controls.currency.value ?? 'PEN'" locale="es-PE" [min]="0" [fluid]="true" />
          </div>
          <div class="field">
            <label for="gm-price">Precio de venta</label>
            <p-inputnumber inputId="gm-price" formControlName="price" mode="currency" [currency]="form.controls.currency.value ?? 'PEN'" locale="es-PE" [min]="0" [fluid]="true" />
          </div>
          <div class="field field--full">
            <label for="gm-notes">Notas</label>
            <textarea pTextarea id="gm-notes" formControlName="notes" rows="2" [autoResize]="true"></textarea>
          </div>
          <div class="field field--full">
            <label for="gm-photo">Foto</label>
            <input id="gm-photo" type="file" accept="image/jpeg,image/png,image/webp" (change)="onFile($event)" />
          </div>
        </div>

        <div class="form-actions">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>
  `,
  styles: `
    .mm {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.3rem;
    }
  `,
})
export class GemDialog {
  private readonly service = inject(InventoryService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  readonly gem = input<Gem | null>(null);
  readonly saved = output<void>();

  protected readonly types = GEM_TYPE_OPTIONS;
  protected readonly shapes = GEM_SHAPE_OPTIONS;
  protected readonly colors = DIAMOND_COLOR_OPTIONS;
  protected readonly clarities = CLARITY_OPTIONS;
  protected readonly grades = GRADE_OPTIONS;
  protected readonly fluorescences = FLUORESCENCE_OPTIONS;
  protected readonly labs = LAB_OPTIONS;
  protected readonly currencies = CURRENCY_OPTIONS;
  protected readonly origins = [
    { value: 'EMPRESA', label: 'Empresa' },
    { value: 'CLIENTE', label: 'Cliente' },
  ];
  protected readonly saving = signal(false);
  private file: File | null = null;

  protected readonly form = inject(FormBuilder).group({
    code: [''],
    gem_type: ['DIAMANTE' as GemType, Validators.required],
    shape: ['REDONDO' as GemShape, Validators.required],
    carat: [null as number | null, [Validators.required, positiveValidator]],
    color: [null as string | null],
    clarity: [null as Clarity | null],
    cut_grade: [null as Grade | null],
    polish: [null as Grade | null],
    symmetry: [null as Grade | null],
    fluorescence: [null as Fluorescence | null],
    length_mm: [null as number | null],
    width_mm: [null as number | null],
    depth_mm: [null as number | null],
    lab: [null as string | null],
    certificate_number: [''],
    origin: ['EMPRESA' as 'EMPRESA' | 'CLIENTE'],
    customer_id: [null as string | null],
    cost: [0 as number | null],
    price: [0 as number | null],
    currency: ['USD' as Currency],
    notes: [''],
  });

  protected isDiamond(): boolean {
    return this.form.controls.gem_type.value === 'DIAMANTE';
  }

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const g = this.gem();
      untracked(() => {
        this.file = null;
        this.form.reset(
          g
            ? {
                ...g,
                carat: Number(g.carat),
                cost: Number(g.cost),
                price: Number(g.price),
                length_mm: g.length_mm != null ? Number(g.length_mm) : null,
                width_mm: g.width_mm != null ? Number(g.width_mm) : null,
                depth_mm: g.depth_mm != null ? Number(g.depth_mm) : null,
                certificate_number: g.certificate_number ?? '',
                notes: g.notes ?? '',
              }
            : { gem_type: 'DIAMANTE', shape: 'REDONDO', origin: 'EMPRESA', currency: 'USD', cost: 0, price: 0, code: '', certificate_number: '', notes: '' },
        );
      });
    });
    // Al cambiar de diamante a gema de color (o al revés) el color deja de ser válido.
    this.form.controls.gem_type.valueChanges.subscribe(() => this.form.controls.color.setValue(null));
  }

  protected onFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (v.origin === 'CLIENTE' && !v.customer_id) {
      this.notify.warn('Seleccione el cliente dueño de la piedra.');
      return;
    }
    this.saving.set(true);
    try {
      const id = await this.service.saveGem(this.gem()?.id ?? null, {
        code: v.code?.trim() || this.gem()?.code || '',
        gem_type: v.gem_type!,
        shape: v.shape!,
        carat: Number(v.carat),
        color: v.color?.trim() || null,
        clarity: v.clarity,
        cut_grade: v.cut_grade,
        polish: v.polish,
        symmetry: v.symmetry,
        fluorescence: v.fluorescence,
        length_mm: v.length_mm,
        width_mm: v.width_mm,
        depth_mm: v.depth_mm,
        lab: v.lab,
        certificate_number: v.certificate_number?.trim() || null,
        origin: v.origin!,
        customer_id: v.origin === 'CLIENTE' ? v.customer_id : null,
        cost: Number(v.cost ?? 0),
        price: Number(v.price ?? 0),
        currency: v.currency!,
        notes: v.notes?.trim() || null,
      });
      if (this.file) await this.service.uploadPhoto('gems', id, this.file, this.gem()?.photo_path ?? null);
      this.notify.success('Piedra guardada.');
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar la piedra.');
    } finally {
      this.saving.set(false);
    }
  }
}
