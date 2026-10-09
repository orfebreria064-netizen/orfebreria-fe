import { AfterViewInit, Component, ElementRef, signal, viewChild } from '@angular/core';
import { ButtonModule } from 'primeng/button';

/** Lienzo para capturar la firma del cliente con mouse, lápiz o dedo (Pointer Events). */
@Component({
  selector: 'app-signature-pad',
  imports: [ButtonModule],
  template: `
    <div class="pad">
      <canvas
        #canvas
        (pointerdown)="start($event)"
        (pointermove)="move($event)"
        (pointerup)="end()"
        (pointerleave)="end()"
        aria-label="Área de firma"
      ></canvas>
      @if (empty()) {
        <span class="pad__hint">Firme aquí</span>
      }
    </div>
    <p-button label="Limpiar firma" icon="pi pi-eraser" size="small" [text]="true" severity="secondary" (onClick)="clear()" />
  `,
  styles: `
    .pad {
      position: relative;
      border: 1px dashed var(--p-surface-300);
      border-radius: 0.5rem;
      background: var(--p-surface-0);
      height: 160px;
    }
    canvas {
      width: 100%;
      height: 100%;
      touch-action: none;
      display: block;
      cursor: crosshair;
    }
    .pad__hint {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--p-surface-400);
      pointer-events: none;
      font-size: 0.85rem;
    }
  `,
})
export class SignaturePad implements AfterViewInit {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;
  protected readonly empty = signal(true);

  ngAfterViewInit(): void {
    const el = this.canvas().nativeElement;
    const ratio = window.devicePixelRatio || 1;
    el.width = el.offsetWidth * ratio;
    el.height = el.offsetHeight * ratio;
    this.ctx = el.getContext('2d');
    if (!this.ctx) return;
    this.ctx.scale(ratio, ratio);
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = 'round';
    this.ctx.strokeStyle = '#1f2430';
  }

  protected start(e: PointerEvent): void {
    if (!this.ctx) return;
    this.drawing = true;
    this.canvas().nativeElement.setPointerCapture(e.pointerId);
    this.ctx.beginPath();
    this.ctx.moveTo(e.offsetX, e.offsetY);
  }

  protected move(e: PointerEvent): void {
    if (!this.drawing || !this.ctx) return;
    this.ctx.lineTo(e.offsetX, e.offsetY);
    this.ctx.stroke();
    if (this.empty()) this.empty.set(false);
  }

  protected end(): void {
    this.drawing = false;
  }

  clear(): void {
    const el = this.canvas().nativeElement;
    this.ctx?.clearRect(0, 0, el.width, el.height);
    this.empty.set(true);
  }

  isEmpty(): boolean {
    return this.empty();
  }

  /** Imagen PNG de la firma, o null si no se firmó. */
  toBlob(): Promise<Blob | null> {
    if (this.empty()) return Promise.resolve(null);
    return new Promise((resolve) => this.canvas().nativeElement.toBlob((b) => resolve(b), 'image/png'));
  }
}
