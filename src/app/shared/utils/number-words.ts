const UNITS = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const TEENS = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const TWENTIES = ['VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const TENS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const HUNDREDS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function belowHundred(n: number): string {
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return TWENTIES[n - 20];
  const unit = n % 10;
  return TENS[Math.floor(n / 10)] + (unit ? ` Y ${UNITS[unit]}` : '');
}

function belowThousand(n: number): string {
  if (n === 100) return 'CIEN';
  const rest = n % 100;
  const hundreds = HUNDREDS[Math.floor(n / 100)];
  return [hundreds, rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Entero en letras (español, mayúsculas): 1500 → "MIL QUINIENTOS". */
export function integerToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return 'CERO';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? 'UN MILLÓN' : `${integerToWords(millions).replace(/UNO$/, 'UN')} MILLONES`);
  if (thousands) parts.push(thousands === 1 ? 'MIL' : `${belowThousand(thousands).replace(/UNO$/, 'UN')} MIL`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/**
 * Monto en letras como en los comprobantes: 1500.5, 'PEN' → "MIL QUINIENTOS CON 50/100 SOLES".
 * La moneda va al final y en plural (UNO CON 00/100 SOLES).
 */
export function amountToWords(value: number | string, currency: string | null | undefined = 'PEN'): string {
  const amount = Math.round(Math.abs(Number(value ?? 0)) * 100) / 100;
  const integer = Math.floor(amount);
  const cents = Math.round((amount - integer) * 100);
  const name = currency === 'USD' ? 'DÓLARES AMERICANOS' : 'SOLES';
  return `${integerToWords(integer)} CON ${String(cents).padStart(2, '0')}/100 ${name}`;
}
