// Solo consulta.
export default {
  clave: 'dashboard',
  titulo: 'Dashboard',
  ruta: '/dashboard',
  paraQue:
    'Ver de un vistazo **cómo va el negocio**: pedidos activos, producción, entregas, ventas y cobranza del mes, y las **alertas** que requieren atención hoy.',
  cuando: [
    'Al empezar el día, para saber qué atender primero.',
    'Para revisar las ventas y lo cobrado en el mes.',
  ],
  escenas: [
    {
      voz: 'El Dashboard es la pantalla de inicio. Arriba están los indicadores: pedidos activos, en producción, por entregar, atrasados, cotizaciones pendientes, ventas del mes y total por cobrar.',
      paso: {
        titulo: 'Indicadores',
        texto: 'Los indicadores muestran **pedidos activos**, **en producción**, **por entregar**, **atrasados**, **cotizaciones pendientes**, **ventas del mes** y **total por cobrar**. Pulse uno para ir a su lista.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('app-stat-card').first().locator('xpath=..'), n),
    },
    {
      voz: 'El gráfico compara las ventas y lo cobrado mes a mes.',
      paso: { titulo: 'Ventas y cobranza', texto: 'El gráfico **Ventas y cobranza por mes** compara lo vendido con lo cobrado.' },
      accion: async (h, n) => h.resaltar(h.page.locator('app-chart-card').first(), n),
    },
    {
      voz: 'En Alertas ves lo urgente: pedidos atrasados, entregas de los próximos días, pagos pendientes y cotizaciones por responder.',
      paso: {
        titulo: 'Alertas',
        texto: 'Las **alertas** listan pedidos atrasados, entregas de los próximos 7 días, pagos pendientes y cotizaciones por responder.',
      },
      accion: async (h, n) => h.resaltar(h.page.getByRole('heading', { name: /Alertas/ }).locator('xpath=ancestor::*[contains(@class,"card")][1]'), n),
    },
    {
      voz: 'Más abajo tienes los pedidos por estado, por tipo de servicio, la producción por etapa y las próximas entregas.',
      paso: {
        titulo: 'Más gráficos y próximas entregas',
        texto: 'Más abajo: pedidos **por estado**, **por tipo de servicio**, **producción por etapa** y **próximas entregas**.',
      },
      accion: async (h, n) => {
        const ultimo = h.page.getByRole('heading', { name: 'Próximas entregas' }).locator('xpath=ancestor::*[contains(@class,"card")][1]');
        await ultimo.scrollIntoViewIfNeeded();
        await h.pausa(500);
        await h.resaltar(ultimo, n);
      },
    },
    {
      voz: 'Con Actualizar recargas los datos, y con Nuevo pedido empiezas un encargo desde aquí.',
      accion: async (h) => {
        await h.page.mouse.wheel(0, -3000);
        await h.pausa(500);
        await h.resaltar([h.boton('Actualizar'), h.boton('Nuevo pedido')]);
      },
    },
  ],
  consejos: [
    'Revise las **alertas** cada mañana: los pedidos atrasados aparecen primero.',
    'Pulse cualquier indicador para ir directamente a su lista.',
  ],
  siguiente: 'Para análisis detallados y exportar a Excel o PDF, use **Reportes**.',
};
