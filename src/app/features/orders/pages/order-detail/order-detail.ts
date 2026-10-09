import { Component, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { SkeletonModule } from 'primeng/skeleton';
import { MenuModule } from 'primeng/menu';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { ORDER_STATUS_LABELS, ORDER_STATUS_SEVERITY } from '../../../../core/models/domain';
import { NotifyService } from '../../../../core/services/notify.service';
import { BreadcrumbService } from '../../../../layout/breadcrumb.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { HistoryTimeline } from '../../../../shared/components/history-timeline/history-timeline';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { OrderDetail as Order, OrderHistoryEntry, OrderStage } from '../../models/order.model';
import { OrdersService } from '../../services/orders.service';
import { ProductionService } from '../../../production/services/production.service';
import { OrderAction, OrderSummary } from '../../components/order-summary/order-summary';
import { OrderAttachments } from '../../components/order-attachments/order-attachments';
import { StatusDialog } from '../../components/status-dialog/status-dialog';
import { OrderProduction } from '../../../production/components/order-production/order-production';
import { OrderMaterials } from '../../../materials/components/order-materials/order-materials';
import { OrderPayments } from '../../../payments/components/order-payments/order-payments';
import { Payment } from '../../../payments/models/payment.model';
import { PaymentsService } from '../../../payments/services/payments.service';

type OrderTab = 'summary' | 'production' | 'materials' | 'payments' | 'files' | 'history';

/** Vista principal del pedido / orden de trabajo: /orders/:id */
@Component({
  selector: 'app-order-detail',
  imports: [
    DatePipe,
    RouterLink,
    ButtonModule,
    TabsModule,
    SkeletonModule,
    MenuModule,
    PageHeader,
    StatusTag,
    HistoryTimeline,
    MoneyPipe,
    OrderSummary,
    OrderAttachments,
    StatusDialog,
    OrderProduction,
    OrderMaterials,
    OrderPayments,
  ],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
})
export class OrderDetailPage implements OnInit {
  private readonly service = inject(OrdersService);
  private readonly production = inject(ProductionService);
  private readonly paymentsService = inject(PaymentsService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly order = signal<Order | null>(null);
  protected readonly stages = signal<OrderStage[]>([]);
  protected readonly history = signal<OrderHistoryEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly tab = signal<OrderTab>('summary');
  protected readonly statusDialog = signal(false);
  protected readonly materialDialog = signal(false);
  protected readonly paymentDialog = signal(false);
  protected readonly payments = signal<Payment[]>([]);
  protected readonly advance = computed(() =>
    this.payments()
      .filter((p) => p.is_advance && !p.voided)
      .reduce((acc, p) => acc + Number(p.amount), 0),
  );

  protected readonly labels = ORDER_STATUS_LABELS;
  protected readonly severities = ORDER_STATUS_SEVERITY;

  protected readonly canEdit = this.auth.hasRole(...MODULE_ROLES.ordersWrite);
  protected readonly canChangeStatus = this.auth.hasRole(...MODULE_ROLES.ordersStatus);
  protected readonly canSeeMoney = this.auth.hasRole(...MODULE_ROLES.payments);

  protected readonly locked = computed(() => {
    const status = this.order()?.status;
    return (status === 'CERRADO' || status === 'CANCELADO') && !this.auth.hasRole('ADMIN');
  });

  private readonly attachments = viewChild(OrderAttachments);

  protected readonly moreActions = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    if (this.canEdit && !this.locked()) {
      items.push({ label: 'Editar pedido', icon: 'pi pi-pencil', command: () => void this.router.navigate(['/orders', this.id(), 'edit']) });
    }
    if (this.canSeeMoney && !this.locked()) items.push({ label: 'Registrar pago', icon: 'pi pi-wallet', command: () => this.openPayment() });
    if (!this.locked()) items.push({ label: 'Registrar material', icon: 'pi pi-box', command: () => this.openMaterial() });
    if (!this.locked()) items.push({ label: 'Subir archivo', icon: 'pi pi-upload', command: () => this.tab.set('files') });
    if (this.canChangeStatus) items.push({ label: 'Cambiar estado', icon: 'pi pi-sync', command: () => this.statusDialog.set(true) });
    return items;
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    const first = this.order() === null;
    if (first) this.loading.set(true);
    try {
      const [order, stages, history, payments] = await Promise.all([
        this.service.get(this.id()),
        this.production.stages(this.id()),
        this.service.history(this.id()),
        this.canSeeMoney ? this.paymentsService.byOrder(this.id()) : Promise.resolve([]),
      ]);
      this.payments.set(payments);
      this.order.set(order);
      this.stages.set(stages);
      this.history.set(history);
      this.breadcrumb.setDetail(order.number);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el pedido.');
      if (first) void this.router.navigate(['/orders']);
    } finally {
      this.loading.set(false);
    }
  }

  protected onAction(action: OrderAction): void {
    switch (action) {
      case 'stages':
      case 'production':
        this.tab.set('production');
        break;
      case 'payment':
        this.openPayment();
        break;
      case 'delivery':
        this.tab.set('summary');
        break;
      case 'status':
        this.statusDialog.set(true);
        break;
      case 'close':
        this.closeOrder();
        break;
    }
  }

  /** Cierre del pedido: la base de datos valida producción, control de calidad y entrega. */
  protected closeOrder(): void {
    const o = this.order()!;
    const balance = Number(o.balance);
    this.confirm.confirm({
      header: 'Cerrar pedido',
      message:
        balance > 0
          ? `El pedido tiene un saldo pendiente de ${formatMoney(balance)}. ¿Cerrarlo de todos modos? Luego no podrá modificarse sin permisos de administrador.`
          : `¿Cerrar el pedido ${o.number}? Luego no podrá modificarse sin permisos de administrador.`,
      icon: balance > 0 ? 'pi pi-exclamation-triangle' : 'pi pi-lock',
      acceptButtonProps: { label: 'Cerrar pedido', severity: balance > 0 ? 'warn' : 'primary' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', text: true },
      accept: async () => {
        try {
          await this.service.setStatus(o.id, 'CERRADO');
          this.notify.success(`Pedido ${o.number} cerrado correctamente.`);
          await this.load();
        } catch (err) {
          this.notify.error(err, 'No se pudo cerrar el pedido.');
        }
      },
    });
  }

  protected openPayment(): void {
    this.tab.set('payments');
    this.paymentDialog.set(true);
  }

  protected openMaterial(): void {
    this.tab.set('materials');
    this.materialDialog.set(true);
  }

  protected async refreshHistory(): Promise<void> {
    this.history.set(await this.service.history(this.id()));
  }

  protected openFiles(): void {
    this.tab.set('files');
    void this.attachments()?.load();
  }
}
