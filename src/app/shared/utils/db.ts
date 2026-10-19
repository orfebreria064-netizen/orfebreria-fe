/**
 * Error de datos con un mensaje apto para mostrar al usuario (en español).
 * `code`: código de la API (50000-50004) o estado HTTP. Lo genera ApiService.
 */
export class AppError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** Convierte un error inesperado (no producido por ApiService) en AppError. */
export function toAppError(error: Error | { message: string; code?: string }): AppError {
  const code = 'code' in error ? (error.code as string | undefined) : undefined;
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return new AppError('No se pudo conectar con el servidor. Verifique su conexión.', code);
  }
  return new AppError(error.message, code);
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
export function emptyToNull<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  return out as T;
}
