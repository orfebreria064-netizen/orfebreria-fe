import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { NotifyService } from '../../../../core/services/notify.service';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { phoneValidator } from '../../../../shared/utils/validators';
import { Jeweler } from '../../models/jeweler.model';
import { JewelersService } from '../../services/jewelers.service';

/** Alta y edición de un joyero externo. */
@Component({
  selector: 'app-jeweler-dialog',
  imports: [ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule, TextareaModule, ToggleSwitchModule, FieldError],
  template: `
    <p-dialog [header]="jeweler() ? 'Editar joyero' : 'Nuevo joyero'" [(visible)]="visible" [modal]="true" [style]="{ width: '520px' }" [draggable]="false">
      <form [formGroup]="form" (ngSubmit)="save()" class="form-grid" novalidate>
        <div class="field field--full">
          <label for="jw-name">Nombre completo <span class="req">*</span></label>
          <input pInputText id="jw-name" formControlName="full_name" />
          <app-field-error [control]="form.controls.full_name" />
        </div>
        <div class="field">
          <label for="jw-dni">DNI</label>
          <input pInputText id="jw-dni" formControlName="document_number" inputmode="numeric" maxlength="12" />
          <app-field-error [control]="form.controls.document_number" />
        </div>
        <div class="field">
          <label for="jw-phone">Teléfono</label>
          <input pInputText id="jw-phone" formControlName="phone" />
          <app-field-error [control]="form.controls.phone" />
        </div>
        <div class="field field--full">
          <label for="jw-specialty">Especialidad</label>
          <input pInputText id="jw-specialty" formControlName="specialty" placeholder="Ej. Engaste, fundición, platería" />
        </div>
        <div class="field field--full">
          <label for="jw-notes">Observaciones</label>
          <textarea pTextarea id="jw-notes" formControlName="notes" rows="2" [autoResize]="true"></textarea>
        </div>
        @if (jeweler()) {
          <div class="field field--full row">
            <p-toggleswitch inputId="jw-active" formControlName="active" />
            <label for="jw-active">Activo</label>
          </div>
        }
        <div class="form-actions field--full">
          <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
          <p-button type="submit" label="Guardar" icon="pi pi-check" [loading]="saving()" />
        </div>
      </form>
    </p-dialog>
  `,
})
export class JewelerDialog {
  private readonly service = inject(JewelersService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  /** Joyero a editar (null = nuevo). */
  readonly jeweler = input<Jeweler | null>(null);
  readonly saved = output<string>();

  protected readonly saving = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    full_name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(150)]],
    document_number: ['', [Validators.pattern(/^\d{8,12}$/)]],
    phone: ['', [phoneValidator]],
    specialty: ['', Validators.maxLength(100)],
    notes: ['', Validators.maxLength(1000)],
    active: [true],
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const j = this.jeweler();
      untracked(() =>
        this.form.reset({
          full_name: j?.full_name ?? '',
          document_number: j?.document_number ?? '',
          phone: j?.phone ?? '',
          specialty: j?.specialty ?? '',
          notes: j?.notes ?? '',
          active: j?.active ?? true,
        }),
      );
    });
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const id = await this.service.save({
        id: this.jeweler()?.id ?? null,
        full_name: v.full_name.trim(),
        document_number: v.document_number.trim() || null,
        phone: v.phone.trim() || null,
        specialty: v.specialty.trim() || null,
        notes: v.notes.trim() || null,
        active: v.active,
      });
      this.notify.success(this.jeweler() ? 'Joyero actualizado.' : 'Joyero registrado.');
      this.visible.set(false);
      this.saved.emit(id);
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el joyero.');
    } finally {
      this.saving.set(false);
    }
  }
}
