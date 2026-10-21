// Correos al cierre del día (0015_estados_de_cuenta.sql). pg_cron la llama cada hora en punto.
//   * Estado de cuenta a cada cliente con pagos, adelantos o anulaciones nuevos (si tiene correo
//     y no lo desactivó): movimientos desde su último estado de cuenta y saldo de sus pedidos.
//   * Cierre de caja a los ADMIN y GERENTE de la empresa.
// Solo procesa las empresas con la opción activa cuya hora configurada (Lima) es la actual.
// Se despliega con --no-verify-jwt y se protege con el encabezado x-cron-secret (Vault).
// Envío por Brevo: API key y remitente verificado en Vault (statement_mail_config, 0017).
// Respaldo: Resend (RESEND_API_KEY, MAIL_FROM). Sin ninguno configurado no envía nada.
// Remitente: el nombre de la empresa con la dirección verificada; "Responder a": el correo de la
// empresa o, si no tiene, el de su ADMIN.
// El estado de cuenta de cada cliente trae todo lo ocurrido desde el último que se le envió.
// Prueba manual: body { "org_id": "...", "date": "2026-10-20", "dry_run": true } devuelve el HTML sin enviar.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { corsHeaders, env, json } from '../_shared/http.ts';

interface Movement {
  receipt_number: string | null;
  order_number: string;
  order_title: string;
  payment_date: string;
  method: string;
  amount: number;
  currency: string;
  is_advance: boolean;
  voided: boolean;
  void_reason: string | null;
}
interface OrderBalance {
  number: string;
  title: string;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  balance: number;
}
interface CustomerStatement {
  customer_id: string;
  name: string;
  email: string;
  movements: Movement[] | null;
  orders: OrderBalance[] | null;
}
interface Company {
  name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  logo: string | null;
  reply_to: string | null;
}
interface Closing {
  recipients: string[];
  by_method: { method: string; currency: string; count: number; amount: number }[];
  advances: { currency: string; count: number; amount: number }[];
  payments: { receipt_number: string | null; order_number: string; customer: string; method: string; amount: number; currency: string; is_advance: boolean }[];
  voided: { receipt_number: string | null; order_number: string; amount: number; currency: string; reason: string | null }[];
  jeweler_payments: { number: string; jeweler: string; order_number: string; amount: number; currency: string; method: string }[];
}
interface StatementData {
  date: string;
  company: Company;
  customers: CustomerStatement[];
  closing: Closing | null;
}
interface MailConfig {
  provider: 'brevo' | 'resend';
  apiKey: string;
  senderEmail: string;
}
interface Mail {
  kind: 'CLIENTE' | 'CIERRE';
  customer_id: string | null;
  to: string[];
  subject: string;
  html: string;
}

const METHODS: Record<string, string> = {
  EFECTIVO: 'Efectivo', YAPE: 'Yape', PLIN: 'Plin', TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta', CHEQUE: 'Cheque', OTRO: 'Otro',
};
const STATUS: Record<string, string> = {
  SOLICITUD: 'Solicitud', COTIZADO: 'Cotizado', APROBADO: 'Aprobado', DISENO: 'Diseño', PRODUCCION: 'Producción',
  CONTROL_CALIDAD: 'Control de calidad', LISTO_ENTREGA: 'Listo para entregar', ENTREGADO: 'Entregado',
  CERRADO: 'Cerrado', PAUSADO: 'Pausado', CANCELADO: 'Cancelado',
};

/** Los textos vienen de formularios: se escapan antes de ir al HTML. */
const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');
const number = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: number, currency: string) => `${currency === 'USD' ? 'US$' : 'S/'} ${number.format(Number(v))}`;

const TD = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;';
const TH = 'padding:6px 8px;border-bottom:2px solid #1f2937;font-size:12px;text-align:left;color:#374151;';
const R = 'text-align:right;white-space:nowrap;';

function table(headers: string[], rows: string[][], rightCols: number[] = []): string {
  const th = headers.map((h, i) => `<th style="${TH}${rightCols.includes(i) ? R : ''}">${h}</th>`).join('');
  const tr = rows
    .map((r) => `<tr>${r.map((c, i) => `<td style="${TD}${rightCols.includes(i) ? R : ''}">${c}</td>`).join('')}</tr>`)
    .join('');
  return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:8px 0 18px">${`<thead><tr>${th}</tr></thead>`}<tbody>${tr}</tbody></table>`;
}

