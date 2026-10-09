import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';

const MESSAGES: Record<string, (e: unknown) => string> = {
  required: () => 'Este campo es obligatorio.',
  email: () => 'Ingrese un correo electrónico válido.',
  min: (e) => `El valor mínimo es ${(e as { min: number }).min}.`,
  max: (e) => `El valor máximo es ${(e as { max: number }).max}.`,
  minlength: (e) => `Debe tener al menos ${(e as { requiredLength: number }).requiredLength} caracteres.`,
  maxlength: (e) => `Debe tener como máximo ${(e as { requiredLength: number }).requiredLength} caracteres.`,
  pattern: () => 'El formato no es válido.',
};

/** Muestra el primer error de validación de un control, en español, cuando el control fue tocado. */
@Component({
  selector: 'app-field-error',
  template: `
    @if (message; as msg) {
      <small class="field-error" role="alert">{{ msg }}</small>
    }
  `,
  styles: `
    .field-error {
      color: var(--p-red-600);
      font-size: 0.8rem;
      display: block;
      margin-top: 0.25rem;
    }
  `,
})
export class FieldError {
  readonly control = input.required<AbstractControl | null>();
  /** Error a nivel de grupo (p. ej. rango de fechas) que también se muestra bajo este control. */
  readonly groupErrorKey = input<string | null>(null);

  // Getter (no computed): el estado de los controles no es reactivo y se lee en cada detección de cambios.
  protected get message(): string | null {
    const c = this.control();
    if (!c || !(c.touched || c.dirty)) return null;
    const groupKey = this.groupErrorKey();
    if (groupKey && c.parent?.errors?.[groupKey]) return String(c.parent.errors[groupKey]);
    const errors = c.errors ?? {};
    const key = Object.keys(errors)[0];
    if (!key) return null;
    const value = errors[key];
    if (typeof value === 'string') return value;
    return MESSAGES[key]?.(value) ?? 'Valor no válido.';
  }
}
