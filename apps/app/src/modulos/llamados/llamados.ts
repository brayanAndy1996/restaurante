import {
  atencionRespuestaSchema,
  llamadoDetalleSchema,
  llamadosRespuestaSchema,
  pasoACuentaRespuestaSchema,
  type AtencionEntrada,
  type AtencionRespuesta,
  type DescarteEntrada,
  type LlamadoDetalle,
  type LlamadoResumen,
  type LlamadosRespuesta,
  type PasoACuentaEntrada,
  type PasoACuentaRespuesta,
} from '@restaurante/contratos';
import { estadoVigenteLlamado, totalOrden, type EstadoLlamado } from '@restaurante/dominio';
import { nombreAccesibleDeMesa } from '@restaurante/ui';
import { api, consultarSiCambio } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { comoDecimal } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';

/**
 * Los llamados desde la mesa en la PWA (005, criterios 68 a 73): la lectura de `GET /llamados`, el detalle
 * con su revisión y las tres acciones del mozo (atender, pasar a la cuenta y descartar), más las reglas de
 * presentación. El vencimiento se calcula siempre con el `ahora` del servidor, nunca con el reloj del equipo.
 * Los montos los calcula `packages/dominio`; aquí solo se muestran.
 */

/** Clave de TanStack Query de la lista de una sucursal; cuelga de `['llamados']`, que invalidan los eventos. */
export const claveListaDeLlamados = (sucursalId: string) =>
  [...CLAVES_TIEMPO_REAL.llamados, 'lista', sucursalId] as const;

/** Clave del detalle de un llamado. */
export const claveDetalleDeLlamado = (llamadoId: string) =>
  [...CLAVES_TIEMPO_REAL.llamados, 'detalle', llamadoId] as const;

/**
 * Lo que se guarda de la lista: el cuerpo, el `ETag` (para `If-None-Match`) y la hora del servidor de esa
 * respuesta junto a la del equipo al recibirla, para decir "vence en 12 min" sin fiarse del reloj del celular.
 */
export interface LlamadosEnCache {
  respuesta: LlamadosRespuesta;
  etag: string | null;
  /** `ahora` del servidor en la última respuesta completa (ms de época). */
  ahoraDelServidorMs: number;
  /** Hora de este equipo (ms de época) cuando llegó esa respuesta. */
  recibidoEnMs: number;
}

/** `GET /llamados` con `If-None-Match`: si nada cambió responde 304 y no se baja el cuerpo (criterio 39). */
export const consultarLlamados = (
  etag: string | null,
  segundoPlano: boolean,
  senal?: AbortSignal,
) =>
  consultarSiCambio('/llamados', {
    esquema: llamadosRespuestaSchema,
    etag,
    ...(segundoPlano ? { segundoPlano: true, reintentos: 1 } : {}),
    ...(senal ? { senal } : {}),
  });

/** `GET /llamados/:id` con la revisión de cada línea (criterio 40). */
export const consultarLlamado = (llamadoId: string, segundoPlano: boolean, senal?: AbortSignal) =>
  api.get(`/llamados/${llamadoId}`, {
    esquema: llamadoDetalleSchema,
    ...(segundoPlano ? { segundoPlano: true, reintentos: 1 } : {}),
    ...(senal ? { senal } : {}),
  });

