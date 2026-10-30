import {
  envioRespuestaSchema,
  marchaRespuestaSchema,
  ordenRespuestaSchema,
  type EnvioEntrada,
  type ItemRespuesta,
  type OrdenRespuesta,
} from '@restaurante/contratos';
import { nombreAccesibleDeMesa, type TonoEtiqueta } from '@restaurante/ui';
import { api, consultarSiCambio } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { horaDeLima } from '../../lib/formato';
import { minutosAbierta, textoDeDuracion } from './salon';

/**
 * La cuenta de una mesa: llamadas a la API y las reglas de presentación de `GET /ordenes/:id` (criterios 55
 * y 90 de 004), sin React. Los totales llegan calculados por la API con `packages/dominio`; aquí no se suma
 * nada.
 */

/** Lo que se guarda de la cuenta: el cuerpo y el `ETag` con el que se pidió, si la API lo manda. */
export interface OrdenEnCache {
  orden: OrdenRespuesta;
  etag: string | null;
}

/** `GET /ordenes/:id`; con `If-None-Match` igual responde 304 y no se baja el cuerpo. */
export const consultarOrden = (
  ordenId: string,
  etag: string | null,
  segundoPlano: boolean,
  senal?: AbortSignal,
) =>
  consultarSiCambio(`/ordenes/${ordenId}`, {
    esquema: ordenRespuestaSchema,
    etag,
    // La consulta automática no insiste ni renueva la inactividad de la sesión.
    ...(segundoPlano ? { segundoPlano: true, reintentos: 1 } : {}),
    ...(senal ? { senal } : {}),
  });

/**
 * Envía el pedido (criterio 15). `entrada.id` lo genera la PWA y se conserva hasta que el envío termina:
 * repetir la llamada con el mismo `id` devuelve el envío ya hecho en vez de mandarlo otra vez a cocina
 * (criterio 26). La clave de idempotencia viene de `enviarSinPerder`.
 */
export const enviarComanda = (ordenId: string, entrada: EnvioEntrada, extra?: ExtraDeEscritura) =>
  api.post(`/ordenes/${ordenId}/envios`, entrada, { esquema: envioRespuestaSchema, ...extra });

/** Marcha los ítems de segundo tiempo (criterio 32); sin `itemIds`, todos los que esperan. */
export const marcharItems = (
  ordenId: string,
  entrada: { id: string; itemIds?: string[] },
  extra?: ExtraDeEscritura,
) => api.post(`/ordenes/${ordenId}/marchas`, entrada, { esquema: marchaRespuestaSchema, ...extra });

// --- Reglas de presentación -----------------------------------------------------------------------

/** "Mesa 4", "Mesas 4 y 5", "Mesas 4, 5 y 6": las mesas de la cuenta. */
export function tituloDeMesas(mesas: readonly { nombre: string }[]): string {
  const nombres = mesas.map((m) => m.nombre);
  if (nombres.length === 0) return 'Cuenta de la mesa';
  if (nombres.length === 1) return nombreAccesibleDeMesa(nombres[0] ?? '');
  const ultimo = nombres[nombres.length - 1];
  return `Mesas ${nombres.slice(0, -1).join(', ')} y ${ultimo}`;
}

export const ETIQUETA_DE_ESTADO: Record<
  OrdenRespuesta['estado'],
  { texto: string; tono: TonoEtiqueta }
> = {
  ABIERTA: { texto: 'Ocupada', tono: 'mal' },
  EN_PRECUENTA: { texto: 'Pre-cuenta', tono: 'alerta' },
  ANULADA: { texto: 'Anulada', tono: 'neutro' },
  UNIDA: { texto: 'Unida a otra cuenta', tono: 'neutro' },
  CERRADA: { texto: 'Cerrada', tono: 'neutro' },
};

/** Una cuenta abierta admite agregar, marchar y pedir la pre-cuenta (`esOrdenAbierta` de dominio). */
export const estaAbierta = (orden: Pick<OrdenRespuesta, 'estado'>): boolean =>
  orden.estado === 'ABIERTA' || orden.estado === 'EN_PRECUENTA';

/** "Ana Ríos · 3 comensales · Abierta hace 25 min". */
export function resumenDeCuenta(orden: OrdenRespuesta, ahoraMs: number): string {
  const comensales = `${orden.comensales} ${orden.comensales === 1 ? 'comensal' : 'comensales'}`;
  const tiempo = `Abierta hace ${textoDeDuracion(minutosAbierta(orden.abiertaEn, ahoraMs))}`;
  return [orden.mozo.nombre, comensales, tiempo].join(' · ');
}

