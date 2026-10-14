import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { NotifyService } from '../../../../core/services/notify.service';
import {
  ACCESS_STATE_LABELS,
  ACCESS_STATE_SEVERITY,
  AccessRequest,
  AccessState,
  Plan,
  PlatformOrganization,
  PlatformOverview,
  SAAS_PAYMENT_METHOD_LABELS,
  SubscriptionPayment,
} from '../../../../core/models/subscription.model';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { StatusTag } from '../../../../shared/components/status-tag/status-tag';
import { MoneyPipe, formatMoney } from '../../../../shared/pipes/money.pipe';
import { ChartCard, ChartSeries } from '../../../dashboard/components/chart-card/chart-card';
import { PlatformService } from '../../services/platform.service';
import { SaasPaymentDialog } from '../../components/saas-payment-dialog/saas-payment-dialog';
import { SubscriptionDialog } from '../../components/subscription-dialog/subscription-dialog';
import { RequestDialog } from '../../components/request-dialog/request-dialog';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const compactMoney = (v: number) =>
  v >= 1000 ? `S/ ${(v / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} mil` : formatMoney(v);

/** Panel del superadministrador: empresas, solicitudes, pagos de suscripción y planes. */
@Component({
  selector: 'app-platform',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    TabsModule,
    TableModule,
    TagModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DialogModule,
    ToggleSwitchModule,
    BadgeModule,
    TooltipModule,
    SkeletonModule,
    PageHeader,
    StatCard,
    EmptyState,
    StatusTag,
    MoneyPipe,
    ChartCard,
    SaasPaymentDialog,
    SubscriptionDialog,
    RequestDialog,
  ],
  templateUrl: './platform.html',
  styleUrl: './platform.scss',
})
export class Platform implements OnInit {
  private readonly service = inject(PlatformService);
  private readonly notify = inject(NotifyService);

  protected readonly loading = signal(true);
  protected readonly overview = signal<PlatformOverview | null>(null);
  protected readonly orgs = signal<PlatformOrganization[]>([]);
  protected readonly requests = signal<AccessRequest[]>([]);
  protected readonly payments = signal<SubscriptionPayment[]>([]);
  protected readonly plans = signal<Plan[]>([]);

  protected readonly stateLabels = ACCESS_STATE_LABELS;
  protected readonly stateSeverity = ACCESS_STATE_SEVERITY;
  protected readonly money = formatMoney;
  protected readonly compactMoney = compactMoney;
  protected readonly stateOptions = (Object.keys(ACCESS_STATE_LABELS) as AccessState[]).map((value) => ({
    value,
    label: ACCESS_STATE_LABELS[value],
  }));

  // ---------------------------------------------------------- Filtros
  protected readonly search = signal('');
  protected readonly stateFilter = signal<AccessState | null>(null);
  protected readonly showAllRequests = signal(false);

  protected readonly filteredOrgs = computed(() => {
    const q = this.search().trim().toLowerCase();
    const st = this.stateFilter();
    return this.orgs().filter(
      (o) =>
        (!st || o.state === st) &&
        (!q || [o.name, o.tax_id, o.owner_email, o.owner_name, o.email].some((v) => v?.toLowerCase().includes(q))),
    );
  });
  protected readonly pendingRequests = computed(() => this.requests().filter((r) => r.status === 'PENDING'));
  protected readonly visibleRequests = computed(() => (this.showAllRequests() ? this.requests() : this.pendingRequests()));
  protected readonly orgNames = computed(() => new Map(this.orgs().map((o) => [o.org_id, o.name])));
  protected readonly paymentsTotal = computed(() => this.payments().reduce((a, p) => a + Number(p.amount), 0));

  protected readonly revenueChart = computed(() => {
    const rows = this.overview()?.revenue_by_month ?? [];
    return {
      labels: rows.map((r) => {
        const [y, m] = r.month.split('-').map(Number);
        return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
      }),
      series: [{ label: 'Cobrado', values: rows.map((r) => Number(r.amount)), color: '#2a78d6' }] as ChartSeries[],
    };
  });

  // ---------------------------------------------------------- Diálogos
  protected readonly selectedOrg = signal<PlatformOrganization | null>(null);
  protected readonly paymentVisible = signal(false);
  protected readonly subscriptionVisible = signal(false);
  protected readonly selectedRequest = signal<AccessRequest | null>(null);
  protected readonly requestMode = signal<'approve' | 'reject'>('approve');
  protected readonly requestVisible = signal(false);
  protected editingPlan: Plan | null = null;
  protected planVisible = false;
  protected readonly savingPlan = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [overview, orgs, requests, payments, plans] = await Promise.all([
        this.service.overview(),
        this.service.organizations(),
        this.service.requests(),
        this.service.payments(),
        this.service.plans(),
      ]);
      this.overview.set(overview);
      this.orgs.set(orgs);
      this.requests.set(requests);
      this.payments.set(payments);
      this.plans.set(plans);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el panel de plataforma.');
    } finally {
      this.loading.set(false);
    }
  }

  protected daysLabel(o: PlatformOrganization): string {
    const d = o.days_left;
    if (d > 1) return `en ${d} días`;
    if (d === 1) return 'mañana';
    if (d === 0) return 'hoy';
    return `hace ${-d} día(s)`;
  }

  protected methodLabel(m: SubscriptionPayment['method']): string {
    return SAAS_PAYMENT_METHOD_LABELS[m] ?? m;
  }

  protected planName(code: string | null): string {
    return this.plans().find((p) => p.code === code)?.name ?? code ?? '—';
  }

  protected openPayment(o: PlatformOrganization): void {
    this.selectedOrg.set(o);
    this.paymentVisible.set(true);
  }

  protected openSubscription(o: PlatformOrganization): void {
    this.selectedOrg.set(o);
    this.subscriptionVisible.set(true);
  }

  protected openRequest(r: AccessRequest, mode: 'approve' | 'reject'): void {
    this.selectedRequest.set(r);
    this.requestMode.set(mode);
    this.requestVisible.set(true);
  }

  protected editPlan(p: Plan): void {
    this.editingPlan = { ...p, price_month: Number(p.price_month), price_year: Number(p.price_year), extra_user_price: p.extra_user_price === null ? null : Number(p.extra_user_price) };
    this.planVisible = true;
  }

  protected async savePlan(): Promise<void> {
    const p = this.editingPlan;
    if (!p || !p.name.trim() || p.max_users < 1) return;
    this.savingPlan.set(true);
    try {
      await this.service.savePlan({ ...p, name: p.name.trim() });
      this.planVisible = false;
      this.notify.success(`Plan ${p.name} actualizado. Los cambios aplican a todas las empresas con ese plan.`);
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el plan.');
    } finally {
      this.savingPlan.set(false);
    }
  }
}
