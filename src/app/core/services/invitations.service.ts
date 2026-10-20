import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AppRole } from '../models/domain';
import { Invitation } from '../models/subscription.model';
import { AppError, unwrap } from '../../shared/utils/db';

/** Resultado de la Edge Function send-invitation. Si el correo no salió, trae el enlace para compartirlo. */
export interface AccessLinkResult {
  emailed: boolean;
  email: string;
  link: string | null;
  kind: 'invite' | 'recovery';
  /** Motivo por el que no salió el correo (solo invitaciones). */
  email_error?: string | null;
}

/**
 * Invitaciones de usuarios. La base de datos reserva el cupo del plan (create_invitation)
 * y la Edge Function send-invitation envía el correo con la clave de servicio; si el correo
 * no sale, devuelve el enlace de activación para compartirlo por WhatsApp u otro medio.
 */
@Injectable({ providedIn: 'root' })
export class InvitationsService {
  private readonly db = inject(SupabaseService).client;

  async list(): Promise<Invitation[]> {
    return unwrap(
      await this.db.from('invitations').select('*').eq('status', 'PENDING').order('created_at', { ascending: false }),
    ) as Invitation[];
  }

  /** ADMIN de empresa: reserva el cupo y envía el correo (o devuelve el enlace si no sale). */
  async invite(email: string, fullName: string, role: AppRole): Promise<AccessLinkResult> {
    const id = unwrap(
      await this.db.rpc('create_invitation', { p_email: email, p_full_name: fullName, p_role: role }),
    ) as string;
    return this.send(id);
  }

  /** Envía (o reintenta) una invitación pendiente. linkOnly: solo genera el enlace, sin correo. */
  async send(invitationId: string, linkOnly = false): Promise<AccessLinkResult> {
    return this.call({ invitation_id: invitationId, link_only: linkOnly }, 'No se pudo enviar la invitación.');
  }

  /** Enlace de acceso (crear nueva contraseña) para un usuario existente. Solo ADMIN de su empresa o superadmin. */
  async accessLink(userId: string): Promise<AccessLinkResult> {
    return this.call({ user_id: userId }, 'No se pudo generar el enlace de acceso.');
  }

  async revoke(invitationId: string): Promise<void> {
    unwrap(await this.db.rpc('revoke_invitation', { p_id: invitationId }));
  }

  private async call(body: Record<string, unknown>, fallback: string): Promise<AccessLinkResult> {
    const { data, error } = await this.db.functions.invoke('send-invitation', {
      body: { ...body, redirect_to: `${location.origin}/activar-cuenta` },
    });
    if (!error) return data as AccessLinkResult;
    let message = fallback;
    if (error instanceof FunctionsHttpError) {
      const res = await error.context.json().catch(() => null);
      if (res?.error) message = res.error;
    }
    throw new AppError(message);
  }
}
