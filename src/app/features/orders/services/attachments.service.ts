import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AttachmentCategory } from '../../../core/models/domain';
import { AppError, toAppError, unwrap } from '../../../shared/utils/db';
import { Attachment } from '../models/order.model';

const BUCKET = 'orders';
const MAX_SIZE = 10 * 1024 * 1024;

/** Archivos del pedido: binario en Storage (orders/{order_id}/...) y metadata en PostgreSQL. */
@Injectable({ providedIn: 'root' })
export class AttachmentsService {
  private readonly db = inject(SupabaseService).client;

  async list(orderId: string): Promise<Attachment[]> {
    const rows = unwrap(
      await this.db
        .from('attachments')
        .select('*')
        .eq('order_id', orderId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ) as Attachment[];
    if (rows.length === 0) return rows;
    const { data } = await this.db.storage.from(BUCKET).createSignedUrls(
      rows.map((r) => r.storage_path),
      60 * 60,
    );
    const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
    return rows.map((r) => ({ ...r, url: urls.get(r.storage_path) ?? undefined }));
  }

  async upload(orderId: string, file: File, category: AttachmentCategory, description: string | null): Promise<void> {
    if (file.size > MAX_SIZE) throw new AppError(`"${file.name}" supera el tamaño máximo de 10 MB.`);
    const safeName = file.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(-80);
    const path = `${orderId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await this.db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw toAppError(error);
    const insert = await this.db.from('attachments').insert({
      order_id: orderId,
      category,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      description,
    });
    if (insert.error) {
      await this.db.storage.from(BUCKET).remove([path]);
      throw toAppError(insert.error);
    }
  }

  async download(attachment: Attachment): Promise<void> {
    const { data, error } = await this.db.storage.from(BUCKET).download(attachment.storage_path);
    if (error || !data) throw toAppError(error ?? new Error('No se pudo descargar el archivo.'));
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.file_name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Elimina el binario y conserva la metadata como baja lógica (queda en auditoría). */
  async remove(attachment: Attachment): Promise<void> {
    unwrap(await this.db.from('attachments').update({ deleted_at: new Date().toISOString() }).eq('id', attachment.id));
    await this.db.storage.from(BUCKET).remove([attachment.storage_path]);
  }
}
