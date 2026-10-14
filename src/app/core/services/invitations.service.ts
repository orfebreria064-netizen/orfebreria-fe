import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AppRole } from '../models/domain';
import { Invitation } from '../models/subscription.model';
import { AppError, unwrap } from '../../shared/utils/db';

/**
 * Invitaciones de usuarios. La base de datos reserva el cupo del plan (create_invitation)
 * y la Edge Function send-invitation envía el correo con la clave de servicio.
 */
@Injectable({ providedIn: 'root' })
export class InvitationsService {
  private readonly db = inject(SupabaseService).client;

  async list(): Promise<Invitation[]> {
    return unwrap(
      await this.db.from('invitations').select('*').eq('status', 'PENDING').order('created_at', { ascending: false }),
    ) as Invitation[];
  }

  /** ADMIN de empresa: reserva el cupo y envía el correo. */
  async invite(email: string, fullName: string, role: AppRole): Promise<void> {
    const id = unwrap(
      await this.db.rpc('create_invitation', { p_email: email, p_full_name: fullName, p_role: role }),
    ) as string;
    await this.send(id);
  }

  /** Envía (o reintenta) el correo de una invitación pendiente. Si falla, la función la revoca. */
  async send(invitationId: string): Promise<void> {
    const { error } = await this.db.functions.invoke('send-invitation', {
      body: { invitation_id: invitationId, redirect_to: `${location.origin}/activar-cuenta` },
    });
    if (!error) return;
    let message = 'No se pudo enviar el correo de invitación.';
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body?.error) message = body.error;
    }
    throw new AppError(message);
  }

  async revoke(invitationId: string): Promise<void> {
    unwrap(await this.db.rpc('revoke_invitation', { p_id: invitationId }));
  }
}