/** Logo como imagen incrustada (cid): los correos no muestran imágenes en data URL. */
function logoAttachment(company: Company): { filename: string; content: string; content_id: string } | null {
  const m = company.logo?.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  return m ? { filename: `logo.${m[1] === 'png' ? 'png' : 'jpg'}`, content: m[2], content_id: 'logo' } : null;
}

function layout(company: Company, title: string, body: string, hasLogo: boolean): string {
  const contact = [company.address, company.phone && `Tel. ${company.phone}`, company.mobile && `Cel. ${company.mobile}`]
    .filter(Boolean).map((s) => esc(s as string)).join(' · ');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <div style="max-width:640px;margin:0 auto;background:#ffffff">
    <div style="background:#1f2937;padding:16px 20px;color:#ffffff">
      <table cellspacing="0" cellpadding="0" style="width:100%"><tr>
        ${hasLogo ? '<td style="width:64px"><img src="cid:logo" alt="" width="56" height="56" style="display:block;border-radius:50%"></td>' : ''}
        <td><div style="font-size:18px;font-weight:bold">${esc(company.name)}</div>
            <div style="font-size:12px;color:#d1d5db">${company.tax_id ? `RUC ${esc(company.tax_id)}` : ''}</div></td>
        <td style="text-align:right;font-size:13px;color:#d4af37;font-weight:bold">${title}</td>
      </tr></table>
    </div>
    <div style="padding:20px">${body}</div>
    <div style="padding:14px 20px;background:#f9fafb;font-size:11px;color:#6b7280">
      ${contact}${company.email ? `<br>${esc(company.email)}` : ''}<br>
      Mensaje automático generado al cierre del día.
    </div>
  </div></body></html>`;
}

function customerMail(d: StatementData, c: CustomerStatement, hasLogo: boolean): Mail {
  const moves = c.movements ?? [];
  const rows = moves.map((m) => [
    fmtDate(m.payment_date),
    esc(m.receipt_number ?? '—'),
    `${esc(m.order_number)}<br><span style="color:#6b7280;font-size:12px">${esc(m.order_title)}</span>`,
    `${m.voided ? '<b style="color:#b91c1c">Anulado</b>' : m.is_advance ? 'Adelanto' : 'Pago'} · ${METHODS[m.method] ?? esc(m.method)}` +
      (m.voided && m.void_reason ? `<br><span style="color:#6b7280;font-size:12px">${esc(m.void_reason)}</span>` : ''),
    m.voided ? `<s>${money(m.amount, m.currency)}</s>` : money(m.amount, m.currency),
  ]);
  const orders = (c.orders ?? []).map((o) => [
    `${esc(o.number)}<br><span style="color:#6b7280;font-size:12px">${esc(o.title)} · ${STATUS[o.status] ?? esc(o.status)}</span>`,
    money(o.total, o.currency),
    money(o.amount_paid, o.currency),
    `<b style="color:${Number(o.balance) > 0 ? '#b91c1c' : '#047857'}">${money(o.balance, o.currency)}</b>`,
  ]);
  const pending = (c.orders ?? []).filter((o) => Number(o.balance) > 0);
  const totals = ['PEN', 'USD']
    .map((cur) => [cur, pending.filter((o) => o.currency === cur).reduce((a, o) => a + Number(o.balance), 0)] as const)
    .filter(([, v]) => v > 0)
    .map(([cur, v]) => money(v, cur));
  const body = `
    <p style="font-size:14px">Hola <b>${esc(c.name)}</b>,</p>
    <p style="font-size:14px">Este es el resumen de sus pagos en ${esc(d.company.name)} registrados desde nuestro último estado de cuenta.</p>
    <h3 style="font-size:14px;margin:18px 0 4px">Movimientos</h3>
    ${table(['Fecha', 'Recibo', 'Pedido', 'Detalle', 'Monto'], rows, [4])}
    <h3 style="font-size:14px;margin:18px 0 4px">Estado de sus pedidos</h3>
    ${orders.length ? table(['Pedido', 'Total', 'Pagado', 'Saldo'], orders, [1, 2, 3]) : '<p style="font-size:13px">No tiene pedidos con saldo pendiente.</p>'}
    <p style="font-size:14px">${totals.length ? `Saldo pendiente total: <b>${totals.join(' · ')}</b>` : '<b>No tiene saldos pendientes.</b> ¡Gracias!'}</p>
    <p style="font-size:12px;color:#6b7280">Si algún dato no coincide con sus comprobantes, responda a este correo o comuníquese con nosotros.</p>`;
  return {
    kind: 'CLIENTE',
    customer_id: c.customer_id,
    to: [c.email],
    subject: `Estado de cuenta al ${fmtDate(d.date)} · ${d.company.name}`,
    html: layout(d.company, 'ESTADO DE CUENTA', body, hasLogo),
  };
}

function closingMail(d: StatementData, k: Closing, hasLogo: boolean): Mail | null {
  const hasActivity = k.payments.length || k.voided.length || k.jeweler_payments.length;
  if (!hasActivity || k.recipients.length === 0) return null;
  const sum = (rows: { amount: number; currency: string }[], cur: string) =>
    rows.filter((r) => r.currency === cur).reduce((a, r) => a + Number(r.amount), 0);
  const curList = (rows: { amount: number; currency: string }[]) =>
    ['PEN', 'USD'].filter((c) => sum(rows, c) !== 0 || c === 'PEN').map((c) => money(sum(rows, c), c)).join(' · ');

  const body = `
    <p style="font-size:14px">Cierre de caja del <b>${fmtDate(d.date)}</b>.</p>
    <table cellspacing="0" cellpadding="0" style="width:100%;margin:6px 0 16px"><tr>
      <td style="padding:10px;background:#ecfdf5;border-radius:6px"><div style="font-size:11px;color:#047857">COBRADO</div>
        <div style="font-size:16px;font-weight:bold">${curList(k.by_method)}</div></td>
      <td style="width:8px"></td>
      <td style="padding:10px;background:#fef2f2;border-radius:6px"><div style="font-size:11px;color:#b91c1c">PAGADO A JOYEROS</div>
        <div style="font-size:16px;font-weight:bold">${curList(k.jeweler_payments)}</div></td>
    </tr></table>
    <h3 style="font-size:14px;margin:18px 0 4px">Cobrado por método</h3>
    ${k.by_method.length ? table(['Método', 'Moneda', 'Cobros', 'Monto'],
        k.by_method.map((m) => [METHODS[m.method] ?? esc(m.method), m.currency === 'USD' ? 'Dólares' : 'Soles', String(m.count), money(m.amount, m.currency)]), [2, 3])
      : '<p style="font-size:13px">Sin cobros.</p>'}
    ${k.advances.length ? `<p style="font-size:13px">Adelantos incluidos: ${k.advances.map((a) => `${a.count} (${money(a.amount, a.currency)})`).join(' · ')}</p>` : ''}
    <h3 style="font-size:14px;margin:18px 0 4px">Detalle de cobros</h3>
    ${k.payments.length ? table(['Recibo', 'Pedido', 'Cliente', 'Método', 'Monto'],
        k.payments.map((p) => [esc(p.receipt_number ?? '—'), esc(p.order_number), esc(p.customer),
          `${METHODS[p.method] ?? esc(p.method)}${p.is_advance ? ' · adelanto' : ''}`, money(p.amount, p.currency)]), [4])
      : '<p style="font-size:13px">Sin cobros.</p>'}
    ${k.voided.length ? `<h3 style="font-size:14px;margin:18px 0 4px;color:#b91c1c">Pagos anulados</h3>
      ${table(['Recibo', 'Pedido', 'Motivo', 'Monto'], k.voided.map((v) => [esc(v.receipt_number ?? '—'), esc(v.order_number), esc(v.reason), money(v.amount, v.currency)]), [3])}` : ''}
    ${k.jeweler_payments.length ? `<h3 style="font-size:14px;margin:18px 0 4px">Pagos a joyeros</h3>
      ${table(['Recibo', 'Joyero', 'Pedido', 'Método', 'Monto'], k.jeweler_payments.map((j) => [esc(j.number), esc(j.jeweler), esc(j.order_number), METHODS[j.method] ?? esc(j.method), money(j.amount, j.currency)]), [4])}` : ''}`;
  return {
    kind: 'CIERRE',
    customer_id: null,
    to: k.recipients,
    subject: `Cierre de caja del ${fmtDate(d.date)} · ${d.company.name}`,
    html: layout(d.company, 'CIERRE DE CAJA', body, hasLogo),
  };
}

/** Brevo (Vault) o, si no está, Resend (variables de entorno). null = sin configurar. */
async function mailConfig(admin: ReturnType<typeof createClient>): Promise<MailConfig | null> {
  const { data } = await admin.rpc('statement_mail_config');
  const cfg = data as { brevo_api_key?: string | null; sender_email?: string | null } | null;
  if (cfg?.brevo_api_key && cfg?.sender_email) {
    return { provider: 'brevo', apiKey: cfg.brevo_api_key, senderEmail: cfg.sender_email };
  }
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  if (resendKey && from) {
    return { provider: 'resend', apiKey: resendKey, senderEmail: from.match(/<([^>]+)>/)?.[1] ?? from.trim() };
  }
  return null;
}

async function send(
  mail: Mail,
  company: Company,
  cfg: MailConfig,
  logo: ReturnType<typeof logoAttachment>,
): Promise<{ ok: boolean; detail: string }> {
  const name = company.name.replace(/["<>]/g, '');
  const res =
    cfg.provider === 'brevo'
      ? await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: { name, email: cfg.senderEmail },
            to: mail.to.map((email) => ({ email })),
            ...(company.reply_to ? { replyTo: { email: company.reply_to } } : {}),
            subject: mail.subject,
            htmlContent: mail.html,
            tags: [mail.kind === 'CIERRE' ? 'cierre-caja' : 'estado-cuenta'],
          }),
        })
      : await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `"${name}" <${cfg.senderEmail}>`,
            to: mail.to,
            ...(company.reply_to ? { reply_to: company.reply_to } : {}),
            subject: mail.subject,
            html: mail.html,
            ...(logo ? { attachments: [logo] } : {}),
          }),
        });
  const text = await res.text();
  return { ok: res.ok, detail: res.ok ? text.slice(0, 200) : `${res.status} ${text.slice(0, 300)}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data: authorized } = await admin.rpc('check_statements_secret', { p_secret: req.headers.get('x-cron-secret') ?? '' });
    if (authorized !== true) return json({ error: 'No autorizado.' }, 401);

    const input = (await req.json().catch(() => ({}))) as { org_id?: string; date?: string; dry_run?: boolean };
    const dryRun = input.dry_run === true;
    const cfg = await mailConfig(admin);
    if (!dryRun && !cfg) return json({ ok: true, skipped: 'No hay proveedor de correo configurado (Brevo o Resend): no se envió nada.' });

    const { data: orgs, error } = await admin.rpc('statement_orgs_due', { p_org: input.org_id ?? null });
    if (error) throw error;

    const result: { org_id: string; date: string; sent: number; errors: number; reply_to?: string | null; preview?: Mail[] }[] = [];
    for (const org of (orgs ?? []) as { org_id: string; statement_date: string }[]) {
      const date = input.date ?? org.statement_date;
      const { data, error: dataError } = await admin.rpc('daily_statement_data', { p_org: org.org_id, p_date: date });
      if (dataError) throw dataError;
      const d = data as StatementData;
      // Brevo no admite imágenes incrustadas (cid): en ese caso el encabezado va sin logo
      const logo = cfg?.provider === 'brevo' ? null : logoAttachment(d.company);

      const mails: Mail[] = d.customers.map((c) => customerMail(d, c, !!logo));
      const closing = d.closing ? closingMail(d, d.closing, !!logo) : null;
      if (closing) mails.push(closing);

      if (dryRun) {
        result.push({ org_id: org.org_id, date, sent: 0, errors: 0, reply_to: d.company.reply_to, preview: mails });
        continue;
      }
      let sent = 0;
      let errors = 0;
      for (const mail of mails) {
        const r = await send(mail, d.company, cfg!, logo);
        r.ok ? sent++ : errors++;
        await admin.from('statement_sends').insert({
          org_id: org.org_id, kind: mail.kind, statement_date: date, customer_id: mail.customer_id,
          recipients: mail.to, status: r.ok ? 'ENVIADO' : 'ERROR', detail: r.detail,
        });
      }
      result.push({ org_id: org.org_id, date, sent, errors });
    }
    return json({ ok: true, processed: result });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Error inesperado.' }, 500);
  }
});
