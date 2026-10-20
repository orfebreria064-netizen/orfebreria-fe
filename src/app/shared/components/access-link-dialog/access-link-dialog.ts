import { Component, computed, inject, input, model } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { NotifyService } from '../../../core/services/notify.service';
import { AccessLinkResult } from '../../../core/services/invitations.service';

/**
 * Enlace de activación (invitación) o de acceso (nueva contraseña) para compartir por WhatsApp u otro
 * medio cuando el correo no llega. El enlace es personal y de un solo uso.
 */
@Component({
  selector: 'app-access-link-dialog',
  imports: [ButtonModule, DialogModule, InputTextModule, MessageModule],
  template: `
    <p-dialog [header]="title()" [(visible)]="visible" [modal]="true" [style]="{ width: '520px' }" [draggable]="false">
      @if (result(); as r) {
        @if (r.email_error) {
          <p-message severity="warn" [text]="'No se pudo enviar el correo: ' + r.email_error + ' Comparta este enlace por otro medio.'" />
        }
        <p>
          Envíe este enlace a <b>{{ r.email }}</b>. Al abrirlo podrá
          {{ r.kind === 'invite' ? 'crear su contraseña y entrar al sistema' : 'crear una nueva contraseña' }}.
        </p>
        <input pInputText [value]="r.link ?? ''" readonly class="w-full mono small" (focus)="$any($event.target).select()" aria-label="Enlace" />
        <p class="muted small">Es personal, sirve una sola vez y vence en poco tiempo (1 hora por defecto). No lo publique en grupos.</p>
        <div class="form-actions">
          <p-button label="Copiar enlace" icon="pi pi-copy" severity="secondary" [outlined]="true" (onClick)="copy()" />
          <a class="p-button p-button-success" [href]="whatsapp()" target="_blank" rel="noopener">
            <i class="pi pi-whatsapp"></i>&nbsp;Enviar por WhatsApp
          </a>
        </div>
      }
    </p-dialog>
  `,
})
export class AccessLinkDialog {
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  readonly result = input<AccessLinkResult | null>(null);
  /** Nombre de la empresa o del sistema para el mensaje de WhatsApp. */
  readonly appName = input('Aurum');

  protected readonly title = computed(() => (this.result()?.kind === 'invite' ? 'Enlace de invitación' : 'Enlace de acceso'));

  protected readonly whatsapp = computed(() => {
    const r = this.result();
    if (!r?.link) return '';
    const text =
      r.kind === 'invite'
        ? `Hola, te invito a usar el sistema de ${this.appName()}. Abre este enlace para crear tu contraseña: ${r.link}`
        : `Hola, abre este enlace para crear una nueva contraseña en el sistema de ${this.appName()}: ${r.link}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  });

  protected async copy(): Promise<void> {
    const link = this.result()?.link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.notify.success('Enlace copiado.');
    } catch {
      this.notify.warn('No se pudo copiar automáticamente: seleccione el enlace y cópielo.');
    }
  }
}
