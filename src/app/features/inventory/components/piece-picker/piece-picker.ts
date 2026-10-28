import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { Currency } from '../../../../core/models/domain';
import { MarketService } from '../../../../core/services/market.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { QuotationItem } from '../../../quotations/models/quotation.model';
import { Gem, InventoryService, PRODUCT_CATEGORY_LABELS, Product, gemSummary } from '../../services/inventory.service';

/**
 * Elige una joya o piedra en stock para venderla en el pedido. Si la pieza tiene otra moneda que el
 * pedido, el precio se convierte con el TC de venta del día.
 */
@Component({
  selector: 'app-piece-picker',
  imports: [DecimalPipe, FormsModule, ButtonModule, DialogModule, IconFieldModule, InputIconModule, InputTextModule, TableModule, TabsModule, EmptyState, MoneyPipe],
  template: `
    <p-dialog header="Agregar desde la vitrina" [(visible)]="visible" [modal]="true" [style]="{ width: '820px' }" [breakpoints]="{ '860px': '96vw' }" [draggable]="false">
      <div class="toolbar-filters">
        <p-iconfield>
          <p-inputicon styleClass="pi pi-search" />
          <input pInputText [(ngModel)]="search" placeholder="Buscar por código, nombre o característica" />
        </p-iconfield>
        @if (rate()) {
          <span class="small muted">TC venta hoy: {{ rate() | number: '1.3-3' }}</span>
        }
      </div>
      <p-tabs value="products">
        <p-tablist>
          <p-tab value="products">Joyas ({{ products().length }})</p-tab>
          <p-tab value="gems">Piedras sueltas ({{ gems().length }})</p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="products">
            <p-table [value]="filteredProducts()" [loading]="loading()" [scrollable]="true" scrollHeight="380px" size="small">
              <ng-template #body let-p>
                <tr>
                  <td style="width: 64px">
                    @if (p.photo_url) {
                      <img class="thumb" [src]="p.photo_url" [alt]="p.name" />
                    } @else {
                      <span class="thumb thumb--empty"><i class="pi pi-image"></i></span>
                    }
                  </td>
                  <td>
                    <strong>{{ p.name }}</strong>
                    <br /><span class="small muted mono">{{ p.code }}</span> <span class="small muted">· {{ $any(categoryLabels)[p.category] }} {{ p.metal ?? '' }}</span>
                  </td>
                  <td class="text-right mono nowrap">{{ p.price | money: p.currency }}</td>
                  <td class="text-right"><p-button label="Agregar" size="small" icon="pi pi-plus" (onClick)="pickProduct(p)" /></td>
                </tr>
              </ng-template>
              <ng-template #emptymessage>
                <tr><td colspan="4"><app-empty-state icon="pi pi-star" message="No hay joyas disponibles en vitrina." /></td></tr>
              </ng-template>
            </p-table>
          </p-tabpanel>
          <p-tabpanel value="gems">
            <p-table [value]="filteredGems()" [loading]="loading()" [scrollable]="true" scrollHeight="380px" size="small">
              <ng-template #body let-g>
                <tr>
                  <td>
                    <strong>{{ summary(g) }}</strong>
                    <br /><span class="small muted mono">{{ g.code }}{{ g.lab ? ' · ' + g.lab + ' ' + (g.certificate_number ?? '') : '' }}</span>
                  </td>
                  <td class="text-right mono nowrap">{{ g.price | money: g.currency }}</td>
                  <td class="text-right"><p-button label="Agregar" size="small" icon="pi pi-plus" (onClick)="pickGem(g)" /></td>
                </tr>
              </ng-template>
              <ng-template #emptymessage>
                <tr><td colspan="3"><app-empty-state icon="pi pi-sparkles" message="No hay piedras sueltas disponibles." /></td></tr>
              </ng-template>
            </p-table>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </p-dialog>
  `,
  styles: `
    .thumb {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: 0.4rem;
      object-fit: cover;
    }
    .thumb--empty {
      background: var(--p-surface-100);
      color: var(--p-surface-400);
    }
  `,
})
export class PiecePicker {
  private readonly service = inject(InventoryService);
  private readonly market = inject(MarketService);
  private readonly notify = inject(NotifyService);

