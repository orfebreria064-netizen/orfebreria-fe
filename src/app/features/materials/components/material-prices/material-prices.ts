import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MATERIAL_TYPE_LABELS } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { todayIso } from '../../../../shared/utils/db';
import { MaterialPrice, MaterialPriceHistory } from '../../models/material.model';
import { MaterialsService } from '../../services/materials.service';

/**
 * Precios de venta del día por material (S/ por gramo, quilate o unidad).
 * ADMIN y GERENTE los actualizan; las cotizaciones y pedidos los sugieren al elegir el material.
 */
@Component({
  selector: 'app-material-prices',
  imports: [DatePipe, FormsModule, ButtonModule, DialogModule, InputNumberModule, TableModule, TagModule, EmptyState, LabelPipe, MoneyPipe],
  template: `
    <p class="muted small" style="margin-top: 0">
      Precio de venta por unidad de cada material. Al elegir el material en una cotización o pedido se sugiere el precio vigente.
      @if (outdated() > 0) {
        <span class="text-warn"><i class="pi pi-exclamation-triangle"></i> {{ outdated() }} sin precio de hoy.</span>
      }
    </p>

    <p-table [value]="rows()" [loading]="loading()" [scrollable]="true" [tableStyle]="{ 'min-width': '760px' }" dataKey="material_id">
      <ng-template #header>
        <tr>
          <th>Material</th>
          <th>Tipo</th>
          <th class="text-right">Precio vigente</th>
          <th>Fecha</th>
          <th class="text-right">Variación</th>
          @if (canWrite()) {
            <th class="text-right" style="width: 170px">Nuevo precio</th>
          }
          <th></th>
        </tr>
      </ng-template>
      <ng-template #body let-r>
        <tr>
          <td class="strong">{{ r.name }}{{ r.purity && !r.name.includes(r.purity) ? ' ' + r.purity : '' }}</td>
          <td>{{ r.type | label: typeLabels }}</td>
          <td class="text-right mono nowrap">
            @if (r.price != null) {
              {{ r.price | money }} / {{ r.unit }}
            } @else {
              <span class="muted">Sin precio</span>
            }
          </td>
          <td class="nowrap">
            @if (r.price_date) {
              @if (r.price_date === today) {
                <p-tag value="Hoy" severity="success" />
              } @else {
                <span class="text-warn" [title]="'Actualizado por ' + (r.updated_by ?? '—')">
                  <i class="pi pi-clock"></i> {{ r.price_date | date: 'dd/MM/yyyy' }}
                </span>
              }
            } @else {
              —
            }
          </td>
          <td class="text-right mono nowrap">
            @if (variation(r); as v) {
              <span [class.text-danger]="v < 0" [class.text-success]="v > 0">
                <i [class]="v > 0 ? 'pi pi-arrow-up' : v < 0 ? 'pi pi-arrow-down' : 'pi pi-minus'"></i>
                {{ v > 0 ? '+' : '' }}{{ v.toFixed(1) }}%
              </span>
            } @else {
              <span class="muted">—</span>
            }
          </td>
          @if (canWrite()) {
            <td class="text-right">
              <p-inputnumber
                [(ngModel)]="draft[r.material_id]"
                mode="currency"
                currency="PEN"
                locale="es-PE"
                [min]="0"
                inputStyleClass="text-right"
                [fluid]="true"
                [placeholder]="r.price != null ? (r.price | money) : 'S/ 0.00'"
                [ariaLabel]="'Nuevo precio de ' + r.name"
              />
            </td>
          }
          <td class="text-right">
            <p-button icon="pi pi-history" [text]="true" severity="secondary" ariaLabel="Ver historial" title="Historial" (onClick)="openHistory(r)" />
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr><td [attr.colspan]="canWrite() ? 7 : 6"><app-empty-state icon="pi pi-dollar" message="Registre primero sus materiales (oro, plata, piedras)." /></td></tr>
      </ng-template>
    </p-table>

    @if (canWrite() && rows().length) {
      <div class="form-actions">
        <span class="muted small">{{ pending() }} precio(s) por guardar con fecha de hoy.</span>
        <p-button label="Descartar" severity="secondary" [text]="true" [disabled]="!pending()" (onClick)="draft = {}" />
        <p-button label="Guardar precios" icon="pi pi-check" [loading]="saving()" [disabled]="!pending()" (onClick)="save()" />
      </div>
    }

    <p-dialog [header]="'Historial: ' + (historyOf()?.name ?? '')" [(visible)]="historyVisible" [modal]="true" [style]="{ width: '480px' }" [draggable]="false">
      <p-table [value]="history()" [loading]="loadingHistory()" [scrollable]="true" scrollHeight="360px">
        <ng-template #header>
          <tr>
            <th>Fecha</th>
            <th class="text-right">Precio</th>
            <th>Registrado por</th>
          </tr>
        </ng-template>
        <ng-template #body let-h>
          <tr>
            <td class="nowrap">{{ h.price_date | date: 'dd/MM/yyyy' }}</td>
            <td class="text-right mono nowrap">{{ h.price | money }} / {{ historyOf()?.unit }}</td>
            <td>{{ h.updated_by ?? '—' }}</td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr><td colspan="3"><app-empty-state icon="pi pi-history" message="Aún no hay precios registrados." /></td></tr>
        </ng-template>
      </p-table>
    </p-dialog>
  `,
})
export class MaterialPrices implements OnInit {
  private readonly service = inject(MaterialsService);
  private readonly notify = inject(NotifyService);

  readonly canWrite = input(false);

  protected readonly typeLabels = MATERIAL_TYPE_LABELS;
  protected readonly today = todayIso();
  protected readonly rows = signal<MaterialPrice[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  /** Precios escritos y aún no guardados, por material. */
  protected draft: Record<string, number | null> = {};

  protected historyVisible = false;
  protected readonly historyOf = signal<MaterialPrice | null>(null);
  protected readonly history = signal<MaterialPriceHistory[]>([]);
  protected readonly loadingHistory = signal(false);

  protected readonly outdated = computed(() => this.rows().filter((r) => r.price_date !== this.today).length);

  ngOnInit(): void {
    void this.load();
  }

  protected pending(): number {
    return Object.values(this.draft).filter((v) => v != null && v > 0).length;
  }

  /** % respecto del precio anterior (null si no hay con qué comparar). */
  protected variation(r: MaterialPrice): number | null {
    if (r.price == null || !r.previous_price) return null;
    return ((Number(r.price) - Number(r.previous_price)) / Number(r.previous_price)) * 100;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.service.currentPrices());
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los precios.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    const prices = Object.entries(this.draft)
      .filter((e): e is [string, number] => e[1] != null && e[1] > 0)
      .map(([material_id, price]) => ({ material_id, price }));
    if (!prices.length) return;
    this.saving.set(true);
    try {
      await this.service.savePrices(prices);
      this.draft = {};
      this.notify.success(`Se actualizaron ${prices.length} precio(s) del día.`);
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudieron guardar los precios.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async openHistory(r: MaterialPrice): Promise<void> {
    this.historyOf.set(r);
    this.history.set([]);
    this.historyVisible = true;
    this.loadingHistory.set(true);
    try {
      this.history.set(await this.service.priceHistory(r.material_id));
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el historial.');
    } finally {
      this.loadingHistory.set(false);
    }
  }
}
