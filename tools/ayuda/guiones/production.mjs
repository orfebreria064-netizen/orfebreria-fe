import { pedidoDemo } from '../lib/db.mjs';

const tarjeta = (h, etapa) => h.page.locator('.kcard').filter({ hasText: h.datos.pedido.number }).filter({ hasText: etapa }).first();
const etapaFila = (h, etapa) => h.page.locator('li.stage').filter({ hasText: etapa }).first();

async function mover(h, etapa, destino) {
  await h.clic(tarjeta(h, etapa).locator('.kcard__menu button, button[aria-label="Mover"]').first());
  await h.clic(h.page.getByRole('menuitem', { name: `Mover a ${destino}` }));
  await h.cerrarAvisos();
  await h.pausa(600);
}

export default {
  clave: 'production',
  titulo: 'Producción',
  ruta: '/production',
  // Deja la primera etapa del pedido demo pendiente, para mostrar el recorrido completo
  preparar: async (db) => {
    const pedido = await pedidoDemo(db);
    await db.from('order_production_stages').update({ status: 'PENDIENTE' }).eq('order_id', pedido.id);
    return { pedido };
  },
  paraQue:
    'Ver en un **tablero** en qué etapa está cada trabajo del taller (diseño, fundición, engaste, pulido…) y actualizar su avance; el pedido avanza de estado solo.',
  cuando: [
    'Cada día, para revisar qué trabajos están pendientes, en proceso o bloqueados.',
    'Cuando el joyero termina una etapa o empieza la siguiente.',
  ],
  escenas: [
    {
      voz: 'Producción es el tablero del taller. Cada tarjeta es una etapa de un pedido, ordenada en columnas: pendiente, en proceso, completado y bloqueado.',
      paso: {
        titulo: 'El tablero',
        texto: 'Cada **tarjeta** es una etapa de un pedido. Las columnas son **Pendiente**, **En proceso**, **Completado** y **Bloqueado**.',
        detalle: ['La tarjeta muestra el número de pedido, la etapa, el producto, el cliente, el avance, el responsable y la fecha de entrega.'],
      },
      accion: async (h, n) => h.resaltar(h.page.locator('.board'), n),
    },
    {
      voz: 'Con los filtros ves solo un responsable o una etapa, por ejemplo todo lo que está en engaste.',
      paso: { titulo: 'Filtros', texto: 'Filtre por **responsable** o por **etapa**.' },
      accion: async (h, n) => h.resaltar(h.page.locator('.card.filters'), n),
    },
    {
      voz: 'Para avanzar una etapa, arrastra la tarjeta a otra columna, o usa el menú de la tarjeta y elige Mover a en proceso.',
      paso: {
        titulo: 'Mover una etapa',
        texto: '**Arrastre** la tarjeta a otra columna, o pulse **⋯** en la tarjeta y elija **Mover a…**.',
      },
      accion: async (h, n) => {
        await h.clic(tarjeta(h, 'Diseño').locator('.kcard__menu button, button[aria-label="Mover"]').first());
        await h.resaltar([tarjeta(h, 'Diseño'), h.page.getByRole('menuitem', { name: 'Mover a En proceso' })], n);
      },
    },
    {
      voz: 'La tarjeta pasa a En proceso y el pedido se actualiza solo.',
      paso: { titulo: 'Etapa en proceso', texto: 'La etapa queda **En proceso** y el estado del pedido se actualiza automáticamente.' },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('menuitem', { name: 'Mover a En proceso' }));
        await h.cerrarAvisos();
        await h.pausa(700);
        await h.resaltar(tarjeta(h, 'Diseño'), n);
      },
    },
    {
      voz: 'Cuando el joyero termina, mueve la etapa a Completado. La siguiente etapa del pedido pasa a ser la actual.',
      paso: { titulo: 'Completar la etapa', texto: 'Al terminar, mueva la etapa a **Completado**: la siguiente etapa pasa a ser la actual.' },
      accion: async (h, n) => {
        await mover(h, 'Diseño', 'Completado');
        await h.resaltar(h.page.locator('.column[data-status="COMPLETADO"]'), n);
      },
    },
    {
      voz: 'También puedes actualizar las etapas desde el pedido. Pulsa el número del pedido y abre la pestaña Producción.',
      paso: {
        titulo: 'Etapas dentro del pedido',
        texto: 'Pulse el **número del pedido** en la tarjeta y abra la pestaña **Producción**: verá todas las etapas en orden, con su avance.',
      },
      accion: async (h, n) => {
        await h.clic(h.page.locator('.kcard a.link', { hasText: h.datos.pedido.number }).first());
        await h.page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
        await h.clic(h.pestana('Producción'));
        await h.pausa(800);
        await h.resaltar(h.page.locator('ol.stages'), n);
      },
    },
    {
      voz: 'En cada etapa cambias el estado, asignas un responsable o dejas observaciones.',
      paso: {
        titulo: 'Estado, responsable y observaciones',
        texto: 'En cada etapa elija el **estado** y el **responsable**; con el ícono de comentario deje **observaciones**.',
        detalle: ['Con **Agregar etapa** suma pasos que no estén en la plantilla.'],
      },
      accion: async (h, n) => {
        await h.elegir(etapaFila(h, 'Fundición').locator('p-select').first(), 'En proceso');
        await h.cerrarAvisos();
        await h.resaltar(etapaFila(h, 'Fundición'), n);
      },
    },
    {
      voz: 'Cuando todas las etapas están completas y pasa el control de calidad, el pedido queda listo para entregar.',
      accion: async (h) => h.resaltar(etapaFila(h, 'Control de calidad')),
    },
  ],
  consejos: [
    'Actualice las etapas el mismo día: el Dashboard y los clientes dependen de ese avance.',
    'Use **Bloqueado** cuando falte algo (material, aprobación del cliente) y explique el motivo en observaciones.',
    'Las etapas por defecto se configuran en **Configuración → Etapas de producción**.',
  ],
  siguiente: 'Registre los cobros del cliente en **Pagos** y, al terminar, la **Entrega**.',
};
