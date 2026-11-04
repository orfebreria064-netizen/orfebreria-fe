import { DEMO } from '../lib/demo.mjs';
import { pedidoDemo } from '../lib/db.mjs';

export default {
  clave: 'payments',
  titulo: 'Pagos',
  ruta: '/payments',
  preparar: async (db) => ({ pedido: await pedidoDemo(db) }),
  paraQue:
    'Registrar los **cobros y adelantos** de los clientes, emitir su **recibo de ingreso** y saber cuánto se cobró en el periodo y cuánto falta cobrar.',
  cuando: [
    'Cada vez que un cliente deja un adelanto o paga su saldo.',
    'Para revisar lo cobrado en el día o en el mes, por método de pago.',
    'Para ver qué pedidos tienen saldo pendiente.',
  ],
  escenas: [
    {
      voz: 'En Pagos registras los cobros de tus clientes. Arriba ves lo cobrado en el periodo y el total que falta cobrar.',
      paso: {
        titulo: 'Resumen de cobros',
        texto: 'En el menú pulse **Pagos**. Verá lo **cobrado en el periodo** y el **total por cobrar**.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'Pulsa Registrar pago y busca el pedido por su número o por el producto.',
      paso: {
        titulo: 'Elegir el pedido',
        texto: 'Pulse **Registrar pago** y busque el **pedido** por número o producto. Se muestran su total, lo pagado y el saldo.',
        detalle: ['También puede registrar el pago desde el propio pedido con **Registrar pago**.'],
      },
      accion: async (h, n) => {
        await h.clic(h.boton('Registrar pago'));
        await h.autocompletar('#pay-order', h.datos.pedido.number.slice(-6), h.datos.pedido.number);
        await h.pausa(600);
        await h.resaltar([h.page.locator('#pay-order'), h.page.locator('.amounts:visible').first()], n);
      },
    },
    {
      voz: 'Escribe el monto, la fecha y el método: efectivo, Yape, Plin, transferencia o tarjeta. Si es un adelanto, se marca solo.',
      paso: {
        titulo: 'Monto, método y referencia',
        texto: 'Escriba el **monto**, elija el **método** (efectivo, Yape, Plin, transferencia, tarjeta…) y el **número de operación**. **Es un adelanto** se marca solo en el primer pago.',
      },
      accion: async (h, n) => {
        await h.numero('#pay-amount', DEMO.pago.adelanto);
        await h.elegir('#pay-method', 'Yape');
        await h.escribir('#pay-ref', DEMO.pago.referencia);
        await h.resaltar(['#pay-amount', '#pay-method', '#pay-ref', '#pay-advance'], n);
      },
    },
    {
      voz: 'Pulsa Registrar pago. El sistema te ofrece imprimir el recibo de ingreso para el cliente.',
      paso: {
        titulo: 'Recibo de ingreso',
        texto: 'Pulse **Registrar pago**. Cada cobro genera su **recibo de ingreso**; el sistema ofrece imprimirlo en el momento.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Registrar pago'));
        const aviso = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog')).filter({ hasText: /recibo/i }).last();
        await aviso.waitFor({ state: 'visible', timeout: 15_000 });
        await h.resaltar(aviso, n);
      },
    },
    {
      voz: 'El pago aparece en la lista. Puedes filtrar por fechas o por método, y volver a imprimir el recibo cuando lo necesites.',
      paso: {
        titulo: 'Lista de pagos',
        texto: 'Filtre por **rango de fechas** y **método**. Desde cada fila puede volver a imprimir el recibo.',
        detalle: ['Un pago mal registrado no se borra: el administrador o gerente lo **anula** con un motivo.'],
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.confirmar('Ahora no', 'No');
        await h.cerrarAvisos();
        await h.pausa(700);
        await h.resaltar([h.page.locator('.toolbar-filters:visible').first(), h.page.locator('tr:visible', { hasText: h.datos.pedido.number }).first()], n);
      },
    },
    {
      voz: 'Listo. El saldo del pedido se actualiza al instante.',
    },
  ],
  consejos: [
    'Anote siempre el **número de operación** de Yape, Plin o transferencia: facilita cuadrar la caja.',
    'Si alguien distinto al cliente trae el dinero, escriba su nombre en **Entregado por**.',
    'Si el monto supera el saldo, el sistema pide confirmación antes de registrarlo.',
    'El reporte **Cobranza / caja** resume los pagos por día y método.',
  ],
  siguiente: 'Cuando el trabajo esté terminado, regístrelo en **Entregas**.',
};
