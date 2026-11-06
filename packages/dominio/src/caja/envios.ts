/**
 * Envío de los comprobantes al PSE (historia 006, entrega 6b, criterios 127 a 133; ruta crítica P7): las esperas entre
 * reintentos, los plazos de SUNAT, las alertas y las transiciones de estado permitidas. Son reglas puras: reciben el
 * instante como parámetro y nunca leen el reloj.
 *
 * Fase A (T28): las constantes están completas; las funciones solo tienen su firma y lanzan
 * `Error('No implementado')` hasta T30.
 */
import type {
  AlertaComprobante,
  EstadoComprobante,
  EstadoEnvioPse,
  ResultadoEnvioPse,
  TipoDocumentoElectronico,
} from './catalogos';

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
  void intentos;
  void ahora;
  void plazoHasta;
  throw new Error('No implementado');
}

/**
 * El último milisegundo, hora de Lima, del día `fechaEmision` (`AAAA-MM-DD`) más `PLAZOS_ENVIO_DIAS[tipo]` días
 * calendario (criterio 130). Lanza `RangeError` con un tipo o una fecha inválidos.
 */
export function plazoDeEnvio(tipo: TipoDocumentoElectronico, fechaEmision: string): Date {
  void tipo;
  void fechaEmision;
  throw new Error('No implementado');
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
 * `SIN_CONFIGURACION` (último resultado `ERROR_CONFIGURACION`); `null` si no hay ninguna. Qué motivo gana cuando
 * coinciden varios lo decide T30 con sus pruebas (el criterio no lo fija todavía).
 */
export function alertaDe(entrada: EntradaAlerta, ahora: Date): AlertaComprobante | null {
  void entrada;
  void ahora;
  throw new Error('No implementado');
}

/**
 * Si el estado de un comprobante puede pasar de `desde` a `hacia` (criterio 127): `POR_ENVIAR` → `ENVIADO`,
 * `ACEPTADO` o `RECHAZADO`; `ENVIADO` → `ACEPTADO` o `RECHAZADO`; `ACEPTADO` → `ANULADO`. Quedarse en el mismo
 * estado es permitido. Ninguna otra.
 */
export function transicionPermitida(desde: EstadoComprobante, hacia: EstadoComprobante): boolean {
  void desde;
  void hacia;
  throw new Error('No implementado');
}
