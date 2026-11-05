import {
  cajaRespuestaSchema,
  movimientoRespuestaSchema,
  reporteCajaSchema,
  cuentaResumenSchema,
  turnoRespuestaSchema,
  type CajaRespuesta,
  type CierreEntrada,
  type DiferenciaDeArqueo,
  type MovimientoEntrada,
  type MovimientoRespuesta,
  type ReporteCaja,
  type CuentaResumen,
  type TurnoRespuesta,
} from '@restaurante/contratos';
import { MEDIOS_PAGO, type MedioPago } from '@restaurante/dominio';
import { useRef } from 'react';
import { api, listaDe, nuevaClaveDeIdempotencia } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { horaDeLima } from '../../lib/formato';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { comoDecimal, formatearMonto, montoComoTexto, montoEsCero } from '../../lib/monto';

/**
 * El turno de caja en la PWA (historia 006, entrega 6a, criterios 24 a 35 y 108 a 110, 116): abrir caja con su
 * fondo, los ingresos y egresos, el reporte X en pantalla y el cierre con el conteo a ciegas. Aquí van las
 * llamadas a la API, las claves de las consultas, los textos y la validación de lo que se escribe. Ningún monto se
 * calcula aquí: los montos viajan y se muestran como texto, y lo esperado, las diferencias y los totales los
 * calcula la API con `packages/dominio`.
 */

// --- Claves de las consultas (cuelgan de ['turno'], que invalida el evento `turno.cambio`) -------------

export const CLAVE_DE_TURNO = CLAVES_TIEMPO_REAL.turno;
export const claveTurnoMio = (usuarioId: string, sucursalId: string) =>
  [...CLAVE_DE_TURNO, 'mio', usuarioId, sucursalId] as const;
export const claveCajasDeTurno = (sucursalId: string) =>
  [...CLAVE_DE_TURNO, 'cajas', sucursalId] as const;
export const claveReporte = (turnoId: string) => [...CLAVE_DE_TURNO, 'reporte', turnoId] as const;

// --- Llamadas a la API ---------------------------------------------------------------------------------

/** El turno abierto de la persona en la sucursal activa, o `null` si no tiene (la API responde 404). */
export async function leerTurnoMio(senal?: AbortSignal): Promise<TurnoRespuesta | null> {
  try {
    return await api.get('/turnos/mio', {
      esquema: turnoRespuestaSchema,
      ...(senal ? { senal } : {}),
    });
  } catch (error) {
    if (error instanceof ErrorApi && error.estado === 404) return null;
    throw error;
  }
}

