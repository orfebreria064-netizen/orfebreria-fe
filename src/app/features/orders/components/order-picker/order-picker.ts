import { Component, forwardRef, inject, input, output, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AutoCompleteCompleteEvent, AutoCompleteModule } from 'primeng/autocomplete';
import { OrderStatus } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { OrderRow } from '../../models/order.model';
import { OrdersService } from '../../services/orders.service';

/** Selector de pedido con búsqueda por número o producto. Valor: id del pedido. */
@Component({
  selector: 'app-order-picker',
  imports: [FormsModule, AutoCompleteModule, MoneyPipe],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => OrderPicker), multi: true }],
  template: `
    <p-autocomplete
      [inputId]="inputId()"
      [(ngModel)]="selected"
      [suggestions]="suggestions()"
      (completeMethod)="search($event)"
      (onSelect)="emit()"
      (onClear)="clear()"
      (onBlur)="onTouched()"
      optionLabel="number"
      [forceSelection]="true"
      [dropdown]="true"
      [disabled]="disabled"
      placeholder="Buscar pedido por número o producto"
      emptyMessage="Sin coincidencias"
      [fluid]="true"
      appendTo="body"
    >
      <ng-template #item let-o>
        <div>
          <div><strong>{{ o.number }}</strong> · {{ o.title }}</div>
          <small class="muted">{{ o.customer?.full_name }} · Saldo {{ o.balance | money }}</small>
        </div>
      </ng-template>
    </p-autocomplete>
  `,
})
export class OrderPicker implements ControlValueAccessor {
  private readonly service = inject(OrdersService);
  private readonly notify = inject(NotifyService);

  readonly inputId = input('order');
  readonly excludeStatuses = input<OrderStatus[]>(['CERRADO', 'CANCELADO']);

  protected readonly selected = signal<OrderRow | null>(null);
  protected readonly suggestions = signal<OrderRow[]>([]);
  protected disabled = false;

  private onChange: (value: string | null) => void = () => undefined;
  protected onTouched: () => void = () => undefined;
  /** Emite el pedido completo seleccionado (para validar saldos, cliente, etc.). */
  readonly orderSelected = output<OrderRow | null>();

  async writeValue(id: string | null): Promise<void> {
    if (!id) {
      this.selected.set(null);
      return;
    }
    if (this.selected()?.id === id) return;
    try {
      const order = await this.service.get(id);
      this.selected.set(order as unknown as OrderRow);
      this.orderSelected.emit(this.selected());
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el pedido.');
    }
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  protected async search(event: AutoCompleteCompleteEvent): Promise<void> {
    try {
      this.suggestions.set(await this.service.search(event.query ?? '', { excludeStatuses: this.excludeStatuses() }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron buscar pedidos.');
    }
  }

  protected emit(): void {
    this.onChange(this.selected()?.id ?? null);
    this.orderSelected.emit(this.selected());
  }

  protected clear(): void {
    this.selected.set(null);
    this.onChange(null);
    this.orderSelected.emit(null);
  }
}