  readonly visible = model(false);
  /** Moneda del pedido. */
  readonly currency = input<Currency>('PEN');
  /** Piezas ya agregadas al pedido (no se ofrecen de nuevo). */
  readonly exclude = input<string[]>([]);
  readonly picked = output<Partial<QuotationItem>>();

  protected readonly categoryLabels = PRODUCT_CATEGORY_LABELS;
  protected readonly summary = gemSummary;
  protected readonly loading = signal(false);
  protected readonly products = signal<Product[]>([]);
  protected readonly gems = signal<Gem[]>([]);
  protected readonly rate = signal<number | null>(null);
  protected search = '';

  protected filteredProducts(): Product[] {
    const t = this.search.trim().toLowerCase();
    return this.products().filter(
      (p) => !this.exclude().includes(p.id) && (!t || `${p.code} ${p.name} ${p.metal ?? ''} ${p.description ?? ''}`.toLowerCase().includes(t)),
    );
  }

  protected filteredGems(): Gem[] {
    const t = this.search.trim().toLowerCase();
    return this.gems().filter(
      (g) => !this.exclude().includes(g.id) && (!t || `${g.code} ${gemSummary(g)} ${g.certificate_number ?? ''}`.toLowerCase().includes(t)),
    );
  }

  constructor() {
    effect(() => {
      if (this.visible()) void this.load();
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [{ products, gems }, today] = await Promise.all([this.service.available(), this.market.today().catch(() => null)]);
      this.products.set(products);
      this.gems.set(gems);
      this.rate.set(today?.exchange ? Number(today.exchange.sell) : null);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar la vitrina.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Precio en la moneda del pedido (null si no hay TC para convertir). */
  private convert(price: number, from: Currency): { price: number; note: string | null } | null {
    const to = this.currency();
    if (from === to) return { price: Number(price), note: null };
    const rate = this.rate();
    if (!rate) return null;
    const value = from === 'USD' ? Number(price) * rate : Number(price) / rate;
    return { price: Math.round(value * 100) / 100, note: `Precio de lista ${from === 'USD' ? 'US$' : 'S/'} ${Number(price).toFixed(2)} al TC ${rate.toFixed(3)}` };
  }

  protected pickProduct(p: Product): void {
    const c = this.convert(p.price, p.currency);
    if (!c) {
      this.notify.warn('No hay tipo de cambio registrado para convertir el precio.');
      return;
    }
    const stones = (p.gems ?? []).map((g) => (g.gem ? gemSummary(g.gem) : `${g.quantity} ${g.description}`)).join('; ');
    const detail = [p.metal, p.size ? `talla ${p.size}` : null, stones || null, c.note].filter(Boolean).join(' · ');
    this.picked.emit({
      description: `${p.name} (${p.code})`,
      detail: detail.slice(0, 500) || null,
      material_id: p.material_id,
      material_name: p.metal,
      quantity: 1,
      unit: 'und',
      weight: p.weight_g != null ? Number(p.weight_g) : null,
      unit_price: c.price,
      discount: 0,
      product_id: p.id,
      gem_id: null,
    });
    this.visible.set(false);
  }

  protected pickGem(g: Gem): void {
    const c = this.convert(g.price, g.currency);
    if (!c) {
      this.notify.warn('No hay tipo de cambio registrado para convertir el precio.');
      return;
    }
    const cert = g.lab ? `Certificado ${g.lab} ${g.certificate_number ?? ''}`.trim() : null;
    this.picked.emit({
      description: `${gemSummary(g)} (${g.code})`.slice(0, 200),
      detail: [cert, c.note].filter(Boolean).join(' · ') || null,
      material_id: null,
      material_name: null,
      quantity: 1,
      unit: 'und',
      weight: null,
      unit_price: c.price,
      discount: 0,
      product_id: null,
      gem_id: g.id,
    });
    this.visible.set(false);
  }
}
