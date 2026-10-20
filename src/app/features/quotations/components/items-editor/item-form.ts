import { AbstractControl, FormArray, FormControl, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { positiveValidator } from '../../../../shared/utils/validators';
import { QuotationItem } from '../../models/quotation.model';

export type ItemFormGroup = FormGroup<{
  description: FormControl<string>;
  detail: FormControl<string>;
  material_id: FormControl<string | null>;
  material_name: FormControl<string | null>;
  quantity: FormControl<number | null>;
  unit: FormControl<string>;
  weight: FormControl<number | null>;
  unit_price: FormControl<number | null>;
  discount: FormControl<number | null>;
}>;

export const UNIT_OPTIONS = [
  { value: 'und', label: 'Unidad' },
  { value: 'par', label: 'Par' },
  { value: 'g', label: 'Gramos' },
  { value: 'ct', label: 'Quilates' },
  { value: 'servicio', label: 'Servicio' },
];

/** El descuento de una línea no puede superar su importe bruto. */
function discountWithinLine(group: AbstractControl): ValidationErrors | null {
  const qty = Number(group.get('quantity')?.value ?? 0);
  const price = Number(group.get('unit_price')?.value ?? 0);
  const discount = Number(group.get('discount')?.value ?? 0);
  return discount > Math.round(qty * price * 100) / 100 ? { discount: 'El descuento supera el importe de la línea.' } : null;
}

export function createItemGroup(item?: Partial<QuotationItem>): ItemFormGroup {
  return new FormGroup(
    {
      description: new FormControl(item?.description ?? '', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(200)],
      }),
      detail: new FormControl(item?.detail ?? '', { nonNullable: true, validators: [Validators.maxLength(500)] }),
      material_id: new FormControl(item?.material_id ?? null),
      material_name: new FormControl(item?.material_name ?? null),
      quantity: new FormControl(item?.quantity != null ? Number(item.quantity) : 1, [Validators.required, positiveValidator]),
      unit: new FormControl(item?.unit ?? 'und', { nonNullable: true }),
      weight: new FormControl(item?.weight != null ? Number(item.weight) : null, [Validators.min(0)]),
      unit_price: new FormControl(item?.unit_price != null ? Number(item.unit_price) : null, [
        Validators.required,
        Validators.min(0),
      ]),
      discount: new FormControl(item?.discount != null ? Number(item.discount) : 0, [Validators.min(0)]),
    },
    { validators: discountWithinLine },
  ) as ItemFormGroup;
}

export function itemsFromArray(array: FormArray<ItemFormGroup>): QuotationItem[] {
  return array.getRawValue().map((v, i) => ({
    position: i,
    description: v.description.trim(),
    detail: v.detail?.trim() || null,
    material_id: v.material_id,
    material_name: v.material_name,
    quantity: Number(v.quantity),
    unit: v.unit,
    weight: v.weight ? Number(v.weight) : null,
    unit_price: Number(v.unit_price ?? 0),
    discount: Number(v.discount ?? 0),
  }));
}
