import { Component, computed, effect, inject, input, model, output, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { DELIVERY_STATUS_OPTIONS, DeliveryStatus } from '../../../../core/models/domain';
import { AuthService } from '../../../../core/auth/auth.service';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { SignaturePad } from '../../../../shared/components/signature-pad/signature-pad';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { fromIsoDate, toIsoDate } from '../../../../shared/utils/db';
import { Order, OrderRow } from '../../../orders/models/order.model';
import { OrderPicker } from '../../../orders/components/order-picker/order-picker';
import { OrdersService } from '../../../orders/services/orders.service';
import { Delivery } from '../../models/delivery.model';
import { DeliveriesService } from '../../services/deliveries.service';

type OrderInfo = Pick<Order, 'id' | 'number' | 'title' | 'total' | 'amount_paid' | 'balance' | 'qc_approved' | 'status'>;

/** Programar o registrar una entrega (conformidad, receptor y firma opcional). */
@Component({
  selector: 'app-delivery-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    SelectButtonModule,
    InputTextModule,
    DatePickerModule,
    TextareaModule,
    MessageModule,
    FieldError,
    SignaturePad,
    MoneyPipe,
    OrderPicker,
  ],
  templateUrl: './delivery-dialog.html',
})
export class DeliveryDialog {
  private readonly service = inject(DeliveriesService);
  private readonly orders = inject(OrdersService);
  protected readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  readonly visible = model(false);
  readonly orderId = input<string | null>(null);
  readonly delivery = input<Delivery | null>(null);
  /** Abre el diálogo directamente en modo "registrar entrega realizada". */
  readonly markDelivered = input(false);
  readonly saved = output<void>();

  private readonly signature = viewChild(SignaturePad);

  protected readonly order = signal<OrderInfo | null>(null);
  protected readonly saving = signal(false);
  protected readonly statusOptions = DELIVERY_STATUS_OPTIONS;
  protected readonly conformityOptions = [
    { label: 'Conforme', value: true },
    { label: 'No conforme', value: false },
  ];

  protected readonly form = inject(FormBuilder).group({
    order_id: [null as string | null, Validators.required],
    status: ['PENDIENTE' as DeliveryStatus, Validators.required],
    scheduled_date: [new Date() as Date | null, Validators.required],
    delivered_at: [null as Date | null],
    responsible_id: [null as string | null],
    received_by: ['', Validators.maxLength(120)],
    conformity: [null as boolean | null],
    conformity_notes: ['', Validators.maxLength(500)],
    notes: ['', Validators.maxLength(500)],
  });

  private readonly status = toSignal(this.form.controls.status.valueChanges, { initialValue: 'PENDIENTE' as DeliveryStatus | null });
  protected readonly isDelivered = computed(() => this.status() === 'ENTREGADA');

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const d = this.delivery();
      const fixedOrder = d?.order_id ?? this.orderId();
      this.form.reset({
        order_id: fixedOrder,
        status: this.markDelivered() ? 'ENTREGADA' : (d?.status ?? 'PENDIENTE'),
        scheduled_date: fromIsoDate(d?.scheduled_date) ?? new Date(),
        delivered_at: d?.delivered_at ? new Date(d.delivered_at) : this.markDelivered() ? new Date() : null,
        responsible_id: d?.responsible_id ?? this.auth.profile()?.id ?? null,
        received_by: d?.received_by ?? '',
        conformity: d?.conformity ?? (this.markDelivered() ? true : null),
        conformity_notes: d?.conformity_notes ?? '',
        notes: d?.notes ?? '',
      });
      this.order.set(null);
      if (fixedOrder) void this.loadOrder(fixedOrder);
    });
    this.form.controls.status.valueChanges.subscribe((status) => {
      const { conformity, delivered_at } = this.form.controls;
      if (status === 'ENTREGADA') {
        conformity.addValidators(Validators.required);
        if (!delivered_at.value) delivered_at.setValue(new Date());
      } else {
        conformity.removeValidators(Validators.required);
      }
      conformity.updateValueAndValidity();
    });
  }

  private async loadOrder(id: string): Promise<void> {
    try {
      this.order.set(await this.orders.get(id));
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el pedido.');
    }
  }

  protected setOrder(o: OrderRow | null): void {
    this.order.set(o);
  }

  protected readonly isEdit = computed(() => this.delivery() !== null);

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    try {
      const saved = await this.service.save(this.delivery()?.id ?? null, {
        order_id: v.order_id!,
        status: v.status!,
        scheduled_date: toIsoDate(v.scheduled_date)!,
        delivered_at: v.status === 'ENTREGADA' && v.delivered_at ? v.delivered_at.toISOString() : null,
        responsible_id: v.responsible_id,
        received_by: v.received_by?.trim() || null,
        conformity: v.conformity,
        conformity_notes: v.conformity_notes?.trim() || null,
        notes: v.notes?.trim() || null,
      });

      const signature = await this.signature()?.toBlob();
      if (signature) {
        try {
          await this.service.saveSignature(saved, signature);
        } catch (err) {
          this.notify.error(err, 'La entrega se guardó, pero no se pudo guardar la firma.');
        }
      }

      const balance = Number(this.order()?.balance ?? 0);
      if (v.status === 'ENTREGADA') {
        this.notify.success('Entrega registrada correctamente.');
        if (balance > 0) this.notify.warn(`El pedido tiene un saldo pendiente de ${formatMoney(balance)}.`);
      } else {
        this.notify.success(this.isEdit() ? 'Entrega actualizada.' : 'Entrega programada correctamente.');
      }
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar la entrega.');
    } finally {
      this.saving.set(false);
    }
  }
}
