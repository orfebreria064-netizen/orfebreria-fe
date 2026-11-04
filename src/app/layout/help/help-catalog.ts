/**
 * Ayuda por opción del menú. La clave es el primer segmento de la URL (/customers → customers);
 * el mismo nombre se usa para el PDF (public/ayuda/manuales/{clave}.pdf) y el video
 * (bucket "ayuda" de Supabase Storage: videos/{clave}.mp4).
 *
 * Qué material existe lo dice public/ayuda/manifest.json, que regenera tools/ayuda al publicar.
 */
export interface HelpTopic {
  title: string;
  summary: string;
}

export const HELP_TOPICS: Record<string, HelpTopic> = {
  dashboard: { title: 'Dashboard', summary: 'Resumen del negocio: ventas, pedidos en curso y alertas del día.' },
  customers: { title: 'Clientes', summary: 'Registrar y buscar clientes, y ver su historial y estado de cuenta.' },
  quotations: { title: 'Cotizaciones', summary: 'Preparar el presupuesto de una joya y convertirlo en pedido.' },
  orders: { title: 'Pedidos', summary: 'Registrar el encargo del cliente y seguir su avance hasta la entrega.' },
  reparaciones: { title: 'Reparaciones', summary: 'Recibir una joya para reparar con su acta de recepción.' },
  production: { title: 'Producción', summary: 'Tablero del taller: en qué etapa está cada trabajo.' },
  jewelers: { title: 'Joyeros', summary: 'Joyeros del taller, material entregado y pagos por su trabajo.' },
  vitrina: { title: 'Vitrina', summary: 'Joyas en exhibición y piedras registradas.' },
  materials: { title: 'Materiales', summary: 'Oro, plata y demás insumos: existencias y movimientos.' },
  payments: { title: 'Pagos', summary: 'Cobros y abonos de los clientes, con su recibo.' },
  deliveries: { title: 'Entregas', summary: 'Entregar el trabajo terminado al cliente y dejar constancia.' },
  finanzas: { title: 'Finanzas', summary: 'Utilidad del mes, gastos y préstamos.' },
  'tipo-cambio': { title: 'Tipo de cambio', summary: 'Tipo de cambio diario y precio del oro.' },
  reports: { title: 'Reportes', summary: 'Reportes para exportar a Excel o PDF.' },
  settings: { title: 'Configuración', summary: 'Datos de la empresa, usuarios y catálogos.' },
};

export interface HelpManifestEntry {
  pdf?: boolean;
  video?: boolean;
  /** Fecha de generación; se usa para no servir una versión vieja desde la caché. */
  version?: string;
}

export type HelpManifest = Record<string, HelpManifestEntry>;
