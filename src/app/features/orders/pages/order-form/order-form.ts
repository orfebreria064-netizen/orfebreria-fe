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
import { PRIORITY_OPTIONS, Priority } from '../../../../core/models/domain';
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
import { ItemsEditor } from '../../../quotations/components/items-editor/items-editor';
import { ItemFormGroup, createItemGroup, itemsFromArray } from '../../../quotations/components/items-editor/item-form';
import { OrderHeaderInput } from '../../models/order.model';
import { OrdersService } from '../../services/orders.service';

/** Alta directa (sin cotización) y edición de pedidos. */
@Component({
  selector: 'app-order-form',
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
  templateUrl: './order-form.html',
})
export class OrderForm implements OnInit {
  private readonly service = inject(OrdersService);
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
  protected readonly priorities = PRIORITY_OPTIONS;

  protected readonly items = new FormArray<ItemFormGroup>([]);
  protected readonly form = inject(FormBuilder).group(
    {
      customer_id: [null as string | null, Validators.required],
      service_type_id: [null as string | null, Validators.required],
      priority: ['MEDIA' as Priority, Validators.required],
      title: ['', [Validators.required, Validators.maxLength(160)]],
      description: ['', Validators.maxLength(2000)],
      main_material: [''],
      estimated_weight: [null as number | null, positiveValidator],
      stone: [''],
      size: [''],
      notes: ['', Validators.maxLength(2000)],
      assigned_to: [null as string | null],
      start_date: [new Date() as Date | null, Validators.required],
      due_date: [null as Date | null],
      tax_rate: [18 as number | null, [Validators.required, Validators.min(0), Validators.max(100)]],
    },
    { validators: dateRangeValidator('start_date', 'due_date', 'La entrega no puede ser anterior a la fecha de inicio.') },
  );

  async ngOnInit(): Promise<void> {
    try {
      const [, materials] = await Promise.all([this.lookups.ensureLoaded(), this.materialsService.list()]);
      this.materials.set(materials);
      const id = this.id();
      if (id) await this.loadOrder(id);
      else {
        this.form.patchValue({
          customer_id: this.route.snapshot.queryParamMap.get('customer'),
          tax_rate: this.lookups.taxRate(),
        });
        this.items.push(createItemGroup());
      }
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el formulario.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadOrder(id: string): Promise<void> {
    const o = await this.service.get(id);
    if (['CERRADO', 'CANCELADO'].includes(o.status)) {
      this.notify.warn('El pedido está cerrado o cancelado y no puede editarse.');
      void this.router.navigate(['/orders', id]);
      return;
    }
    this.number.set(o.number);
    this.breadcrumb.setDetail(`Editar · ${o.number}`);
    this.form.patchValue({
      customer_id: o.customer_id,
      service_type_id: o.service_type_id,
      priority: o.priority,
      title: o.title,
      description: o.description ?? '',
      main_material: o.main_material ?? '',
      estimated_weight: o.estimated_weight != null ? Number(o.estimated_weight) : null,
      stone: o.stone ?? '',
      size: o.size ?? '',
      notes: o.notes ?? '',
      assigned_to: o.assigned_to,
      start_date: fromIsoDate(o.start_date),
      due_date: fromIsoDate(o.due_date),
      tax_rate: Number(o.tax_rate),
    });
    this.items.clear();
    o.items.forEach((item) => this.items.push(createItemGroup(item)));
  }

  protected taxRate(): number {
    return Number(this.form.controls.tax_rate.value ?? 0);
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
    const header: OrderHeaderInput = {
      customer_id: v.customer_id!,
      service_type_id: v.service_type_id!,
      priority: v.priority ?? 'MEDIA',
      title: v.title!.trim(),
      description: v.description?.trim() || null,
      main_material: v.main_material?.trim() || null,
      estimated_weight: v.estimated_weight,
      stone: v.stone?.trim() || null,
      size: v.size?.trim() || null,
      notes: v.notes?.trim() || null,
      assigned_to: v.assigned_to,
      start_date: toIsoDate(v.start_date)!,
      due_date: toIsoDate(v.due_date),
      tax_rate: Number(v.tax_rate),
    };
    try {
      const id = await this.service.save(this.id() ?? null, header, itemsFromArray(this.items));
      this.notify.success(this.id() ? 'Pedido actualizado correctamente.' : 'Pedido creado correctamente.');
      void this.router.navigate(['/orders', id]);
    } catch (err) {
      this.notify.error(err, this.id() ? 'No se pudo actualizar el pedido.' : 'No se pudo registrar el pedido.');
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/orders', id] : ['/orders']);
  }
}
