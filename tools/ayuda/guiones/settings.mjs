// Solo consulta: no guarda cambios en la configuración real de la empresa.
export default {
  clave: 'settings',
  titulo: 'Configuración',
  ruta: '/settings',
  paraQue:
    'Definir los **datos de la empresa** que salen en cotizaciones y recibos, **invitar a los usuarios** con su rol, y ajustar los catálogos: **etapas de producción** y **tipos de servicio**.',
  cuando: [
    'Al empezar a usar el sistema (es lo primero que se configura).',
    'Cuando ingresa o se retira un trabajador.',
    'Si cambia el IGV, la vigencia de las cotizaciones o el logo.',
  ],
  escenas: [
    {
      voz: 'Configuración es lo primero que se completa. En la pestaña Empresa registras el nombre comercial, el RUC, la dirección, el teléfono y el correo.',
      paso: {
        titulo: 'Datos de la empresa',
        texto: 'En **Empresa** complete el **nombre comercial**, **RUC**, dirección, teléfono y correo. Salen impresos en cotizaciones, proformas y recibos.',
      },
      accion: async (h, n) => h.resaltar(['#st-name', '#st-ruc', '#st-address', '#st-phone', '#st-email'], n),
    },
    {
      voz: 'También defines el IGV por defecto, cuántos días vale una cotización y las condiciones que se imprimen en cada una.',
      paso: {
        titulo: 'IGV, vigencia y condiciones',
        texto: 'Defina el **IGV por defecto**, la **vigencia de las cotizaciones** (días) y las **condiciones** que se imprimen en cada cotización.',
      },
      accion: async (h, n) => h.resaltar(['#st-tax', '#st-validity', '#st-terms'], n),
    },
    {
      voz: 'Más abajo subes el logo para los documentos impresos y configuras los correos automáticos. Al terminar, pulsa Guardar.',
      paso: {
        titulo: 'Logo, correos y guardar',
        texto: 'En **Documentos impresos** suba el **logo**; en **Correos automáticos** configure los envíos. Pulse **Guardar**.',
      },
      accion: async (h, n) => {
        const guardar = h.page.locator('p-tabpanel:visible').getByRole('button', { name: 'Guardar' }).last();
        await guardar.scrollIntoViewIfNeeded();
        await h.pausa(400);
        await h.resaltar([h.page.getByRole('heading', { name: 'Correos automáticos' }), guardar], n);
      },
    },
    {
      voz: 'En Usuarios invitas a cada trabajador con su correo y su rol: administrador, gerente, vendedor, supervisor u orfebre. Cada rol ve solo lo que le corresponde.',
      paso: {
        titulo: 'Usuarios e invitaciones',
        texto: 'En **Usuarios** pulse **Invitar usuario**, escriba el correo y elija el **rol**. El trabajador recibe un enlace para crear su contraseña.',
        detalle: [
          '**Administrador**: todo. **Gerente**: todo menos configuración.',
          '**Vendedor**: clientes, cotizaciones, pedidos y pagos. **Supervisor** y **Orfebre**: taller y producción.',
        ],
      },
      accion: async (h, n) => {
        await h.page.mouse.wheel(0, -3000);
        await h.clic(h.pestana('Usuarios'));
        await h.pausa(700);
        await h.clic(h.boton('Invitar usuario'));
        await h.pausa(500);
        await h.resaltar(h.page.getByRole('dialog').filter({ visible: true }).last(), n);
      },
    },
    {
      voz: 'En Etapas de producción defines los pasos que tendrá cada pedido, y en Tipos de servicio, los trabajos que ofrece tu taller.',
      paso: {
        titulo: 'Etapas y tipos de servicio',
        texto: 'En **Etapas de producción** defina la plantilla de pasos de cada pedido. En **Tipos de servicio**, los trabajos que ofrece (fabricación, reparación, venta…).',
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Cancelar'));
        await h.clic(h.pestana('Etapas de producción'));
        await h.pausa(700);
        await h.resaltar(h.page.locator('p-tabpanel:visible').first(), n);
      },
    },
    {
      voz: 'Listo. Con la empresa configurada, ya puedes registrar materiales, joyeros y clientes.',
      accion: async (h) => {
        await h.clic(h.pestana('Tipos de servicio'));
        await h.pausa(600);
        await h.resaltar(h.page.locator('p-tabpanel:visible').first());
      },
    },
  ],
  consejos: [
    'Solo el **administrador** entra a Configuración.',
    'Cuando un trabajador se retira, desactive su usuario: no se borra para conservar su historial.',
    'Cambiar la plantilla de etapas no modifica los pedidos ya creados.',
  ],
  siguiente: 'Registre sus **Materiales** y los **Joyeros** del taller.',
};
