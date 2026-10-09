import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanySettings, ProductionStageTemplate, ServiceType } from '../models/catalog.model';
import { StaffMember } from '../models/profile.model';
import { unwrap } from '../../shared/utils/db';

/**
 * Catálogos compartidos (tipos de servicio, personal, plantilla de etapas, configuración),
 * cacheados en signals y recargables tras cambios en Configuración.
 */
@Injectable({ providedIn: 'root' })
export class LookupService {
  private readonly db = inject(SupabaseService).client;

  readonly serviceTypes = signal<ServiceType[]>([]);
  readonly staff = signal<StaffMember[]>([]);
  readonly stageTemplates = signal<ProductionStageTemplate[]>([]);
  readonly settings = signal<CompanySettings | null>(null);

  private loaded: Promise<void> | null = null;

  /** Carga los catálogos una sola vez (idempotente). */
  ensureLoaded(): Promise<void> {
    this.loaded ??= this.reload().catch((err) => {
      this.loaded = null;
      throw err;
    });
    return this.loaded;
  }

  async reload(): Promise<void> {
    const [types, staff, stages, settings] = await Promise.all([
      this.db.from('service_types').select('id, code, name, position, active').order('position'),
      this.db.from('profiles').select('id, full_name, role, active').order('full_name'),
      this.db.from('production_stages').select('id, name, position, is_quality_check, active').order('position'),
      this.db.from('settings').select('*').maybeSingle(),
    ]);
    this.serviceTypes.set(unwrap(types) as ServiceType[]);
    this.staff.set(unwrap(staff) as StaffMember[]);
    this.stageTemplates.set(unwrap(stages) as ProductionStageTemplate[]);
    this.settings.set(unwrap(settings) as CompanySettings | null);
  }

  /** Limpia la caché (al cerrar sesión). */
  reset(): void {
    this.loaded = null;
    this.serviceTypes.set([]);
    this.staff.set([]);
    this.stageTemplates.set([]);
    this.settings.set(null);
  }

  activeServiceTypes(): ServiceType[] {
    return this.serviceTypes().filter((t) => t.active);
  }

  activeStaff(): StaffMember[] {
    return this.staff().filter((s) => s.active);
  }

  taxRate(): number {
    return Number(this.settings()?.tax_rate ?? 18);
  }
}
