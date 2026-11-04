// Guion de "Clientes". Cada escena: `voz` (narración), `accion` (lo que se hace en pantalla) y,
// si debe aparecer en el manual, `paso` (título y texto; la captura se toma al terminar la acción).
// Los datos son ficticios; tools/ayuda/limpieza.sql los borra.
export const CLIENTE_DEMO = {
  nombres: 'María Fernanda',
  apellidos: 'Quispe Rojas',
  // DNI distinto en cada grabación: el documento no puede repetirse y los clientes no se borran desde la app
  dni: '4' + String(Date.now()).slice(-7),
  telefono: '987654321',
  correo: 'maria.quispe@ejemplo.pe',
  ciudad: 'Miraflores',
};

export default {
  clave: 'customers',
  titulo: 'Clientes',
  ruta: '/customers',
  // Retira los clientes demo de grabaciones anteriores: la búsqueda del video debe salir vacía
  preparar: async (db) => {
    await db.from('customers').update({ active: false }).like('email', '%@ejemplo.pe').eq('active', true);
  },
  paraQue:
    'Registrar a las personas y empresas que encargan trabajos, y consultar en un solo lugar sus cotizaciones, pedidos, pagos y **saldo pendiente**.',
  cuando: [
    'Cuando llega un cliente nuevo, **antes** de preparar su cotización o pedido.',
    'Para buscar el teléfono o el documento de un cliente.',
    'Para revisar cuánto debe un cliente o qué pedidos tiene en curso.',
  ],
  escenas: [
    {
      voz: 'En este video aprenderás a registrar un cliente y a consultar su información. Entra a la opción Clientes del menú.',
      paso: {
        titulo: 'Entrar a Clientes',
        texto: 'En el menú de la izquierda pulse **Clientes**. Verá la lista de todos los clientes registrados.',
      },
      accion: async (h, n) => h.resaltar('a[href="/customers"]', n),
    },
    {
      voz: 'Usa el buscador para encontrar a un cliente por su nombre, documento, teléfono o correo. Así evitas registrarlo dos veces.',
      paso: {
        titulo: 'Buscar antes de registrar',
        texto: 'Escriba en el buscador el nombre, documento, teléfono o correo. Si el cliente ya existe, ábralo; no lo registre de nuevo.',
      },
      accion: async (h, n) => {
        await h.escribir('input[type="search"]', 'Quispe');
        await h.page.waitForLoadState('networkidle').catch(() => {});
        await h.resaltar('input[type="search"]', n);
      },
    },
    {
      voz: 'Si no existe, pulsa el botón Nuevo cliente.',
      paso: { titulo: 'Pulsar «Nuevo cliente»', texto: 'El botón está arriba a la derecha.' },
      accion: async (h, n) => {
        await h.page.locator('input[type="search"]').fill('');
        await h.apuntar(h.page.getByRole('button', { name: 'Nuevo cliente' }));
        await h.resaltar(h.page.getByRole('button', { name: 'Nuevo cliente' }), n);
      },
    },
    {
      voz: 'Elige si es una persona natural o una empresa. Luego escribe sus nombres y apellidos. Los campos con asterisco son obligatorios.',
      paso: {
        titulo: 'Datos principales',
        texto: 'Elija **Persona natural** o **Empresa** y complete el nombre.',
        detalle: [
          'Persona natural: **Nombres** (obligatorio) y Apellidos.',
          'Empresa: **Razón social** (obligatoria).',
        ],
      },
      accion: async (h, n) => {
        await h.quitarResaltado();
        await h.clic(h.page.getByRole('button', { name: 'Nuevo cliente' }));
        await h.page.waitForURL('**/customers/new');
        await h.escribir('#first_name', CLIENTE_DEMO.nombres);
        await h.escribir('#last_name', CLIENTE_DEMO.apellidos);
        await h.resaltar(['p-selectbutton', '#first_name', '#last_name'], n);
      },
    },
    {
      voz: 'Selecciona el tipo de documento y escribe el número. El sistema valida que el DNI tenga ocho dígitos y el RUC, once.',
      paso: {
        titulo: 'Documento de identidad',
        texto: 'Elija el tipo (DNI, RUC, carné de extranjería, pasaporte u otro) y escriba el número.',
        detalle: ['DNI: 8 dígitos. RUC: 11 dígitos.'],
      },
      accion: async (h, n) => {
        await h.elegir('#document_type', 'DNI');
        await h.escribir('#document_number', CLIENTE_DEMO.dni);
        await h.resaltar(['#document_type', '#document_number'], n);
      },
    },
    {
      voz: 'Agrega el teléfono. Al salir del campo, el número se copia solo en WhatsApp. Completa también el correo y la ciudad.',
      paso: {
        titulo: 'Datos de contacto',
        texto: 'Escriba el **teléfono**: al pasar al siguiente campo se copia en **WhatsApp**. Agregue el correo y la ciudad o distrito.',
      },
      accion: async (h, n) => {
        await h.escribir('#phone', CLIENTE_DEMO.telefono);
        await h.clic('#email');
        await h.escribir('#email', CLIENTE_DEMO.correo);
        await h.escribir('#city', CLIENTE_DEMO.ciudad);
        await h.resaltar(['#phone', '#whatsapp', '#email', '#city'], n);
      },
    },
    {
      voz: 'Si activas esta opción, el cliente recibirá por correo el resumen de sus pagos y su saldo. Para eso necesita tener un correo registrado.',
      paso: {
        titulo: 'Estado de cuenta por correo (opcional)',
        texto: 'Active **Enviar estado de cuenta por correo** para que el cliente reciba el resumen de sus pagos y saldo al cierre de cada día con movimientos.',
      },
      accion: async (h, n) => {
        await h.resaltar(h.page.locator('.field').filter({ has: h.page.locator('#statement_email') }), n);
      },
    },
    {
      voz: 'Por último, pulsa Crear cliente. El sistema te lleva a la ficha del cliente.',
      paso: { titulo: 'Guardar', texto: 'Pulse **Crear cliente**. Si falta algún dato obligatorio, el campo se marca en rojo.' },
      accion: async (h, n) => {
        const boton = h.page.getByRole('button', { name: 'Crear cliente' });
        await h.resaltar(boton, n);
        await h.pausa(600);
        await h.quitarResaltado();
        await h.clic(boton);
        await h.page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
        await h.pausa(800);
      },
    },
    {
      voz: 'En la ficha ves cuántos pedidos tiene el cliente, cuánto ha comprado y su saldo pendiente.',
      paso: {
        titulo: 'Ficha del cliente',
        texto: 'Arriba se muestran los **pedidos**, el **total comprado** y el **saldo pendiente**. En las pestañas están sus cotizaciones, pedidos, pagos y el historial.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'Desde aquí puedes escribirle por WhatsApp, crear una cotización o un pedido, o editar sus datos.',
      paso: {
        titulo: 'Acciones rápidas',
        texto: 'Use **WhatsApp** para escribirle, **Nueva cotización** o **Nuevo pedido** para empezar un trabajo ya con el cliente elegido, y **Editar** para corregir sus datos.',
      },
      accion: async (h, n) =>
        h.resaltar(
          [
            h.page.getByRole('button', { name: 'WhatsApp' }),
            h.page.getByRole('button', { name: 'Nueva cotización' }),
            h.page.getByRole('button', { name: 'Nuevo pedido' }),
            h.page.getByRole('button', { name: 'Editar' }),
          ],
          n,
        ),
    },
    {
      voz: 'Listo. El siguiente paso es preparar su cotización. Si tienes dudas, pulsa el botón de ayuda en la parte superior.',
      accion: async (h) => h.resaltar('.topbar__help'),
    },
  ],
  consejos: [
    'Busque siempre antes de registrar: así no se duplican clientes ni se reparte su historial.',
    'Si el cliente ya no compra, edítelo y desactive **Cliente activo** en lugar de borrarlo; su historial se conserva. Para verlo de nuevo marque **Mostrar inactivos** en la lista.',
    'El estado de cuenta por correo solo se envía si el cliente tiene correo registrado.',
  ],
  siguiente: 'Con el cliente registrado, prepare su presupuesto en **Cotizaciones** o, si ya lo aprobó, registre directamente el **Pedido**.',
};
