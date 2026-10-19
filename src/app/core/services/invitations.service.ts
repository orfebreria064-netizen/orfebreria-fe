import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import { AppRole } from '../models/domain';
import { Invitation } from '../models/subscription.model';

/**
 * Invitaciones de usuarios. La base de datos reserva el cupo del plan y la API envía el correo
 * con el enlace de activación (el token nunca llega al navegador).
 */
@Injectable({ providedIn: 'root' })
export class InvitationsService {
  private readonly api = inject(ApiService);

  async list(): Promise<Invitation[]> {
    const rows = await this.api.get<Invitation[]>('Seguridad/listarinvitaciones');
    return rows.filter((i) => i.status === 'PENDING');
  }

  /** ADMIN de empresa: reserva el cupo y envía el correo. branchIds null = sucursal principal. */
  async invite(email: string, fullName: string, role: AppRole, branchIds: string[] | null = null): Promise<void> {
    await this.api.procesar('Seguridad/invitar', { email, full_name: fullName, role, branch_ids: branchIds });
  }

  /** Reenvía el correo de una invitación pendiente (nuevo enlace, 7 días más). */
  async send(invitationId: string): Promise<void> {
    await this.api.procesar(`Seguridad/reenviarinvitacion/${invitationId}`);
  }

  async revoke(invitationId: string): Promise<void> {
    await this.api.procesar(`Seguridad/revocarinvitacion/${invitationId}`);
  }
}
