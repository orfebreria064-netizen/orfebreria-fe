// Solo consulta: no modifica el tipo de cambio real de la empresa.
export default {
  clave: 'tipo-cambio',
  titulo: 'Tipo de cambio',
  ruta: '/tipo-cambio',
  paraQue:
    'Consultar el **tipo de cambio del dólar** de cada día (compra y venta), que el sistema registra **automáticamente**, y corregirlo si la empresa trabaja con otro valor.',
  cuando: [
    'Antes de cotizar o cobrar en dólares.',
    'Si el tipo de cambio automático no coincide con el que usa la empresa ese día.',
  ],
  escenas: [
    {
      voz: 'En Tipo de cambio ves un calendario con el dólar de cada día: el precio de compra y el de venta. El sistema lo registra solo cada mañana.',
      paso: {
        titulo: 'Calendario del mes',
        texto: 'Cada día muestra la **compra (C)** y la **venta (V)** del dólar. El sistema lo registra **automáticamente** cada día.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('.cal'), n),
    },
    {
      voz: 'Los colores te indican si el valor es automático, si lo corrigió la empresa, o si ese día no hubo registro y rige el anterior.',
      paso: {
        titulo: 'Leyenda',
        texto: 'La leyenda indica si el valor es **automático**, **corregido por la empresa** o si **no hubo registro** y rige el del día anterior.',
      },
      accion: async (h, n) => h.resaltar(h.page.locator('.legend'), n),
    },
    {
      voz: 'Con las flechas cambias de mes, y con Hoy vuelves al mes actual.',
      paso: { titulo: 'Cambiar de mes', texto: 'Use las **flechas** para ver otros meses y **Hoy** para volver al actual.' },
      accion: async (h, n) => h.resaltar(h.page.locator('.cal-head h2'), n),
    },
    {
      voz: 'Si la empresa usa otro valor, pulsa el día y escribe la compra y la venta. Con Volver al automático deshaces la corrección.',
      paso: {
        titulo: 'Corregir un día',
        texto: 'Pulse un día para ver el valor automático y el oficial de SUNAT. Escriba la **compra** y la **venta** y pulse **Guardar**. **Volver al automático** deshace la corrección.',
        detalle: ['Solo el administrador y el gerente pueden corregirlo.'],
      },
      accion: async (h, n) => {
        await h.clic(h.page.locator('.cal__day--today'));
        await h.pausa(500);
        await h.resaltar(['#tc-buy', '#tc-sell'], n);
      },
    },
    {
      voz: 'En este caso solo estamos mirando, así que cancelamos. Si el valor de hoy no aparece, pulsa Actualizar ahora.',
      accion: async (h) => {
        await h.quitarResaltado();
        await h.clic(h.enDialogo('Cancelar'));
        await h.resaltar(h.boton('Actualizar ahora'));
      },
    },
  ],
  consejos: [
    'Revise el tipo de cambio antes de cotizar en dólares.',
    'Corrija solo los días en que la empresa usó un valor distinto; el resto queda automático.',
  ],
  siguiente: 'Revise el resumen del negocio en el **Dashboard**.',
};
