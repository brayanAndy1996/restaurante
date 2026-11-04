/** Monto en letras del comprobante (historia 006, criterio 23; no crítico). */
import { ENTEROS_TOTAL, monto } from './comun';

const UNIDADES = [
  'CERO',
  'UNO',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
  'VEINTE',
  'VEINTIUNO',
  'VEINTIDÓS',
  'VEINTITRÉS',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISÉIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
] as const;
const DECENAS = [
  '',
  '',
  '',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
] as const;
const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
] as const;

/** Un número de 1 a 999 en letras ("UNO" al final; el apócope lo pone quien lo usa). */
function hasta999(n: number): string {
  if (n === 100) return 'CIEN';
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (centena > 0) partes.push(CENTENAS[centena]!);
  if (resto > 0) {
    if (resto < 30) {
      partes.push(UNIDADES[resto]!);
    } else {
      const decena = DECENAS[Math.floor(resto / 10)]!;
      const unidad = resto % 10;
      partes.push(unidad === 0 ? decena : `${decena} Y ${UNIDADES[unidad]!}`);
    }
  }
  return partes.join(' ');
}

/** Cambia el "UNO" final por "UN" ("VEINTIUNO" por "VEINTIÚN"): lo que va antes de MIL o MILLÓN. */
function apocopar(letras: string): string {
  if (letras.endsWith('VEINTIUNO')) return `${letras.slice(0, -'VEINTIUNO'.length)}VEINTIÚN`;
  if (letras.endsWith('UNO')) return `${letras.slice(0, -1)}`;
  return letras;
}

/** Un entero de 0 a 999 999 999 999 en letras. */
function enLetras(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const partes: string[] = [];
  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLÓN' : `${apocopar(miles(millones))} MILLONES`);
  }
  if (resto > 0) partes.push(miles(resto));
  return partes.join(' ');
}

/** Un entero de 1 a 999 999 en letras. */
function miles(n: number): string {
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (mil > 0) partes.push(mil === 1 ? 'MIL' : `${apocopar(hasta999(mil))} MIL`);
  if (resto > 0) partes.push(hasta999(resto));
  return partes.join(' ');
}

/** `"69.20"` → `"SESENTA Y NUEVE CON 20/100 SOLES"`. */
export function montoEnLetras(valor: string): string {
  const texto = monto(valor, 'El monto', ENTEROS_TOTAL).toFixed(2);
  const [enteros, centimos] = texto.split('.') as [string, string];
  return `${enLetras(Number(enteros))} CON ${centimos}/100 SOLES`;
}
