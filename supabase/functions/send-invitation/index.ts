// Envía el correo de invitación de una invitación PENDIENTE.
// Autorización: la RPC invitation_for_sending se ejecuta con el JWT de quien llama
// y solo devuelve la invitación si es superadmin o ADMIN de esa empresa.
// El envío usa la clave de servicio (auth.admin), que nunca sale del servidor.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { corsHeaders, env, json } from '../_shared/http.ts';

const ERRORS: Record<string, string> = {
  'A user with this email address has already been registered': 'Ese correo ya tiene una cuenta en el sistema.',
  'Email rate limit exceeded': 'Se alcanzó el límite de correos por hora. Intente más tarde.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const { invitation_id, redirect_to } = await req.json();
    if (typeof invitation_id !== 'string') return json({ error: 'Falta la invitación.' }, 400);

    const url = env('SUPABASE_URL');
    const caller = createClient(url, env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: inv, error } = await caller.rpc('invitation_for_sending', { p_id: invitation_id });
    if (error) return json({ error: error.message }, 400);
    if (!inv) return json({ error: 'La invitación no existe, ya fue usada o no tiene permisos para enviarla.' }, 403);

    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(inv.email, {
      redirectTo: typeof redirect_to === 'string' ? redirect_to : undefined,
      data: { full_name: inv.full_name ?? undefined },
    });
    if (inviteError) {
      // Libera el cupo reservado; el ADMIN puede volver a invitar.
      await admin.from('invitations').update({ status: 'REVOKED' }).eq('id', inv.id).eq('status', 'PENDING');
      return json({ error: ERRORS[inviteError.message] ?? inviteError.message }, 400);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error inesperado.' }, 500);
  }
});
