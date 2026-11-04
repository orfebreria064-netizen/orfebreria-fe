import { DEMO } from '../lib/demo.mjs';
import { clienteDemo } from '../lib/db.mjs';

const Q = DEMO.cotizacion;
const fila = (h, i) => h.page.locator('.items__row').nth(i);
const campo = (h, i, nombre) => fila(h, i).locator(`[formcontrolname="${nombre}"] input, input[formcontrolname="${nombre}"]`).first();

export default {
  clave: 'quotations',
  titulo: 'Cotizaciones',
  ruta: '/quotations',
  preparar: async (db) => ({ cliente: await clienteDemo(db) }),
  paraQue:
    'Preparar el **presupuesto** de una joya para el cliente, con sus materiales, precios e IGV; imprimirlo en PDF y, cuando el cliente lo aprueba, **convertirlo en pedido** sin volver a escribir nada.',
  cuando: [
    'Cuando un cliente pide precio por una joya a medida, una modificación o una reparación.',
    'Para enviar al cliente un PDF con el detalle y la vigencia del precio.',
    'Cuando el cliente acepta: se aprueba y se convierte en pedido.',
  ],
  escenas: [
    {
      voz: 'En Cotizaciones preparas el presupuesto de una joya. Pulsa Nueva cotización.',
      paso: { titulo: 'Nueva cotización', texto: 'En el menú pulse **Cotizaciones** y luego **Nueva cotización**.' },
      accion: async (h, n) => h.resaltar(h.page.getByRole('button', { name: 'Nueva cotización' }), n),
    },
    {
      voz: 'Busca al cliente por su nombre o documento y elígelo de la lista. Si es nuevo, puedes crearlo aquí mismo con el botón de la derecha.',
      paso: {
        titulo: 'Elegir el cliente',
        texto: 'Escriba el nombre o documento del cliente y elíjalo. Si no existe, créelo con el botón **+** de la derecha sin salir de la cotización.',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('button', { name: 'Nueva cotización' }));
        await h.page.waitForURL('**/quotations/new');
        await h.autocompletar('#customer', 'Quispe', h.datos.cliente.full_name);
        await h.resaltar(h.page.locator('app-customer-picker'), n);
      },
    },
    {
      voz: 'Elige el tipo de servicio y describe el trabajo principal. La fecha y el vencimiento se llenan solos según la vigencia configurada.',
      paso: {
        titulo: 'Servicio, trabajo y fechas',
        texto: 'Elija el **tipo de servicio** y escriba el **trabajo o producto principal**. La **fecha** y el **vencimiento** se completan según la vigencia de Configuración.',
      },
      accion: async (h, n) => {
        await h.elegir('#service_type', 'Fabricación personalizada');
        await h.escribir('#title', Q.titulo);
        await h.resaltar(['#service_type', '#title', '#issue_date', '#expiry_date'], n);
      },
    },
    {
      voz: 'Completa las especificaciones: material, peso estimado, piedra y talla.',
      paso: { titulo: 'Especificaciones', texto: 'Complete **material principal**, **peso estimado**, **piedra** y **talla**. Salen impresas en el PDF.' },
      accion: async (h, n) => {
        await h.escribir('#main_material', Q.material);
        await h.numero('#estimated_weight', Q.peso);
        await h.escribir('#stone', Q.piedra);
        await h.escribir('#size', Q.talla);
        await h.resaltar(['#main_material', '#estimated_weight', '#stone', '#size'], n);
      },
    },
    {
      voz: 'En el detalle escribe cada producto o servicio. Si eliges el material, el sistema te muestra su precio del día.',
      paso: {
        titulo: 'Detalle: primer ítem',
        texto: 'Escriba el **producto o servicio**, elija el **material** (se muestra su **precio del día**), la cantidad, el peso y el **precio unitario**.',
      },
      accion: async (h, n) => {
        await h.page.locator('.items__row').first().scrollIntoViewIfNeeded();
        await h.escribir(campo(h, 0, 'description'), Q.item1.descripcion);
        await h.escribir(campo(h, 0, 'detail'), Q.item1.detalle);
        await h.elegir(fila(h, 0).locator('[formcontrolname="material_id"]'), new RegExp(Q.material));
        await h.elegir(fila(h, 0).locator('[formcontrolname="unit"]'), 'Unidad');
        await h.numero(campo(h, 0, 'weight'), Q.peso);
        await h.numero(campo(h, 0, 'unit_price'), Q.item1.precio);
        await h.resaltar(fila(h, 0), n);
      },
    },
    {
      voz: 'Con Agregar ítem sumas más líneas, por ejemplo el engaste. Abajo ves el subtotal, el IGV y el total.',
      paso: {
        titulo: 'Más ítems y totales',
        texto: 'Pulse **Agregar ítem** para más líneas. Los **totales** con descuento e **IGV** se calculan solos.',
      },
      accion: async (h, n) => {
        await h.clic(h.page.getByRole('button', { name: 'Agregar ítem' }));
        await h.escribir(campo(h, 1, 'description'), Q.item2.descripcion);
        await h.elegir(fila(h, 1).locator('[formcontrolname="unit"]'), 'Servicio');
        await h.numero(campo(h, 1, 'unit_price'), Q.item2.precio);
        await h.resaltar([fila(h, 1), h.page.locator('.totals')], n);
      },
    },
    {
      voz: 'Agrega observaciones o condiciones si hace falta, y pulsa Guardar cotización. El número se asigna solo.',
      paso: {
        titulo: 'Guardar',
        texto: 'Escriba observaciones o condiciones (opcional) y pulse **Guardar cotización**. El número correlativo se asigna automáticamente.',
      },
      accion: async (h, n) => {
        await h.escribir('#notes', 'Incluye estuche de regalo.');
        await h.resaltar(h.page.getByRole('button', { name: 'Guardar cotización' }), n);
      },
    },
    {
      voz: 'Desde la cotización puedes descargar el PDF para enviarlo al cliente. Cuando el cliente acepta, pulsa Aprobar.',
      paso: {
        titulo: 'PDF y aprobar',
        texto: 'Use **PDF** para descargarla y enviarla al cliente. Cuando el cliente acepte, pulse **Aprobar** y confirme.',
        detalle: ['En **⋮** (más acciones) puede marcarla como enviada, duplicarla, imprimirla, rechazarla o cancelarla.'],
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('button', { name: 'Guardar cotización' }));
        await h.page.waitForURL(/\/quotations\/[0-9a-f-]{36}$/);
        await h.cerrarAvisos();
        await h.pausa(600);
        await h.resaltar([h.boton('PDF'), h.boton('Aprobar')], n);
      },
    },
    {
      voz: 'Con la cotización aprobada, pulsa Convertir en pedido. Elige la fecha de entrega y la prioridad. El pedido hereda el cliente, los ítems y los precios.',
      paso: {
        titulo: 'Convertir en pedido',
        texto: 'Pulse **Convertir en pedido**, indique la **fecha de entrega** y la **prioridad**, y deje marcado **Generar etapas de producción**.',
        detalle: ['El pedido hereda cliente, ítems, precios y observaciones de la cotización.'],
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.boton('Aprobar'));
        await h.confirmar('Aprobar', 'Sí');
        await h.cerrarAvisos();
        // Al aprobar, la app abre sola el diálogo de conversión
        const dialogo = h.page.getByRole('dialog').filter({ hasText: 'Convertir en pedido' });
        await dialogo.waitFor({ state: 'visible', timeout: 4000 }).catch(() => h.clic(h.boton('Convertir en pedido')));
        await h.fecha('#due_date', DEMO.enDias(15));
        await h.elegir('#priority', 'Alta');
        await h.resaltar(['#due_date', '#priority', '#create_stages'], n);
      },
    },
    {
      voz: 'Pulsa Crear pedido. El sistema te lleva directamente al pedido nuevo.',
      paso: { titulo: 'Pedido creado', texto: 'Pulse **Crear pedido**. Se abre el pedido, listo para producción y cobros.' },
      accion: async (h, n) => {
        await h.clic(h.enDialogo('Crear pedido'));
        await h.page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
        await h.cerrarAvisos();
        await h.pausa(800);
        await h.resaltar(h.page.locator('app-page-header').first(), n);
      },
    },
    {
      voz: 'Listo. En el video de Pedidos verás cómo seguir el trabajo hasta la entrega.',
    },
  ],
  consejos: [
    'Revise el **precio del día** del material antes de cotizar (Materiales → Precios del día).',
    'Si el cliente pide cambios, use **Editar** mientras la cotización esté en borrador o enviada.',
    'Una cotización vencida puede **duplicarse** desde ⋮ para volver a enviarla con precios nuevos.',
    'La vigencia, el IGV y las condiciones por defecto se configuran en **Configuración → Empresa**.',
  ],
  siguiente: 'Siga el trabajo en **Pedidos**: producción, taller, pagos y entrega.',
};
