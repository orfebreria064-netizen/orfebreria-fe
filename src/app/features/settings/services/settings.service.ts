import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { AppRole } from '../../../core/models/domain';
import { CompanySettings, ProductionStageTemplate, ServiceType } from '../../../core/models/catalog.model';
import { Profile } from '../../../core/models/profile.model';
import { Plan, SubscriptionPayment } from '../../../core/models/subscription.model';
import { AppError, emptyToNull } from '../../../shared/utils/db';

/** Configuración (solo ADMIN escribe; lo valida la base de datos). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiService);

  /** La API recibe la configuración completa: se combina el cambio con los valores actuales. */
  async updateCompany(_orgId: string, patch: Partial<Omit<CompanySettings, 'org_id'>>): Promise<void> {
    const actual = await this.api.get<CompanySettings>('Configuracion/traerconfiguracion');
    await this.api.procesar('Configuracion/actualizarconfiguracion', { ...actual, ...emptyToNull(patch) });
  }

  async users(): Promise<Profile[]> {
    const rows = await this.api.get<Profile[]>('Seguridad/listarusuarios');
    // Mismo orden que antes: inactivos primero, luego por nombre
    return [...rows].sort((a, b) => Number(a.active) - Number(b.active) || a.full_name.localeCompare(b.full_name));
  }

  async updateUser(id: string, patch: { role?: AppRole; active?: boolean; full_name?: string }): Promise<void> {
    const actual = (await this.api.get<Profile[]>('Seguridad/listarusuarios')).find((u) => u.id === id);
    if (!actual) throw new AppError('Usuario no encontrado.');
    await this.api.procesar('Seguridad/actualizarusuario', {
      user_id: id,
      role: patch.role ?? actual.role,
      active: patch.active ?? actual.active,
      full_name: patch.full_name ?? null,
    });
  }

  /** Sucursales asignadas a un usuario (ADMIN y GERENTE ven todas sin asignación). */
  async setUserBranches(userId: string, branchIds: string[]): Promise<void> {
    await this.api.procesar('Seguridad/asignarsucursales', { user_id: userId, branch_ids: branchIds });
  }

  async plans(): Promise<Plan[]> {
    return this.api.get<Plan[]>('Plataforma/planes');
  }

  /** Pagos de suscripción de la empresa (solo ADMIN). */
  async subscriptionPayments(): Promise<SubscriptionPayment[]> {
    return this.api.get<SubscriptionPayment[]>('Plataforma/pagossuscripcion');
  }

  async saveStage(stage: Partial<ProductionStageTemplate> & { name: string; position: number }): Promise<void> {
    const actual = stage.id
      ? (await this.api.get<ProductionStageTemplate[]>('Configuracion/listaretapas', { incluirinactivos: true })).find((s) => s.id === stage.id)
      : undefined;
    await this.api.procesar('Configuracion/etapaprc', {
      is_quality_check: false,
      active: true,
      ...actual,
      ...stage,
    });
  }

  async saveServiceType(type: Partial<ServiceType> & { name: string; code: string }): Promise<void> {
    const actual = type.id
      ? (await this.api.get<ServiceType[]>('Configuracion/listarservicios', { incluirinactivos: true })).find((t) => t.id === type.id)
      : undefined;
    await this.api.procesar('Configuracion/servicioprc', { position: 0, active: true, ...actual, ...type });
  }
}
