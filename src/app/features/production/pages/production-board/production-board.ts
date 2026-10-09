import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { MenuModule } from 'primeng/menu';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';
import { SkeletonModule } from 'primeng/skeleton';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { PRIORITY_LABELS, PRIORITY_SEVERITY, STAGE_STATUS_LABELS, StageStatus } from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { daysUntil } from '../../../../shared/utils/format';
import { BoardStage } from '../../../orders/models/order.model';
import { ProductionService } from '../../services/production.service';

interface Column {
  status: StageStatus;
  label: string;
  icon: string;
}

const COLUMNS: Column[] = [
  { status: 'PENDIENTE', label: 'Pendiente', icon: 'pi pi-clock' },
  { status: 'EN_PROCESO', label: 'En proceso', icon: 'pi pi-spin pi-cog' },
  { status: 'COMPLETADO', label: 'Completado', icon: 'pi pi-check-circle' },
  { status: 'BLOQUEADO', label: 'Bloqueado', icon: 'pi pi-ban' },
];

/** Las etapas completadas se muestran durante esta cantidad de días en el tablero. */
const RECENT_DAYS = 7;

/** Tablero Kanban de producción con drag & drop (CDK, compatible con pantallas táctiles). */
@Component({
  selector: 'app-production-board',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    ButtonModule,
    SelectModule,
    CheckboxModule,
    MenuModule,
    TagModule,
    ProgressBarModule,
    SkeletonModule,
    PageHeader,
    StatusTag,
  ],
  templateUrl: './production-board.html',
  styleUrl: './production-board.scss',
})
export class ProductionBoard implements OnInit {
  private readonly service = inject(ProductionService);
  protected readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  protected readonly columns = COLUMNS;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly prioritySeverity = PRIORITY_SEVERITY;
  protected readonly loading = signal(true);
  protected readonly stages = signal<BoardStage[]>([]);
  protected readonly canManage = this.auth.hasRole(...MODULE_ROLES.productionManage);

  protected onlyCurrent = true;
  protected assignedTo: string | null = null;
  protected stageName: string | null = null;

  protected readonly stageNames = computed(() =>
    this.lookups
      .stageTemplates()
      .filter((s) => s.active)
      .map((s) => ({ label: s.name, value: s.name })),
  );

  /** Tarjetas agrupadas por columna, aplicando el filtro "solo etapa actual". */
  protected readonly byStatus = computed(() => {
    const groups: Record<StageStatus, BoardStage[]> = { PENDIENTE: [], EN_PROCESO: [], COMPLETADO: [], BLOQUEADO: [] };
    for (const s of this.stages()) {
      if (this.onlyCurrentSignal() && !this.isVisibleInCurrentMode(s)) continue;
      groups[s.status].push(s);
    }
    for (const list of Object.values(groups)) {
      list.sort((a, b) => (a.order.due_date ?? '9999').localeCompare(b.order.due_date ?? '9999'));
    }
    return groups;
  });
  private readonly onlyCurrentSignal = signal(true);

  ngOnInit(): void {
    if (this.auth.hasRole('ORFEBRE')) this.assignedTo = this.auth.profile()?.id ?? null;
    void this.lookups.ensureLoaded();
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.onlyCurrentSignal.set(this.onlyCurrent);
    try {
      this.stages.set(await this.service.board({ assignedTo: this.assignedTo, stageName: this.stageName }));
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el tablero de producción.');
    } finally {
      this.loading.set(false);
    }
  }

  private isVisibleInCurrentMode(s: BoardStage): boolean {
    if (s.is_current) return true;
    if (s.status === 'BLOQUEADO' || s.status === 'EN_PROCESO') return true;
    if (s.status === 'COMPLETADO' && s.completed_at) {
      return Date.now() - new Date(s.completed_at).getTime() < RECENT_DAYS * 86_400_000;
    }
    return false;
  }

  protected canMove(s: BoardStage): boolean {
    if (this.canManage) return true;
    const me = this.auth.profile()?.id;
    return s.assigned_to === me;
  }

  protected isOverdue(s: BoardStage): boolean {
    const d = daysUntil(s.order.due_date);
    return d !== null && d < 0;
  }

  protected async drop(event: CdkDragDrop<StageStatus>): Promise<void> {
    const stage = event.item.data as BoardStage;
    const target = event.container.data;
    if (event.previousContainer === event.container || stage.status === target) return;
    await this.move(stage, target);
  }

  protected menuFor(stage: BoardStage): MenuItem[] {
    return COLUMNS.filter((c) => c.status !== stage.status).map((c) => ({
      label: `Mover a ${c.label}`,
      icon: c.icon.replace(' pi-spin', ''),
      command: () => void this.move(stage, c.status),
    }));
  }

  private async move(stage: BoardStage, status: StageStatus): Promise<void> {
    const previous = this.stages();
    // Actualización optimista; la base de datos recalcula etapa actual, avance y estado del pedido.
    this.stages.set(previous.map((s) => (s.id === stage.id ? { ...s, status, is_current: s.is_current } : s)));
    try {
      await this.service.setStatus(stage.id, status);
      this.notify.success(`${stage.order.number} · ${stage.name}: ${STAGE_STATUS_LABELS[status]}.`);
      await this.load();
    } catch (err) {
      this.stages.set(previous);
      this.notify.error(err, 'No se pudo mover la etapa.');
    }
  }
}
