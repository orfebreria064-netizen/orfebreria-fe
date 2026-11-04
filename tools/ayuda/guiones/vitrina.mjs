import { DEMO } from '../lib/demo.mjs';

const J = DEMO.joya;
const P = DEMO.piedra;

export default {
  clave: 'vitrina',
  titulo: 'Vitrina',
  ruta: '/vitrina',
  // Da de baja las piezas demo de grabaciones anteriores (la vitrina muestra solo las que están en stock)
  preparar: async (db) => {
    await db.from('products').update({ status: 'BAJA' }).eq('name', J.nombre).eq('status', 'STOCK');
    await db.from('gems').update({ status: 'BAJA' }).eq('carat', P.quilates).eq('price', P.precio).eq('status', 'STOCK');
  },
  paraQue:
    'Llevar el inventario de las **joyas terminadas** en exhibición y de las **piedras y diamantes** (propios o de clientes), con su código, características, costo y precio de venta.',
  cuando: [
    'Cuando ingresa a la vitrina una joya terminada para la venta.',
    'Cuando compra o recibe una piedra o un diamante.',
    'Al vender: se agrega al pedido con **Agregar desde la vitrina**.',
  ],
  escenas: [
    {
      voz: 'En Vitrina controlas las joyas en exhibición y las piedras. Arriba ves cuántas joyas hay, su valor de venta, las piedras en stock y las reservadas.',
      paso: {
        titulo: 'Resumen de la vitrina',
        texto: 'Los indicadores muestran las **joyas en vitrina**, su **valor de venta**, las **piedras en stock** y las piezas **reservadas** en pedidos.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'Para registrar una joya, pulsa Nueva joya. Escribe su nombre, elige la categoría, el metal y el color. El código se asigna solo.',
      paso: {
        titulo: 'Nueva joya',
        texto: 'Pulse **Nueva joya**. Escriba el **nombre**, elija la **categoría**, el **metal** y su color. El **código** (JY-000001) se asigna solo si lo deja vacío.',
      },
      accion: async (h, n) => {
        await h.clic(h.boton('Nueva joya'));
        await h.escribir('#pr-name', J.nombre);
        await h.elegir('#pr-cat', 'Aretes');
        await h.elegir('#pr-mat', new RegExp(DEMO.material.nombre));
        await h.elegir('#pr-color', 'Amarillo');
        await h.resaltar(['#pr-name', '#pr-code', '#pr-cat', '#pr-mat', '#pr-color'], n);
      },
    },
    {
      voz: 'Indica el peso, el costo y el precio de venta. También puedes subir una foto y agregar las piedras que lleva.',
      paso: {
        titulo: 'Peso, costo, precio y foto',
        texto: 'Indique el **peso**, el **costo** y el **precio de venta**. Puede subir una **foto** y, en **Piedras**, detallar las piedras que lleva la joya.',
      },
      accion: async (h, n) => {
        await h.numero('#pr-weight', J.peso);
        await h.numero('#pr-cost', J.costo);
        await h.numero('#pr-price', J.precio);
        await h.resaltar(['#pr-weight', '#pr-cost', '#pr-price', '#pr-photo'], n);
      },
    },
    {
      voz: 'Pulsa Guardar. La joya queda en vitrina, en stock, lista para venderse.',
      paso: { titulo: 'Joya en vitrina', texto: 'Pulse **Guardar**. La joya queda **En stock** en la pestaña **Joyas**.' },
      accion: async (h, n) => {
        await h.clic(h.enDialogo('Guardar'));
        await h.cerrarAvisos();
        await h.pausa(600);
        await h.resaltar(h.page.locator('article.piece:visible', { hasText: J.nombre }).first(), n);
      },
    },
    {
      voz: 'Las piedras y diamantes se registran con Nueva piedra. Elige el tipo, la forma y los quilates. Para diamantes, también el color, la pureza y el corte.',
      paso: {
        titulo: 'Nueva piedra',
        texto: 'Pulse **Nueva piedra**: **tipo**, **forma** y **quilates**. Para diamantes, además **color**, **pureza**, corte, pulido, simetría y fluorescencia, y el **certificado** si lo tiene.',
      },
      accion: async (h, n) => {
        await h.clic(h.boton('Nueva piedra'));
        await h.numero('#gm-carat', P.quilates);
        await h.elegir('#gm-color', /^\s*G\b/);
        await h.elegir('#gm-clarity', /^\s*VS1\b/);
        await h.elegir('#gm-cut', /^\s*Excelente/);
        await h.resaltar(['#gm-type', '#gm-shape', '#gm-carat', '#gm-color', '#gm-clarity', '#gm-cut'], n);
      },
    },
    {
      voz: 'Indica si la piedra es de la empresa o de un cliente, y su costo y precio. Luego pulsa Guardar.',
      paso: {
        titulo: 'Propietario y precio',
        texto: 'Indique el **propietario** (empresa o cliente), la **moneda**, el **costo** y el **precio**. Pulse **Guardar**.',
      },
      accion: async (h, n) => {
        await h.numero('#gm-cost', P.costo);
        await h.numero('#gm-price', P.precio);
        await h.resaltar([h.page.getByRole('dialog').locator('p-selectbutton').last(), '#gm-cur', '#gm-cost', '#gm-price'], n);
      },
    },
    {
      voz: 'La piedra queda en la pestaña Piedras y diamantes, con su resumen de características.',
      paso: { titulo: 'Piedras y diamantes', texto: 'La pestaña **Piedras y diamantes** lista cada piedra con su código, características, estado y precio.' },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Guardar'));
        await h.cerrarAvisos();
        await h.clic(h.pestana('Piedras y diamantes'));
        await h.pausa(800);
        await h.resaltar(h.page.locator('p-tabpanel:visible table').first(), n);
      },
    },
    {
      voz: 'Para vender una pieza, en el pedido usa Agregar desde la vitrina. La pieza se reserva y, al entregar, queda como vendida.',
      accion: async (h) => h.resaltar(h.page.locator('.toolbar-filters:visible').first()),
    },
  ],
  consejos: [
    'Para vender, en el pedido pulse **Agregar desde la vitrina**: la pieza se **reserva** y luego queda **vendida**.',
    'Use el buscador por **código** para encontrar rápido una pieza.',
    'Registre como **del cliente** las piedras que el cliente trae para montar; así no se mezclan con las suyas.',
  ],
  siguiente: 'Revise la **utilidad del mes**, gastos y préstamos en **Finanzas**.',
};