/** Las cajas activas de la sucursal con quién las tiene abiertas (sin montos). */
export const listarCajasActivas = (senal?: AbortSignal) =>
  api.get<CajaRespuesta[]>('/cajas', {
    esquema: listaDe(cajaRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const abrirTurno = (
  entrada: { id: string; cajaId: string; fondo: string },
  extra?: ExtraDeEscritura,
) => api.post('/turnos', entrada, { esquema: turnoRespuestaSchema, ...extra });

export const registrarMovimiento = (
  turnoId: string,
  entrada: MovimientoEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.post<MovimientoRespuesta>(`/turnos/${turnoId}/movimientos`, entrada, {
    esquema: movimientoRespuestaSchema,
    ...extra,
  });

/** El reporte X de un turno abierto (o el Z de uno cerrado). */
export const leerReporte = (turnoId: string, senal?: AbortSignal) =>
  api.get(`/turnos/${turnoId}/reporte`, {
    esquema: reporteCajaSchema,
    ...(senal ? { senal } : {}),
  });

export const cerrarTurno = (turnoId: string, entrada: CierreEntrada, extra?: ExtraDeEscritura) =>
  api.post(`/turnos/${turnoId}/cierre`, entrada, { esquema: reporteCajaSchema, ...extra });

// --- Textos --------------------------------------------------------------------------------------------

export const NOMBRE_DE_MEDIO: Record<MedioPago, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA_CREDITO: 'Tarjeta de crédito',
  TARJETA_DEBITO: 'Tarjeta de débito',
  YAPE: 'Yape',
  PLIN: 'Plin',
};

/** Qué contar en cada medio: una línea de ayuda debajo del campo del conteo. */
export const AYUDA_DE_CONTEO: Record<MedioPago, string> = {
  EFECTIVO: 'Billetes y monedas de la gaveta, con el fondo inicial.',
  TARJETA_CREDITO: 'Suma de los vouchers de crédito del turno.',
  TARJETA_DEBITO: 'Suma de los vouchers de débito del turno.',
  YAPE: 'Suma de las operaciones recibidas en Yape.',
  PLIN: 'Suma de las operaciones recibidas en Plin.',
};

/**
 * "S/ 1,234.50" con el espacio duro de siempre; un monto negativo se escribe "-S/ 15.00" (el signo va antes de la
 * moneda). Un texto que no es un monto se muestra tal cual.
 */
export function soles(valor: string): string {
  const texto = formatearMonto(valor);
  if (texto === null) return valor;
  return texto.startsWith('-') ? `-S/\u00a0${texto.slice(1)}` : `S/\u00a0${texto}`;
}

/** "Faltan S/ 12.00", "Sobran S/ 5.00" o "Cuadra": la diferencia de un medio dicha con palabras (contado − esperado). */
export function textoDeDiferencia(diferencia: string): string {
  if (montoEsCero(diferencia)) return 'Cuadra';
  const d = comoDecimal(diferencia);
  if (d === null) return diferencia;
  return d.isNegative() ? `Faltan ${soles(d.abs().toFixed(2))}` : `Sobran ${soles(diferencia)}`;
}

/** "una cuenta abierta" / "2 cuentas abiertas". */
export const textoDeCuentasAbiertas = (cantidad: number): string =>
  cantidad === 1 ? 'Queda 1 cuenta abierta' : `Quedan ${cantidad} cuentas abiertas`;

/** La hora de Lima de un instante, "18:02". */
export const horaDelTurno = (instante: string): string => horaDeLima(instante);

/** "Ingreso" o "Egreso". */
export const NOMBRE_DE_MOVIMIENTO = { INGRESO: 'Ingreso', EGRESO: 'Egreso' } as const;

// --- Errores en palabras --------------------------------------------------------------------------------

const TEXTO_SUSPENDIDA =
  'No se puede abrir caja: la sucursal está suspendida. Puedes consultar y exportar tus datos. Se reactiva al registrarse el pago.';

/** Lo que la persona lee cuando la API rechaza una operación de caja: el problema y la salida. */
export function mensajeDeCaja(error: unknown): string {
  return mensajeDeError(error, {
    SUCURSAL_SUSPENDIDA: TEXTO_SUSPENDIDA,
    MODULO_NO_INCLUIDO:
      'El plan de esta sucursal no incluye Caja. Pide a tu administrador que lo revise.',
    PROHIBIDO: 'No tienes permiso para operar la caja.',
    TURNO_YA_ABIERTO: 'Esa caja ya está abierta, o ya tienes otra caja abierta. Revisa la lista.',
    TURNO_CERRADO: 'Este turno ya está cerrado. No se pueden registrar más cambios.',
    TURNO_AJENO:
      'Este turno es de otra persona. Solo su responsable, un supervisor o el administrador pueden hacerlo.',
    CONFLICTO: 'Esa caja ya no está activa. Elige otra.',
    NO_ENCONTRADO: 'No encontramos esa caja o ese turno. Actualiza la pantalla.',
    REFERENCIA_INVALIDA:
      'Un turno es de una persona: en una sesión de soporte no se puede abrir ni cerrar caja.',
    CLAVE_IDEMPOTENCIA_REUTILIZADA:
      'Esta operación ya se había enviado con otros datos. Vuelve a abrir la pantalla e inténtalo de nuevo.',
    CIERRE_BLOQUEADO: 'Aún quedan cuentas abiertas. Cóbralas o anúlalas antes de cerrar la caja.',
    DIFERENCIA_SIN_MOTIVO: 'Escribe el motivo de cada diferencia para poder cerrar.',
  });
}

// --- Apertura: la caja elegida y el fondo ---------------------------------------------------------------

export interface BorradorDeApertura {
  cajaId: string;
  /** Texto del campo, como se escribe ("200", "200.50"). */
  fondo: string;
}

export type ResultadoDeApertura =
  | { ok: true; cajaId: string; fondo: string }
  | { ok: false; errores: { cajaId?: string; fondo?: string } };

/** Valida la caja y el fondo (de "0.00" a "99999999.99") antes de enviar; el fondo sale con 2 decimales. */
export function validarApertura(borrador: BorradorDeApertura): ResultadoDeApertura {
  const errores: { cajaId?: string; fondo?: string } = {};
  if (borrador.cajaId === '') errores.cajaId = 'Elige la caja que vas a abrir';
  const fondo = montoComoTexto(borrador.fondo, { permitirCero: true });
  if (borrador.fondo.trim() === '') {
    errores.fondo = 'Escribe el fondo inicial. Si empiezas sin dinero, escribe 0.00';
  } else if (fondo === null) {
    errores.fondo = 'Escribe un monto válido, por ejemplo 200.00';
  }
  if (errores.cajaId || errores.fondo || fondo === null) return { ok: false, errores };
  return { ok: true, cajaId: borrador.cajaId, fondo };
}

/** Una caja se puede abrir si está libre. */
export const cajaLibre = (caja: CajaRespuesta): boolean => caja.turnoAbierto === null;

/** ¿La caja puede emitir comprobantes? Necesita una serie activa. */
export const cajaConSeries = (caja: CajaRespuesta): boolean => caja.series.some((s) => s.activa);

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;
const clavePreferencia = (empresaId: string, usuarioId: string, sucursalId: string) =>
  `restaurante.caja.${empresaId}.${usuarioId}.${sucursalId}`;

export interface PreferenciaDeCaja {
  cajaId: string | null;
  /** El último fondo con que abrió, para ofrecerlo como atajo (nunca se escribe solo). */
  fondo: string | null;
}

/** La caja que esta persona eligió la última vez en este equipo, y su último fondo. Nunca una credencial. */
export function preferenciaDeCaja(
  empresaId: string,
  usuarioId: string,
  sucursalId: string,
): PreferenciaDeCaja {
  try {
    const texto = local()?.getItem(clavePreferencia(empresaId, usuarioId, sucursalId));
    const valor = (texto ? JSON.parse(texto) : {}) as Partial<
      Record<keyof PreferenciaDeCaja, unknown>
    >;
    return {
      cajaId: typeof valor.cajaId === 'string' ? valor.cajaId : null,
      fondo: typeof valor.fondo === 'string' ? valor.fondo : null,
    };
  } catch {
    return { cajaId: null, fondo: null };
  }
}

export function guardarPreferenciaDeCaja(
  empresaId: string,
  usuarioId: string,
  sucursalId: string,
  preferencia: PreferenciaDeCaja,
): void {
  try {
    local()?.setItem(
      clavePreferencia(empresaId, usuarioId, sucursalId),
      JSON.stringify(preferencia),
    );
  } catch {
    // Sin almacenamiento, no se recuerda.
  }
}

/** La caja con que arranca la pantalla: la recordada si sigue libre; si no, la única libre; si no, ninguna. */
export function cajaInicial(cajas: readonly CajaRespuesta[], recordada: string | null): string {
  const libres = cajas.filter(cajaLibre);
  const guardada = libres.find((c) => c.id === recordada);
  if (guardada) return guardada.id;
  return libres.length === 1 ? (libres[0]?.id ?? '') : '';
}

// --- Movimientos ---------------------------------------------------------------------------------------

export interface BorradorDeMovimiento {
  tipo: 'INGRESO' | 'EGRESO';
  monto: string;
  motivo: string;
}

export type ResultadoDeMovimiento =
  | { ok: true; tipo: 'INGRESO' | 'EGRESO'; monto: string; motivo: string }
  | { ok: false; errores: { monto?: string; motivo?: string } };

const largo = (texto: string) => Array.from(texto).length;

/** Valida el monto (de "0.01" a "99999999.99") y el motivo (de 1 a 300 caracteres). */
export function validarMovimiento(borrador: BorradorDeMovimiento): ResultadoDeMovimiento {
  const errores: { monto?: string; motivo?: string } = {};
  const monto = montoComoTexto(borrador.monto);
  if (borrador.monto.trim() === '') errores.monto = 'Escribe el monto';
  else if (monto === null) errores.monto = 'Escribe un monto mayor que 0, por ejemplo 15.50';
  const motivo = borrador.motivo.trim();
  if (motivo === '') errores.motivo = 'Escribe el motivo: sirve para revisar la caja después';
  else if (largo(motivo) > 300) errores.motivo = 'Usa 300 caracteres como máximo';
  if (errores.monto || errores.motivo || monto === null) return { ok: false, errores };
  return { ok: true, tipo: borrador.tipo, monto, motivo };
}

/** Los movimientos del más nuevo al más antiguo (la API los entrega del más antiguo al más nuevo). */
export const movimientosRecientesPrimero = (lista: readonly MovimientoRespuesta[]) =>
  [...lista].reverse();

// --- Cierre: el conteo a ciegas y los motivos ---------------------------------------------------------

export type ConteoEscrito = Record<MedioPago, string>;
export type MotivosEscritos = Record<MedioPago, string>;

export const CONTEO_VACIO: ConteoEscrito = {
  EFECTIVO: '',
  TARJETA_CREDITO: '',
  TARJETA_DEBITO: '',
  YAPE: '',
  PLIN: '',
};

/** Atajos de motivo de una diferencia (criterio 116). */
export const ATAJOS_DE_MOTIVO = [
  'Faltó sencillo',
  'Error de vuelto',
  'Voucher sin registrar',
] as const;

export type ResultadoDeConteo =
  | { ok: true; contado: Record<MedioPago, string> }
  | { ok: false; errores: Partial<Record<MedioPago, string>> };

/** Cada medio lleva lo que se contó, de "0.00" a "99999999.99"; ninguno puede quedar sin escribir. */
export function validarConteo(escrito: ConteoEscrito): ResultadoDeConteo {
  const errores: Partial<Record<MedioPago, string>> = {};
  const contado = {} as Record<MedioPago, string>;
  for (const medio of MEDIOS_PAGO) {
    const texto = escrito[medio];
    if (texto.trim() === '') {
      errores[medio] =
        `Escribe lo que contaste en ${NOMBRE_DE_MEDIO[medio].toLowerCase()}. Si no hay nada, escribe 0.00`;
      continue;
    }
    const monto = montoComoTexto(texto, { permitirCero: true });
    if (monto === null) {
      errores[medio] = 'Escribe un monto válido, por ejemplo 120.50';
      continue;
    }
    contado[medio] = monto;
  }
  return Object.keys(errores).length > 0 ? { ok: false, errores } : { ok: true, contado };
}

/** El cuerpo del cierre: los cinco medios en su orden; el motivo solo viaja con una diferencia que lo pide. */
export function cuerpoDeCierre(
  contado: Record<MedioPago, string>,
  motivos: MotivosEscritos,
  conMotivo: ReadonlySet<MedioPago>,
): CierreEntrada {
  return {
    conteo: MEDIOS_PAGO.map((medio) => {
      const motivo = motivos[medio].trim();
      return conMotivo.has(medio) && motivo !== ''
        ? { medio, contado: contado[medio], motivo }
        : { medio, contado: contado[medio] };
    }),
  };
}

/** Los medios que tienen diferencia (distinta de "0.00"), con su motivo todavía por escribir. */
export const mediosConDiferencia = (diferencias: readonly DiferenciaDeArqueo[]): MedioPago[] =>
  diferencias.filter((d) => !montoEsCero(d.diferencia)).map((d) => d.medio);

/** Motivos que faltan: un error por cada medio con diferencia y sin motivo escrito. */
export function motivosQueFaltan(
  diferencias: readonly DiferenciaDeArqueo[],
  motivos: MotivosEscritos,
): Partial<Record<MedioPago, string>> {
  const errores: Partial<Record<MedioPago, string>> = {};
  for (const medio of mediosConDiferencia(diferencias)) {
    const motivo = motivos[medio].trim();
    if (motivo === '') errores[medio] = 'Escribe el motivo de esta diferencia';
    else if (largo(motivo) > 300) errores[medio] = 'Usa 300 caracteres como máximo';
  }
  return errores;
}

/**
 * Los errores `conteo.<i>.motivo` del 422 `DIFERENCIA_SIN_MOTIVO`, traducidos a un mensaje por medio. El índice es
 * el del medio en `MEDIOS_PAGO`, que es el orden en que se envió el conteo.
 */
export function medioDeCampoDeConteo(campo: string): MedioPago | undefined {
  const coincidencia = /^conteo\.(\d+)\.motivo$/.exec(campo);
  return coincidencia ? MEDIOS_PAGO[Number(coincidencia[1])] : undefined;
}

// --- Órdenes que bloquean el cierre ---------------------------------------------------------------------

export interface CuentaAbierta {
  ordenId: string;
  /** "Mesa 4" o "Mesas 4 y 5". */
  texto: string;
  /** "Ana · S/ 69.20". */
  detalle: string;
}

export function etiquetaDeMesas(nombres: readonly string[]): string {
  if (nombres.length === 0) return 'Cuenta sin mesa';
  if (nombres.length === 1) return `Mesa ${nombres[0]}`;
  const ultimo = nombres[nombres.length - 1];
  return `Mesas ${nombres.slice(0, -1).join(', ')} y ${ultimo}`;
}

/**
 * Las cuentas abiertas de la sucursal (`GET /cuentas`, la misma lista de «Por cobrar»), una fila por cuenta: con mesa
 * («Mesas 4 y 5») o de mostrador («Llamado 23», o «Mostrador» si todavía no tiene número). El detalle es quién la
 * atiende y lo que falta cobrar.
 */
export function cuentasAbiertas(cuentas: readonly CuentaResumen[]): CuentaAbierta[] {
  return cuentas.map((c) => ({
    ordenId: c.ordenId,
    texto: c.mesas.length > 0 ? etiquetaDeMesas(c.mesas.map((m) => m.nombre)) : 'Mostrador',
    detalle: [c.mozo?.nombre, soles(c.saldo)].filter(Boolean).join(' · '),
  }));
}

export const leerCuentasParaCierre = (senal?: AbortSignal) =>
  api.get<CuentaResumen[]>('/cuentas', {
    esquema: listaDe(cuentaResumenSchema),
    ...(senal ? { senal } : {}),
  });

/**
 * Un `id` de operación (turno, movimiento) que se conserva mientras la respuesta no sea final: si el envío se
 * cortó por la red, pulsar otra vez repite el mismo `id` y la API devuelve lo ya guardado en vez de duplicar. `para`
 * entrega el `id` de lo que se escribió (otro dato, otro `id`) y `soltar` lo olvida cuando hubo una respuesta final.
 */
export function useIdConservado() {
  const guardado = useRef<{ datos: string; id: string } | null>(null);
  return {
    para(datos: string): string {
      if (guardado.current?.datos !== datos) {
        guardado.current = { datos, id: nuevaClaveDeIdempotencia() };
      }
      return guardado.current.id;
    },
    soltar(): void {
      guardado.current = null;
    },
  };
}

export type { ReporteCaja, TurnoRespuesta };
