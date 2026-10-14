import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { AuthService } from '../../../../core/auth/auth.service';
import { AppRole, ROLE_LABELS, ROLE_OPTIONS } from '../../../../core/models/domain';
import { ProductionStageTemplate, ServiceType } from '../../../../core/models/catalog.model';
import { Profile } from '../../../../core/models/profile.model';
import { LookupService } from '../../../../core/services/lookup.service';
import { NotifyService } from '../../../../core/services/notify.service';
import { InvitationsService } from '../../../../core/services/invitations.service';
import {
  ACCESS_STATE_LABELS,
  ACCESS_STATE_SEVERITY,
  Invitation,
  Plan,
  SAAS_PAYMENT_METHOD_LABELS,
  SubscriptionPayment,
} from '../../../../core/models/subscription.model';
import { PLATFORM, whatsappLink } from '../../../../core/config/platform';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { phoneValidator } from '../../../../shared/utils/validators';
import { SettingsService } from '../../services/settings.service';

/** Configuración: empresa, usuarios (invitaciones y cupos del plan), etapas, tipos de servicio y Mi plan. */
@Component({
  selector: 'app-settings',
  imports: [
    DatePipe,
    MoneyPipe,
    RouterLink,
    DialogModule,
    ProgressBarModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    TabsModule,
    TableModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    SelectModule,
    ToggleSwitchModule,
    CheckboxModule,
    TagModule,
    MessageModule,
    PageHeader,
    FieldError,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly service = inject(SettingsService);
  private readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly invitationsService = inject(InvitationsService);
  protected readonly auth = inject(AuthService);

  /** Pestaña inicial (?tab=plan desde el aviso de vencimiento). */
  readonly tab = input<string>();

  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly payments = signal<SubscriptionPayment[]>([]);
  protected readonly stateLabels = ACCESS_STATE_LABELS;
  protected readonly stateSeverity = ACCESS_STATE_SEVERITY;
  protected readonly methodLabels = SAAS_PAYMENT_METHOD_LABELS;
  protected readonly platform = PLATFORM;
  protected readonly seatsFull = computed(() => {
    const s = this.auth.subscription();
    return !!s && s.seats_used >= s.seat_limit;
  });
  protected readonly seatPct = computed(() => {
    const s = this.auth.subscription();
    return s ? Math.min(100, Math.round((s.seats_used / s.seat_limit) * 100)) : 0;
  });
  protected readonly whatsappPay = computed(() =>
    whatsappLink(`Hola, envío la constancia de pago del plan de ${this.lookups.settings()?.company_name ?? 'mi empresa'}.`),
  );

  protected inviteVisible = false;
  protected readonly inviting = signal(false);
  protected readonly inviteForm = inject(FormBuilder).nonNullable.group({
    full_name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    role: ['VENDEDOR' as AppRole, [Validators.required]],
  });

  protected readonly users = signal<Profile[]>([]);
  protected readonly stages = signal<ProductionStageTemplate[]>([]);
  protected readonly serviceTypes = signal<ServiceType[]>([]);
  protected readonly saving = signal(false);
  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly roleLabels = ROLE_LABELS;

  protected newStage = '';
  protected newStageQc = false;
  protected newServiceName = '';

  protected readonly company = inject(FormBuilder).nonNullable.group({
    company_name: ['', [Validators.required, Validators.maxLength(120)]],
    tax_id: ['', [Validators.pattern(/^(10|15|17|20)\d{9}$/)]],
    address: [''],
    phone: ['', [phoneValidator]],
    email: ['', [Validators.email]],
    tax_rate: [18, [Validators.required, Validators.min(0), Validators.max(100)]],
    quote_validity_days: [15, [Validators.required, Validators.min(1), Validators.max(365)]],
    default_terms: [''],
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.lookups.reload();
      const s = this.lookups.settings();
      if (s) {
        this.company.reset({
          company_name: s.company_name,
          tax_id: s.tax_id ?? '',
          address: s.address ?? '',
          phone: s.phone ?? '',
          email: s.email ?? '',
          tax_rate: Number(s.tax_rate),
          quote_validity_days: s.quote_validity_days,
          default_terms: s.default_terms ?? '',
        });
      }
      this.stages.set(this.lookups.stageTemplates());
      this.serviceTypes.set(this.lookups.serviceTypes());
      const [users, invitations, plans, payments] = await Promise.all([
        this.service.users(),
        this.invitationsService.list(),
        this.service.plans(),
        this.service.subscriptionPayments(),
        this.auth.refreshSubscription(),
      ]);
      this.users.set(users);
      this.invitations.set(invitations);
      this.plans.set(plans);
      this.payments.set(payments);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar la configuración.');
    }
  }

  // ------------------------------------------------------------ Empresa
  async saveCompany(): Promise<void> {
    if (this.company.invalid) {
      this.company.markAllAsTouched();
      return;
    }
    const orgId = this.lookups.settings()?.org_id;
    if (!orgId) return;
    this.saving.set(true);
    try {
      await this.service.updateCompany(orgId, this.company.getRawValue());
      await this.lookups.reload();
      this.notify.success('Datos de la empresa actualizados.');
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar la configuración.');
    } finally {
      this.saving.set(false);
    }
  }

  // ------------------------------------------------------------ Usuarios
  protected isMe(u: Profile): boolean {
    return u.id === this.auth.profile()?.id;
  }

  async updateUser(u: Profile, patch: { role?: AppRole; active?: boolean }): Promise<void> {
    try {
      await this.service.updateUser(u.id, patch);
      await this.reloadUsers();
      await this.lookups.reload();
      this.notify.success(
        patch.active === true ? `${u.full_name} fue activado.` : patch.active === false ? `${u.full_name} fue desactivado.` : 'Rol actualizado.',
      );
    } catch (err) {
      this.notify.error(err, 'No se pudo actualizar el usuario.');
      await this.reloadUsers();
    }
  }

  protected roleLabel(role: AppRole): string {
    return this.roleLabels[role] ?? role;
  }

  protected methodLabel(method: SubscriptionPayment['method']): string {
    return this.methodLabels[method] ?? method;
  }

  protected openInvite(): void {
    this.inviteForm.reset({ full_name: '', email: '', role: 'VENDEDOR' });
    this.inviteVisible = true;
  }

  async sendInvite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const { full_name, email, role } = this.inviteForm.getRawValue();
    this.inviting.set(true);
    try {
      await this.invitationsService.invite(email.trim(), full_name.trim(), role);
      this.inviteVisible = false;
      this.notify.success(`Se envió la invitación a ${email.trim()}.`);
    } catch (err) {
      this.notify.error(err, 'No se pudo invitar al usuario.');
    } finally {
      this.inviting.set(false);
      await this.reloadUsers();
    }
  }

  async resendInvitation(inv: Invitation): Promise<void> {
    try {
      await this.invitationsService.send(inv.id);
      this.notify.success(`Invitación reenviada a ${inv.email}.`);
    } catch (err) {
      this.notify.error(err, 'No se pudo reenviar la invitación.');
    }
    await this.reloadUsers();
  }

  async revokeInvitation(inv: Invitation): Promise<void> {
    try {
      await this.invitationsService.revoke(inv.id);
      this.notify.success('Invitación cancelada.');
    } catch (err) {
      this.notify.error(err, 'No se pudo cancelar la invitación.');
    }
    await this.reloadUsers();
  }

  private async reloadUsers(): Promise<void> {
    const [users, invitations] = await Promise.all([
      this.service.users(),
      this.invitationsService.list(),
      this.auth.refreshSubscription(),
    ]);
    this.users.set(users);
    this.invitations.set(invitations);
  }

  // ------------------------------------------------------------ Etapas
  async addStage(): Promise<void> {
    const name = this.newStage.trim();
    if (!name) return;
    const stages = this.stages();
    const qc = stages.find((s) => s.is_quality_check && s.active);
    const max = Math.max(0, ...stages.map((s) => s.position));
    try {
      if (!this.newStageQc && qc) {
        // Las etapas de trabajo van antes del control de calidad final.
        await this.service.saveStage({ id: qc.id, name: qc.name, position: max + 1 });
        await this.service.saveStage({ name, position: qc.position, is_quality_check: false });
      } else {
        await this.service.saveStage({ name, position: max + 1, is_quality_check: this.newStageQc });
      }
      this.newStage = '';
      this.newStageQc = false;
      await this.reloadCatalogs();
      this.notify.success('Etapa agregada a la plantilla.');
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar la etapa.');
    }
  }

  async moveStage(index: number, delta: -1 | 1): Promise<void> {
    const list = this.stages();
    const a = list[index];
    const b = list[index + delta];
    if (!a || !b) return;
    try {
      await this.service.saveStage({ id: a.id, name: a.name, position: b.position });
      await this.service.saveStage({ id: b.id, name: b.name, position: a.position });
      await this.reloadCatalogs();
    } catch (err) {
      this.notify.error(err, 'No se pudo reordenar la etapa.');
    }
  }

  async toggleStage(stage: ProductionStageTemplate): Promise<void> {
    try {
      await this.service.saveStage({ id: stage.id, name: stage.name, position: stage.position, active: !stage.active });
      await this.reloadCatalogs();
    } catch (err) {
      this.notify.error(err, 'No se pudo actualizar la etapa.');
    }
  }

  // ------------------------------------------------------------ Servicios
  async addServiceType(): Promise<void> {
    const name = this.newServiceName.trim();
    if (!name) return;
    const code = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .slice(0, 30);
    try {
      await this.service.saveServiceType({ name, code, position: this.serviceTypes().length + 1 });
      this.newServiceName = '';
      await this.reloadCatalogs();
      this.notify.success('Tipo de servicio agregado.');
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el tipo de servicio.');
    }
  }

  async toggleServiceType(t: ServiceType): Promise<void> {
    try {
      await this.service.saveServiceType({ id: t.id, name: t.name, code: t.code, active: !t.active });
      await this.reloadCatalogs();
    } catch (err) {
      this.notify.error(err, 'No se pudo actualizar el tipo de servicio.');
    }
  }

  private async reloadCatalogs(): Promise<void> {
    await this.lookups.reload();
    this.stages.set(this.lookups.stageTemplates());
    this.serviceTypes.set(this.lookups.serviceTypes());
  }
}
