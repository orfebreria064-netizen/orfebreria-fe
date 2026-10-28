import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { AuthService } from '../../../../core/auth/auth.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { CustomerReceipt, CustomerReceiptsService, ReceiptKind } from '../../services/customer-receipts.service';
import { ReceiptDialog } from '../receipt-dialog/receipt-dialog';
import { ReturnDialog } from '../return-dialog/return-dialog';

/** Actas de recepción del pedido (material del cliente o pieza para reparar): registrar, imprimir, devolver y anular. */
@Component({
  selector: 'app-order-receipts',
  imports: [DatePipe, DecimalPipe, FormsModule, ButtonModule, DialogModule, InputNumberModule, InputTextModule, TableModule, TagModule, TextareaModule, ReceiptDialog, ReturnDialog],
  template: `
    <div class="row row--between" style="margin-bottom: 0.5rem">
      <h3 class="section-title" style="margin: 0">Actas de recepción</h3>
      @if (!readonly()) {
        <span>
          <p-button label="Material del cliente" icon="pi pi-inbox" size="small" severity="secondary" [outlined]="true" (onClick)="open('MATERIAL')" />
          <p-button label="Pieza a reparar" icon="pi pi-wrench" size="small" severity="secondary" [outlined]="true" (onClick)="open('REPARACION')" />
        </span>
      }
    </div>
    @if (receipts().length) {
      <p-table [value]="receipts()" [scrollable]="true" [tableStyle]="{ 'min-width': '720px' }" size="small" styleClass="mb-3">
        <ng-template #header>
          <tr><th>N.°</th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th class="text-right">Peso</th><th>Devolución</th><th></th></tr>
        </ng-template>
        <ng-template #body let-r>
          <tr>
            <td class="mono small nowrap">{{ r.number }}</td>
            <td class="nowrap">{{ r.received_at | date: 'dd/MM/yyyy HH:mm' }}</td>
            <td>
              @if (r.voided) {
                <p-tag value="Anulada" severity="danger" [title]="r.void_reason ?? ''" />
              } @else {
                {{ r.kind === 'REPARACION' ? 'Reparación' : 'Material' }}
              }
            </td>
            <td class="small">
              @for (it of r.items; track $index) {
                <div>{{ it.quantity > 1 ? it.quantity + ' × ' : '' }}{{ it.description }}{{ it.purity ? ' (' + it.purity + ')' : '' }}</div>
              }
              @if (r.reported_issue) {
                <div class="muted">Trabajo: {{ r.reported_issue }}</div>
              }
            </td>
            <td class="text-right mono nowrap">{{ r.weight_in ? (r.weight_in | number: '1.2-2') + ' g' : '—' }}</td>
            <td class="small nowrap">
              @if (r.returned_at) {
                {{ r.returned_at | date: 'dd/MM/yyyy' }}{{ r.returned_weight ? ' · ' + (r.returned_weight | number: '1.2-2') + ' g' : '' }}
              } @else {
                <span class="muted">Pendiente</span>
              }
            </td>
            <td class="text-right nowrap">
              <p-button icon="pi pi-print" [text]="true" severity="secondary" ariaLabel="Imprimir" title="Imprimir" (onClick)="print(r)" />
              @if (!r.voided && !r.returned_at && !readonly()) {
                <p-button icon="pi pi-reply" [text]="true" ariaLabel="Registrar devolución" title="Registrar devolución" (onClick)="returning.set(r)" />
              }
              @if (!r.voided && canVoid) {
                <p-button icon="pi pi-ban" [text]="true" severity="danger" ariaLabel="Anular" title="Anular" (onClick)="askVoid(r)" />
              }
            </td>
          </tr>
        </ng-template>
      </p-table>
    } @else {
      <p class="muted small">Sin actas. Registre aquí lo que el cliente deja: materia prima para su joya o la pieza a reparar.</p>
    }

    <app-receipt-dialog [(visible)]="dialog" [kind]="kind()" [orderId]="orderId()" (saved)="reload(); changed.emit()" />
    <app-return-dialog [receipt]="returning()" (closed)="returning.set(null)" (saved)="reload(); changed.emit()" />

    <p-dialog header="Anular acta" [(visible)]="voidVisible" [modal]="true" [style]="{ width: '420px' }" [draggable]="false">
      <div class="field">
        <label for="ar-void">Motivo de la anulación <span class="req">*</span></label>
        <textarea pTextarea id="ar-void" [(ngModel)]="voidReason" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="voidVisible = false" />
        <p-button label="Anular" severity="danger" icon="pi pi-ban" [disabled]="!voidReason.trim()" (onClick)="confirmVoid()" />
      </div>
    </p-dialog>
  `,
})
export class OrderReceipts implements OnInit {
  private readonly service = inject(CustomerReceiptsService);
  private readonly notify = inject(NotifyService);

  readonly orderId = input.required<string>();
  readonly readonly = input(false);
  readonly changed = output<void>();

  protected readonly canVoid = inject(AuthService).hasRole('ADMIN', 'GERENTE');
  protected readonly receipts = signal<CustomerReceipt[]>([]);
  protected readonly kind = signal<ReceiptKind>('MATERIAL');
  protected readonly returning = signal<CustomerReceipt | null>(null);
  protected dialog = false;
  protected voidVisible = false;
  protected voidReason = '';
  private voidTarget: CustomerReceipt | null = null;

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    try {
      this.receipts.set(await this.service.byOrder(this.orderId()));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar las actas.');
    }
  }

  protected open(kind: ReceiptKind): void {
    this.kind.set(kind);
    this.dialog = true;
  }

  protected async print(r: CustomerReceipt): Promise<void> {
    try {
      await this.service.print(r);
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el PDF.');
    }
  }

  protected askVoid(r: CustomerReceipt): void {
    this.voidTarget = r;
    this.voidReason = '';
    this.voidVisible = true;
  }

  protected async confirmVoid(): Promise<void> {
    if (!this.voidTarget) return;
    try {
      await this.service.void(this.voidTarget.id, this.voidReason.trim());
      this.notify.success(`Acta ${this.voidTarget.number} anulada.`);
      this.voidVisible = false;
      await this.reload();
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo anular el acta.');
    }
  }
}
