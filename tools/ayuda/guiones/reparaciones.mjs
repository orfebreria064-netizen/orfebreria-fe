import { DEMO } from '../lib/demo.mjs';
import { clienteDemo } from '../lib/db.mjs';

const R = DEMO.reparacion;
const dialogo = (h) => h.page.getByRole('dialog').filter({ visible: true }).last();

export default {
  clave: 'reparaciones',
  titulo: 'Reparaciones',
  ruta: '/reparaciones',
  preparar: async (db) => ({ cliente: await clienteDemo(db) }),
  paraQue:
    'Recibir la **joya de un cliente para reparar** dejando constancia en un **acta de recepción**: qué pieza se recibe, en qué estado, su peso y la firma del cliente; y registrar su devolución.',
  cuando: [
    'Cuando un cliente deja una pieza para soldar, ajustar, pulir, cambiar garras, etc.',
    'Cuando la reparación está lista y el cliente recoge su pieza.',
  ],
  escenas: [
    {
      voz: 'En Reparaciones ves las piezas de clientes que están en el taller, las listas para entregar y las atrasadas.',
      paso: {
        titulo: 'Resumen de reparaciones',
        texto: 'En el menú pulse **Reparaciones**. Los indicadores muestran las piezas **en taller**, las **listas para entregar** y las **atrasadas**.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'Cuando un cliente deja una pieza, pulsa Nueva reparación. Elige al cliente, describe la pieza y su precio estimado.',
      paso: {
        titulo: 'Nueva reparación',
        texto: 'Pulse **Nueva reparación**. Elija el **cliente**, la fecha aproximada de entrega, la **pieza** y el **precio estimado**.',
      },
      accion: async (h, n) => {
        await h.clic(h.boton('Nueva reparación'));
        await h.autocompletar('#rc-customer', 'Quispe', h.datos.cliente.full_name);
        await h.fecha('#rc-due', DEMO.enDias(5));
        await h.escribir('#rc-title', R.pieza);
        await h.numero('#rc-price', R.precio);
        await h.resaltar(['#rc-customer', '#rc-due', '#rc-title', '#rc-price'], n);
      },
    },
    {
      voz: 'Escribe el trabajo a realizar y detalla cada pieza recibida: descripción, ley, cantidad y peso.',
      paso: {
        titulo: 'Trabajo y piezas recibidas',
        texto: 'Describa el **trabajo a realizar** y cada **pieza recibida** con su ley, cantidad, **peso** y quilates. El peso protege a ambas partes.',
      },
      accion: async (h, n) => {
        await h.escribir('#rc-issue', R.trabajo);
        const linea = dialogo(h).locator('.lines__row').first();
        await h.escribir(linea.locator('input[aria-label="Descripción"]'), 'Cadena tejido cartier, 50 cm');
        await h.escribir(linea.locator('input[aria-label="Ley"]'), '18K');
        await h.numero(linea.locator('p-inputnumber[arialabel="Peso en gramos"] input, input[aria-label="Peso en gramos"]').first(), R.peso);
        await h.resaltar(['#rc-issue', linea], n);
      },
    },
    {
      voz: 'Anota el estado en que se recibe la pieza, por ejemplo rayones o piedras faltantes, y pide al cliente que firme.',
      paso: {
        titulo: 'Estado y firma',
        texto: 'Anote el **estado en que se recibe** (rayones, piedras faltantes, broche flojo…). Si la trae otra persona, registre su nombre y DNI. El cliente puede **firmar** en el recuadro.',
      },
      accion: async (h, n) => {
        await h.escribir('#rc-cond', 'Eslabón roto, rayones leves');
        const firma = dialogo(h).locator('canvas').first();
        await firma.scrollIntoViewIfNeeded();
        await h.firmar(firma);
        await h.resaltar(['#rc-cond', firma], n);
      },
    },
    {
      voz: 'Pulsa Registrar reparación. El sistema crea el acta y te ofrece imprimirla para entregársela al cliente.',
      paso: {
        titulo: 'Registrar e imprimir el acta',
        texto: 'Pulse **Registrar reparación**. Se crea el **acta de recepción** y el sistema ofrece **imprimirla** para el cliente.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Registrar reparación'));
        const aviso = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog')).filter({ hasText: /imprimir/i }).last();
        await aviso.waitFor({ state: 'visible', timeout: 20_000 });
        await h.resaltar(aviso, n);
      },
    },
    {
      voz: 'La reparación aparece en la lista. Con la impresora vuelves a imprimir el acta y con la flecha registras la devolución de la pieza al cliente.',
      paso: {
        titulo: 'Seguimiento y devolución',
        texto: 'Cada reparación muestra su estado. Con **🖨** reimprime el acta y con **↩** registra la **devolución** de la pieza.',
        detalle: ['Cada reparación es también un pedido de tipo Reparación: su producción y cobro se siguen en **Pedidos**.'],
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.confirmar('Ahora no', 'No');
        await h.cerrarAvisos();
        await h.pausa(800);
        await h.resaltar(h.page.locator('tr:visible', { hasText: R.pieza }).first(), n);
      },
    },
    {
      voz: 'Listo. Así queda constancia de cada pieza que entra y sale del taller.',
    },
  ],
  consejos: [
    'Pese siempre la pieza frente al cliente y anótelo en el acta.',
    'Describa con detalle el estado de la pieza al recibirla: evita reclamos.',
    'Si la pieza tiene piedras, anote cantidad y quilates en la línea de la pieza.',
  ],
  siguiente: 'Revise sus joyas en exhibición en **Vitrina**.',
};
