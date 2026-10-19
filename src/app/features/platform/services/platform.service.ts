import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import {
  AccessRequest,
  PaymentMethodSaas,
  Plan,
  PlatformOrganization,
  PlatformOverview,
  SubscriptionPayment,
  SubscriptionStatus,
} from '../../../core/models/subscription.model';
import { toIsoDate } from '../../../shared/utils/db';

export interface RegisterPaymentInput {
  orgId: string;
  planCode: string;
  amount: number;
  method: PaymentMethodSaas;
  months: number;
  paidAt: Date;
  reference: string;
}

export interface UpdateSubscriptionInput {
  orgId: string;
  planCode: string;
  status: SubscriptionStatus;
  extraUsers: number;
  currentPeriodEnd: Date;
  graceDays: number;
  notes: string;
}

/**
 * Panel del superadministrador. La base de datos verifica en cada procedimiento que el
 * usuario sea administrador de la plataforma.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly api = inject(ApiService);

  async overview(): Promise<PlatformOverview> {
    return this.api.get<PlatformOverview>('Plataforma/resumen');
  }

  async organizations(): Promise<PlatformOrganization[]> {
    return this.api.get<PlatformOrganization[]>('Plataforma/empresas');
  }

  async requests(): Promise<AccessRequest[]> {
    return this.api.get<AccessRequest[]>('Plataforma/solicitudes');
  }

  async payments(): Promise<SubscriptionPayment[]> {
    return this.api.get<SubscriptionPayment[]>('Plataforma/pagossuscripcion');
  }

  async plans(): Promise<Plan[]> {
    return this.api.get<Plan[]>('Plataforma/todosplanes');
  }

  async savePlan(plan: Plan): Promise<void> {
    await this.api.procesar('Plataforma/actualizarplan', { max_branches: null, ...plan });
  }

  /** Crea la empresa e invita al dueño (la API envía el correo). Devuelve el correo invitado. */
  async approve(requestId: string, planCode: string, trialDays: number): Promise<string> {
    const r = await this.api.procesar<{ email: string }>('Plataforma/aprobarsolicitud', {
      id: requestId,
      plan_code: planCode,
      trial_days: trialDays,
    });
    return r.data?.email ?? '';
  }

  async reject(requestId: string, reason: string): Promise<void> {
    await this.api.procesar('Plataforma/rechazarsolicitud', { id: requestId, reason });
  }

  async inviteAdmin(orgId: string, email: string, fullName: string): Promise<void> {
    await this.api.procesar('Plataforma/invitaradmin', { org_id: orgId, email, full_name: fullName });
  }

  /** Devuelve la nueva fecha de vencimiento. */
  async registerPayment(input: RegisterPaymentInput): Promise<string> {
    const r = await this.api.procesar<{ current_period_end: string }>('Plataforma/registrarpago', {
      org_id: input.orgId,
      plan_code: input.planCode,
      amount: input.amount,
      method: input.method,
      months: input.months,
      paid_at: toIsoDate(input.paidAt),
      reference: input.reference || null,
    });
    return (r.data?.current_period_end ?? r.resultProceso ?? '').slice(0, 10);
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<void> {
    await this.api.procesar('Plataforma/actualizarsuscripcion', {
      org_id: input.orgId,
      plan_code: input.planCode,
      status: input.status,
      extra_users: input.extraUsers,
      current_period_end: toIsoDate(input.currentPeriodEnd),
      grace_days: input.graceDays,
      notes: input.notes || null,
    });
  }
}
