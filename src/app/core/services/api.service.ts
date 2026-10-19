import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppError } from '../../shared/utils/db';

/** Respuesta de las escrituras de la API (igual que ARGO). procesoSwitch: 0 OK · 1 validación · -1 error interno. */
export interface RespuestaProceso<T = Record<string, unknown>> {
  procesoSwitch: number;
  errorNumero: number;
  mensaje: string | null;
  resultProceso: string | null;
  data: T | null;
}

type Params = Record<string, string | number | boolean | null | undefined>;

/**
 * Cliente de la API AURUM (aurum-be). El token lo agrega apiInterceptor.
 * Los errores llegan como AppError con el mensaje listo para mostrar.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Lectura por GET. */
  get<T>(ruta: string, params?: Params): Promise<T> {
    return this.request(this.http.get<T>(this.url(ruta), { params: toParams(params) }));
  }

  /** Lectura con filtros en el body (listar*, reportes). */
  post<T>(ruta: string, body: unknown = {}): Promise<T> {
    return this.request(this.http.post<T>(this.url(ruta), body));
  }

  /** Escritura: devuelve RespuestaProceso o lanza AppError si no fue exitosa. */
  async procesar<T = Record<string, unknown>>(ruta: string, body: unknown = {}): Promise<RespuestaProceso<T>> {
    return checkProceso(await this.request(this.http.post<RespuestaProceso<T>>(this.url(ruta), body)));
  }

  /** Carga de archivos (multipart). */
  async subir(ruta: string, form: FormData): Promise<RespuestaProceso> {
    return checkProceso(await this.request(this.http.post<RespuestaProceso>(this.url(ruta), form)));
  }

  /** Descarga autenticada de un archivo. */
  descargar(ruta: string, params?: Params): Promise<Blob> {
    return this.request(this.http.get(this.url(ruta), { params: toParams(params), responseType: 'blob' }));
  }

  private url(ruta: string): string {
    return `${this.base}/${ruta}`;
  }

  private async request<T>(obs: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(obs);
    } catch (err) {
      throw await toApiError(err);
    }
  }
}

function toParams(params?: Params): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  return p;
}

function checkProceso<T>(r: RespuestaProceso<T>): RespuestaProceso<T> {
  if (r.procesoSwitch !== 0) {
    throw new AppError(r.mensaje || 'No se pudo completar la operación.', r.errorNumero ? String(r.errorNumero) : undefined);
  }
  return r;
}

async function toApiError(err: unknown): Promise<AppError> {
  if (!(err instanceof HttpErrorResponse)) return new AppError(err instanceof Error ? err.message : 'Error inesperado.');
  if (err.status === 0) return new AppError('No se pudo conectar con el servidor. Verifique su conexión.');
  if (err.status === 429) return new AppError('Demasiados intentos. Espere un minuto e intente nuevamente.');

  let body: unknown = err.error;
  if (body instanceof Blob) {
    try {
      body = JSON.parse(await body.text());
    } catch {
      body = null;
    }
  }
  const mensaje = (body as { mensaje?: string; Mensaje?: string } | null)?.mensaje ?? (body as { Mensaje?: string } | null)?.Mensaje;
  const numero = (body as { errorNumero?: number } | null)?.errorNumero;
  if (mensaje) return new AppError(mensaje, numero ? String(numero) : String(err.status));
  switch (err.status) {
    case 401:
      return new AppError('Su sesión expiró. Inicie sesión nuevamente.', '401');
    case 403:
      return new AppError('No tiene permisos para realizar esta acción.', '403');
    case 404:
      return new AppError('No se encontró el registro o no tiene acceso a él.', '404');
    default:
      return new AppError('Ocurrió un error en el servidor. Intente nuevamente.', String(err.status));
  }
}
