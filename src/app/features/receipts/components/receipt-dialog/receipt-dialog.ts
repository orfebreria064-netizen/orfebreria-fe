import { Component, computed, effect, inject, input, model, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmationService } from 'primeng/api';
import { CURRENCY_OPTIONS } from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { SignaturePad } from '../../../../shared/components/signature-pad/signature-pad';
import { toIsoDate } from '../../../../shared/utils/db';
import { CustomerPicker } from '../../../customers/components/customer-picker/customer-picker';
import { Material } from '../../../materials/models/material.model';
import { MaterialsService } from '../../../materials/services/materials.service';
import { CustomerReceiptItem, CustomerReceiptsService, ReceiptKind } from '../../services/customer-receipts.service';

/**
 * Acta de recepción.
 *  - Con pedido: material del cliente (o pieza a reparar) para ese pedido.
 *  - Sin pedido y tipo REPARACION: crea el pedido de reparación y su acta en un paso.
 */
@Component({
  selector: 'app-receipt-dialog',
  imports: [FormsModule, ButtonModule, DatePickerModule, DialogModule, InputNumberModule, InputTextModule, SelectModule, TextareaModule, SignaturePad, CustomerPicker],
  template: `
    <p-dialog [header]="header()" [(visible)]="visible" [modal]="true" [style]="{ width: '860px' }" [breakpoints]="{ '900px': '96vw' }" [draggable]="false">
      @if (isNewRepair()) {
        <div class="form-grid form-grid--3">
          <div class="field field--span-2">
            <label for="rc-customer">Cliente <span class="req">*</span></label>
            <app-customer-picker inputId="rc-customer" [(ngModel)]="customerId" />
          </div>
          <div class="field">
            <label for="rc-due">Fecha de entrega aprox.</label>
            <p-datepicker inputId="rc-due" [(ngModel)]="dueDate" dateFormat="dd/mm/yy" [minDate]="today" [showIcon]="true" appendTo="body" [fluid]="true" />
          </div>
          <div class="field field--span-2">
            <label for="rc-title">Pieza <span class="req">*</span></label>
            <input pInputText id="rc-title" [(ngModel)]="title" placeholder="Ej.: Anillo de oro 18K con brillante" />
          </div>
          <div class="field">
            <label for="rc-price">Precio estimado</label>
            <div class="row">
              <p-select [options]="currencies" [(ngModel)]="currency" optionLabel="value" optionValue="value" ariaLabel="Moneda" appendTo="body" />
              <p-inputnumber inputId="rc-price" [(ngModel)]="price" mode="decimal" [minFractionDigits]="2" [min]="0" [fluid]="true" />
            </div>
          </div>
        </div>
      }

      @if (kind() === 'REPARACION') {
        <div class="field">
          <label for="rc-issue">Trabajo a realizar / daño reportado <span class="req">*</span></label>
          <textarea pTextarea id="rc-issue" [(ngModel)]="reportedIssue" rows="2" [autoResize]="true" placeholder="Ej.: soldar aro roto, cambiar garras, pulir y rodinar"></textarea>
        </div>
      }

      <h3 class="section-title">{{ kind() === 'REPARACION' ? 'Piezas recibidas' : 'Material recibido' }}</h3>
      <div class="lines">
        <div class="lines__head">
          <span>Descripción</span>
          @if (kind() === 'MATERIAL') {
            <span>Material</span>
          }
          <span>Ley</span><span>Cant.</span><span>Peso (g)</span><span>Quilates</span><span></span>
        </div>
        @for (line of lines; track $index) {
          <div class="lines__row" [class.lines__row--material]="kind() === 'MATERIAL'">
            <input pInputText [(ngModel)]="line.description" [placeholder]="kind() === 'MATERIAL' ? 'Ej.: cadena rota para fundir' : 'Ej.: anillo con piedra central'" aria-label="Descripción" />
            @if (kind() === 'MATERIAL') {
              <p-select [options]="materialOptions()" [(ngModel)]="line.material_id" optionLabel="label" optionValue="value" [showClear]="true" placeholder="(sin registrar)" appendTo="body" ariaLabel="Material" (onChange)="onMaterial(line)" />
            }
            <input pInputText [(ngModel)]="line.purity" placeholder="18K" aria-label="Ley" />
            <p-inputnumber [(ngModel)]="line.quantity" [min]="1" ariaLabel="Cantidad" [fluid]="true" />
            <p-inputnumber [(ngModel)]="line.weight_g" [maxFractionDigits]="2" [min]="0" ariaLabel="Peso en gramos" [fluid]="true" />
            <p-inputnumber [(ngModel)]="line.carats" [maxFractionDigits]="3" [min]="0" ariaLabel="Quilates" [fluid]="true" />
            <p-button icon="pi pi-trash" [text]="true" severity="danger" ariaLabel="Quitar línea" [disabled]="lines.length === 1" (onClick)="lines.splice($index, 1)" />
          </div>
        }
        <p-button label="Agregar línea" icon="pi pi-plus" [text]="true" size="small" (onClick)="addLine()" />
        @if (kind() === 'MATERIAL') {
          <p class="small muted">Las líneas con material y peso entran al saldo de material del cliente del pedido (no al stock de la empresa).</p>
        }
      </div>

      <div class="form-grid">
        <div class="field field--full">
          <label for="rc-cond">Estado en que se recibe</label>
          <textarea pTextarea id="rc-cond" [(ngModel)]="conditionNotes" rows="2" [autoResize]="true" placeholder="Ej.: rayones visibles, falta una piedra lateral, broche flojo"></textarea>
        </div>
        <div class="field">
          <label for="rc-by">Entregado por (si no es el cliente)</label>
          <input pInputText id="rc-by" [(ngModel)]="deliveredBy" />
        </div>
        <div class="field">
          <label for="rc-bydoc">DNI de quien entrega</label>
          <input pInputText id="rc-bydoc" [(ngModel)]="deliveredByDoc" maxlength="12" />
        </div>
      </div>

      <h3 class="section-title">Firma del cliente (opcional)</h3>
      <app-signature-pad />

      <ng-template #footer>
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
        <p-button [label]="isNewRepair() ? 'Registrar reparación' : 'Registrar acta'" icon="pi pi-check" [loading]="saving()" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .lines__head,
    .lines__row {
      display: grid;
      grid-template-columns: minmax(0, 3fr) 70px 70px 90px 90px auto;
      gap: 0.35rem;
      align-items: center;
    }
    .lines__row--material,
    .lines__head:has(+ .lines__row--material) {
      grid-template-columns: minmax(0, 2.4fr) minmax(0, 1.6fr) 70px 70px 90px 90px auto;
    }
    .lines__head {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--p-surface-500);
      margin-bottom: 0.25rem;
    }
    .lines__row {
      margin-bottom: 0.35rem;
    }
    @media (max-width: 720px) {
      .lines__head {
        display: none;
      }
      .lines__row,
      .lines__row--material {
        grid-template-columns: 1fr 1fr;
      }
    }
  `,
})
export class ReceiptDialog {
  private readonly service = inject(CustomerReceiptsService);
  private readonly materialsService = inject(MaterialsService);
  private readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly signature = viewChild(SignaturePad);

