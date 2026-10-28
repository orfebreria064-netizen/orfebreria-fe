import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { Material } from '../../../materials/models/material.model';
import { MaterialsService } from '../../../materials/services/materials.service';
import { GemDialog } from '../../components/gem-dialog/gem-dialog';
import { ProductDialog } from '../../components/product-dialog/product-dialog';
import {
  GEM_SHAPE_LABELS,
  GEM_TYPE_LABELS,
  GEM_TYPE_OPTIONS,
  GRADE_SHORT,
  Gem,
  InventoryService,
  METAL_COLOR_LABELS,
  PIECE_STATUS_LABELS,
  PIECE_STATUS_SEVERITY,
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_OPTIONS,
  Product,
  colorGroup,
  gemSummary,
} from '../../services/inventory.service';

/** Vitrina: joyas terminadas en stock y piedras registradas (diamantes con las 4C). Se venden desde un pedido de tipo Venta. */
@Component({
  selector: 'app-inventory',
  imports: [
    DecimalPipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    TableModule,
    TabsModule,
    TagModule,
    EmptyState,
    PageHeader,
    StatCard,
    LabelPipe,
    MoneyPipe,
    GemDialog,
    ProductDialog,
  ],
  template: `
    <app-page-header title="Vitrina" subtitle="Joyas en stock y piedras registradas. Para vender, cree un pedido de tipo Venta y agregue la pieza desde la vitrina.">
      @if (canWrite) {
        <p-button label="Nueva piedra" icon="pi pi-plus" severity="secondary" [outlined]="true" (onClick)="openGem(null)" />
        <p-button label="Nueva joya" icon="pi pi-plus" (onClick)="openProduct(null)" />
      }
    </app-page-header>

    <div class="kpis">
      <app-stat-card label="Joyas en vitrina" [value]="stockCount()" icon="pi pi-star" tone="gold" />
      <app-stat-card label="Valor de venta en vitrina" [value]="stockValue()" icon="pi pi-tag" tone="green" />
      <app-stat-card label="Piedras en stock" [value]="gemStockCount()" icon="pi pi-sparkles" tone="blue" [hint]="gemCarats()" />
      <app-stat-card label="Reservadas" [value]="reservedCount()" icon="pi pi-clock" tone="orange" />
    </div>

    <div class="card" style="margin-top: 1rem">
      <p-tabs value="products">
        <p-tablist>
          <p-tab value="products"><i class="pi pi-star"></i> Joyas</p-tab>
          <p-tab value="gems"><i class="pi pi-sparkles"></i> Piedras y diamantes</p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="products">
            <div class="toolbar-filters">
              <p-iconfield>
                <p-inputicon styleClass="pi pi-search" />
                <input pInputText [(ngModel)]="search" placeholder="Buscar por código o nombre" />
              </p-iconfield>
              <p-select [options]="categories" [(ngModel)]="category" optionLabel="label" optionValue="value" placeholder="Categoría" [showClear]="true" />
              <p-select [options]="productStatuses" [(ngModel)]="productStatus" optionLabel="label" optionValue="value" placeholder="Estado" [showClear]="true" />
            </div>
            @if (!filteredProducts().length && !loading()) {
              <app-empty-state icon="pi pi-star" message="No hay joyas con esos filtros." />
            }
            <div class="grid">
              @for (p of filteredProducts(); track p.id) {
                <article class="piece" [class.piece--off]="p.status !== 'STOCK'">
                  <div class="piece__photo">
                    @if (p.photo_url) {
                      <img [src]="p.photo_url" [alt]="p.name" loading="lazy" />
                    } @else {
                      <i class="pi pi-image"></i>
                    }
                    <p-tag class="piece__status" [value]="p.status | label: statusLabels" [severity]="$any(severities)[p.status]" />
                  </div>
                  <div class="piece__body">
                    <span class="muted small mono">{{ p.code }} · {{ p.category | label: categoryLabels }}</span>
                    <strong>{{ p.name }}</strong>
                    <span class="small">
                      {{ p.metal ?? '' }}{{ p.metal_color ? ' ' + (p.metal_color | label: metalColors).toLowerCase() : '' }}{{ p.weight_g ? ' · ' + p.weight_g + ' g' : '' }}{{ p.size ? ' · talla ' + p.size : '' }}
                    </span>
                    @for (g of p.gems ?? []; track $index) {
                      <span class="small muted"><i class="pi pi-sparkles"></i> {{ g.gem ? summary(g.gem) : g.quantity + ' ' + g.description + (g.total_carat ? ' (' + g.total_carat + ' ct)' : '') }}</span>
                    }
                    <div class="row row--between piece__foot">
                      <strong class="mono">{{ p.price | money: p.currency }}</strong>
                      @if (canWrite) {
                        <span>
                          <p-button icon="pi pi-pencil" [text]="true" size="small" severity="secondary" ariaLabel="Editar" (onClick)="openProduct(p)" />
                          @if (p.status === 'STOCK' || p.status === 'BAJA') {
                            <p-button
                              [icon]="p.status === 'STOCK' ? 'pi pi-ban' : 'pi pi-replay'"
                              [text]="true"
                              size="small"
                              [severity]="p.status === 'STOCK' ? 'danger' : 'success'"
                              [ariaLabel]="p.status === 'STOCK' ? 'Dar de baja' : 'Volver a stock'"
                              [title]="p.status === 'STOCK' ? 'Dar de baja' : 'Volver a stock'"
                              (onClick)="toggleProduct(p)"
                            />
                          }
                        </span>
                      }
                    </div>
                    @if (p.order) {
                      <a class="small" [routerLink]="['/orders', p.order.id]">Pedido {{ p.order.number }}</a>
                    }
                    @if (canSeeCost && p.cost) {
                      <span class="small muted">Costo {{ p.cost | money: p.currency }}</span>
                    }
                  </div>
                </article>
              }
            </div>
          </p-tabpanel>

          <p-tabpanel value="gems">
            <div class="toolbar-filters">
              <p-select [options]="gemTypes" [(ngModel)]="gemType" optionLabel="label" optionValue="value" placeholder="Tipo" [showClear]="true" />
              <p-select [options]="gemStatuses" [(ngModel)]="gemStatus" optionLabel="label" optionValue="value" placeholder="Estado" [showClear]="true" />
            </div>
            <p-table [value]="filteredGems()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '1050px' }" [rowHover]="true" sortMode="single">
              <ng-template #header>
                <tr>
                  <th>Código</th>
                  <th>Piedra</th>
                  <th pSortableColumn="carat" class="text-right">Quilates <p-sortIcon field="carat" /></th>
                  <th>Color</th>
                  <th>Claridad</th>
                  <th>Talla / Pul. / Sim.</th>
                  <th>Medidas (mm)</th>
                  <th>Certificado</th>
                  <th>Estado</th>
                  <th class="text-right">Precio</th>
                  <th></th>
                </tr>
              </ng-template>
              <ng-template #body let-g>
                <tr>
                  <td class="mono small nowrap">{{ g.code }}</td>
                  <td>
                    {{ g.gem_type | label: gemTypeLabels }} {{ (g.shape | label: shapeLabels).toLowerCase() }}
                    @if (g.origin === 'CLIENTE') {
                      <br /><span class="small text-warn">De {{ g.customer?.full_name }}</span>
                    }
                  </td>
                  <td class="text-right mono">{{ g.carat | number: '1.2-3' }}</td>
                  <td>{{ g.color ?? '—' }} @if (colorGroup(g.color)) {<span class="muted small">{{ colorGroup(g.color) }}</span>}</td>
                  <td>{{ g.clarity ?? '—' }}</td>
                  <td class="mono small">{{ grade(g.cut_grade) }} / {{ grade(g.polish) }} / {{ grade(g.symmetry) }}</td>
                  <td class="mono small nowrap">{{ dims(g) }}</td>
                  <td class="small">{{ g.lab ? g.lab + ' ' + (g.certificate_number ?? '') : '—' }}</td>
                  <td class="nowrap">
                    <p-tag [value]="g.status | label: statusLabels" [severity]="$any(severities)[g.status]" />
                    @if (g.product) {
                      <br /><span class="small muted">en {{ g.product.code }}</span>
                    }
                    @if (g.order) {
                      <br /><a class="small" [routerLink]="['/orders', g.order.id]">{{ g.order.number }}</a>
                    }
                  </td>
                  <td class="text-right mono nowrap">{{ g.price | money: g.currency }}</td>
                  <td class="text-right nowrap">
                    @if (canWrite) {
                      <p-button icon="pi pi-pencil" [text]="true" severity="secondary" ariaLabel="Editar" (onClick)="openGem(g)" />
                      @if (g.status === 'STOCK' || g.status === 'BAJA') {
                        <p-button
                          [icon]="g.status === 'STOCK' ? 'pi pi-ban' : 'pi pi-replay'"
                          [text]="true"
                          [severity]="g.status === 'STOCK' ? 'danger' : 'success'"
                          [ariaLabel]="g.status === 'STOCK' ? 'Dar de baja' : 'Volver a stock'"
                          (onClick)="toggleGem(g)"
                        />
                      }
                    }
                  </td>
                </tr>
              </ng-template>
              <ng-template #emptymessage>
                <tr><td colspan="11"><app-empty-state icon="pi pi-sparkles" message="No hay piedras registradas con esos filtros." /></td></tr>
              </ng-template>
            </p-table>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </div>

    <app-product-dialog [(visible)]="productDialog" [product]="editingProduct()" [materials]="materials()" [gems]="stockGems()" (saved)="load()" />
    <app-gem-dialog [(visible)]="gemDialog" [gem]="editingGem()" (saved)="load()" />
  `,
  styles: `
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: var(--app-gap);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 0.9rem;
    }
    .piece {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--p-surface-200);
      border-radius: var(--app-radius);
      overflow: hidden;
      background: var(--p-surface-0);
    }
    .piece--off {
      opacity: 0.75;
    }
    .piece__photo {
      position: relative;
      display: grid;
      place-items: center;
      aspect-ratio: 4 / 3;
      background: var(--p-surface-100);
      color: var(--p-surface-400);
      font-size: 2rem;
    }
    .piece__photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .piece__status {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
    }
    .piece__body {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      padding: 0.7rem 0.8rem;
    }
    .piece__foot {
      margin-top: 0.3rem;
    }
  `,
})
export class Inventory implements OnInit {
  private readonly service = inject(InventoryService);
  private readonly materialsService = inject(MaterialsService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  protected readonly canWrite = this.auth.hasRole(...MODULE_ROLES.inventoryWrite);
  protected readonly canSeeCost = this.auth.hasRole('ADMIN', 'GERENTE');

  protected readonly categories = PRODUCT_CATEGORY_OPTIONS;
  protected readonly categoryLabels = PRODUCT_CATEGORY_LABELS;
  protected readonly metalColors = METAL_COLOR_LABELS;
  protected readonly statusLabels = PIECE_STATUS_LABELS;
  protected readonly severities = PIECE_STATUS_SEVERITY;
  protected readonly gemTypes = GEM_TYPE_OPTIONS;
  protected readonly gemTypeLabels = GEM_TYPE_LABELS;
  protected readonly shapeLabels = GEM_SHAPE_LABELS;
  protected readonly colorGroup = colorGroup;
  protected readonly summary = gemSummary;
  protected readonly productStatuses = (['STOCK', 'RESERVADO', 'VENDIDO', 'BAJA'] as const).map((value) => ({ value, label: PIECE_STATUS_LABELS[value] }));
  protected readonly gemStatuses = (['STOCK', 'RESERVADA', 'MONTADA', 'VENDIDA', 'DEVUELTA', 'BAJA'] as const).map((value) => ({ value, label: PIECE_STATUS_LABELS[value] }));

  protected search = '';
  protected category: string | null = null;
  protected productStatus: string | null = 'STOCK';
  protected gemType: string | null = null;
  protected gemStatus: string | null = null;

  protected readonly products = signal<Product[]>([]);
  protected readonly gems = signal<Gem[]>([]);
  protected readonly materials = signal<Material[]>([]);
  protected readonly loading = signal(true);

  protected productDialog = false;
  protected gemDialog = false;
  protected readonly editingProduct = signal<Product | null>(null);
  protected readonly editingGem = signal<Gem | null>(null);

  protected readonly stockGems = computed(() => this.gems().filter((g) => g.status === 'STOCK'));
  protected readonly stockCount = computed(() => String(this.products().filter((p) => p.status === 'STOCK').length));
  protected readonly reservedCount = computed(
    () => String(this.products().filter((p) => p.status === 'RESERVADO').length + this.gems().filter((g) => g.status === 'RESERVADA').length),
  );
  protected readonly gemStockCount = computed(() => String(this.stockGems().length));
  protected readonly gemCarats = computed(() => `${this.stockGems().reduce((a, g) => a + Number(g.carat), 0).toFixed(2)} ct en total`);
  protected readonly stockValue = computed(() => {
    const stock = this.products().filter((p) => p.status === 'STOCK');
    const pen = stock.filter((p) => p.currency === 'PEN').reduce((a, p) => a + Number(p.price), 0);
    const usd = stock.filter((p) => p.currency === 'USD').reduce((a, p) => a + Number(p.price), 0);
    return usd ? `${formatMoney(pen)} · ${formatMoney(usd, 'USD')}` : formatMoney(pen);
  });

  protected filteredProducts(): Product[] {
    const term = this.search.trim().toLowerCase();
    return this.products().filter(
      (p) =>
        (!this.category || p.category === this.category) &&
        (!this.productStatus || p.status === this.productStatus) &&
        (!term || p.code.toLowerCase().includes(term) || p.name.toLowerCase().includes(term)),
    );
  }

  protected filteredGems(): Gem[] {
    return this.gems().filter((g) => (!this.gemType || g.gem_type === this.gemType) && (!this.gemStatus || g.status === this.gemStatus));
  }

  ngOnInit(): void {
    void this.load();
    this.materialsService.list().then((m) => this.materials.set(m), () => undefined);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [products, gems] = await Promise.all([this.service.products(), this.service.gems()]);
      this.products.set(products);
      this.gems.set(gems);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar la vitrina.');
    } finally {
      this.loading.set(false);
    }
  }

  protected grade(g: string | null): string {
    return g ? GRADE_SHORT[g as keyof typeof GRADE_SHORT] : '—';
  }

  protected dims(g: Gem): string {
    const d = [g.length_mm, g.width_mm, g.depth_mm].filter((x) => x != null);
    return d.length ? d.map((x) => Number(x).toFixed(2)).join(' × ') : '—';
  }

  protected openProduct(p: Product | null): void {
    this.editingProduct.set(p);
    this.productDialog = true;
  }

  protected openGem(g: Gem | null): void {
    this.editingGem.set(g);
    this.gemDialog = true;
  }

  protected async toggleProduct(p: Product): Promise<void> {
    try {
      await this.service.setProductStatus(p.id, p.status === 'STOCK' ? 'BAJA' : 'STOCK');
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo cambiar el estado.');
    }
  }

  protected async toggleGem(g: Gem): Promise<void> {
    try {
      await this.service.setGemStatus(g.id, g.status === 'STOCK' ? 'BAJA' : 'STOCK');
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo cambiar el estado.');
    }
  }
}
