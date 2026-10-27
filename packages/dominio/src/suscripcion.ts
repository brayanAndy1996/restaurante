/**
 * Reglas de tiempo de la suscripción de una sucursal (RF-03, RF-06; criterios 71 y 72). Todas
 * trabajan con la fecha de Lima (UTC−5, sin horario de verano), nunca con la zona del servidor.
 * Las fechas son texto `AAAA-MM-DD`; el periodo de la cuota, `AAAA-MM`.
 */

const DESFASE_LIMA_MS = 5 * 60 * 60 * 1000;
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

export type EstadoSuscripcionCodigo = 'ACTIVA' | 'EN_GRACIA' | 'SUSPENDIDA';

export interface DatosSuscripcion {
  /** Último día (de Lima) en que la suscripción está activa. */
  vencimiento: string;
  /** Días de gracia después del vencimiento (0 a 60). */
  diasGracia: number;
}

export interface ResultadoEstadoSuscripcion {
  estado: EstadoSuscripcionCodigo;
  /** Primer día suspendido: `vencimiento + diasGracia + 1`. */
  suspensionDesde: string;
  /** Días que quedan antes de la suspensión; solo en gracia (`suspensionDesde − hoy`), si no `null`. */
  diasRestantesGracia: number | null;
}

/** Días desde 1970-01-01 de una fecha `AAAA-MM-DD` válida; lanza `RangeError` si no lo es. */
function dias(fecha: string): number {
  const partes = FORMATO_FECHA.exec(fecha);
  if (!partes) throw new RangeError(`Fecha inválida (se espera AAAA-MM-DD): "${fecha}"`);
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const ms = Date.UTC(anio, mes - 1, dia);
  const comprobada = new Date(ms);
  if (
    comprobada.getUTCFullYear() !== anio ||
    comprobada.getUTCMonth() !== mes - 1 ||
    comprobada.getUTCDate() !== dia
  ) {
    throw new RangeError(`Fecha inexistente: "${fecha}"`);
  }
  return Math.round(ms / MS_POR_DIA);
}

function aTexto(totalDias: number): string {
  return new Date(totalDias * MS_POR_DIA).toISOString().slice(0, 10);
}

function instanteValido(instante: Date): number {
  const ms = instante.getTime();
  if (Number.isNaN(ms)) throw new RangeError('Instante inválido');
  return ms;
}

/** Fecha de Lima (`AAAA-MM-DD`) de un instante. */
export function fechaLima(instante: Date): string {
  return new Date(instanteValido(instante) - DESFASE_LIMA_MS).toISOString().slice(0, 10);
}

/** Mes de Lima (`AAAA-MM`) de un instante: es el periodo de la cuota de comprobantes. */
export function periodoLima(instante: Date): string {
  return fechaLima(instante).slice(0, 7);
}

/**
 * Suma `n` meses calendario a una fecha; si el día no existe en el mes de llegada, queda el último
 * día de ese mes (`2026-01-31` + 1 = `2026-02-28`). `n` puede ser negativo.
 */
export function sumarMeses(fecha: string, n: number): string {
  if (!Number.isInteger(n)) throw new RangeError('La cantidad de meses debe ser un entero');
  dias(fecha); // valida
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  const indice = anio * 12 + (mes - 1) + n;
  const anioNuevo = Math.floor(indice / 12);
  const mesNuevo = indice - anioNuevo * 12; // 0 a 11
  const ultimoDia = new Date(Date.UTC(anioNuevo, mesNuevo + 1, 0)).getUTCDate();
  const diaNuevo = Math.min(dia, ultimoDia);
  return `${String(anioNuevo).padStart(4, '0')}-${String(mesNuevo + 1).padStart(2, '0')}-${String(diaNuevo).padStart(2, '0')}`;
}

/**
 * Estado de una suscripción en un instante: `ACTIVA` si hoy ≤ vencimiento; `EN_GRACIA` si
 * vencimiento < hoy ≤ vencimiento + `diasGracia`; `SUSPENDIDA` si hoy es posterior (hoy = fecha de
 * Lima del instante).
 */
export function estadoSuscripcion(
  datos: DatosSuscripcion,
  instante: Date,
): ResultadoEstadoSuscripcion {
  if (!Number.isInteger(datos.diasGracia) || datos.diasGracia < 0) {
    throw new RangeError('Los días de gracia deben ser un entero mayor o igual que 0');
  }
  const vencimiento = dias(datos.vencimiento);
  const hoy = dias(fechaLima(instante));
  const suspension = vencimiento + datos.diasGracia + 1;
  const suspensionDesde = aTexto(suspension);
  if (hoy <= vencimiento) return { estado: 'ACTIVA', suspensionDesde, diasRestantesGracia: null };
  if (hoy < suspension) {
    return { estado: 'EN_GRACIA', suspensionDesde, diasRestantesGracia: suspension - hoy };
  }
  return { estado: 'SUSPENDIDA', suspensionDesde, diasRestantesGracia: null };
}
