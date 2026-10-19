import { Component, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { PAYMENT_METHOD_LABELS } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { fromIsoDate, toIsoDate } from '../../../../shared/utils/db';
import { dateRangeValidator } from '../../../../shared/utils/validators';
import { JewelerDialog } from '../../../jewelers/components/jeweler-dialog/jeweler-dialog';
import { JewelerPaymentDialog } from '../../../jewelers/components/jeweler-payment-dialog/jeweler-payment-dialog';
import { Jeweler, JewelerPayment } from '../../../jewelers/models/jeweler.model';
import { JewelersService } from '../../../jewelers/services/jewelers.service';
import { ReceiptPdfService } from '../../../payments/services/receipt-pdf.service';
import { OrderDetail } from '../../models/order.model';
import { OrderDocumentsService } from '../../services/order-documents.service';
import { OrdersService } from '../../services/orders.service';

/**
 * Pestaña "Taller" del pedido: orden de producción para el joyero externo (manufactura y acabado),
 * control de peso y merma, y los pagos al joyero con su recibo de egreso.
 */
@Component({
  selector: 'app-order-workshop',
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    TextareaModule,
    TableModule,
    TagModule,
    DialogModule,
    TooltipModule,
    EmptyState,
    FieldError,
    LabelPipe,
    MoneyPipe,
    JewelerDialog,
    JewelerPaymentDialog,
  ],
  template: `
    @let o = order();
    <div class="row row--between" style="margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem">
      <div>
        <h3 class="section-title" style="margin: 0">Orden de producción</h3>
        <small class="muted">
          {{ o.production_number ? 'N.° ' + o.production_number : 'Se numera al imprimirla por primera vez' }}
        </small>
      </div>
      <p-button label="Imprimir orden de producción" icon="pi pi-print" severity="secondary" [outlined]="true" [loading]="printing()" (onClick)="printOrder()" />
    </div>

    <form [formGroup]="form" (ngSubmit)="save()" class="form-grid form-grid--3" novalidate>
      <div class="field field--span-2">
        <label for="ws-jeweler">Joyero</label>
        <div class="row" style="gap: 0.5rem">
          <p-select inputId="ws-jeweler" [options]="activeJewelers()" formControlName="jeweler_id" optionLabel="full_name" optionValue="id" placeholder="Sin asignar" [showClear]="true" [filter]="true" filterBy="full_name" appendTo="body" style="flex: 1" />
          @if (canManageJewelers && editable()) {
            <p-button icon="pi pi-plus" severity="secondary" [outlined]="true" ariaLabel="Nuevo joyero" pTooltip="Nuevo joyero" (onClick)="jewelerDialog.set(true)" />
          }
        </div>
      </div>
      <div class="field">
        <label for="ws-material-date">Entrega del material</label>
        <p-datepicker inputId="ws-material-date" formControlName="material_delivered_at" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" [fluid]="true" />
      </div>
      <div class="field">
        <label for="ws-weight-out">Peso entregado al joyero (g)</label>
        <p-inputnumber inputId="ws-weight-out" formControlName="material_weight_out" [minFractionDigits]="0" [maxFractionDigits]="2" [min]="0" suffix=" g" locale="es-PE" [fluid]="true" />
      </div>
      <div class="field">
        <label for="ws-product-date">Entrega del producto (acabado)</label>
        <p-datepicker inputId="ws-product-date" formControlName="product_delivered_at" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" [fluid]="true" />
        <app-field-error [control]="form.controls.product_delivered_at" groupErrorKey="dateRange" />
      </div>
      <div class="field">
        <label for="ws-weight-ret">Peso del producto entregado (g)</label>
        <p-inputnumber inputId="ws-weight-ret" formControlName="weight_returned" [minFractionDigits]="0" [maxFractionDigits]="2" [min]="0" suffix=" g" locale="es-PE" [fluid]="true" />
        @if (waste() !== null) {
          <small [class.text-danger]="waste()! > 0" [class.muted]="waste()! <= 0">Merma: {{ waste()!.toFixed(2) }} g</small>
        }
      </div>
      <div class="field field--full">
        <label for="ws-instructions">Indicaciones para el joyero</label>
        <textarea pTextarea id="ws-instructions" formControlName="production_instructions" rows="3" [autoResize]="true" placeholder="Modelo, medidas, acabado, engaste…"></textarea>
      </div>
      <div class="field field--full">
        <label for="ws-notes">Observaciones del acabado</label>
        <textarea pTextarea id="ws-notes" formControlName="production_notes" rows="2" [autoResize]="true"></textarea>
      </div>
      @if (editable()) {
        <div class="form-actions field--full">
          <p-button type="submit" label="Guardar datos del taller" icon="pi pi-check" [loading]="saving()" [disabled]="form.pristine" />
        </div>
      }
    </form>

    @if (canPayJewelers) {
      <div class="row row--between" style="margin: 1.5rem 0 0.5rem">
        <div>
          <h3 class="section-title" style="margin: 0">Pagos al joyero</h3>
          <small class="muted">Total pagado: <strong>{{ paidTotal() | money: o.currency }}</strong></small>
        </div>
        @if (!locked()) {
          <p-button label="Registrar pago" icon="pi pi-plus" size="small" (onClick)="paymentDialog.set(true)" />
        }
      </div>
      <p-table [value]="payments()" [scrollable]="true" [tableStyle]="{ 'min-width': '720px' }" size="small">
        <ng-template #header>
          <tr><th>Fecha</th><th>Recibo</th><th>Joyero</th><th>Detalle</th><th>Método</th><th class="text-right">Monto</th><th></th></tr>
        </ng-template>
        <ng-template #body let-p>
          <tr [style.opacity]="p.voided ? 0.55 : 1">
            <td class="nowrap">{{ p.payment_date | date: 'dd/MM/yyyy' }}</td>
            <td class="nowrap mono">{{ p.number }}</td>
            <td>{{ p.jeweler_name }}</td>
            <td>
              {{ p.concept }}
              @if (p.voided) {
                <p-tag value="Anulado" severity="danger" [title]="p.void_reason" />
              }
            </td>
            <td class="nowrap">{{ p.method | label: methodLabels }}</td>
            <td class="text-right mono nowrap strong" [style.text-decoration]="p.voided ? 'line-through' : 'none'">{{ p.amount | money: p.currency }}</td>
            <td class="text-right nowrap">
              <p-button icon="pi pi-print" [text]="true" severity="secondary" size="small" ariaLabel="Imprimir recibo de egreso" (onClick)="printPayment(p)" />
              @if (!p.voided && !locked()) {
                <p-button icon="pi pi-ban" [text]="true" severity="danger" size="small" ariaLabel="Anular pago" (onClick)="openVoid(p)" />
              }
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr><td colspan="7"><app-empty-state icon="pi pi-id-card" message="Aún no hay pagos al joyero en este pedido." /></td></tr>
        </ng-template>
      </p-table>

      <app-jeweler-payment-dialog [(visible)]="paymentDialog" [order]="o" [jewelers]="activeJewelers()" (saved)="reloadPayments(); changed.emit()" />

      <p-dialog header="Anular pago al joyero" [(visible)]="voidDialog" [modal]="true" [style]="{ width: '440px' }" [draggable]="false">
        <div class="field">
          <label for="jp-void-reason">Motivo de la anulación <span class="req">*</span></label>
          <textarea pTextarea id="jp-void-reason" [(ngModel)]="voidReason" rows="3"></textarea>
        </div>
        <ng-template #footer>
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="voidDialog.set(false)" />
          <p-button label="Anular pago" severity="danger" icon="pi pi-ban" [disabled]="!voidReason.trim()" [loading]="voiding()" (onClick)="confirmVoid()" />
        </ng-template>
      </p-dialog>
    }

    <app-jeweler-dialog [(visible)]="jewelerDialog" (saved)="onJewelerCreated($event)" />
  `,
})
export class OrderWorkshop implements OnInit {
  private readonly orders = inject(OrdersService);
  private readonly documents = inject(OrderDocumentsService);
  private readonly jewelersService = inject(JewelersService);
  private readonly receipts = inject(ReceiptPdfService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  readonly order = input.required<OrderDetail>();
  readonly locked = input(false);
  readonly changed = output<void>();

  protected readonly canEdit = this.auth.hasRole(...MODULE_ROLES.workshop);
  protected readonly canManageJewelers = this.auth.hasRole(...MODULE_ROLES.jewelersWrite);
  protected readonly canPayJewelers = this.auth.hasRole(...MODULE_ROLES.jewelerPayments);
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;

  protected readonly jewelers = signal<Jeweler[]>([]);
  protected readonly payments = signal<JewelerPayment[]>([]);
  protected readonly saving = signal(false);
  protected readonly printing = signal(false);
  protected readonly jewelerDialog = signal(false);
  protected readonly paymentDialog = signal(false);
  protected readonly voidDialog = signal(false);
  protected readonly voiding = signal(false);
  protected voidReason = '';
  private voidTarget: JewelerPayment | null = null;

  protected readonly editable = computed(() => this.canEdit && !this.locked());
  /** Los joyeros activos, más el asignado aunque esté inactivo. */
  protected readonly activeJewelers = computed(() =>
    this.jewelers().filter((j) => j.active || j.id === this.order().jeweler_id),
  );
  protected readonly paidTotal = computed(() =>
    this.payments().filter((p) => !p.voided).reduce((acc, p) => acc + Number(p.amount), 0),
  );

  protected readonly form = inject(FormBuilder).group(
    {
      jeweler_id: [null as string | null],
      material_delivered_at: [null as Date | null],
      material_weight_out: [null as number | null],
      production_instructions: [''],
      product_delivered_at: [null as Date | null],
      weight_returned: [null as number | null],
      production_notes: [''],
    },
    {
      validators: dateRangeValidator(
        'material_delivered_at',
        'product_delivered_at',
        'La entrega del producto no puede ser anterior a la entrega del material.',
      ),
    },
  );
  /** Versión del formulario para recalcular la merma (los FormGroup no son signals). */
  private readonly version = signal(0);
  protected readonly waste = computed(() => {
    this.version();
    const out = this.form.controls.material_weight_out.value;
    const ret = this.form.controls.weight_returned.value;
    return out != null && ret != null ? Number(out) - Number(ret) : null;
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.version.update((v) => v + 1));
    // Al recargar el pedido se refleja lo guardado
    effect(() => {
      const o = this.order();
      untracked(() => {
        this.form.reset({
          jeweler_id: o.jeweler_id,
          material_delivered_at: fromIsoDate(o.material_delivered_at),
          material_weight_out: o.material_weight_out != null ? Number(o.material_weight_out) : null,
          production_instructions: o.production_instructions ?? '',
          product_delivered_at: fromIsoDate(o.product_delivered_at),
          weight_returned: o.weight_returned != null ? Number(o.weight_returned) : null,
          production_notes: o.production_notes ?? '',
        });
        if (this.editable()) this.form.enable({ emitEvent: false });
        else this.form.disable({ emitEvent: false });
      });
    });
  }

  ngOnInit(): void {
    void this.loadJewelers();
    if (this.canPayJewelers) void this.reloadPayments();
  }

  private async loadJewelers(): Promise<void> {
    try {
      this.jewelers.set(await this.jewelersService.list(true));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los joyeros.');
    }
  }

  protected async reloadPayments(): Promise<void> {
    try {
      this.payments.set(await this.jewelersService.payments({ orderId: this.order().id, includeVoided: true }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los pagos al joyero.');
    }
  }

  protected async onJewelerCreated(id: string): Promise<void> {
    await this.loadJewelers();
    this.form.controls.jeweler_id.setValue(id);
    this.form.markAsDirty();
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (v.weight_returned != null && v.material_weight_out == null) {
      this.notify.warn('Registre primero el peso del material entregado al joyero.');
      return;
    }
    this.saving.set(true);
    try {
      await this.orders.saveProduction({
        order_id: this.order().id,
        jeweler_id: v.jeweler_id,
        material_delivered_at: toIsoDate(v.material_delivered_at),
        material_weight_out: v.material_weight_out ? Number(v.material_weight_out) : null,
        production_instructions: v.production_instructions?.trim() || null,
        product_delivered_at: toIsoDate(v.product_delivered_at),
        weight_returned: v.weight_returned ? Number(v.weight_returned) : null,
        production_notes: v.production_notes?.trim() || null,
      });
      this.notify.success('Datos del taller guardados.');
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudieron guardar los datos del taller.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async printOrder(): Promise<void> {
    if (this.form.dirty) {
      this.notify.warn('Guarde los cambios del taller antes de imprimir la orden.');
      return;
    }
    this.printing.set(true);
    try {
      const hadNumber = !!this.order().production_number;
      await this.documents.productionOrder(this.order());
      if (!hadNumber) this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo generar la orden de producción.');
    } finally {
      this.printing.set(false);
    }
  }

  protected async printPayment(p: JewelerPayment): Promise<void> {
    const o = this.order();
    try {
      await this.receipts.expense(p, { number: o.number, title: o.title, customer: o.customer?.full_name });
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el recibo.');
    }
  }

  protected openVoid(p: JewelerPayment): void {
    this.voidTarget = p;
    this.voidReason = '';
    this.voidDialog.set(true);
  }

  protected async confirmVoid(): Promise<void> {
    if (!this.voidTarget) return;
    this.voiding.set(true);
    try {
      await this.jewelersService.voidPayment(this.voidTarget.id, this.voidReason);
      this.notify.success(`Recibo ${this.voidTarget.number} anulado (${formatMoney(this.voidTarget.amount, this.voidTarget.currency)}).`);
      this.voidDialog.set(false);
      await this.reloadPayments();
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo anular el pago.');
    } finally {
      this.voiding.set(false);
    }
  }
}
