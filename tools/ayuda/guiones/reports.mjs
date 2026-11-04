// Solo consulta.
const reporte = (h, titulo) => h.page.locator('.report-nav__item', { hasText: titulo }).first();

export default {
  clave: 'reports',
  titulo: 'Reportes',
  ruta: '/reports',
  paraQue:
    'Obtener la información consolidada del negocio (ventas, cuentas por cobrar, caja, plazos, stock y material de clientes) y **exportarla a Excel o PDF**.',
  cuando: [
    'Al cierre del día o del mes, para cuadrar la caja.',
    'Para revisar qué clientes deben y desde cuándo.',
    'Para entregar información al contador.',
  ],
  escenas: [
    {
      voz: 'En Reportes eliges el informe en la columna de la izquierda: ventas, cuentas por cobrar, cobranza, atrasados, stock valorizado o material de clientes.',
      paso: {
        titulo: 'Elegir el reporte',
        texto: 'Elija el informe en la lista: **Ventas por periodo**, **Cuentas por cobrar**, **Cobranza / caja**, **Atrasados y por entregar**, **Stock valorizado** o **Material de clientes**.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('.report-nav'), n),
    },
    {
      voz: 'Cada reporte tiene sus filtros: el periodo, el tipo de servicio o el responsable.',
      paso: { titulo: 'Filtros', texto: 'Ajuste los **filtros**: periodo, tipo de servicio, responsable, método de pago, etc.' },
      accion: async (h, n) => {
        await h.clic(reporte(h, 'Ventas por periodo'));
        await h.pausa(800);
        await h.resaltar(h.page.locator('.report-body .filters'), n);
      },
    },
    {
      voz: 'El resultado aparece debajo, con sus totales.',
      paso: { titulo: 'Resultado', texto: 'La tabla muestra los registros y los **totales** del reporte.' },
      accion: async (h, n) => h.resaltar(h.page.locator('.report-body .card').last(), n),
    },
    {
      voz: 'Por ejemplo, Cuentas por cobrar muestra los saldos pendientes según su antigüedad.',
      paso: { titulo: 'Cuentas por cobrar', texto: '**Cuentas por cobrar** agrupa los saldos pendientes por **antigüedad** de la deuda.' },
      accion: async (h, n) => {
        await h.clic(reporte(h, 'Cuentas por cobrar'));
        await h.pausa(900);
        await h.resaltar(h.page.locator('.report-body'), n);
      },
    },
    {
      voz: 'Y Cobranza muestra los pagos recibidos por día y por método, para cuadrar la caja.',
      paso: { titulo: 'Cobranza / caja', texto: '**Cobranza / caja** lista los pagos recibidos por día y **método**: úselo para cuadrar la caja.' },
      accion: async (h, n) => {
        await h.clic(reporte(h, 'Cobranza / caja'));
        await h.pausa(900);
        await h.resaltar(h.page.locator('.report-body'), n);
      },
    },
    {
      voz: 'Con los botones Excel y PDF descargas el reporte tal como lo estás viendo.',
      paso: { titulo: 'Exportar', texto: 'Pulse **Excel** o **PDF** para descargar el reporte con los filtros aplicados.' },
      accion: async (h, n) => h.resaltar([h.boton('Excel'), h.boton('PDF')], n),
    },
  ],
  consejos: [
    'Exporte a **Excel** si necesita trabajar los datos; a **PDF** para imprimir o enviar.',
    'Revise **Cuentas por cobrar** cada semana para llamar a los clientes con saldo.',
  ],
  siguiente: 'Configure los datos de su empresa, usuarios y catálogos en **Configuración**.',
};
