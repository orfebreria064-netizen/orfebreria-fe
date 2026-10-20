import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AccessLinkResult, InvitationsService } from '../../../core/services/invitations.service';
import {
  AccessRequest,
  PaymentMethodSaas,
  Plan,
  PlatformOrganization,
  PlatformOverview,
  SubscriptionPayment,
  SubscriptionStatus,
} from '../../../core/models/subscription.model';
import { toIsoDate, unwrap } from '../../../shared/utils/db';

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
 * Panel del superadministrador. Toda escritura pasa por RPC SECURITY DEFINER que
 * verifican is_platform_admin() en la base de datos.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly db = inject(SupabaseService).client;
  private readonly invitations = inject(InvitationsService);

  async overview(): Promise<PlatformOverview> {
    return unwrap(await this.db.rpc('platform_overview')) as PlatformOverview;
  }

  async organizations(): Promise<PlatformOrganization[]> {
    return unwrap(await this.db.rpc('platform_organizations')) as PlatformOrganization[];
  }

  async requests(): Promise<AccessRequest[]> {
    return unwrap(await this.db.from('access_requests').select('*').order('created_at', { ascending: false }).limit(500)) as AccessRequest[];
  }

  async payments(): Promise<SubscriptionPayment[]> {
    return unwrap(
      await this.db.from('subscription_payments').select('*').order('paid_at', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
    ) as SubscriptionPayment[];
  }

  async plans(): Promise<Plan[]> {
    return unwrap(await this.db.from('plans').select('*').order('position')) as Plan[];
  }

  async savePlan(plan: Plan): Promise<void> {
    const { code, ...data } = plan;
    unwrap(await this.db.from('plans').update(data).eq('code', code));
  }

  /** Crea la empresa e invita al dueño. Si el correo no sale, el resultado trae el enlace de activación. */
  async approve(requestId: string, planCode: string, trialDays: number): Promise<AccessLinkResult> {
    const res = unwrap(
      await this.db.rpc('platform_approve_request', { p_id: requestId, p_plan_code: planCode, p_trial_days: trialDays }),
    ) as { invitation_id: string; email: string };
    return this.invitations.send(res.invitation_id);
  }

  async reject(requestId: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('platform_reject_request', { p_id: requestId, p_reason: reason }));
  }

  async inviteAdmin(orgId: string, email: string, fullName: string): Promise<AccessLinkResult> {
    const id = unwrap(
      await this.db.rpc('platform_invite_admin', { p_org_id: orgId, p_email: email, p_full_name: fullName }),
    ) as string;
    return this.invitations.send(id);
  }

  /** Devuelve la nueva fecha de vencimiento. */
  async registerPayment(input: RegisterPaymentInput): Promise<string> {
    return unwrap(
      await this.db.rpc('platform_register_payment', {
        p_org_id: input.orgId,
        p_plan_code: input.planCode,
        p_amount: input.amount,
        p_method: input.method,
        p_months: input.months,
        p_paid_at: toIsoDate(input.paidAt),
        p_reference: input.reference,
      }),
    ) as string;
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<void> {
    unwrap(
      await this.db.rpc('platform_update_subscription', {
        p_org_id: input.orgId,
        p_plan_code: input.planCode,
        p_status: input.status,
        p_extra_users: input.extraUsers,
        p_current_period_end: toIsoDate(input.currentPeriodEnd),
        p_grace_days: input.graceDays,
        p_notes: input.notes,
      }),
    );
  }
}
