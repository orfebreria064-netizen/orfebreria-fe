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
import { TooltipModule } from 'primeng/tooltip';
import { AccessLinkDialog } from '../../../../shared/components/access-link-dialog/access-link-dialog';
import { AccessLinkResult } from '../../../../core/services/invitations.service';
import { MessageModule } from 'primeng/message';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { AuthService } from '../../../../core/auth/auth.service';
import { AppRole, ROLE_LABELS, ROLE_OPTIONS } from '../../../../core/models/domain';
import { ProductionStageTemplate, ServiceType, StatementSend } from '../../../../core/models/catalog.model';
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
import { PLATFORM, SHOW_PLAN_TAB, whatsappLink } from '../../../../core/config/platform';
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
    TooltipModule,
    AccessLinkDialog,
    MessageModule,
    PageHeader,
    FieldError,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly service = inject(SettingsService);
  protected readonly lookups = inject(LookupService);
  private readonly notify = inject(NotifyService);
  private readonly invitationsService = inject(InvitationsService);
  protected readonly auth = inject(AuthService);

  /** Pestaña inicial (?tab=plan desde el aviso de vencimiento). */
  readonly tab = input<string>();

  protected readonly showPlanTab = SHOW_PLAN_TAB;
  /** Si la pestaña pedida está oculta (p. ej. ?tab=plan), se abre Empresa. */
  protected readonly initialTab = computed(() => {
    const t = this.tab();
    return !t || (t === 'plan' && !SHOW_PLAN_TAB) ? 'company' : t;
  });

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
    // Documentos impresos
    logo: [''],
    slogan: ['', Validators.maxLength(500)],
    mobile: ['', Validators.maxLength(80)],
    city: ['', Validators.maxLength(60)],
    // Correos automáticos al cierre del día
    daily_statements_enabled: [false],
    daily_statements_hour: [20, [Validators.required, Validators.min(0), Validators.max(23)]],
  });

  protected readonly statementSends = signal<StatementSend[]>([]);
  /** Enlace para compartir por WhatsApp cuando el correo no sale (o a pedido del ADMIN). */
  protected readonly accessLink = signal<AccessLinkResult | null>(null);
  protected accessLinkVisible = false;
  /** De 5 p. m. a 11 p. m. (hora de Lima). */
  protected readonly statementHours = [17, 18, 19, 20, 21, 22, 23].map((h) => ({ value: h, label: `${h - 12}:00 p. m.` }));

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
          logo: s.logo ?? '',
          slogan: s.slogan ?? '',
          mobile: s.mobile ?? '',
          city: s.city ?? '',
          daily_statements_enabled: s.daily_statements_enabled ?? false,
          daily_statements_hour: s.daily_statements_hour ?? 20,
        });
      }
      this.stages.set(this.lookups.stageTemplates());
      this.serviceTypes.set(this.lookups.serviceTypes());
      const [users, invitations, plans, payments, sends] = await Promise.all([
        this.service.users(),
        this.invitationsService.list(),
        this.service.plans(),
        this.service.subscriptionPayments(),
        this.service.statementSends(),
        this.auth.refreshSubscription(),
      ]);
      this.users.set(users);
      this.invitations.set(invitations);
      this.plans.set(plans);
      this.payments.set(payments);
      this.statementSends.set(sends);
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

  /** Logo para los documentos: se reduce a 600 px de ancho como máximo y se guarda como PNG/JPEG en base64. */
  protected async onLogoSelected(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      this.notify.warn('El logo debe ser una imagen PNG o JPG.');
      return;
    }
    try {
      const dataUrl = await resizeImage(file, 600);
      if (dataUrl.length > 700_000) {
        this.notify.warn('La imagen es demasiado pesada. Use un logo más liviano (máximo 500 KB).');
        return;
      }
      this.company.controls.logo.setValue(dataUrl);
      this.company.markAsDirty();
    } catch {
      this.notify.warn('No se pudo leer la imagen.');
    }
  }

  protected removeLogo(): void {
    this.company.controls.logo.setValue('');
    this.company.markAsDirty();
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
      const result = await this.invitationsService.invite(email.trim(), full_name.trim(), role);
      this.inviteVisible = false;
      this.showSendResult(result, `Se envió la invitación a ${email.trim()}.`);
    } catch (err) {
      this.notify.error(err, 'No se pudo invitar al usuario.');
    } finally {
      this.inviting.set(false);
      await this.reloadUsers();
    }
  }

  async resendInvitation(inv: Invitation): Promise<void> {
    try {
      const result = await this.invitationsService.send(inv.id);
      this.showSendResult(result, `Invitación reenviada a ${inv.email}.`);
    } catch (err) {
      this.notify.error(err, 'No se pudo reenviar la invitación.');
    }
    await this.reloadUsers();
  }

  /** Enlace de acceso (nueva contraseña) para compartirlo por WhatsApp. */
  async generateAccessLink(u: Profile): Promise<void> {
    try {
      this.accessLink.set(await this.invitationsService.accessLink(u.id));
      this.accessLinkVisible = true;
    } catch (err) {
      this.notify.error(err, 'No se pudo generar el enlace de acceso.');
    }
  }

  private showSendResult(result: AccessLinkResult, emailedMessage: string): void {
    if (result.emailed) {
      this.notify.success(emailedMessage);
      return;
    }
    this.accessLink.set(result);
    this.accessLinkVisible = true;
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

/** Reduce la imagen al ancho indicado (sin agrandarla). PNG conserva la transparencia; JPEG se recomprime. */
function resizeImage(file: File, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Imagen no válida'));
    };
    img.src = url;
  });
}
