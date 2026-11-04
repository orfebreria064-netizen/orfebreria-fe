import { DEMO } from '../lib/demo.mjs';

const M = DEMO.material;

export default {
  clave: 'materials',
  titulo: 'Materiales',
  ruta: '/materials',
  // El nombre del material es único: retira el material demo de una grabación anterior
  preparar: async (db) => {
    await db.from('materials').update({ name: `${M.nombre} (demo ${Date.now()})`, active: false }).eq('name', M.nombre);
  },
  paraQue:
    'Controlar el **oro, la plata, las piedras y los insumos** del taller: cuánto hay en stock, cada entrada y salida, y el **precio del día** que se sugiere en cotizaciones y pedidos.',
  cuando: [
    'Al empezar a usar el sistema, para registrar los materiales con los que trabaja.',
    'Cada vez que compra material o lo entrega al taller.',
    'Cada mañana, para actualizar el precio del día del oro y la plata.',
  ],
  escenas: [
    {
      voz: 'En Materiales controlas el oro, la plata y las piedras del taller. Arriba ves cuántos materiales tienes, el metal en stock y los que están por debajo del mínimo.',
      paso: {
        titulo: 'Entrar a Materiales',
        texto: 'En el menú pulse **Materiales**. Los indicadores muestran los materiales activos, el metal en stock y los que están **bajo el stock mínimo**.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'Para registrar un material nuevo, pulsa Nuevo material.',
      paso: { titulo: 'Nuevo material', texto: 'Pulse **Nuevo material**, arriba a la derecha.' },
      accion: async (h, n) => h.resaltar(h.page.getByRole('button', { name: 'Nuevo material' }), n),
    },
    {
      voz: 'Escribe el nombre, elige el tipo, la ley y la unidad. Para los metales, la unidad es el gramo.',
      paso: {
        titulo: 'Nombre, tipo, ley y unidad',
        texto: 'Complete el **nombre** (por ejemplo, Oro 18K), el **tipo** (oro, plata, platino, piedra…), la **ley** y la **unidad**.',
        detalle: ['Metales: en gramos. Piedras: en quilates o unidades.'],
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('button', { name: 'Nuevo material' }));
        await h.escribir('#mt-name', M.nombre);
        await h.escribir('#mt-purity', M.ley);
        await h.resaltar(['#mt-name', '#mt-type', '#mt-purity', '#mt-unit'], n);
      },
    },
    {
      voz: 'El precio de venta del día se sugiere al cotizar. El costo de compra sirve para valorizar tu inventario; no se le cobra al cliente.',
      paso: {
        titulo: 'Precio del día y costo',
        texto: 'El **precio de venta del día** se sugiere en cotizaciones y pedidos. El **costo de compra** solo valoriza el inventario.',
      },
      accion: async (h, n) => {
        await h.numero('#mt-price', M.precioDia);
        await h.numero('#mt-cost', M.costo);
        await h.resaltar(['#mt-price', '#mt-cost'], n);
      },
    },
    {
      voz: 'Indica cuánto tienes hoy y el stock mínimo. Cuando baje de ese mínimo, el sistema te avisará.',
      paso: {
        titulo: 'Stock inicial y mínimo',
        texto: 'El **stock inicial** se registra como una entrada. El **stock mínimo** activa la alerta de reposición.',
      },
      accion: async (h, n) => {
        await h.numero('#mt-stock', M.stock);
        await h.numero('#mt-min', M.minimo);
        await h.resaltar(['#mt-stock', '#mt-min'], n);
      },
    },
    {
      voz: 'Pulsa Guardar. El material aparece en el inventario con su stock.',
      paso: { titulo: 'Guardar', texto: 'Pulse **Guardar**. El material queda en la pestaña **Inventario**.' },
      accion: async (h, n) => {
        await h.clic(h.enDialogo('Guardar'));
        await h.cerrarAvisos();
        await h.resaltar(h.page.locator('tr:visible', { hasText: M.nombre }).first(), n);
      },
    },
    {
      voz: 'Cuando compras material o lo entregas al taller, pulsa Registrar movimiento. Elige si es de la empresa o del cliente, el tipo de movimiento y el material.',
      paso: {
        titulo: 'Registrar un movimiento',
        texto: 'Pulse **Registrar movimiento**. Indique a quién pertenece el material (**empresa** o **cliente**), el **tipo** (entrada, salida, ajuste…) y el material.',
        detalle: ['El material del cliente no afecta el stock de la empresa: se controla por pedido.'],
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('button', { name: 'Registrar movimiento' }));
        await h.elegir('#mv-type', 'Entrada');
        await h.elegir('#mv-material', new RegExp(M.nombre));
        await h.resaltar(['p-selectbutton', '#mv-type', '#mv-material'], n);
      },
    },
    {
      voz: 'Escribe la cantidad y, si quieres, el costo y una observación. Luego pulsa Registrar.',
      paso: { titulo: 'Cantidad y registrar', texto: 'Escriba la **cantidad o peso**, el costo (opcional) y una observación. Pulse **Registrar**.' },
      accion: async (h, n) => {
        await h.numero('#mv-qty', 20);
        await h.numero('#mv-cost', M.costo);
        await h.escribir('#mv-notes', 'Compra a proveedor');
        await h.resaltar(['#mv-qty', '#mv-cost', h.enDialogo('Registrar')], n);
      },
    },
    {
      voz: 'En la pestaña Movimientos ves todas las entradas, salidas y consumos, con su fecha y su pedido.',
      paso: { titulo: 'Movimientos', texto: 'La pestaña **Movimientos** lista cada entrada, salida, ajuste y consumo en pedidos.' },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Registrar'));
        await h.cerrarAvisos();
        await h.clic(h.pestana('Movimientos'));
        await h.pausa(800);
        await h.resaltar(h.page.locator('p-tabpanel:visible table, p-tabpanel:visible .p-datatable').first(), n);
      },
    },
    {
      voz: 'En Precios del día actualizas el precio de cada material. Escribe el nuevo precio y pulsa Guardar precios.',
      paso: {
        titulo: 'Precios del día',
        texto: 'En **Precios del día** escriba el nuevo precio de cada material y pulse **Guardar precios**. Queda registrado con la fecha de hoy.',
      },
      accion: async (h, n) => {
        await h.clic(h.pestana('Precios del día'));
        await h.pausa(800);
        const fila = h.page.locator('tr:visible', { hasText: M.nombre }).first();
        await h.numero(fila.locator('p-inputnumber input'), M.precioDia + 3);
        await h.resaltar([fila, h.page.getByRole('button', { name: 'Guardar precios' })], n);
      },
    },
    {
      voz: 'Si abres un material, ves su kardex: el historial completo de movimientos y el stock actual.',
      paso: { titulo: 'Kardex del material', texto: 'En **Inventario**, pulse un material para ver su **kardex** y su stock actual.' },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('button', { name: 'Guardar precios' }));
        await h.cerrarAvisos();
        await h.clic(h.pestana('Inventario'));
        await h.clic(h.page.locator('tr:visible', { hasText: M.nombre }).first());
        await h.page.waitForURL(/\/materials\/[0-9a-f-]{36}/);
        await h.pausa(900);
        await h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n);
      },
    },
    {
      voz: 'Listo. Mantén tus precios del día al corriente para cotizar con valores reales.',
    },
  ],
  consejos: [
    'Actualice el **precio del día** cada mañana: las cotizaciones y pedidos lo sugieren automáticamente.',
    'Registre siempre los movimientos; así el stock y el kardex coinciden con lo que hay en caja fuerte.',
    'El material que trae el cliente se registra como **del cliente** desde su pedido: no se mezcla con el de la empresa.',
    'Un material que ya no usa se desactiva desde **Editar**; no se borra para no perder su historial.',
  ],
  siguiente: 'Registre a sus **Joyeros** para poder asignarles trabajos y controlar el material que les entrega.',
};
