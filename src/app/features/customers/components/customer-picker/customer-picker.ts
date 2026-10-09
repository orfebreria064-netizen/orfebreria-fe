import { Component, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AutoCompleteCompleteEvent, AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputGroupModule } from 'primeng/inputgroup';
import { NotifyService } from '../../../../core/services/notify.service';
import { Customer, CustomerOption } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';
import { CustomerForm } from '../customer-form/customer-form';

/**
 * Selector de cliente con búsqueda remota y alta rápida.
 * Es un ControlValueAccessor cuyo valor es el id del cliente.
 */
@Component({
  selector: 'app-customer-picker',
  imports: [FormsModule, AutoCompleteModule, ButtonModule, DialogModule, InputGroupModule, CustomerForm],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CustomerPicker), multi: true }],
  template: `
    <p-inputgroup>
      <p-autocomplete
        [inputId]="inputId()"
        [(ngModel)]="selected"
        [suggestions]="suggestions()"
        (completeMethod)="search($event)"
        (onSelect)="emit()"
        (onClear)="clear()"
        (onBlur)="onTouched()"
        optionLabel="full_name"
        [forceSelection]="true"
        [dropdown]="true"
        [disabled]="disabled"
        placeholder="Buscar cliente por nombre o documento"
        emptyMessage="Sin coincidencias"
        [fluid]="true"
        appendTo="body"
      >
        <ng-template #item let-c>
          <div>
            <div>{{ c.full_name }}</div>
            <small class="muted">{{ c.document_number || 'Sin documento' }} · {{ c.phone || 'Sin teléfono' }}</small>
          </div>
        </ng-template>
      </p-autocomplete>
      @if (allowCreate()) {
        <p-button icon="pi pi-user-plus" severity="secondary" [outlined]="true" ariaLabel="Nuevo cliente" [disabled]="disabled" (onClick)="creating.set(true)" />
      }
    </p-inputgroup>

    <p-dialog header="Nuevo cliente" [(visible)]="creating" [modal]="true" [style]="{ width: '720px' }" [draggable]="false" appendTo="body">
      @if (creating()) {
        <app-customer-form [compact]="true" (saved)="onCreated($event)" (cancelled)="creating.set(false)" />
      }
    </p-dialog>
  `,
})
export class CustomerPicker implements ControlValueAccessor {
  private readonly service = inject(CustomersService);
  private readonly notify = inject(NotifyService);

  readonly inputId = input('customer');
  readonly allowCreate = input(true);

  protected readonly selected = signal<CustomerOption | null>(null);
  protected readonly suggestions = signal<CustomerOption[]>([]);
  protected readonly creating = signal(false);
  protected disabled = false;

  private onChange: (value: string | null) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  async writeValue(id: string | null): Promise<void> {
    if (!id) {
      this.selected.set(null);
      return;
    }
    if (this.selected()?.id === id) return;
    try {
      const c = await this.service.get(id);
      this.selected.set({ id: c.id, full_name: c.full_name, document_number: c.document_number, phone: c.phone });
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el cliente.');
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
      this.suggestions.set(await this.service.search(event.query ?? ''));
    } catch (err) {
      this.notify.error(err, 'No se pudieron buscar clientes.');
    }
  }

  protected emit(): void {
    this.onChange(this.selected()?.id ?? null);
  }

  protected clear(): void {
    this.selected.set(null);
    this.onChange(null);
  }

  protected onCreated(c: Customer): void {
    this.selected.set({ id: c.id, full_name: c.full_name, document_number: c.document_number, phone: c.phone });
    this.onChange(c.id);
    this.creating.set(false);
  }
}
