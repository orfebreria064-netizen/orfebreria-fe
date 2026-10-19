import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { CompanySettings, ProductionStageTemplate, ServiceType } from '../models/catalog.model';
import { StaffMember } from '../models/profile.model';

/**
 * Catálogos compartidos (tipos de servicio, personal, plantilla de etapas, configuración),
 * cacheados en signals y recargables tras cambios en Configuración.
 */
@Injectable({ providedIn: 'root' })
export class LookupService {
  private readonly api = inject(ApiService);

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
      this.api.get<ServiceType[]>('Configuracion/listarservicios', { incluirinactivos: true }),
      this.api.get<StaffMember[]>('Seguridad/listarusuarios'),
      this.api.get<ProductionStageTemplate[]>('Configuracion/listaretapas', { incluirinactivos: true }),
      this.api.get<CompanySettings>('Configuracion/traerconfiguracion'),
    ]);
    this.serviceTypes.set(types);
    this.staff.set([...staff].sort((a, b) => a.full_name.localeCompare(b.full_name)));
    this.stageTemplates.set(stages);
    this.settings.set(settings);
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
