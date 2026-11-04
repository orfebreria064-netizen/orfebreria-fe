import { DEMO } from '../lib/demo.mjs';

const J = DEMO.joyero;

export default {
  clave: 'jewelers',
  titulo: 'Joyeros',
  ruta: '/jewelers',
  // Retira el joyero demo de grabaciones anteriores para que la lista muestre uno solo
  preparar: async (db) => {
    await db.from('jewelers').update({ active: false }).eq('full_name', J.nombre).eq('active', true);
  },
  paraQue:
    'Registrar a los **joyeros externos** que trabajan para el taller, ver cuántos pedidos tiene cada uno y controlar **lo que se les paga**.',
  cuando: [
    'Al empezar, para registrar a los joyeros con los que trabaja.',
    'Antes de asignar un pedido a un joyero en la pestaña **Taller** del pedido.',
    'Para revisar cuánto se pagó a cada joyero en un periodo.',
  ],
  escenas: [
    {
      voz: 'En Joyeros registras a los joyeros externos del taller. Para agregar uno, pulsa Nuevo joyero.',
      paso: { titulo: 'Nuevo joyero', texto: 'En el menú pulse **Joyeros** y luego **Nuevo joyero**.' },
      accion: async (h, n) => h.resaltar(h.page.getByRole('button', { name: 'Nuevo joyero' }), n),
    },
    {
      voz: 'Escribe su nombre completo, su DNI y su teléfono.',
      paso: { titulo: 'Datos del joyero', texto: 'Complete el **nombre completo** (obligatorio), el **DNI** y el **teléfono**.' },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('button', { name: 'Nuevo joyero' }));
        await h.escribir('#jw-name', J.nombre);
        await h.escribir('#jw-dni', DEMO.dni());
        await h.escribir('#jw-phone', J.telefono);
        await h.resaltar(['#jw-name', '#jw-dni', '#jw-phone'], n);
      },
    },
    {
      voz: 'Indica su especialidad, por ejemplo engaste o fundición, y cualquier observación. Luego pulsa Guardar.',
      paso: {
        titulo: 'Especialidad y guardar',
        texto: 'Indique su **especialidad** (engaste, fundición, platería…) y observaciones. Pulse **Guardar**.',
      },
      accion: async (h, n) => {
        await h.escribir('#jw-specialty', J.especialidad);
        await h.escribir('#jw-notes', 'Trabaja de lunes a sábado');
        await h.resaltar(['#jw-specialty', h.enDialogo('Guardar')], n);
      },
    },
    {
      voz: 'El joyero aparece en la lista con sus pedidos en curso y el total que se le ha pagado.',
      paso: {
        titulo: 'Lista de joyeros',
        texto: 'Cada joyero muestra sus **pedidos en curso** y el **total pagado**. Con el lápiz edita sus datos o lo desactiva.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Guardar'));
        await h.cerrarAvisos();
        await h.resaltar(h.page.locator('tr:visible', { hasText: J.nombre }).first(), n);
      },
    },
    {
      voz: 'En la pestaña Pagos a joyeros ves los recibos de egreso por periodo y por joyero. Los pagos se registran desde la pestaña Taller de cada pedido.',
      paso: {
        titulo: 'Pagos a joyeros',
        texto: 'La pestaña **Pagos a joyeros** reúne los recibos de egreso. Filtre por **rango de fechas** y por **joyero**.',
        detalle: ['Los pagos se registran en el pedido: pestaña **Taller** → **Pagos al joyero** → **Registrar pago**.'],
      },
      accion: async (h, n) => {
        await h.clic(h.pestana('Pagos a joyeros'));
        await h.pausa(800);
        await h.resaltar(h.page.locator('p-tabpanel:visible .toolbar-filters').first(), n);
      },
    },
    {
      voz: 'Listo. Ahora podrás asignar este joyero a tus pedidos.',
    },
  ],
  consejos: [
    'Registre el DNI del joyero: aparece en los recibos de egreso.',
    'Si un joyero deja de trabajar con usted, desactívelo desde **Editar**; su historial de pagos se conserva.',
    'Los préstamos al joyero se registran en **Finanzas → Préstamos**.',
  ],
  siguiente: 'Registre a sus **Clientes** para empezar a cotizar y tomar pedidos.',
};
