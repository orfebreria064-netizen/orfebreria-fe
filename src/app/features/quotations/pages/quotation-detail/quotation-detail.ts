import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { ConfirmationService, MenuItem } from 'primeng/api';
import {
  PRIORITY_OPTIONS,
  Priority,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_SEVERITY,
  QuotationStatus,
} from '../../../../core/models/domain';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { BreadcrumbService } from '../../../../layout/breadcrumb.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { toIsoDate } from '../../../../shared/utils/db';
import { daysUntil } from '../../../../shared/utils/format';
import { QuotationDetail as Quotation } from '../../models/quotation.model';
import { QuotationsService } from '../../services/quotations.service';
import { QuotationPdfService } from '../../services/quotation-pdf.service';

const STATUS_ACTIONS: Record<QuotationStatus, { status: QuotationStatus; label: string; icon: string }[]> = {
  BORRADOR: [
    { status: 'ENVIADA', label: 'Marcar como enviada', icon: 'pi pi-send' },
    { status: 'RECHAZADA', label: 'Rechazar', icon: 'pi pi-times-circle' },
    { status: 'CANCELADA', label: 'Cancelar', icon: 'pi pi-ban' },
  ],
  ENVIADA: [
    { status: 'BORRADOR', label: 'Volver a borrador', icon: 'pi pi-undo' },
    { status: 'RECHAZADA', label: 'Rechazar', icon: 'pi pi-times-circle' },
    { status: 'CANCELADA', label: 'Cancelar', icon: 'pi pi-ban' },
  ],
  VENCIDA: [
    { status: 'BORRADOR', label: 'Reabrir como borrador', icon: 'pi pi-undo' },
    { status: 'CANCELADA', label: 'Cancelar', icon: 'pi pi-ban' },
  ],
  RECHAZADA: [{ status: 'BORRADOR', label: 'Reabrir como borrador', icon: 'pi pi-undo' }],
  APROBADA: [{ status: 'CANCELADA', label: 'Cancelar', icon: 'pi pi-ban' }],
  CANCELADA: [],
};

@Component({
  selector: 'app-quotation-detail',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    MenuModule,
    TableModule,
    SkeletonModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    CheckboxModule,
    MessageModule,
    PageHeader,
    StatusTag,
    MoneyPipe,
  ],
  templateUrl: './quotation-detail.html',
})
export class QuotationDetailPage implements OnInit {
  private readonly service = inject(QuotationsService);
  private readonly pdf = inject(QuotationPdfService);
  protected readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);

  readonly id = input.required<string>();

  protected readonly q = signal<Quotation | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly labels = QUOTATION_STATUS_LABELS;
  protected readonly severities = QUOTATION_STATUS_SEVERITY;
  protected readonly priorities = PRIORITY_OPTIONS;

  protected readonly editable = computed(() => ['BORRADOR', 'ENVIADA'].includes(this.q()?.status ?? ''));
  protected readonly canApprove = computed(() => ['BORRADOR', 'ENVIADA'].includes(this.q()?.status ?? ''));
  protected readonly canConvert = computed(() => this.q()?.status === 'APROBADA' && !this.q()?.order_id);
  protected readonly expiresIn = computed(() => daysUntil(this.q()?.expiry_date));

  protected readonly menuItems = computed<MenuItem[]>(() => {
    const q = this.q();
    if (!q) return [];
    const items: MenuItem[] = [
      { label: 'Duplicar', icon: 'pi pi-copy', command: () => void this.duplicate() },
      { label: 'Imprimir', icon: 'pi pi-print', command: () => void this.print() },
    ];
    const transitions = STATUS_ACTIONS[q.status].filter((a) => !(a.status === 'CANCELADA' && q.order_id));
    if (transitions.length) {
      items.push({ separator: true });
      transitions.forEach((a) => items.push({ label: a.label, icon: a.icon, command: () => this.changeStatus(a.status) }));
    }
    return items;
  });

  // Conversión a pedido
  protected readonly convertDialog = signal(false);
  protected readonly convertForm = inject(FormBuilder).group({
    assigned_to: [null as string | null],
    due_date: [null as Date | null],
    priority: ['MEDIA' as Priority],
    create_stages: [true],
  });
  protected readonly minDate = new Date();

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const q = await this.service.get(this.id());
      this.q.set(q);
      this.breadcrumb.setDetail(q.number);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar la cotización.');
      void this.router.navigate(['/quotations']);
    } finally {
      this.loading.set(false);
    }
  }

  protected approve(): void {
    const q = this.q()!;
    this.confirm.confirm({
      header: 'Aprobar cotización',
      message: `¿Confirmar que el cliente aprobó la cotización ${q.number}? Luego podrá convertirla en pedido.`,
      icon: 'pi pi-check-circle',
      acceptButtonProps: { label: 'Aprobar', severity: 'success' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: () => void this.applyStatus('APROBADA', 'Cotización aprobada.'),
    });
  }

  protected changeStatus(status: QuotationStatus): void {
    const q = this.q()!;
    const destructive = status === 'RECHAZADA' || status === 'CANCELADA';
    this.confirm.confirm({
      header: 'Cambiar estado',
      message: `¿Cambiar la cotización ${q.number} a "${this.labels[status]}"?`,
      icon: destructive ? 'pi pi-exclamation-triangle' : 'pi pi-question-circle',
      acceptButtonProps: { label: 'Confirmar', severity: destructive ? 'danger' : 'primary' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: () => void this.applyStatus(status, `Cotización actualizada a "${this.labels[status]}".`),
    });
  }

  private async applyStatus(status: QuotationStatus, message: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.service.setStatus(this.id(), status);
      this.notify.success(message);
      await this.load();
      if (status === 'APROBADA') this.openConvert();
    } catch (err) {
      this.notify.error(err, 'No se pudo cambiar el estado.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async duplicate(): Promise<void> {
    this.busy.set(true);
    try {
      const newId = await this.service.duplicate(this.id());
      this.notify.success('Cotización duplicada como borrador.');
      await this.router.navigate(['/quotations', newId, 'edit']);
    } catch (err) {
      this.notify.error(err, 'No se pudo duplicar la cotización.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async print(): Promise<void> {
    try {
      await this.pdf.print(this.q()!);
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el documento.');
    }
  }

  protected async downloadPdf(): Promise<void> {
    try {
      await this.pdf.download(this.q()!);
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el PDF.');
    }
  }

  protected openConvert(): void {
    this.convertForm.reset({ assigned_to: null, due_date: null, priority: 'MEDIA', create_stages: true });
    this.convertDialog.set(true);
  }

  protected async convert(): Promise<void> {
    const v = this.convertForm.getRawValue();
    this.busy.set(true);
    try {
      const orderId = await this.service.convertToOrder(this.id(), {
        assignedTo: v.assigned_to,
        dueDate: toIsoDate(v.due_date),
        priority: v.priority ?? 'MEDIA',
        createStages: v.create_stages ?? true,
      });
      this.convertDialog.set(false);
      this.notify.success('Pedido creado correctamente.');
      await this.router.navigate(['/orders', orderId]);
    } catch (err) {
      this.notify.error(err, 'No se pudo registrar el pedido.');
    } finally {
      this.busy.set(false);
    }
  }
}
