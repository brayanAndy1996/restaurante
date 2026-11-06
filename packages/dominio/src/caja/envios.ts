/**
 * Envío de los comprobantes al PSE (historia 006, entrega 6b, criterios 127 a 133; ruta crítica P7): las esperas entre
 * reintentos, los plazos de SUNAT, las alertas y las transiciones de estado permitidas. Son reglas puras: reciben el
 * instante como parámetro y nunca leen el reloj.
 *
 * Todas lanzan `RangeError` con entradas mal formadas (un tipo o un estado que no existe, una fecha inválida, una cantidad de
 * intentos que no es un entero positivo): nunca devuelven un valor engañoso.
 */
import {
  ESTADOS_COMPROBANTE,
  TIPOS_DOCUMENTO_ELECTRONICO,
  type AlertaComprobante,
  type EstadoComprobante,
  type EstadoEnvioPse,
  type ResultadoEnvioPse,
  type TipoDocumentoElectronico,
} from './catalogos';

const MS_POR_MINUTO = 60_000;
/** Lima está en UTC−5 todo el año (sin horario de verano): el día de Lima termina a las 04:59:59.999 UTC del siguiente. */
const HORAS_DE_LIMA_RESPECTO_A_UTC = 5;
const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function exigirFecha(valor: Date, nombre: string): number {
  const instante = valor instanceof Date ? valor.getTime() : Number.NaN;
  if (!Number.isFinite(instante)) throw new RangeError(`${nombre} no es una fecha válida`);
  return instante;
}

/**
 * Minutos de espera después del intento `n` (`n` desde 1) que no terminó el envío: `[n − 1]` hasta el sexto y luego
 * siempre el último, 60 (criterio 129).
 */
export const ESPERAS_REINTENTO_MINUTOS = [1, 2, 5, 15, 30, 60] as const;

/** Minutos en `POR_ENVIAR` o `ENVIADO`, desde la emisión, a partir de los cuales hay alerta (criterio 133). */
export const MINUTOS_ALERTA_PENDIENTE = 30;

/**
 * Días calendario para enviar cada tipo de documento (criterio 130). Valor provisional: 3 para todos hasta que el
 * contador lo confirme (pregunta 27). Cambiar los plazos es cambiar esta tabla y sus pruebas.
 */
export const PLAZOS_ENVIO_DIAS: Readonly<Record<TipoDocumentoElectronico, number>> = {
  BOLETA: 3,
  FACTURA: 3,
  NOTA_CREDITO_BOLETA: 3,
  NOTA_CREDITO_FACTURA: 3,
};

/**
 * Cuándo se intenta de nuevo (criterio 129): `ahora` + `ESPERAS_REINTENTO_MINUTOS[min(intentos − 1, 5)]` minutos,
 * sin pasar de `plazoHasta` (si el siguiente caería después, se intenta justo en `plazoHasta`). `intentos` es la
 * cantidad de intentos ya hechos (≥ 1). Lanza `RangeError` con entradas mal formadas.
 */
export function proximoIntento(intentos: number, ahora: Date, plazoHasta: Date): Date {
  if (!Number.isInteger(intentos) || intentos < 1) {
    throw new RangeError('Los intentos hechos deben ser un entero de 1 en adelante');
  }
  const desde = exigirFecha(ahora, 'El instante actual');
  const limite = exigirFecha(plazoHasta, 'El plazo');
  const espera =
    ESPERAS_REINTENTO_MINUTOS[Math.min(intentos - 1, ESPERAS_REINTENTO_MINUTOS.length - 1)]!;
  return new Date(Math.min(desde + espera * MS_POR_MINUTO, limite));
}

/**
 * El último milisegundo, hora de Lima, del día `fechaEmision` (`AAAA-MM-DD`) más `PLAZOS_ENVIO_DIAS[tipo]` días
 * calendario (criterio 130). Lanza `RangeError` con un tipo o una fecha inválidos.
 */
export function plazoDeEnvio(tipo: TipoDocumentoElectronico, fechaEmision: string): Date {
  if (!(TIPOS_DOCUMENTO_ELECTRONICO as readonly string[]).includes(tipo)) {
    throw new RangeError(`Tipo de documento desconocido: ${String(tipo)}`);
  }
  const partes = typeof fechaEmision === 'string' ? FECHA_ISO.exec(fechaEmision) : null;
  if (partes === null) throw new RangeError('La fecha de emisión debe ser AAAA-MM-DD');
  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const comprobacion = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    comprobacion.getUTCFullYear() !== anio ||
    comprobacion.getUTCMonth() !== mes - 1 ||
    comprobacion.getUTCDate() !== dia
  ) {
    throw new RangeError('La fecha de emisión no existe');
  }
  return new Date(
    Date.UTC(
      anio,
      mes - 1,
      dia + PLAZOS_ENVIO_DIAS[tipo],
      23 + HORAS_DE_LIMA_RESPECTO_A_UTC,
      59,
      59,
      999,
    ),
  );
}

