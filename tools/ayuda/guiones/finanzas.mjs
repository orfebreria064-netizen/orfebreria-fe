import { DEMO } from '../lib/demo.mjs';

const G = DEMO.gasto;
const panel = (h) => h.page.locator('p-tabpanel:visible').first();

export default {
  clave: 'finanzas',
  titulo: 'Finanzas',
  ruta: '/finanzas',
  paraQue:
    'Conocer la **utilidad real del mes**: lo cobrado menos lo pagado a joyeros y los **gastos** de la empresa; y llevar el control de los **préstamos** al personal y a los joyeros.',
  cuando: [
    'A fin de mes, para ver cuánto ganó el negocio.',
    'Cada vez que paga un gasto: luz, alquiler, planilla, impuestos, compra de material…',
    'Cuando presta dinero a un trabajador o joyero, y cuando le descuenta o le cobra un abono.',
  ],
  escenas: [
    {
      voz: 'En Finanzas ves la utilidad del mes: lo cobrado, lo pagado a joyeros, los gastos y la utilidad neta, comparados con el mes anterior.',
      paso: {
        titulo: 'Utilidad del mes',
        texto: 'La pestaña **Utilidad del mes** muestra los **cobros**, los **pagos a joyeros**, los **gastos** y la **utilidad neta**, con la variación respecto al mes anterior.',
        detalle: ['Debajo, el **estado de resultados** detalla cada concepto.'],
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'En la pestaña Gastos registras cada pago de la empresa. Pulsa Nuevo gasto.',
      paso: { titulo: 'Gastos', texto: 'Abra la pestaña **Gastos** y pulse **Nuevo gasto**.' },
      accion: async (h, n) => {
        await h.clic(h.pestana('Gastos'));
        await h.pausa(600);
        await h.resaltar(h.boton('Nuevo gasto'), n);
      },
    },
    {
      voz: 'Elige la categoría, escribe la descripción, el monto y el método de pago. Puedes anotar el proveedor y el número de comprobante.',
      paso: {
        titulo: 'Registrar un gasto',
        texto: 'Elija la **categoría** (planilla, servicios, alquiler, impuestos…), escriba la **descripción**, el **monto** y el **método**. Opcional: proveedor y comprobante. Pulse **Guardar**.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.boton('Nuevo gasto'));
        await h.elegir('#ex-cat', /^\s*Servicios/);
        await h.escribir('#ex-desc', G.descripcion);
        await h.numero('#ex-amount', G.monto);
        await h.elegir('#ex-method', 'Transferencia');
        await h.escribir('#ex-sup', 'Luz del Sur');
        await h.resaltar(['#ex-cat', '#ex-desc', '#ex-amount', '#ex-method', '#ex-sup'], n);
      },
    },
    {
      voz: 'El gasto aparece en la lista del periodo. Si te equivocas, no se borra: se anula indicando el motivo.',
      paso: {
        titulo: 'Lista de gastos',
        texto: 'El gasto queda en la lista. Un gasto equivocado no se borra: se **anula** con un motivo.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Guardar'));
        await h.cerrarAvisos();
        await h.pausa(600);
        await h.resaltar(panel(h).locator('tr', { hasText: G.descripcion }).first(), n);
      },
    },
    {
      voz: 'En Préstamos registras el dinero prestado a un trabajador o a un joyero, con el número de cuotas.',
      paso: {
        titulo: 'Nuevo préstamo',
        texto: 'En **Préstamos** pulse **Nuevo préstamo**. Elija si es para un **trabajador** o un **joyero**, el **monto**, las **cuotas** y el método.',
      },
      accion: async (h, n) => {
        await h.clic(h.pestana('Préstamos'));
        await h.clic(h.boton('Nuevo préstamo'));
        const tipo = h.page.getByRole('dialog').locator('p-selectbutton').first();
        await h.clic(tipo.getByText('Joyero', { exact: true }));
        await h.elegir('#ln-jw', DEMO.joyero.nombre);
        await h.numero('#ln-amount', DEMO.prestamo.monto);
        await h.numero('#ln-inst', DEMO.prestamo.cuotas);
        await h.escribir('#ln-reason', 'Adelanto para herramientas');
        await h.resaltar([tipo, '#ln-jw', '#ln-amount', '#ln-inst'], n);
      },
    },
    {
      voz: 'Pulsa Registrar préstamo. Cada vez que el trabajador devuelva una parte, regístrala como abono con el botón de la fila.',
      paso: {
        titulo: 'Abonos del préstamo',
        texto: 'Pulse **Registrar préstamo**. Cuando le descuente o le cobre una cuota, use **＋** en la fila para registrar el **abono**; con **☰** ve el detalle.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Registrar préstamo'));
        await h.cerrarAvisos();
        await h.pausa(700);
        await h.resaltar(panel(h).locator('tr', { hasText: DEMO.joyero.nombre }).first(), n);
      },
    },
    {
      voz: 'Listo. Registra tus gastos al día para que la utilidad del mes sea real.',
      accion: async (h) => {
        await h.clic(h.pestana('Utilidad del mes'));
        await h.pausa(600);
        await h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'));
      },
    },
  ],
  consejos: [
    'Registre los gastos el mismo día con su comprobante: al cierre del mes la utilidad será exacta.',
    'Los pagos a joyeros se registran desde el pedido (pestaña **Taller**) y entran solos en la utilidad.',
    'Los préstamos no son gasto: se controlan aparte hasta que se cancelan con abonos.',
  ],
  siguiente: 'Mantenga al día el **Tipo de cambio** para los pedidos y cobros en dólares.',
};