/** Atender (criterios 41 a 45): `ordenId` y `comensales` solo se usan si la mesa está libre y hay que abrirla. */
export const atenderLlamado = (
  llamadoId: string,
  entrada: AtencionEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.post<AtencionRespuesta>(`/llamados/${llamadoId}/atencion`, entrada, {
    esquema: atencionRespuestaSchema,
    ...extra,
  });

/** Pasar a la cuenta (criterios 46 a 52): no envía nada a cocina, devuelve las líneas para el borrador. */
export const pasarLlamadoACuenta = (
  llamadoId: string,
  entrada: PasoACuentaEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.post<PasoACuentaRespuesta>(`/llamados/${llamadoId}/paso-a-cuenta`, entrada, {
    esquema: pasoACuentaRespuestaSchema,
    ...extra,
  });

/** Descartar (criterio 53). */
export const descartarLlamado = (
  llamadoId: string,
  entrada: DescarteEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.post<LlamadoDetalle>(`/llamados/${llamadoId}/descarte`, entrada, {
    esquema: llamadoDetalleSchema,
    ...extra,
  });

// --- El reloj del servidor --------------------------------------------------------------------------

/** La hora del servidor ahora mismo: la de su última respuesta más lo que pasó en este equipo desde entonces. */
export function ahoraDeLlamados(datos: LlamadosEnCache | undefined, relojLocalMs: number): number {
  if (!datos) return relojLocalMs;
  return datos.ahoraDelServidorMs + Math.max(0, relojLocalMs - datos.recibidoEnMs);
}

/** El estado de un llamado a la hora `ahoraMs` del servidor: un pendiente cuyo `venceEn` ya pasó está `VENCIDO`. */
export function estadoDeLlamado(
  llamado: Pick<LlamadoResumen, 'estado' | 'venceEn'>,
  ahoraMs: number,
): EstadoLlamado {
  return estadoVigenteLlamado(
    { estado: llamado.estado, venceEn: new Date(llamado.venceEn) },
    new Date(ahoraMs),
  );
}

export interface LlamadosClasificados {
  /** Pendientes vigentes, el más antiguo primero. */
  pendientes: LlamadoResumen[];
  /** Pedidos ya atendidos que nadie pasó a la cuenta ni descartó. */
  enAtencion: LlamadoResumen[];
  /** Lo demás: pasados, descartados, vencidos y avisos sin pedido ya atendidos; lo más reciente primero. */
  recientes: LlamadoResumen[];
}

const instante = (texto: string | null): number => (texto === null ? 0 : Date.parse(texto));

/** Cuándo terminó un llamado (para ordenar "Recientes"). */
function cierreDe(l: LlamadoResumen, ahoraMs: number): number {
  if (estadoDeLlamado(l, ahoraMs) === 'VENCIDO' && l.estado === 'PENDIENTE')
    return instante(l.venceEn);
  return Math.max(instante(l.cerradoEn), instante(l.atendidoEn), instante(l.creadoEn));
}

/**
 * Reparte la lista del servidor entre pendientes, en atención y recientes, con el reloj del servidor
 * (criterio 70: un llamado vencido sale de pendientes cuando llega su hora).
 */
export function clasificarLlamados(
  llamados: readonly LlamadoResumen[],
  ahoraMs: number,
): LlamadosClasificados {
  const pendientes: LlamadoResumen[] = [];
  const enAtencion: LlamadoResumen[] = [];
  const recientes: LlamadoResumen[] = [];
  for (const l of llamados) {
    const estado = estadoDeLlamado(l, ahoraMs);
    if (estado === 'PENDIENTE') pendientes.push(l);
    else if (estado === 'ATENDIDO' && l.tipo === 'PEDIDO') enAtencion.push(l);
    else recientes.push(l);
  }
  const antiguosPrimero = (a: LlamadoResumen, b: LlamadoResumen) =>
    instante(a.creadoEn) - instante(b.creadoEn);
  pendientes.sort(antiguosPrimero);
  enAtencion.sort(antiguosPrimero);
  recientes.sort((a, b) => cierreDe(b, ahoraMs) - cierreDe(a, ahoraMs));
  return { pendientes, enAtencion, recientes };
}

// --- Presentación -------------------------------------------------------------------------------

type Tipo = LlamadoResumen['tipo'];

export const TEXTO_DE_TIPO: Record<Tipo, string> = {
  PEDIDO: 'Pedido',
  LLAMAR_MOZO: 'Llama al mozo',
  PEDIR_CUENTA: 'Pide la cuenta',
};

/** "1 plato", "3 platos". */
export function textoDePlatos(unidades: number): string {
  return unidades === 1 ? '1 plato' : `${unidades} platos`;
}

/** "Mesa 4 · Pedido (3 platos)" (criterio 69); sin las unidades mientras no se sepan. */
export function textoDeAvisoDeLlamado(
  mesaNombre: string,
  tipo: Tipo,
  unidades?: number | null,
): string {
  const base = `${nombreAccesibleDeMesa(mesaNombre)} · ${TEXTO_DE_TIPO[tipo]}`;
  return tipo === 'PEDIDO' && unidades ? `${base} (${textoDePlatos(unidades)})` : base;
}

/** `true` si el aviso es para esta persona: está entre los destinatarios, o `destinatarios` es `null` (todos). */
export function esParaMi(
  destinatarios: readonly string[] | null,
  usuarioId: string | null | undefined,
): boolean {
  if (destinatarios === null) return usuarioId !== null && usuarioId !== undefined;
  return usuarioId !== null && usuarioId !== undefined && destinatarios.includes(usuarioId);
}

const MS_POR_MINUTO = 60_000;

/** "hace 3 min", "hace 1 h 05 min", "recién llegó". */
export function textoDeAntiguedad(creadoEn: string, ahoraMs: number): string {
  const minutos = Math.max(0, Math.floor((ahoraMs - Date.parse(creadoEn)) / MS_POR_MINUTO));
  if (minutos < 1) return 'recién llegó';
  if (minutos < 60) return `hace ${minutos} min`;
  return `hace ${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
}

/** "vence en 12 min", "vence en menos de 1 min": cuánto falta, con el reloj del servidor. */
export function textoDeVencimiento(venceEn: string, ahoraMs: number): string {
  const falta = Date.parse(venceEn) - ahoraMs;
  if (falta <= 0) return 'venció';
  const minutos = Math.ceil(falta / MS_POR_MINUTO);
  return falta < MS_POR_MINUTO ? 'vence en menos de 1 min' : `vence en ${minutos} min`;
}

/** Un pendiente que está por vencer (menos de 3 minutos): la fila lo marca en ají. */
export const estaPorVencer = (venceEn: string, ahoraMs: number): boolean =>
  Date.parse(venceEn) - ahoraMs < 3 * MS_POR_MINUTO;

export const TEXTO_DE_ESTADO_CERRADO: Partial<Record<EstadoLlamado, string>> = {
  ATENDIDO: 'Atendido',
  PASADO_A_CUENTA: 'Pasó a la cuenta',
  DESCARTADO: 'Descartado',
  VENCIDO: 'Venció',
};

// --- Líneas del detalle ---------------------------------------------------------------------------

/** Total de una línea: `totalOrden` de `packages/dominio` sobre una sola línea. */
export function totalDeLineaDeLlamado(precioUnitario: string, cantidad: number): string {
  return totalOrden([{ precioUnitario, cantidad, cantidadAnulada: 0 }]);
}

/** Suma de varias líneas con `totalOrden`. */
export function totalDeLineasDeLlamado(
  lineas: readonly { precioUnitario: string; cantidad: number }[],
): string {
  return totalOrden(lineas.map((l) => ({ ...l, cantidadAnulada: 0 })));
}

/** `true` si los dos montos en texto valen lo mismo ("28.00" y "28"). */
export function montosIguales(a: string, b: string): boolean {
  const x = comoDecimal(a);
  const y = comoDecimal(b);
  return x !== null && y !== null && x.eq(y);
}

/** Lo que el mozo cambió de una línea del llamado antes de pasarlo: otra cantidad, o quitarla. */
export interface EdicionDeLinea {
  cantidad: number;
  quitada: boolean;
}

/** Las líneas que se pasarían a la cuenta, con las ediciones del mozo aplicadas (criterio 46). */
export function lineasParaPasar(
  detalle: LlamadoDetalle,
  ediciones: Readonly<Record<number, EdicionDeLinea | undefined>>,
): { posicion: number; cantidad: number }[] {
  return detalle.lineas
    .map((l) => ({ l, e: ediciones[l.posicion] }))
    .filter(({ e }) => !e?.quitada)
    .map(({ l, e }) => ({ posicion: l.posicion, cantidad: e?.cantidad ?? l.cantidad }));
}

/** Qué impide pasar el llamado ahora, en palabras; `null` si se puede (criterio 71). */
export function motivoParaNoPasar(
  detalle: LlamadoDetalle,
  ediciones: Readonly<Record<number, EdicionDeLinea | undefined>>,
  conEnvioEnCurso: boolean,
): string | null {
  const quedan = detalle.lineas.filter((l) => !ediciones[l.posicion]?.quitada);
  if (quedan.some((l) => !l.revision.disponible))
    return 'Quita lo que no está disponible para poder pasar el pedido.';
  if (quedan.length === 0) return 'Deja al menos un plato, o descarta el llamado.';
  if (conEnvioEnCurso)
    return 'La cuenta tiene un envío a cocina sin terminar. Espera a que termine para pasar el pedido.';
  return null;
}
