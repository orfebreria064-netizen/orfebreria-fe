// Invitaciones y enlaces de acceso.
//   * { invitation_id, redirect_to }: envía el correo de invitación de una invitación PENDIENTE.
//     Si el correo no sale (SMTP caído, filtro de spam, límite), genera el enlace de activación
//     y lo devuelve para que el ADMIN lo comparta (WhatsApp, etc.).
//     Con link_only = true no intenta el correo.
//   * { user_id, redirect_to }: enlace de acceso (crear nueva contraseña) para un usuario existente.
// Autorización con el JWT de quien llama: superadmin, o ADMIN de la empresa de la invitación/usuario.
// Las operaciones de auth.admin usan la clave de servicio, que nunca sale del servidor.
// El enlace es personal y de un solo uso: solo se devuelve a quien tiene permiso.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { corsHeaders, env, json } from '../_shared/http.ts';

const ERRORS: Record<string, string> = {
  'A user with this email address has already been registered': 'Ese correo ya tiene una cuenta en el sistema.',
  'Email rate limit exceeded': 'Se alcanzó el límite de correos por hora.',
  'email rate limit exceeded': 'Se alcanzó el límite de correos por hora.',
};
/**
 * Enlace hacia la app (/activar-cuenta?token_hash=…&type=…) en vez del enlace directo de Supabase:
 * el token se valida solo cuando la persona pulsa «Continuar», así los revisores automáticos de
 * enlaces (antivirus del correo, vista previa de WhatsApp) no gastan el token de un solo uso.
 */
function appLink(redirectTo: string | undefined, props: { hashed_token: string; action_link: string }, type: 'invite' | 'recovery') {
  if (!redirectTo) return props.action_link;
  const url = new URL(redirectTo);
  url.searchParams.set('token_hash', props.hashed_token);
  url.searchParams.set('type', type);
  return url.toString();
}

const translate = (message: string) =>
  ERRORS[message] ?? (/spam/i.test(message) ? 'El servidor de correo rechazó el mensaje (filtro de spam).' : message);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const { invitation_id, user_id, redirect_to, link_only } = await req.json();
    const redirectTo = typeof redirect_to === 'string' ? redirect_to : undefined;

    const url = env('SUPABASE_URL');
    const caller = createClient(url, env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

    // ---------------------------------------------------------------- Enlace de acceso (usuario existente)
    if (typeof user_id === 'string') {
      const { data: me } = await caller.auth.getUser();
      if (!me.user) return json({ error: 'Sesión no válida.' }, 401);
      const { data: isPlatformAdmin } = await caller.rpc('is_platform_admin');
      if (isPlatformAdmin !== true) {
        // RLS: solo se ven los perfiles de la propia empresa
        const [{ data: mine }, { data: target }] = await Promise.all([
          caller.from('profiles').select('org_id, role, active').eq('id', me.user.id).maybeSingle(),
          caller.from('profiles').select('org_id').eq('id', user_id).maybeSingle(),
        ]);
        if (!mine || mine.role !== 'ADMIN' || !mine.active || !target || target.org_id !== mine.org_id) {
          return json({ error: 'Solo un administrador de la empresa puede generar el enlace de acceso.' }, 403);
        }
      }
      const { data: u, error: userError } = await admin.auth.admin.getUserById(user_id);
      if (userError || !u.user?.email) return json({ error: 'Usuario no encontrado.' }, 404);
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: u.user.email,
        options: { redirectTo },
      });
      if (linkError) return json({ error: translate(linkError.message) }, 400);
      return json({ ok: true, emailed: false, email: u.user.email, link: appLink(redirectTo, link.properties, 'recovery'), kind: 'recovery' });
    }

    // ---------------------------------------------------------------- Invitación
    if (typeof invitation_id !== 'string') return json({ error: 'Falta la invitación.' }, 400);
    const { data: inv, error } = await caller.rpc('invitation_for_sending', { p_id: invitation_id });
    if (error) return json({ error: error.message }, 400);
    if (!inv) return json({ error: 'La invitación no existe, ya fue usada o no tiene permisos para enviarla.' }, 403);

    const data = { full_name: inv.full_name ?? undefined };
    let emailError: string | null = null;
    if (link_only !== true) {
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(inv.email, { redirectTo, data });
      if (!inviteError) return json({ ok: true, emailed: true, email: inv.email, link: null, kind: 'invite' });
      if (inviteError.message === 'A user with this email address has already been registered') {
        await admin.from('invitations').update({ status: 'REVOKED' }).eq('id', inv.id).eq('status', 'PENDING');
        return json({ error: translate(inviteError.message) }, 400);
      }
      emailError = translate(inviteError.message);
    }

    // Sin correo: enlace de activación para compartirlo por otro medio
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'invite',
      email: inv.email,
      options: { redirectTo, data },
    });
    if (linkError) {
      // Libera el cupo reservado; el ADMIN puede volver a invitar.
      await admin.from('invitations').update({ status: 'REVOKED' }).eq('id', inv.id).eq('status', 'PENDING');
      return json({ error: translate(linkError.message) }, 400);
    }
    return json({ ok: true, emailed: false, email: inv.email, link: appLink(redirectTo, link.properties, 'invite'), kind: 'invite', email_error: emailError });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error inesperado.' }, 500);
  }
});
