import { ok, pedidoDemo } from '../lib/db.mjs';

const filaEntrega = (h) => h.page.locator('tr:visible', { hasText: h.datos.pedido.number }).first();

export default {
  clave: 'deliveries',
  titulo: 'Entregas',
  ruta: '/deliveries',
  // Para entregar, la producción del pedido demo debe estar completa (control de calidad aprobado)
  preparar: async (db) => {
    const pedido = await pedidoDemo(db);
    const etapas = ok(await db.from('order_production_stages').select('id').eq('order_id', pedido.id).order('position'));
    for (const e of etapas) ok(await db.from('order_production_stages').update({ status: 'COMPLETADO' }).eq('id', e.id));
    return { pedido };
  },
  paraQue:
    'Programar la **entrega** de cada trabajo terminado y dejar constancia de **quién lo recibió**, cuándo y con qué conformidad, con la firma del cliente.',
  cuando: [
    'Cuando el pedido está listo y se acuerda con el cliente el día de entrega.',
    'En el momento en que el cliente recoge la joya.',
  ],
  escenas: [
    {
      voz: 'En Entregas ves las entregas pendientes, las de hoy y las atrasadas.',
      paso: {
        titulo: 'Resumen de entregas',
        texto: 'En el menú pulse **Entregas**. Los indicadores muestran las entregas **pendientes**, las de **hoy** y las **atrasadas**.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'Para coordinar una entrega, pulsa Programar entrega, elige el pedido, la fecha y el responsable.',
      paso: {
        titulo: 'Programar entrega',
        texto: 'Pulse **Programar entrega**, busque el **pedido**, elija la **fecha programada** y el **responsable**.',
        detalle: ['Si el pedido tiene saldo, se muestra un aviso: puede entregarse, pero quedará registrado.'],
      },
      accion: async (h, n) => {
        await h.clic(h.boton('Programar entrega'));
        await h.autocompletar('#dl-order', h.datos.pedido.number.slice(-6), h.datos.pedido.number);
        await h.pausa(500);
        await h.elegir('#dl-resp', 'Juan Ortega');
        await h.resaltar(['#dl-order', '#dl-status', '#dl-date', '#dl-resp'], n);
      },
    },
    {
      voz: 'Pulsa Guardar. La entrega queda en la lista con su fecha y el saldo del pedido.',
      paso: { titulo: 'Entrega programada', texto: 'Pulse **Guardar**. La entrega aparece en la lista con su fecha, estado y el **saldo** del pedido.' },
      accion: async (h, n) => {
        await h.clic(h.enDialogo('Guardar'));
        await h.cerrarAvisos();
        await h.pausa(600);
        await h.resaltar(filaEntrega(h), n);
      },
    },
    {
      voz: 'Cuando el cliente recoge la joya, pulsa Entregar. Escribe quién la recibe y marca si está conforme.',
      paso: {
        titulo: 'Registrar la entrega',
        texto: 'Cuando el cliente recoja la joya pulse **Entregar**. Indique **quién la recibe**, la **conformidad** y observaciones.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(filaEntrega(h).getByRole('button', { name: 'Entregar' }));
        await h.escribir('#dl-received', h.datos.pedido ? 'María Fernanda Quispe Rojas' : '');
        await h.escribir('#dl-conf-notes', 'Recibe conforme, con estuche.');
        await h.resaltar(['#dl-real', '#dl-received', h.page.getByRole('dialog').locator('p-selectbutton').first()], n);
      },
    },
    {
      voz: 'Pide al cliente que firme en el recuadro y pulsa Registrar entrega.',
      paso: { titulo: 'Firma del cliente', texto: 'El cliente puede **firmar** en el recuadro (opcional). Pulse **Registrar entrega**.' },
      accion: async (h, n) => {
        const firma = h.page.getByRole('dialog').locator('canvas').first();
        await firma.scrollIntoViewIfNeeded();
        await h.firmar(firma);
        await h.resaltar([firma, h.enDialogo('Registrar entrega')], n);
      },
    },
    {
      voz: 'La entrega queda registrada y el pedido pasa a Entregado. Para ver las entregas ya hechas, agrega Entregada en el filtro de estados.',
      paso: {
        titulo: 'Entrega registrada',
        texto: 'La entrega queda como **Entregada** y el pedido pasa a **Entregado**. La lista muestra por defecto las pendientes: para ver las hechas, agregue **Entregada** en el filtro.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Registrar entrega'));
        await h.cerrarAvisos();
        await h.pausa(700);
        await h.clic(h.page.locator('p-multiselect').first());
        await h.clic(h.page.locator('[role="option"]:visible').filter({ hasText: /^\s*Entregada\s*$/ }).first());
        await h.page.keyboard.press('Escape');
        await h.pausa(800);
        await h.resaltar([h.page.locator('p-multiselect').first(), filaEntrega(h)], n);
      },
    },
    {
      voz: 'Listo. Si queda saldo, cóbralo en Pagos y después cierra el pedido.',
    },
  ],
  consejos: [
    'La entrega solo se registra si la producción está completa y el **control de calidad aprobado**.',
    'Si el cliente no vino, cambie el estado a **No entregada** y reprograme la fecha.',
    'Después de la entrega y con el saldo en cero, cierre el pedido con **Cerrar pedido**.',
  ],
  siguiente: 'Revise las **Reparaciones** que tenga en taller.',
};
