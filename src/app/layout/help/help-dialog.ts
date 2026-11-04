import { Component, computed, inject, input, model, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { environment } from '../../../environments/environment';
import { HELP_TOPICS, HelpManifest, HelpTopic } from './help-catalog';

/** Primer segmento de la URL: /orders/123/edit → orders. */
function topicKey(url: string): string {
  return url.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? 'dashboard';
}

/** Ayuda de la pantalla actual: video tutorial y manual en PDF. */
@Component({
  selector: 'app-help-dialog',
  imports: [ButtonModule, DialogModule],
  template: `
    <p-dialog
      [header]="'Ayuda · ' + (topic()?.title ?? 'BRILLOS')"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '760px' }"
      [breakpoints]="{ '800px': '95vw' }"
      [draggable]="false"
      (onShow)="loadManifest()"
    >
      @if (topic(); as t) {
        <p class="help__summary">{{ t.summary }}</p>

        @if (videoUrl(); as src) {
          <video class="help__video" [src]="src" controls preload="metadata" playsinline></video>
        } @else {
          <div class="help__empty">
            <i class="pi pi-video"></i>
            <span>{{ loading() ? 'Cargando…' : 'El video de esta opción estará disponible próximamente.' }}</span>
          </div>
        }

        <div class="help__actions">
          @if (pdfUrl(); as href) {
            <a class="p-button p-component" [href]="href" target="_blank" rel="noopener">
              <i class="pi pi-file-pdf"></i>
              <span>Ver manual (PDF)</span>
            </a>
          } @else if (!loading()) {
            <small class="help__muted">El manual en PDF estará disponible próximamente.</small>
          }
        </div>
      } @else {
        <p class="help__summary">Esta pantalla no tiene ayuda específica.</p>
      }
    </p-dialog>
  `,
  styles: `
    .help__summary {
      margin: 0 0 1rem;
      color: var(--p-surface-600);
    }
    .help__video {
      width: 100%;
      aspect-ratio: 16 / 9;
      border-radius: 0.5rem;
      background: #000;
    }
    .help__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      aspect-ratio: 16 / 9;
      border-radius: 0.5rem;
      background: var(--p-surface-100);
      color: var(--p-surface-500);
      text-align: center;
      padding: 1rem;
      .pi {
        font-size: 2rem;
      }
    }
    .help__actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      margin-top: 1rem;
      a {
        gap: 0.5rem;
        text-decoration: none;
      }
    }
    .help__muted {
      color: var(--p-surface-500);
    }
  `,
})
export class HelpDialog {
  private readonly router = inject(Router);

  readonly visible = model(false);
  /** Para abrir la ayuda de un tema concreto en vez del de la URL actual. */
  readonly topicOverride = input<string | null>(null);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly key = computed(() => this.topicOverride() ?? topicKey(this.url()));
  protected readonly topic = computed<HelpTopic | null>(() => HELP_TOPICS[this.key()] ?? null);

  private readonly manifest = signal<HelpManifest | null>(null);
  protected readonly loading = computed(() => this.manifest() === null);
  private readonly entry = computed(() => this.manifest()?.[this.key()] ?? null);

  protected readonly videoUrl = computed(() => {
    const e = this.entry();
    if (!e?.video) return null;
    return `${environment.supabaseUrl}/storage/v1/object/public/ayuda/videos/${this.key()}.mp4?v=${e.version ?? ''}#t=0.5`;
  });

  protected readonly pdfUrl = computed(() => {
    const e = this.entry();
    if (!e?.pdf) return null;
    return `ayuda/manuales/${this.key()}.pdf?v=${e.version ?? ''}`;
  });

  protected async loadManifest(): Promise<void> {
    try {
      const res = await fetch('ayuda/manifest.json', { cache: 'no-cache' });
      this.manifest.set(res.ok ? ((await res.json()) as HelpManifest) : {});
    } catch {
      this.manifest.set({});
    }
  }
}
