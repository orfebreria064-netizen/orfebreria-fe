import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { AppError, toAppError } from '../../shared/utils/db';

/** Notificaciones (p-toast) con mensajes en español. */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly messages = inject(MessageService);

  success(detail: string, summary = 'Éxito'): void {
    this.messages.add({ severity: 'success', summary, detail, life: 3500 });
  }

  info(detail: string, summary = 'Información'): void {
    this.messages.add({ severity: 'info', summary, detail, life: 4000 });
  }

  warn(detail: string, summary = 'Advertencia'): void {
    this.messages.add({ severity: 'warn', summary, detail, life: 6000 });
  }

  /** Muestra el error; `fallback` es el contexto ("No se pudo registrar el pedido."). */
  error(err: unknown, fallback = 'Ocurrió un error inesperado.'): void {
    const appError = err instanceof AppError ? err : err instanceof Error ? toAppError(err) : null;
    const detail = appError?.message && appError.message !== fallback ? appError.message : undefined;
    this.messages.add({ severity: 'error', summary: fallback, detail: detail ?? '', life: 7000 });
    console.error(err);
  }
}
