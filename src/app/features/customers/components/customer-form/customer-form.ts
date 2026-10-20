import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { DOCUMENT_TYPE_OPTIONS, PERSON_TYPE_OPTIONS, PersonType, DocumentType } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { documentValidator, phoneValidator } from '../../../../shared/utils/validators';
import { Customer, CustomerInput } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';

/**
 * Formulario de cliente reutilizable (página de alta/edición y diálogo de alta rápida
 * desde cotizaciones/pedidos).
 */
@Component({
  selector: 'app-customer-form',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    TextareaModule,
    ToggleSwitchModule,
    FieldError,
  ],
  templateUrl: './customer-form.html',
})
export class CustomerForm {
  private readonly service = inject(CustomersService);
  private readonly notify = inject(NotifyService);

  readonly customer = input<Customer | null>(null);
  readonly compact = input(false);
  readonly saved = output<Customer>();
  readonly cancelled = output<void>();

  protected readonly saving = signal(false);
  protected readonly personTypes = PERSON_TYPE_OPTIONS;
  protected readonly documentTypes = DOCUMENT_TYPE_OPTIONS;

  private readonly nfb = inject(FormBuilder).nonNullable;

  protected readonly form = this.nfb.group({
    person_type: ['NATURAL' as PersonType],
    first_name: ['', [Validators.maxLength(80)]],
    last_name: ['', [Validators.maxLength(80)]],
    business_name: ['', [Validators.maxLength(160)]],
    document_type: ['DNI' as DocumentType],
    document_number: ['', [documentValidator('document_type')]],
    phone: ['', [phoneValidator]],
    whatsapp: ['', [phoneValidator]],
    email: ['', [Validators.email, Validators.maxLength(120)]],
    address: ['', [Validators.maxLength(200)]],
    city: ['', [Validators.maxLength(80)]],
    notes: ['', [Validators.maxLength(1000)]],
    statement_email: [true],
    active: [true],
  });

  constructor() {
    this.applyPersonTypeRules('NATURAL');
    this.form.controls.person_type.valueChanges.subscribe((type) => {
      this.applyPersonTypeRules(type ?? 'NATURAL');
    });
    this.form.controls.document_type.valueChanges.subscribe(() =>
      this.form.controls.document_number.updateValueAndValidity(),
    );
    effect(() => {
      const c = this.customer();
      // untracked: form.reset() lee signals internos de PrimeNG; rastrearlos reiniciaría el formulario al editar.
      if (c) {
        untracked(() => this.form.reset({
          person_type: c.person_type,
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          business_name: c.business_name ?? '',
          document_type: c.document_type,
          document_number: c.document_number ?? '',
          phone: c.phone ?? '',
          whatsapp: c.whatsapp ?? '',
          email: c.email ?? '',
          address: c.address ?? '',
          city: c.city ?? '',
          notes: c.notes ?? '',
          statement_email: c.statement_email ?? true,
          active: c.active,
        }));
      }
    });
  }

  protected get isCompany(): boolean {
    return this.form.controls.person_type.value === 'EMPRESA';
  }

  private applyPersonTypeRules(type: PersonType): void {
    const { first_name, business_name, document_type } = this.form.controls;
    if (type === 'EMPRESA') {
      business_name.addValidators(Validators.required);
      first_name.removeValidators(Validators.required);
      if (document_type.value === 'DNI') document_type.setValue('RUC');
    } else {
      first_name.addValidators(Validators.required);
      business_name.removeValidators(Validators.required);
      if (document_type.value === 'RUC') document_type.setValue('DNI');
    }
    first_name.updateValueAndValidity();
    business_name.updateValueAndValidity();
  }

  /** Copia el teléfono al WhatsApp si este está vacío. */
  protected copyPhoneToWhatsapp(): void {
    const { phone, whatsapp } = this.form.controls;
    if (!whatsapp.value && phone.valid) whatsapp.setValue(phone.value);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notify.warn('Revise los campos marcados.');
      return;
    }
    this.saving.set(true);
    const value = this.form.getRawValue();
    const input: CustomerInput = {
      ...value,
      first_name: this.isCompany ? null : value.first_name,
      last_name: this.isCompany ? null : value.last_name,
      business_name: this.isCompany ? value.business_name : null,
      email: value.email.trim().toLowerCase(),
    };
    try {
      const current = this.customer();
      const result = current ? await this.service.update(current.id, input) : await this.service.create(input);
      this.notify.success(current ? 'Cliente actualizado correctamente.' : 'Cliente creado correctamente.');
      this.saved.emit(result);
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el cliente.');
    } finally {
      this.saving.set(false);
    }
  }
}
