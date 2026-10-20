import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AppRole } from '../../../core/models/domain';
import { CompanySettings, ProductionStageTemplate, ServiceType, StatementSend } from '../../../core/models/catalog.model';
import { Profile } from '../../../core/models/profile.model';
import { Plan, SubscriptionPayment } from '../../../core/models/subscription.model';
import { emptyToNull, unwrap } from '../../../shared/utils/db';

/** Configuración (solo ADMIN escribe; lo exige RLS). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly db = inject(SupabaseService).client;

  async updateCompany(orgId: string, patch: Partial<Omit<CompanySettings, 'org_id'>>): Promise<void> {
    unwrap(await this.db.from('settings').update(emptyToNull(patch)).eq('org_id', orgId));
  }

  /** Últimos correos automáticos enviados (estados de cuenta y cierres de caja). RLS: ADMIN y GERENTE. */
  async statementSends(limit = 30): Promise<StatementSend[]> {
    return unwrap(
      await this.db
        .from('statement_sends')
        .select('id, kind, statement_date, recipients, status, detail, created_at, customer:customers(full_name)')
        .order('created_at', { ascending: false })
        .limit(limit),
    ) as unknown as StatementSend[];
  }

  async users(): Promise<Profile[]> {
    return unwrap(await this.db.from('profiles').select('*').order('active').order('full_name')) as Profile[];
  }

  async updateUser(id: string, patch: { role?: AppRole; active?: boolean; full_name?: string }): Promise<void> {
    unwrap(await this.db.from('profiles').update(patch).eq('id', id));
  }

  async plans(): Promise<Plan[]> {
    return unwrap(await this.db.from('plans').select('*').eq('active', true).order('position')) as Plan[];
  }

  /** Pagos de suscripción de la empresa (RLS: solo ADMIN). */
  async subscriptionPayments(): Promise<SubscriptionPayment[]> {
    return unwrap(await this.db.from('subscription_payments').select('*').order('paid_at', { ascending: false })) as SubscriptionPayment[];
  }

  async saveStage(stage: Partial<ProductionStageTemplate> & { name: string; position: number }): Promise<void> {
    const { id, ...data } = stage;
    if (id) unwrap(await this.db.from('production_stages').update(data).eq('id', id));
    else unwrap(await this.db.from('production_stages').insert(data));
  }

  async saveServiceType(type: Partial<ServiceType> & { name: string; code: string }): Promise<void> {
    const { id, ...data } = type;
    if (id) unwrap(await this.db.from('service_types').update(data).eq('id', id));
    else unwrap(await this.db.from('service_types').insert(data));
  }
}
