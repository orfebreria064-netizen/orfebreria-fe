import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { SkeletonModule } from 'primeng/skeleton';
import { CURRENCY_OPTIONS, Currency } from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { BreadcrumbService } from '../../../../layout/breadcrumb.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { fromIsoDate, toIsoDate } from '../../../../shared/utils/db';
import { dateRangeValidator, positiveValidator } from '../../../../shared/utils/validators';
import { CustomerPicker } from '../../../customers/components/customer-picker/customer-picker';
import { Material } from '../../../materials/models/material.model';
import { MaterialsService } from '../../../materials/services/materials.service';
import { ItemsEditor } from '../../components/items-editor/items-editor';
import { ItemFormGroup, createItemGroup, itemsFromArray } from '../../components/items-editor/item-form';
import { QuotationHeaderInput } from '../../models/quotation.model';
import { QuotationsService } from '../../services/quotations.service';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Alta y edición de cotizaciones (cabecera + ítems + totales). */
@Component({
  selector: 'app-quotation-form',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    TextareaModule,
    SkeletonModule,
    PageHeader,
    FieldError,
    CustomerPicker,
    ItemsEditor,
  ],
  templateUrl: './quotation-form.html',
})
export class QuotationForm implements OnInit {
  private readonly service = inject(QuotationsService);
  private readonly materialsService = inject(MaterialsService);
  protected readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly breadcrumb = inject(BreadcrumbService);

  readonly id = input<string>();

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly materials = signal<Material[]>([]);
  protected readonly number = signal<string | null>(null);

  protected readonly currencies = CURRENCY_OPTIONS;
  protected readonly items = new FormArray<ItemFormGroup>([]);
  protected readonly form = inject(FormBuilder).group(
    {
      customer_id: [null as string | null, Validators.required],
      service_type_id: [null as string | null, Validators.required],
      issue_date: [new Date() as Date | null, Validators.required],
      expiry_date: [addDays(new Date(), 15) as Date | null, Validators.required],
      title: ['', [Validators.required, Validators.maxLength(160)]],
      main_material: [''],
      estimated_weight: [null as number | null, positiveValidator],
      stone: [''],
      size: [''],
      notes: ['', Validators.maxLength(2000)],
      terms: ['', Validators.maxLength(2000)],
      tax_rate: [18 as number | null, [Validators.required, Validators.min(0), Validators.max(100)]],
      currency: ['PEN' as Currency, Validators.required],
    },
    { validators: dateRangeValidator('issue_date', 'expiry_date', 'El vencimiento no puede ser anterior a la fecha de emisión.') },
  );

  async ngOnInit(): Promise<void> {
    try {
      const [, materials] = await Promise.all([this.lookups.ensureLoaded(), this.materialsService.list()]);
      this.materials.set(materials);
      const id = this.id();
      if (id) await this.loadQuotation(id);
      else this.initNew();
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el formulario.');
    } finally {
      this.loading.set(false);
    }
  }

  private initNew(): void {
    const settings = this.lookups.settings();
    const validity = settings?.quote_validity_days ?? 15;
    const fabrication = this.lookups.activeServiceTypes().find((t) => t.code === 'FABRICACION');
    this.form.patchValue({
      customer_id: this.route.snapshot.queryParamMap.get('customer'),
      service_type_id: fabrication?.id ?? null,
      expiry_date: addDays(new Date(), validity),
      terms: settings?.default_terms ?? '',
      tax_rate: this.lookups.taxRate(),
      currency: settings?.currency === 'USD' ? 'USD' : 'PEN',
    });
    this.items.push(createItemGroup());
  }

  private async loadQuotation(id: string): Promise<void> {
    const q = await this.service.get(id);
    if (!['BORRADOR', 'ENVIADA'].includes(q.status)) {
      this.notify.warn('Solo se pueden editar cotizaciones en estado Borrador o Enviada.');
      void this.router.navigate(['/quotations', id]);
      return;
    }
    this.number.set(q.number);
    this.breadcrumb.setDetail(`Editar · ${q.number}`);
    this.form.patchValue({
      customer_id: q.customer_id,
      service_type_id: q.service_type_id,
      issue_date: fromIsoDate(q.issue_date),
      expiry_date: fromIsoDate(q.expiry_date),
      title: q.title,
      main_material: q.main_material ?? '',
      estimated_weight: q.estimated_weight != null ? Number(q.estimated_weight) : null,
      stone: q.stone ?? '',
      size: q.size ?? '',
      notes: q.notes ?? '',
      terms: q.terms ?? '',
      tax_rate: Number(q.tax_rate),
      currency: q.currency ?? 'PEN',
    });
    this.items.clear();
    q.items.forEach((item) => this.items.push(createItemGroup(item)));
  }

  protected taxRate(): number {
    return Number(this.form.controls.tax_rate.value ?? 0);
  }

  protected currency(): string {
    return this.form.controls.currency.value ?? 'PEN';
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.items.invalid) {
      this.form.markAllAsTouched();
      this.items.markAllAsTouched();
      this.notify.warn('Revise los campos marcados antes de guardar.');
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    const header: QuotationHeaderInput = {
      customer_id: v.customer_id!,
      service_type_id: v.service_type_id!,
      issue_date: toIsoDate(v.issue_date)!,
      expiry_date: toIsoDate(v.expiry_date)!,
      title: v.title!.trim(),
      main_material: v.main_material?.trim() || null,
      estimated_weight: v.estimated_weight,
      stone: v.stone?.trim() || null,
      size: v.size?.trim() || null,
      notes: v.notes?.trim() || null,
      terms: v.terms?.trim() || null,
      tax_rate: Number(v.tax_rate),
      currency: v.currency ?? 'PEN',
    };
    try {
      const id = await this.service.save(this.id() ?? null, header, itemsFromArray(this.items));
      this.notify.success(this.id() ? 'Cotización actualizada correctamente.' : 'Cotización creada correctamente.');
      void this.router.navigate(['/quotations', id]);
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar la cotización.');
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/quotations', id] : ['/quotations']);
  }
}
