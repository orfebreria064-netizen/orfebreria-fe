// Datos ficticios que usan los guiones. Todos se identifican para la limpieza (limpieza.sql):
// correos @ejemplo.pe, nombres de este archivo y registros creados por el usuario de demostración.
const hoy = new Date();
const dd = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
const enDias = (n) => dd(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n));

export const DEMO = {
  material: { nombre: 'Oro 18K', ley: '18K', precioDia: 285, costo: 240, stock: 50, minimo: 10 },
  joyero: { nombre: 'Carlos Mendoza Huamán', telefono: '965432187', especialidad: 'Engaste y fundición' },
  cotizacion: {
    titulo: 'Anillo de compromiso en oro 18K',
    material: 'Oro 18K',
    peso: 4.5,
    piedra: 'Diamante 0.30 ct',
    talla: '14',
    item1: { descripcion: 'Anillo solitario', detalle: 'Oro amarillo 18K, 4 garras', precio: 1850 },
    item2: { descripcion: 'Engaste de diamante', precio: 150 },
  },
  pago: { adelanto: 1000, referencia: 'OP 784512' },
  reparacion: { pieza: 'Cadena de oro 18K', trabajo: 'Soldar eslabón roto y pulir', precio: 120, peso: 8.2 },
  joya: { nombre: 'Aretes de oro 18K con perla', peso: 3.2, costo: 450, precio: 890 },
  piedra: { quilates: 0.5, costo: 900, precio: 1400 },
  gasto: { descripcion: 'Recibo de luz de noviembre', monto: 180 },
  prestamo: { monto: 300, cuotas: 3 },
  /** Documento único por grabación (los DNI no pueden repetirse y no se borran desde la app). */
  dni: () => '4' + String(Date.now()).slice(-7),
  hoy: dd(hoy),
  enDias,
};
