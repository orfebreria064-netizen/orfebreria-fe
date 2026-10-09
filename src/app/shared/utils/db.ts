import { PostgrestError } from '@supabase/supabase-js';

/** Error de datos con un mensaje apto para mostrar al usuario (en español). */
export class AppError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const CODE_MESSAGES: Record<string, string> = {
  '23505': 'Ya existe un registro con esos datos (valor duplicado).',
  '23503': 'El registro está relacionado con otros datos y no puede modificarse así.',
  '23514': 'Algún dato no cumple las reglas de validación.',
  '42501': 'No tiene permisos para realizar esta acción.',
  PGRST116: 'No se encontró el registro o no tiene acceso a él.',
};

/** Traduce errores de PostgREST. Los RAISE EXCEPTION de nuestras funciones ya vienen en español (P0001). */
export function toAppError(error: PostgrestError | Error | { message: string; code?: string }): AppError {
  const code = 'code' in error ? (error.code as string | undefined) : undefined;
  if (code === 'P0001') return new AppError(error.message, code);
  if (code && CODE_MESSAGES[code]) return new AppError(CODE_MESSAGES[code], code);
  if (/row-level security/i.test(error.message)) return new AppError(CODE_MESSAGES['42501'], '42501');
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return new AppError('No se pudo conectar con el servidor. Verifique su conexión.', code);
  }
  return new AppError(error.message, code);
}

/** Devuelve `data` o lanza un AppError. */
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw toAppError(res.error);
  return res.data as T;
}

/** Convierte Date -> 'YYYY-MM-DD' en hora local (sin desfase UTC). */
export function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Convierte 'YYYY-MM-DD' -> Date local (medianoche local). */
export function fromIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayIso(): string {
  return toIsoDate(new Date())!;
}

/** Normaliza strings vacíos a null antes de enviar a la base de datos. */
export function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  return out as T;
}
