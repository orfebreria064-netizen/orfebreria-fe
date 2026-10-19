import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { MATERIAL_TYPE_LABELS, MATERIAL_TYPE_OPTIONS, MOVEMENT_TYPE_OPTIONS, MaterialType, MovementType } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { LabelPipe } from '../../../../shared/pipes/label.pipe';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { QtyPipe } from '../../../../shared/pipes/qty.pipe';
import { Material, MaterialMovement } from '../../models/material.model';
import { MaterialsService } from '../../services/materials.service';
import { MaterialDialog } from '../../components/material-dialog/material-dialog';
import { MovementDialog } from '../../components/movement-dialog/movement-dialog';
import { MovementsTable } from '../../components/movements-table/movements-table';
import { MaterialPrices } from '../../components/material-prices/material-prices';

@Component({
  selector: 'app-material-list',
  imports: [
    FormsModule,
    ButtonModule,
    TableModule,
    TabsModule,
    SelectModule,
    CheckboxModule,
    TagModule,
    PageHeader,
    EmptyState,
    StatCard,
    LabelPipe,
    MoneyPipe,
    QtyPipe,
    MaterialDialog,
    MovementDialog,
    MovementsTable,
    MaterialPrices,
  ],
  templateUrl: './material-list.html',
})
export class MaterialList implements OnInit {
  private readonly service = inject(MaterialsService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly materials = signal<Material[]>([]);
  protected readonly movements = signal<MaterialMovement[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMovements = signal(false);
  protected readonly canWrite = this.auth.hasRole(...MODULE_ROLES.materialsWrite);

  protected readonly typeOptions = MATERIAL_TYPE_OPTIONS;
  protected readonly typeLabels = MATERIAL_TYPE_LABELS;
  protected readonly movementTypes = MOVEMENT_TYPE_OPTIONS;
  protected type: MaterialType | null = null;
  protected includeInactive = false;
  protected movementType: MovementType | null = null;

  protected readonly materialDialog = signal(false);
  protected readonly movementDialog = signal(false);
  protected readonly editing = signal<Material | null>(null);

  protected readonly lowStock = computed(() => this.materials().filter((m) => m.active && Number(m.stock) <= Number(m.min_stock)));
  protected readonly inventoryValue = computed(() =>
    formatMoney(this.materials().reduce((acc, m) => acc + Number(m.stock) * Number(m.reference_cost), 0)),
  );
  protected readonly metalGrams = computed(() =>
    this.materials()
      .filter((m) => m.unit === 'g')
      .reduce((acc, m) => acc + Number(m.stock), 0)
      .toFixed(2),
  );

  ngOnInit(): void {
    void this.load();
    void this.loadMovements();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.materials.set(await this.service.list({ includeInactive: this.includeInactive, type: this.type }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los materiales.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadMovements(): Promise<void> {
    this.loadingMovements.set(true);
    try {
      this.movements.set(await this.service.movements({ type: this.movementType, limit: 300 }));
    } catch (err) {
      this.notify.error(err, 'No se pudieron cargar los movimientos.');
    } finally {
      this.loadingMovements.set(false);
    }
  }

  protected isLow(m: Material): boolean {
    return m.active && Number(m.stock) <= Number(m.min_stock);
  }

  protected openNew(): void {
    this.editing.set(null);
    this.materialDialog.set(true);
  }

  protected edit(m: Material, event: Event): void {
    event.stopPropagation();
    this.editing.set(m);
    this.materialDialog.set(true);
  }

  protected open(m: Material): void {
    void this.router.navigate(['/materials', m.id]);
  }

  protected async afterMovement(): Promise<void> {
    await Promise.all([this.load(), this.loadMovements()]);
  }
}
