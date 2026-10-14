/**
 * Datos de contacto y de cobro de la plataforma, visibles para las empresas
 * (avisos de vencimiento, cuenta suspendida, pestaña «Mi plan»).
 * EDITAR con los datos reales antes de publicar.
 */
export const PLATFORM = {
  name: 'Aurum',
  supportEmail: 'soporte@aurum.pe',
  /** Número en formato internacional sin "+" (para enlaces wa.me). */
  supportWhatsapp: '51999999999',
  /** Instrucciones de pago que ve el administrador de cada empresa. */
  paymentInstructions: [
    'Yape o Plin al 999 999 999 (a nombre de Aurum).',
    'Transferencia BCP: cuenta 000-0000000-0-00 / CCI 000-000-000000000000-00.',
    'Envíe la constancia por WhatsApp indicando el nombre de su empresa.',
  ],
} as const;

export const whatsappLink = (text: string) =>
  `https://wa.me/${PLATFORM.supportWhatsapp}?text=${encodeURIComponent(text)}`;
