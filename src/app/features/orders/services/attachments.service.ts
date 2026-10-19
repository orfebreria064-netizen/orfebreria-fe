import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { AttachmentCategory } from '../../../core/models/domain';
import { AppError } from '../../../shared/utils/db';
import { Attachment } from '../models/order.model';
import { OrdersService } from './orders.service';

const MAX_SIZE = 10 * 1024 * 1024;

/** Archivos del pedido: la API guarda el binario y solo lo entrega a quien puede ver el pedido. */
@Injectable({ providedIn: 'root' })
export class AttachmentsService {
  private readonly api = inject(ApiService);
  private readonly orders = inject(OrdersService);

  /** Las imágenes traen `url` (blob:) para la vista previa. */
  async list(orderId: string): Promise<Attachment[]> {
    const rows = (await this.orders.sheet(orderId)).adjuntos.map((r) => ({ order_id: orderId, ...r }) as Attachment);
    return Promise.all(
      rows.map(async (r) => {
        if (!r.mime_type?.startsWith('image/')) return r;
        try {
          return { ...r, url: URL.createObjectURL(await this.api.descargar('Archivo/descargar', { ruta: r.storage_path })) };
        } catch {
          return r;
        }
      }),
    );
  }

  async upload(orderId: string, file: File, category: AttachmentCategory, description: string | null): Promise<void> {
    if (file.size > MAX_SIZE) throw new AppError(`"${file.name}" supera el tamaño máximo de 10 MB.`);
    const form = new FormData();
    form.append('archivo', file, file.name);
    form.append('categoria', category);
    if (description) form.append('descripcion', description);
    await this.api.subir(`Archivo/subir/${orderId}`, form);
  }

  async download(attachment: Attachment): Promise<void> {
    const blob = await this.api.descargar('Archivo/descargar', { ruta: attachment.storage_path });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.file_name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Baja lógica: el archivo se conserva para auditoría. */
  async remove(attachment: Attachment): Promise<void> {
    await this.api.procesar(`Archivo/eliminar/${attachment.id}`);
  }
}
