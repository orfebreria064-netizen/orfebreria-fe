import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { FileSelectEvent, FileUpload, FileUploadModule } from 'primeng/fileupload';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { ImageModule } from 'primeng/image';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from 'primeng/api';
import { ATTACHMENT_CATEGORY_LABELS, ATTACHMENT_CATEGORY_OPTIONS, AttachmentCategory } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { formatFileSize } from '../../../../shared/utils/format';
import { Attachment } from '../../models/order.model';
import { AttachmentsService } from '../../services/attachments.service';

/** Pestaña "Archivos": fotos, diseños, bocetos, documentos y evidencias (Supabase Storage). */
@Component({
  selector: 'app-order-attachments',
  imports: [DatePipe, FormsModule, ButtonModule, FileUploadModule, SelectModule, InputTextModule, ImageModule, TagModule, EmptyState, LabelPipe],
  templateUrl: './order-attachments.html',
  styleUrl: './order-attachments.scss',
})
export class OrderAttachments implements OnInit {
  private readonly service = inject(AttachmentsService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);

  readonly orderId = input.required<string>();
  readonly readonly = input(false);
  readonly changed = output<void>();

  protected readonly files = signal<Attachment[]>([]);
  protected readonly loading = signal(true);
  protected readonly uploading = signal(false);
  protected readonly categories = ATTACHMENT_CATEGORY_OPTIONS;
  protected readonly categoryLabels = ATTACHMENT_CATEGORY_LABELS;
  protected category: AttachmentCategory = 'FOTO';
  protected description = '';
  protected readonly fileSize = formatFileSize;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.files.set(await this.service.list(this.orderId()));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los archivos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected isImage(a: Attachment): boolean {
    return (a.mime_type ?? '').startsWith('image/');
  }

  protected async upload(event: FileSelectEvent, uploader: FileUpload): Promise<void> {
    const files = event.currentFiles;
    if (!files.length) return;
    this.uploading.set(true);
    let ok = 0;
    for (const file of files) {
      try {
        await this.service.upload(this.orderId(), file, this.category, this.description.trim() || null);
        ok++;
      } catch (err) {
        this.notify.error(err, `No se pudo subir "${file.name}".`);
      }
    }
    uploader.clear();
    this.uploading.set(false);
    if (ok) {
      this.notify.success(ok === 1 ? 'Archivo subido correctamente.' : `${ok} archivos subidos correctamente.`);
      this.description = '';
      await this.load();
      this.changed.emit();
    }
  }

  protected async download(a: Attachment): Promise<void> {
    try {
      await this.service.download(a);
    } catch (err) {
      this.notify.error(err, 'No se pudo descargar el archivo.');
    }
  }

  protected remove(a: Attachment): void {
    this.confirm.confirm({
      header: 'Eliminar archivo',
      message: `¿Eliminar "${a.file_name}"? La acción quedará registrada en el historial.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: 'Eliminar', severity: 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: async () => {
        try {
          await this.service.remove(a);
          this.files.update((list) => list.filter((f) => f.id !== a.id));
          this.notify.success('Archivo eliminado.');
          this.changed.emit();
        } catch (err) {
          this.notify.error(err, 'No se pudo eliminar el archivo.');
        }
      },
    });
  }
}
