import { DEMO } from '../lib/demo.mjs';
import { pedidoDemo } from '../lib/db.mjs';

export default {
  clave: 'orders',
  titulo: 'Pedidos',
  ruta: '/orders',
  preparar: async (db) => ({ pedido: await pedidoDemo(db) }),
  paraQue:
    'Registrar el **encargo del cliente** y seguirlo de principio a fin: producción, joyero del taller, material usado, archivos, **pagos** y **entrega**, todo en una sola ficha.',
  cuando: [
    'Cuando el cliente aprueba una cotización (se crea con **Convertir en pedido**).',
    'Cuando el cliente encarga directamente, sin cotización previa (**Nuevo pedido**).',
    'Cada vez que avanza el trabajo, se entrega material al joyero o el cliente paga.',
  ],
  escenas: [
    {
      voz: 'En Pedidos ves todos los encargos con su estado, fecha de entrega, total y saldo. Puedes crear uno con Nuevo pedido o convertir una cotización aprobada.',
      paso: {
        titulo: 'Lista de pedidos',
        texto: 'La lista muestra el **estado**, la **fecha de entrega**, el **total** y el **saldo** de cada pedido. Los atrasados se marcan en rojo.',
        detalle: [
          '**Nuevo pedido**: para encargos sin cotización previa.',
          'Para trabajos cotizados use **Convertir en pedido** desde la cotización aprobada.',
        ],
      },
      accion: async (h, n) =>
        h.resaltar([h.page.getByRole('button', { name: 'Nuevo pedido' }), h.page.locator('tr:visible', { hasText: h.datos.pedido.number }).first()], n),
    },
    {
      voz: 'Abre un pedido para ver su ficha. Arriba están el estado, la entrega, el saldo y las acciones principales.',
      paso: {
        titulo: 'Ficha del pedido',
        texto: 'Pulse un pedido para abrirlo. Arriba verá su **estado**, la **fecha de entrega**, el **saldo** y los botones de acción: editar, cambiar estado, registrar pago, proforma, registrar material y subir archivo.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.locator('tr:visible', { hasText: h.datos.pedido.number }).first());
        await h.page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
        await h.pausa(900);
        await h.resaltar(h.page.locator('app-page-header').first(), n);
      },
    },
    {
      voz: 'En el resumen, el recuadro Próxima acción te indica qué toca hacer ahora con este pedido.',
      paso: {
        titulo: 'Próxima acción',
        texto: 'En **Resumen**, el recuadro **Próxima acción** indica el siguiente paso (iniciar una etapa, cobrar, entregar…) con un botón para ir directo.',
      },
      accion: async (h, n) => h.resaltar(h.page.getByText('Próxima acción', { exact: false }).first().locator('xpath=ancestor::div[contains(@class,"card") or contains(@class,"next")][1]'), n),
    },
    {
      voz: 'En la pestaña Taller asignas el joyero, registras el peso de material que le entregas y le dejas las indicaciones del trabajo.',
      paso: {
        titulo: 'Taller: joyero y material entregado',
        texto: 'En **Taller** elija el **joyero**, la fecha y el **peso entregado**, y escriba las **indicaciones** (modelo, medidas, acabado). Pulse **Guardar datos del taller**.',
        detalle: ['Con **Imprimir orden de producción** le entrega la orden en papel al joyero.'],
      },
      accion: async (h, n) => {
        await h.clic(h.pestana('Taller'));
        await h.elegir('#ws-jeweler', DEMO.joyero.nombre);
        await h.fecha('#ws-material-date', DEMO.hoy);
        await h.numero('#ws-weight-out', 5);
        await h.escribir('#ws-instructions', 'Solitario 4 garras, talla 14, acabado brillante.');
        await h.resaltar(['#ws-jeweler', '#ws-weight-out', '#ws-instructions'], n);
      },
    },
    {
      voz: 'Guarda los datos del taller. Cuando le pagues al joyero, usa Registrar pago en Pagos al joyero: indica el monto, el método y el detalle.',
      paso: {
        titulo: 'Pago al joyero',
        texto: 'En **Pagos al joyero** pulse **Registrar pago**: monto, fecha, método y detalle. Se emite un **recibo de egreso**.',
      },
      accion: async (h, n) => {
        await h.clic(h.boton('Guardar datos del taller'));
        await h.cerrarAvisos();
        await h.clic(h.page.locator('p-tabpanel:visible').getByRole('button', { name: 'Registrar pago' }));
        await h.numero('#jp-amount', 200);
        // El detalle viene sugerido («Mano de obra: …»): se deja tal cual
        await h.resaltar(['#jp-amount', '#jp-method', '#jp-concept'], n);
      },
    },
    {
      voz: 'Al registrar el pago, el sistema te ofrece imprimir el recibo para que lo firme el joyero.',
      paso: { titulo: 'Recibo de egreso', texto: 'Pulse **Registrar pago**. El sistema ofrece **imprimir el recibo** para la firma del joyero.' },
      accion: async (h, n) => {
        await h.clic(h.enDialogo('Registrar pago'));
        const aviso = h.page.getByRole('alertdialog').or(h.page.getByRole('dialog')).filter({ hasText: /imprimir/i }).last();
        await aviso.waitFor({ state: 'visible', timeout: 15_000 });
        await h.resaltar(aviso, n);
      },
    },
    {
      voz: 'Con Registrar material anotas el oro que se consume en este pedido. Se descuenta del stock de la empresa.',
      paso: {
        titulo: 'Material del pedido',
        texto: 'Pulse **Registrar material** para anotar el **consumo** de material del pedido; se descuenta del stock. Si el cliente trae su propio material, elija **Cliente**.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.confirmar('Ahora no', 'No');
        await h.cerrarAvisos();
        await h.clic(h.boton('Registrar material'));
        await h.elegir('#mv-material', new RegExp(DEMO.material.nombre));
        await h.numero('#mv-qty', 4.5);
        await h.resaltar(['p-selectbutton', '#mv-type', '#mv-material', '#mv-qty'], n);
      },
    },
    {
      voz: 'En la pestaña Materiales queda el detalle de todo lo consumido. Y en Archivos puedes subir fotos, diseños o el boceto aprobado.',
      paso: {
        titulo: 'Materiales y archivos',
        texto: 'La pestaña **Materiales** muestra lo consumido. En **Archivos** (o con **Subir archivo**) guarde fotos, diseños y bocetos.',
      },
      accion: async (h, n) => {
        await h.clic(h.enDialogo('Registrar'));
        await h.cerrarAvisos();
        await h.clic(h.pestana('Materiales'));
        await h.pausa(700);
        await h.resaltar([h.page.locator('p-tabpanel:visible').first(), h.boton('Subir archivo')], n);
      },
    },
    {
      voz: 'El Historial registra cada cambio del pedido: quién lo hizo y cuándo.',
      paso: { titulo: 'Historial', texto: 'La pestaña **Historial** registra cada cambio con fecha y usuario.' },
      accion: async (h, n) => {
        await h.clic(h.pestana('Historial'));
        await h.pausa(700);
        await h.resaltar(h.page.locator('p-tabpanel:visible').first(), n);
      },
    },
    {
      voz: 'El estado avanza solo con la producción, pero puedes cambiarlo a mano con Cambiar estado, por ejemplo para pausar o cancelar un pedido.',
      paso: {
        titulo: 'Cambiar estado',
        texto: 'El estado avanza solo con la producción. Con **Cambiar estado** puede pausarlo, cancelarlo o moverlo a mano.',
      },
      accion: async (h, n) => {
        await h.clic(h.boton('Cambiar estado'));
        await h.clic('#next-status');
        await h.pausa(500);
        await h.resaltar(h.page.locator('[role="listbox"]:visible').first(), n);
      },
    },
    {
      voz: 'Listo. Sigue el avance del trabajo en Producción y registra los cobros en Pagos.',
      accion: async (h) => {
        await h.quitarResaltado();
        await h.page.keyboard.press('Escape');
        await h.clic(h.enDialogo('Cancelar'));
        await h.resaltar(h.boton('Proforma'));
      },
    },
  ],
  consejos: [
    'Mantenga la **fecha de entrega** al día: el Dashboard avisa de los pedidos atrasados.',
    'Registre todo el material del pedido: así la utilidad y el stock son reales.',
    'La **Proforma** sirve para entregar al cliente el detalle y el saldo del pedido.',
    'Un pedido solo se puede **cerrar** con la producción completa, el control de calidad aprobado y la entrega registrada.',
  ],
  siguiente: 'Siga el trabajo del taller en **Producción** y registre los cobros en **Pagos**.',
};
