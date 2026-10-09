import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Documento según tipo: DNI 8 dígitos, RUC 11 dígitos (10/15/17/20), CE/Pasaporte alfanumérico. */
export function documentValidator(typeControlName: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '').trim();
    if (!value) return null;
    const type = control.parent?.get(typeControlName)?.value as string | undefined;
    switch (type) {
      case 'DNI':
        return /^\d{8}$/.test(value) ? null : { document: 'El DNI debe tener 8 dígitos.' };
      case 'RUC':
        return /^(10|15|17|20)\d{9}$/.test(value) ? null : { document: 'El RUC debe tener 11 dígitos y empezar con 10, 15, 17 o 20.' };
      case 'CE':
      case 'PASAPORTE':
        return /^[A-Za-z0-9]{6,15}$/.test(value) ? null : { document: 'Debe tener entre 6 y 15 caracteres alfanuméricos.' };
      default:
        return value.length <= 20 ? null : { document: 'Máximo 20 caracteres.' };
    }
  };
}

/** Teléfono peruano: celular de 9 dígitos (9xxxxxxxx) o fijo de 7-9 dígitos; admite +51 y espacios. */
export const phoneValidator: ValidatorFn = (control) => {
  const raw = String(control.value ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[\s\-()]/g, '').replace(/^\+?51/, '');
  return /^(9\d{8}|0?\d{6,8})$/.test(digits) ? null : { phone: 'Ingrese un teléfono válido (ej. 987654321).' };
};

/** Número estrictamente mayor que cero. */
export const positiveValidator: ValidatorFn = (control) => {
  const v = control.value;
  if (v === null || v === undefined || v === '') return null;
  return Number(v) > 0 ? null : { positive: 'Debe ser mayor que cero.' };
};

/** Valida en el FormGroup que `end` >= `start`. */
export function dateRangeValidator(start: string, end: string, message: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const s = group.get(start)?.value as Date | null;
    const e = group.get(end)?.value as Date | null;
    if (!s || !e) return null;
    return e.getTime() >= new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime() ? null : { dateRange: message };
  };
}