/** Los ítems enviados de un mismo envío, con quién los comandó y a qué hora. */
export interface GrupoDeEnvio {
  clave: string;
  titulo: string;
  numero: number;
  esAdicion: boolean;
  /** Quién envió; `null` si lo envió una sesión de soporte. */
  comandadoPor: string | null;
  hora: string;
  items: ItemRespuesta[];
}

/** "Comanda" para el primer envío y "Adición 2", "Adición 3"… para los siguientes (criterio 23). */
export const tituloDeEnvio = (numero: number, esAdicion: boolean): string =>
  esAdicion || numero > 1 ? `Adición ${numero}` : 'Comanda';

/**
 * Lo que se le dice al mozo tras enviar. No promete que el ticket ya salió: eso depende de la impresora. Si el
 * estado de la impresión indica un problema (sin puente, puente caído o impresora que no responde), se dice
 * que quedó en cola de impresión.
 */
export function textoDeEnvioHecho(
  numero: number,
  esAdicion: boolean,
  problemaDeImpresion: boolean,
): string {
  const que = esAdicion || numero > 1 ? `La adición ${numero}` : 'La comanda';
  return `${que} se envió a cocina${problemaDeImpresion ? ' y quedó en cola de impresión' : ''}.`;
}

/** Agrupa los ítems por envío, en el orden en que se enviaron (los ítems de un envío quedan juntos). */
export function agruparPorEnvio(items: readonly ItemRespuesta[]): GrupoDeEnvio[] {
  const grupos = new Map<string, GrupoDeEnvio>();
  for (const item of items) {
    const clave = `${item.envioNumero}:${item.esAdicion ? 'a' : 'c'}`;
    const existente = grupos.get(clave);
    if (existente) {
      existente.items.push(item);
      continue;
    }
    grupos.set(clave, {
      clave,
      titulo: tituloDeEnvio(item.envioNumero, item.esAdicion),
      numero: item.envioNumero,
      esAdicion: item.esAdicion,
      comandadoPor: item.comandadoPor?.nombre ?? null,
      hora: horaDeLima(item.enviadoEn),
      items: [item],
    });
  }
  return [...grupos.values()].sort((a, b) => a.numero - b.numero);
}

/** Un ítem de segundo tiempo que sigue esperando la marcha (criterios 24, 32 y 33). */
export const esperaLaMarcha = (item: ItemRespuesta): boolean =>
  item.tiempo === 2 &&
  item.marchadoEn === null &&
  item.estado === 'ENVIADO' &&
  item.cantidadVigente > 0;

/** Los ítems que "Marchar" va a mandar. */
export const itemsPorMarchar = (orden: Pick<OrdenRespuesta, 'items'>): ItemRespuesta[] =>
  orden.items.filter(esperaLaMarcha);

/**
 * El estado en cocina de un ítem, dicho con palabras (criterio 90): "2 listos de 3", "Preparando",
 * "Enviado a cocina". `null` si el ítem no pasa por ninguna estación (una gaseosa sin estación) o está anulado.
 */
export function estadoEnCocina(item: ItemRespuesta): string | null {
  const { enviado, enPreparacion, listo } = item.cocina;
  const total = enviado + enPreparacion + listo;
  if (total === 0 || item.estado === 'ANULADO') return null;
  if (listo === total) return total === 1 ? 'Listo' : 'Todo listo';
  if (listo > 0) return `${listo} ${listo === 1 ? 'listo' : 'listos'} de ${total}`;
  if (enPreparacion > 0) return 'Preparando';
  return 'Enviado a cocina';
}

/** "3/4 · Huevo", los modificadores de un ítem; `null` si no tiene. */
export function textoDeModificadores(item: Pick<ItemRespuesta, 'modificadores'>): string | null {
  return item.modificadores.length > 0 ? item.modificadores.map((m) => m.nombre).join(' · ') : null;
}

/** "3 ítems", "1 ítem": cuántas unidades hay en una lista de líneas (la suma de sus cantidades). */
export const textoDeItems = (cantidad: number): string =>
  `${cantidad} ${cantidad === 1 ? 'ítem' : 'ítems'}`;
