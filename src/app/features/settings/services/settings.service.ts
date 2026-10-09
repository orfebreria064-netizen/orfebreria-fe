import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AppRole } from '../../../core/models/domain';
import { CompanySettings, ProductionStageTemplate, ServiceType } from '../../../core/models/catalog.model';
import { Profile } from '../../../core/models/profile.model';
import { emptyToNull, unwrap } from '../../../shared/utils/db';

/** Configuración (solo ADMIN escribe; lo exige RLS). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly db = inject(SupabaseService).client;

  async updateCompany(orgId: string, patch: Partial<Omit<CompanySettings, 'org_id'>>): Promise<void> {
    unwrap(await this.db.from('settings').update(emptyToNull(patch)).eq('org_id', orgId));
  }

  async users(): Promise<Profile[]> {
    return unwrap(await this.db.from('profiles').select('*').order('active').order('full_name')) as Profile[];
  }

  async updateUser(id: string, patch: { role?: AppRole; active?: boolean; full_name?: string }): Promise<void> {
    unwrap(await this.db.from('profiles').update(patch).eq('id', id));
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
