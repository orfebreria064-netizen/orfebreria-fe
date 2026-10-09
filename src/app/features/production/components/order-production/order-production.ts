import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { ProgressBarModule } from 'primeng/progressbar';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from 'primeng/api';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { STAGE_STATUS_LABELS, STAGE_STATUS_OPTIONS, STAGE_STATUS_SEVERITY, StageStatus } from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { Order, OrderStage } from '../../../orders/models/order.model';
import { ProductionService } from '../../services/production.service';

/** Pestaña "Producción" del pedido: etapas, responsables, avance y observaciones. */
@Component({
  selector: 'app-order-production',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    SelectModule,
    ProgressBarModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    CheckboxModule,
    TagModule,
    EmptyState,
    StatusTag,
  ],
  templateUrl: './order-production.html',
  styleUrl: './order-production.scss',
})
export class OrderProduction {
  private readonly service = inject(ProductionService);
  protected readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly auth = inject(AuthService);

  readonly order = input.required<Order>();
  readonly stages = input.required<OrderStage[]>();
  readonly locked = input(false);
  readonly changed = output<void>();

  protected readonly statusOptions = STAGE_STATUS_OPTIONS;
  protected readonly statusLabels = STAGE_STATUS_LABELS;
  protected readonly statusSeverity = STAGE_STATUS_SEVERITY;
  protected readonly canManage = this.auth.hasRole(...MODULE_ROLES.productionManage);
  protected readonly busy = signal(false);

  protected readonly completed = computed(() => this.stages().filter((s) => s.status === 'COMPLETADO').length);

  // Diálogo de etapa (alta / observaciones)
  protected readonly dialog = signal(false);
  protected editing: OrderStage | null = null;
  protected stageName = '';
  protected stageNotes = '';
  protected stageIsQc = false;

  /** El orfebre solo actualiza sus etapas o las de pedidos que tiene asignados (lo valida RLS). */
  protected canUpdate(stage: OrderStage): boolean {
    if (this.locked()) return false;
    if (this.canManage) return true;
    const me = this.auth.profile()?.id;
    return this.auth.hasRole('ORFEBRE') && (stage.assigned_to === me || this.order().assigned_to === me);
  }

  protected async generate(): Promise<void> {
    this.busy.set(true);
    try {
      const n = await this.service.createFromTemplate(this.order().id);
      this.notify.success(`Se crearon ${n} etapas de producción.`);
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudieron crear las etapas.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async setStatus(stage: OrderStage, status: StageStatus): Promise<void> {
    if (status === stage.status) return;
    try {
      await this.service.setStatus(stage.id, status);
      this.notify.success(`Etapa "${stage.name}": ${STAGE_STATUS_LABELS[status]}.`);
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo actualizar la etapa.');
      this.changed.emit();
    }
  }

  protected async assign(stage: OrderStage, userId: string | null): Promise<void> {
    try {
      await this.service.update(stage.id, { assigned_to: userId });
      this.notify.success('Responsable de la etapa actualizado.');
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo asignar la etapa.');
    }
  }

  protected openNew(): void {
    this.editing = null;
    this.stageName = '';
    this.stageNotes = '';
    this.stageIsQc = false;
    this.dialog.set(true);
  }

  protected openNotes(stage: OrderStage): void {
    this.editing = stage;
    this.stageName = stage.name;
    this.stageNotes = stage.notes ?? '';
    this.stageIsQc = stage.is_quality_check;
    this.dialog.set(true);
  }

  protected async saveStage(): Promise<void> {
    if (!this.stageName.trim()) {
      this.notify.warn('Indique el nombre de la etapa.');
      return;
    }
    this.busy.set(true);
    try {
      if (this.editing) {
        await this.service.update(this.editing.id, {
          notes: this.stageNotes,
          ...(this.canManage ? { name: this.stageName.trim() } : {}),
        });
      } else {
        const stages = this.stages();
        // Las etapas nuevas se insertan antes del control de calidad final, si existe.
        const qc = stages.find((s) => s.is_quality_check);
        const position = this.stageIsQc || !qc ? Math.max(0, ...stages.map((s) => s.position)) + 1 : qc.position;
        if (!this.stageIsQc && qc) {
          await this.service.update(qc.id, { position: Math.max(...stages.map((s) => s.position)) + 1 });
        }
        await this.service.add(this.order().id, this.stageName, position, this.stageIsQc);
      }
      this.dialog.set(false);
      this.notify.success('Etapa guardada.');
      this.changed.emit();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar la etapa.');
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(stage: OrderStage): void {
    this.confirm.confirm({
      header: 'Eliminar etapa',
      message: `¿Eliminar la etapa "${stage.name}"? El avance del pedido se recalculará.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: 'Eliminar', severity: 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: async () => {
        try {
          await this.service.remove(stage.id);
          this.notify.success('Etapa eliminada.');
          this.changed.emit();
        } catch (err) {
          this.notify.error(err, 'No se pudo eliminar la etapa.');
        }
      },
    });
  }
}