/** Lo que `alertaDe` necesita de un comprobante y su envío (criterio 133). */
export interface EntradaAlerta {
  estado: EstadoComprobante;
  /** El estado del envío; `null` si el comprobante no tiene envío (emitido antes de 6b). */
  estadoEnvio: EstadoEnvioPse | null;
  emitidoEn: Date;
  /** `envio_pse.ultimo_resultado`. */
  ultimoResultado: ResultadoEnvioPse | null;
  /** Ya tiene una reemisión (`RECHAZADO` con `reemplazado` no alerta). */
  reemplazado: boolean;
}

/**
 * La alerta de un comprobante (criterio 133): `RECHAZADO` (rechazado y sin reemisión), `DEMORADO` (más de
 * `MINUTOS_ALERTA_PENDIENTE` minutos desde `emitidoEn` en `POR_ENVIAR` o `ENVIADO`), `DETENIDO` (envío detenido) o
 * `SIN_CONFIGURACION` (último resultado `ERROR_CONFIGURACION`); `null` si no hay ninguna. Cuando coinciden varios gana
 * el primero de este orden, el mismo con que se cuentan las alertas (criterio 133): `RECHAZADO`, `DETENIDO`,
 * `SIN_CONFIGURACION`, `DEMORADO` (un envío detenido siempre lleva más de 30 minutos sin respuesta, pero cuenta como
 * detenido). Un comprobante aceptado, anulado o rechazado y ya reemplazado no tiene alerta.
 */
export function alertaDe(entrada: EntradaAlerta, ahora: Date): AlertaComprobante | null {
  if (!(ESTADOS_COMPROBANTE as readonly string[]).includes(entrada.estado)) {
    throw new RangeError(`Estado de comprobante desconocido: ${String(entrada.estado)}`);
  }
  const emitido = exigirFecha(entrada.emitidoEn, 'La fecha de emisión');
  const instante = exigirFecha(ahora, 'El instante actual');
  if (entrada.estado === 'RECHAZADO') return entrada.reemplazado ? null : 'RECHAZADO';
  const sinRespuestaFinal = entrada.estado === 'POR_ENVIAR' || entrada.estado === 'ENVIADO';
  if (!sinRespuestaFinal) return null;
  if (entrada.estadoEnvio === 'DETENIDO') return 'DETENIDO';
  if (entrada.ultimoResultado === 'ERROR_CONFIGURACION') return 'SIN_CONFIGURACION';
  if (instante - emitido > MINUTOS_ALERTA_PENDIENTE * MS_POR_MINUTO) return 'DEMORADO';
  return null;
}

/** Las seis transiciones que cambian el estado de un comprobante (criterio 127); el disparador de la base repite esta tabla. */
const TRANSICIONES: Readonly<Record<EstadoComprobante, readonly EstadoComprobante[]>> = {
  POR_ENVIAR: ['ENVIADO', 'ACEPTADO', 'RECHAZADO'],
  ENVIADO: ['ACEPTADO', 'RECHAZADO'],
  ACEPTADO: ['ANULADO'],
  RECHAZADO: [],
  ANULADO: [],
};

/**
 * Si el estado de un comprobante puede pasar de `desde` a `hacia` (criterio 127): `POR_ENVIAR` → `ENVIADO`,
 * `ACEPTADO` o `RECHAZADO`; `ENVIADO` → `ACEPTADO` o `RECHAZADO`; `ACEPTADO` → `ANULADO`. Quedarse en el mismo
 * estado es permitido. Ninguna otra.
 */
export function transicionPermitida(desde: EstadoComprobante, hacia: EstadoComprobante): boolean {
  for (const estado of [desde, hacia]) {
    if (!(ESTADOS_COMPROBANTE as readonly string[]).includes(estado)) {
      throw new RangeError(`Estado de comprobante desconocido: ${String(estado)}`);
    }
  }
  if (desde === hacia) return true;
  return TRANSICIONES[desde].includes(hacia);
}
