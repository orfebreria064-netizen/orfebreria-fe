// Avisos diarios de vencimiento (programar con pg_cron, ver README).
//   * A los ADMIN de cada empresa: 7, 3, 1 y 0 días antes, al entrar en gracia y al vencer.
//   * A los superadministradores: resumen con esas empresas y las solicitudes pendientes.
// Se despliega con --no-verify-jwt y se protege con el encabezado x-cron-secret.
// Correo vía Resend (RESEND_API_KEY, MAIL_FROM).
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { corsHeaders, env, json } from '../_shared/http.ts';

interface Due {
  org_id: string;
  company_name: string;
  plan_name: string;
  status: 'TRIAL' | 'ACTIVE';
  state: string;
  current_period_end: string;
  days_left: number;
  grace_end: string;
  admin_emails: string[];
}

const fmt = (iso: string) => iso.split('-').reverse().join('/');
/** Los nombres vienen de formularios: se escapan antes de ir al HTML. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function message(d: Due, appUrl: string): { subject: string; body: string } {
  const plan = d.status === 'TRIAL' ? 'periodo de prueba' : `plan ${esc(d.plan_name)}`;
  const company = esc(d.company_name);
  let subject: string;
  let lead: string;
  if (d.days_left > 0) {
    subject = `Su ${plan} vence en ${d.days_left} día${d.days_left === 1 ? '' : 's'}`;
    lead = `El ${plan} de <b>${company}</b> vence el <b>${fmt(d.current_period_end)}</b>.`;
  } else if (d.days_left === 0) {
    subject = `Su ${plan} vence hoy`;
    lead = `El ${plan} de <b>${company}</b> vence hoy.`;
  } else if (d.state === 'GRACE') {
    subject = 'Su plan venció: tiene unos días de gracia';
    lead = `El plan de <b>${company}</b> venció. Puede seguir trabajando con normalidad hasta el <b>${fmt(d.grace_end)}</b>.`;
  } else {
    subject = 'Su plan venció: el sistema quedó en modo solo lectura';
    lead = `El ${plan} de <b>${company}</b> venció. Puede consultar su información, pero no registrar nuevos datos hasta regularizar el pago.`;
  }
  const body = `<p>Hola,</p><p>${lead}</p>
    <p>Para renovar, ingrese a <a href="${appUrl}/settings">Configuración → Mi plan</a> y siga las instrucciones de pago.</p>
    <p>Gracias por confiar en nosotros.</p>`;
  return { subject, body };
}

async function sendMail(to: string[], subject: string, html: string): Promise<boolean> {
  if (to.length === 0) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to, subject, html }),
  });
  if (!res.ok) console.error('Resend', res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'No autorizado.' }, 401);

  try {
    const appUrl = env('APP_URL').replace(/\/$/, '');
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

    const { data, error } = await admin.rpc('subscription_reminders_due');
    if (error) throw error;
    const due = (data ?? []) as Due[];

    let sent = 0;
    for (const d of due) {
      const { subject, body } = message(d, appUrl);
      if (await sendMail(d.admin_emails, subject, body)) sent++;
    }

    const { count: pending } = await admin
      .from('access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING');

    let summary = false;
    if (due.length > 0 || (pending ?? 0) > 0) {
      const { data: admins } = await admin.from('platform_admins').select('user_id');
      const emails: string[] = [];
      for (const a of admins ?? []) {
        const { data: u } = await admin.auth.admin.getUserById(a.user_id);
        if (u.user?.email) emails.push(u.user.email);
      }
      const rows = due
        .map((d) => `<li>${esc(d.company_name)} — ${esc(d.plan_name)}: vence ${fmt(d.current_period_end)} (${d.days_left} días, ${d.state})</li>`)
        .join('');
      summary = await sendMail(
        emails,
        `Plataforma: ${due.length} empresa(s) por vencer, ${pending ?? 0} solicitud(es) pendiente(s)`,
        `<p>Resumen del día.</p>${rows ? `<ul>${rows}</ul>` : ''}
         <p>Solicitudes de acceso pendientes: <b>${pending ?? 0}</b>.</p>
         <p><a href="${appUrl}/plataforma">Abrir el panel de plataforma</a></p>`,
      );
    }

    return json({ ok: true, due: due.length, sent, summary });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error inesperado.' }, 500);
  }
});
