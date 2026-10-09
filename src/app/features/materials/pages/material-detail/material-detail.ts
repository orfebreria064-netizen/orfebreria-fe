import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { MATERIAL_TYPE_LABELS } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { BreadcrumbService } from '../../../../layout/breadcrumb.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { formatMoney } from '../../../../shared/pipes/money.pipe';
import { Material, MaterialMovement } from '../../models/material.model';
import { MaterialsService } from '../../services/materials.service';
import { MaterialDialog } from '../../components/material-dialog/material-dialog';
import { MovementDialog } from '../../components/movement-dialog/movement-dialog';
import { MovementsTable } from '../../components/movements-table/movements-table';

/** Kardex de un material: stock y todos sus movimientos. */
@Component({
  selector: 'app-material-detail',
  imports: [ButtonModule, SkeletonModule, TagModule, PageHeader, StatCard, MaterialDialog, MovementDialog, MovementsTable],
  template: `
    @if (material(); as m) {
      <app-page-header [title]="m.name" [subtitle]="typeLabels[m.type] + (m.purity ? ' · Ley ' + m.purity : '')" backLink="/materials" backLabel="Materiales">
        <p-button label="Registrar movimiento" icon="pi pi-arrow-right-arrow-left" (onClick)="movementDialog.set(true)" />
        @if (canWrite) {
          <p-button label="Editar" icon="pi pi-pencil" severity="secondary" [outlined]="true" (onClick)="materialDialog.set(true)" />
        }
      </app-page-header>

      <div class="grid-cols grid-cols--3" style="margin-bottom: 1rem">
        <app-stat-card label="Stock actual" [value]="stockLabel(m)" icon="pi pi-box" [tone]="low(m) ? 'red' : 'gold'" [hint]="low(m) ? 'Por debajo del mínimo' : null" />
        <app-stat-card label="Stock mínimo" [value]="m.min_stock + ' ' + m.unit" icon="pi pi-sliders-h" tone="ink" />
        <app-stat-card label="Valor referencial" [value]="value(m)" icon="pi pi-dollar" tone="green" />
      </div>

      <div class="card">
        <h2 class="card__title">Kardex de movimientos</h2>
        <app-movements-table [movements]="movements()" [loading]="loading()" [showMaterial]="false" />
      </div>

      <app-material-dialog [(visible)]="materialDialog" [material]="m" (saved)="load()" />
      <app-movement-dialog [(visible)]="movementDialog" [materialId]="m.id" (saved)="load()" />
    } @else {
      <p-skeleton height="4rem" styleClass="mb-3" />
      <p-skeleton height="20rem" />
    }
  `,
})
export class MaterialDetail implements OnInit {
  private readonly service = inject(MaterialsService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly material = signal<Material | null>(null);
  protected readonly movements = signal<MaterialMovement[]>([]);
  protected readonly loading = signal(true);
  protected readonly materialDialog = signal(false);
  protected readonly movementDialog = signal(false);
  protected readonly canWrite = this.auth.hasRole(...MODULE_ROLES.materialsWrite);
  protected readonly typeLabels = MATERIAL_TYPE_LABELS;

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [material, movements] = await Promise.all([
        this.service.get(this.id()),
        this.service.movements({ materialId: this.id() }),
      ]);
      this.material.set(material);
      this.movements.set(movements);
      this.breadcrumb.setDetail(material.name);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el material.');
      void this.router.navigate(['/materials']);
    } finally {
      this.loading.set(false);
    }
  }

  protected stockLabel(m: Material): string {
    return `${Number(m.stock).toFixed(2)} ${m.unit}`;
  }

  protected low(m: Material): boolean {
    return Number(m.stock) <= Number(m.min_stock);
  }

  protected value(m: Material): string {
    return formatMoney(Number(m.stock) * Number(m.reference_cost));
  }
}
