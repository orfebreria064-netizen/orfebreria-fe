import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import {
  MOVEMENT_TYPE_LABELS,
  MaterialOwnership,
  MovementType,
  OWNERSHIP_OPTIONS,
} from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { QtyPipe } from '../../../../shared/pipes/qty.pipe';
import { toIsoDate } from '../../../../shared/utils/db';
import { OrderPicker } from '../../../orders/components/order-picker/order-picker';
import { ClientMaterialBalance, Material } from '../../models/material.model';
import { MaterialsService } from '../../services/materials.service';

const COMPANY_TYPES: MovementType[] = ['ENTRADA', 'SALIDA', 'AJUSTE', 'CONSUMO', 'DEVOLUCION'];
const CLIENT_TYPES: MovementType[] = ['ENTRADA', 'CONSUMO', 'DEVOLUCION'];
const ORDER_REQUIRED: MovementType[] = ['CONSUMO'];
const OUTGOING: MovementType[] = ['SALIDA', 'CONSUMO'];

const CLIENT_LABELS: Partial<Record<MovementType, string>> = {
  ENTRADA: 'Recepción del cliente',
  CONSUMO: 'Consumo en el pedido',
  DEVOLUCION: 'Devolución al cliente',
};

/**
 * Registro de movimientos de material (entrada, salida, ajuste, consumo, devolución) de la empresa
 * o del cliente. La base de datos valida stock / saldo suficiente y actualiza el stock.
 */
@Component({
  selector: 'app-movement-dialog',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    SelectButtonModule,
    InputNumberModule,
    DatePickerModule,
    TextareaModule,
    MessageModule,
    FieldError,
    QtyPipe,
    OrderPicker,
  ],
  templateUrl: './movement-dialog.html',
})
export class MovementDialog {
  private readonly service = inject(MaterialsService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  /** Pedido fijo (desde la ficha del pedido). */
  readonly orderId = input<string | null>(null);
  /** Material fijo (desde el kardex). */
  readonly materialId = input<string | null>(null);
  readonly saved = output<void>();

  protected readonly materials = signal<Material[]>([]);
  protected readonly clientBalances = signal<ClientMaterialBalance[]>([]);
  protected readonly saving = signal(false);
  protected readonly ownershipOptions = OWNERSHIP_OPTIONS;
  protected readonly adjustSign = signal<1 | -1>(1);
  protected readonly signOptions = [
    { label: 'Aumentar (+)', value: 1 },
    { label: 'Disminuir (−)', value: -1 },
  ];

  protected readonly form = inject(FormBuilder).group({
    ownership: ['EMPRESA' as MaterialOwnership, Validators.required],
    movement_type: ['CONSUMO' as MovementType, Validators.required],
    material_id: [null as string | null, Validators.required],
    order_id: [null as string | null],
    quantity: [null as number | null, [Validators.required, Validators.min(0.001)]],
    unit_cost: [null as number | null, Validators.min(0)],
    movement_date: [new Date() as Date | null, Validators.required],
    notes: ['', Validators.maxLength(500)],
  });

  private readonly tick = toSignal(this.form.valueChanges);

  /** Valor crudo del formulario como dependencia reactiva (incluye controles deshabilitados). */
  private value() {
    this.tick();
    return this.form.getRawValue();
  }

  protected readonly typeOptions = computed(() => {
    const v = this.value();
    const hasOrder = !!(this.orderId() || v.order_id);
    const types = v.ownership === 'CLIENTE' ? CLIENT_TYPES : COMPANY_TYPES;
    return types
      .filter((t) => hasOrder || v.ownership === 'CLIENTE' || !ORDER_REQUIRED.includes(t))
      .map((t) => ({ value: t, label: (v.ownership === 'CLIENTE' && CLIENT_LABELS[t]) || MOVEMENT_TYPE_LABELS[t] }));
  });

  protected readonly material = computed(() => this.materials().find((m) => m.id === this.value().material_id) ?? null);

  protected readonly needsOrder = computed(() => {
    const v = this.value();
    return v.ownership === 'CLIENTE' || ORDER_REQUIRED.includes(v.movement_type as MovementType);
  });

  protected readonly clientBalance = computed(() => {
    const v = this.value();
    return this.clientBalances().find((b) => b.material_id === v.material_id) ?? null;
  });

  /** Advertencia previa (la validación definitiva la hace PostgreSQL). */
  protected readonly availabilityWarning = computed(() => {
    const v = this.value();
    const m = this.material();
    const qty = Number(v.quantity ?? 0);
    if (!m || !qty) return null;
    if (v.ownership === 'EMPRESA') {
      const outgoing = OUTGOING.includes(v.movement_type as MovementType) || (v.movement_type === 'AJUSTE' && this.adjustSign() < 0);
      if (outgoing && qty > Number(m.stock)) {
        return `Stock insuficiente: disponible ${Number(m.stock).toFixed(2)} ${m.unit}.`;
      }
    } else if (v.movement_type !== 'ENTRADA') {
      const balance = Number(this.clientBalance()?.balance ?? 0);
      if (qty > balance) return `El saldo de material del cliente es ${balance.toFixed(2)} ${m.unit}.`;
    }
    return null;
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      this.reset();
      void this.loadData();
    });
    this.form.controls.ownership.valueChanges.subscribe((ownership) => {
      const allowed = ownership === 'CLIENTE' ? CLIENT_TYPES : COMPANY_TYPES;
      if (!allowed.includes(this.form.controls.movement_type.value as MovementType)) {
        this.form.controls.movement_type.setValue(ownership === 'CLIENTE' ? 'ENTRADA' : 'CONSUMO');
      }
    });
  }

  private reset(): void {
    const fixedOrder = this.orderId();
    this.adjustSign.set(1);
    this.form.reset({
      ownership: 'EMPRESA',
      movement_type: fixedOrder ? 'CONSUMO' : 'ENTRADA',
      material_id: this.materialId(),
      order_id: fixedOrder,
      quantity: null,
      unit_cost: null,
      movement_date: new Date(),
      notes: '',
    });
    if (this.materialId()) this.form.controls.material_id.disable();
    else this.form.controls.material_id.enable();
  }

  private async loadData(): Promise<void> {
    try {
      this.materials.set(await this.service.list());
      const orderId = this.orderId();
      this.clientBalances.set(orderId ? await this.service.clientBalances(orderId) : []);
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los materiales.');
    }
  }

  protected async onOrderSelected(orderId: string | null): Promise<void> {
    try {
      this.clientBalances.set(orderId ? await this.service.clientBalances(orderId) : []);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el saldo del cliente.');
    }
  }

  protected materialLabel(m: Material): string {
    return `${m.name} · stock ${Number(m.stock).toFixed(2)} ${m.unit}`;
  }

  async save(): Promise<void> {
    const v = this.form.getRawValue();
    const orderId = this.orderId() ?? v.order_id;
    if (this.needsOrder() && !orderId) {
      this.form.controls.order_id.setErrors({ required: true });
      this.form.controls.order_id.markAsTouched();
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const qty = Number(v.quantity) * (v.movement_type === 'AJUSTE' ? this.adjustSign() : 1);
      await this.service.addMovement({
        material_id: v.material_id!,
        order_id: orderId ?? null,
        movement_type: v.movement_type!,
        ownership: v.ownership!,
        quantity: qty,
        unit_cost: v.unit_cost,
        movement_date: toIsoDate(v.movement_date)!,
        notes: v.notes?.trim() || null,
      });
      this.notify.success('Movimiento de material registrado correctamente.');
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el movimiento.');
    } finally {
      this.saving.set(false);
    }
  }
}