  readonly visible = model(false);
  readonly kind = input<ReceiptKind>('MATERIAL');
  /** Pedido al que pertenece el acta; sin pedido (y tipo REPARACION) se crea la reparación completa. */
  readonly orderId = input<string | null>(null);
  readonly saved = output<{ orderId: string; receiptId: string }>();

  protected readonly today = new Date();
  protected readonly currencies = CURRENCY_OPTIONS;
  protected readonly saving = signal(false);
  private readonly materials = signal<Material[]>([]);

  protected lines: CustomerReceiptItem[] = [];
  protected customerId: string | null = null;
  protected title = '';
  protected dueDate: Date | null = null;
  protected price: number | null = null;
  protected currency = 'PEN';
  protected reportedIssue = '';
  protected conditionNotes = '';
  protected deliveredBy = '';
  protected deliveredByDoc = '';

  protected readonly isNewRepair = computed(() => this.kind() === 'REPARACION' && !this.orderId());
  protected readonly header = computed(() =>
    this.isNewRepair() ? 'Nueva reparación' : this.kind() === 'REPARACION' ? 'Recepción de pieza para reparación' : 'Acta de recepción de material del cliente',
  );
  protected readonly materialOptions = computed(() =>
    this.materials().map((m) => ({ value: m.id, label: m.purity && !m.name.includes(m.purity) ? `${m.name} ${m.purity}` : m.name })),
  );

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => this.reset());
    });
  }

  private reset(): void {
    this.lines = [];
    this.addLine();
    this.customerId = null;
    this.title = '';
    this.dueDate = null;
    this.price = null;
    this.currency = this.lookups.settings()?.currency === 'USD' ? 'USD' : 'PEN';
    this.reportedIssue = '';
    this.conditionNotes = '';
    this.deliveredBy = '';
    this.deliveredByDoc = '';
    this.signature()?.clear();
    if (this.kind() === 'MATERIAL' && !this.materials().length) {
      this.materialsService.list().then((m) => this.materials.set(m), () => undefined);
    }
  }

  protected addLine(): void {
    this.lines.push({ description: '', material_id: null, purity: null, quantity: 1, weight_g: null, carats: null });
  }

  protected onMaterial(line: CustomerReceiptItem): void {
    const m = this.materials().find((x) => x.id === line.material_id);
    if (m?.purity && !line.purity) line.purity = m.purity;
  }

  async save(): Promise<void> {
    const items = this.lines
      .filter((l) => l.description?.trim())
      .map((l) => ({ ...l, description: l.description.trim(), purity: l.purity?.trim() || null, quantity: l.quantity || 1 }));
    if (!items.length) {
      this.notify.warn('Detalle al menos una pieza o material recibido.');
      return;
    }
    if (this.kind() === 'REPARACION' && !this.reportedIssue.trim()) {
      this.notify.warn('Describa el trabajo o daño a reparar.');
      return;
    }
    if (this.isNewRepair() && (!this.customerId || !this.title.trim())) {
      this.notify.warn('Indique el cliente y la pieza.');
      return;
    }
    const data = {
      delivered_by: this.deliveredBy.trim() || null,
      delivered_by_doc: this.deliveredByDoc.trim() || null,
      reported_issue: this.reportedIssue.trim() || null,
      condition_notes: this.conditionNotes.trim() || null,
    };
    this.saving.set(true);
    try {
      let orderId = this.orderId();
      let receiptId: string;
      let number: string;
      if (this.isNewRepair()) {
        const res = await this.service.registerRepair(
          {
            ...data,
            customer_id: this.customerId!,
            title: this.title.trim(),
            due_date: toIsoDate(this.dueDate),
            price: this.price,
            currency: this.currency,
            tax_rate: Number(this.lookups.settings()?.tax_rate ?? 18),
          },
          items,
        );
        orderId = res.order_id;
        receiptId = res.receipt_id;
        number = res.receipt_number;
        this.notify.success(`Reparación registrada: pedido ${res.order_number}, orden ${number}.`);
      } else {
        const res = await this.service.register(orderId!, this.kind(), data, items);
        receiptId = res.id;
        number = res.number;
        this.notify.success(`Acta ${number} registrada.${res.material_entries ? ' El material entró al saldo del cliente.' : ''}`);
      }
      const png = await this.signature()?.toBlob();
      if (png) {
        try {
          await this.service.saveSignature(receiptId, orderId!, png);
        } catch (err) {
          this.notify.error(err, 'El acta se registró, pero no se pudo guardar la firma.');
        }
      }
      this.visible.set(false);
      this.saved.emit({ orderId: orderId!, receiptId });
      this.confirm.confirm({
        header: 'Imprimir',
        message: `¿Desea imprimir ${number} para el cliente?`,
        icon: 'pi pi-print',
        acceptButtonProps: { label: 'Imprimir', icon: 'pi pi-print' },
        rejectButtonProps: { label: 'Ahora no', severity: 'secondary', text: true },
        accept: () => void this.service.print(receiptId).catch((err) => this.notify.error(err, 'No se pudo generar el PDF.')),
      });
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el acta.');
    } finally {
      this.saving.set(false);
    }
  }
}
