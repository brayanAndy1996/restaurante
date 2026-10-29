import {
  cocinaRespuestaSchema,
  type CocinaRespuesta,
  type ComandaKds,
} from '@restaurante/contratos';
import { api, consultarSiCambio } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';

/** Una línea de la pantalla de cocina en el estado que la cocina puede elegir. */
export type EstadoElegible = 'ENVIADO' | 'EN_PREPARACION' | 'LISTO';

/**
 * Clave de TanStack Query del KDS: cuelga de `['cocina']`, que invalidan los eventos `cocina.*`; lleva la
 * sucursal y las estaciones pedidas (otra selección es otra consulta, con su propio `ETag`).
 */
export const prefijoCocina = (sucursalId: string) =>
  [...CLAVES_TIEMPO_REAL.cocina, sucursalId] as const;
export const claveCocina = (sucursalId: string, estacionIds: readonly string[]) =>
  [...prefijoCocina(sucursalId), [...estacionIds].sort().join(',')] as const;

/**
 * Lo que se guarda del KDS: el cuerpo, el `ETag` con el que se pidió y la hora del servidor de esa respuesta
 * junto a la del equipo al recibirla. Con eso el tiempo transcurrido de cada comanda sale de la hora del
 * servidor, no del reloj del celular (el desfase se cancela al restar).
 */
export interface CocinaEnCache {
  cocina: CocinaRespuesta;
  etag: string | null;
  ahoraDelServidorMs: number;
  recibidoEnMs: number;
}

/** `GET /cocina/comandas?estacionIds=…` con `If-None-Match`: si nada cambió, 304 y no se baja el cuerpo. */
export const consultarCocina = (
  estacionIds: readonly string[],
  etag: string | null,
  segundoPlano: boolean,
  senal?: AbortSignal,
) =>
  consultarSiCambio(
    estacionIds.length > 0
      ? `/cocina/comandas?estacionIds=${estacionIds.join(',')}`
      : '/cocina/comandas',
    {
      esquema: cocinaRespuestaSchema,
      etag,
      // La consulta automática no insiste ni renueva la inactividad de la sesión.
      ...(segundoPlano ? { segundoPlano: true, reintentos: 1 } : {}),
      ...(senal ? { senal } : {}),
    },
  );

/** La hora del servidor ahora mismo: la de su última respuesta más lo que pasó en este equipo desde entonces. */
export function ahoraDeCocina(datos: CocinaEnCache | undefined, relojLocalMs: number): number {
  if (!datos) return relojLocalMs;
  return datos.ahoraDelServidorMs + Math.max(0, relojLocalMs - datos.recibidoEnMs);
}

// --- Escrituras (criterio 58 y 59) ----------------------------------------------------------------

/** `PUT /cocina/lineas/:id/estado`: repetir el mismo estado no cambia nada. */
export const cambiarEstadoDeLinea = (
  lineaId: string,
  estado: EstadoElegible,
  extra?: ExtraDeEscritura,
) => api.put(`/cocina/lineas/${lineaId}/estado`, { estado }, { ...extra });

/** `PUT /cocina/comandas/:id/listo`: todas las líneas no anuladas pasan a "Listo". */
export const marcarTodoListo = (comandaId: string, extra?: ExtraDeEscritura) =>
  api.put(`/cocina/comandas/${comandaId}/listo`, undefined, { ...extra });

/** `PUT /cocina/comandas/:id/visto`: una marcha o una anulación ya vista sale de pendientes. */
export const marcarVista = (comandaId: string, extra?: ExtraDeEscritura) =>
  api.put(`/cocina/comandas/${comandaId}/visto`, undefined, { ...extra });

// --- Reglas de presentación ------------------------------------------------------------------------

const esDeCocina = (c: Pick<ComandaKds, 'tipo'>) => c.tipo === 'COMANDA' || c.tipo === 'ADICION';

/**
 * ¿Está pendiente? Una comanda o adición, mientras alguna línea esté por preparar o en preparación; una
 * marcha o anulación, hasta que alguien la marca vista (criterio 56).
 */
export function estaPendiente(comanda: ComandaKds): boolean {
  if (!esDeCocina(comanda)) return comanda.vistaEn === null;
  return comanda.lineas.some((l) => l.estado === 'ENVIADO' || l.estado === 'EN_PREPARACION');
}

/** Orden de llegada: la hora de la comanda y, si empatan, su id (el mismo desempate de la API). */
export function porLlegada(a: ComandaKds, b: ComandaKds): number {
  const dif = Date.parse(a.creadaEn) - Date.parse(b.creadaEn);
  if (dif !== 0) return dif;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Las comandas pendientes como se ven: en orden de llegada, con las anulaciones arriba (criterio 62: lo que
 * ya no hay que preparar no puede quedar enterrado bajo lo que sigue). No cambia la lista que recibe.
 */
export function pendientesEnOrden(comandas: readonly ComandaKds[]): ComandaKds[] {
  const anulaciones = comandas.filter((c) => c.tipo === 'ANULACION').sort(porLlegada);
  const otras = comandas.filter((c) => c.tipo !== 'ANULACION').sort(porLlegada);
  return [...anulaciones, ...otras];
}

/** Recientes: la más nueva primero (lo último que se tocó es lo que se quiere corregir). */
export function recientesEnOrden(comandas: readonly ComandaKds[]): ComandaKds[] {
  return [...comandas].sort((a, b) => porLlegada(b, a));
}

/** "Mesa 4", "Mesas 4 y 5", "Mesas 4, 5 y 6": los nombres de mesa tal cual, sin repetir la palabra "Mesa". */
export function etiquetaDeMesas(mesas: readonly { nombre: string }[]): string {
  const numeros = mesas.map((m) => m.nombre.trim().replace(/^mesa\s+/i, ''));
  if (numeros.length === 0) return 'Sin mesa';
  if (numeros.length === 1) return `Mesa ${numeros[0]}`;
  return `Mesas ${numeros.slice(0, -1).join(', ')} y ${numeros[numeros.length - 1]}`;
}

// --- Cambios provisionales (la pantalla responde al toque, la API confirma después) --------------

/** Vuelve a repartir las comandas entre pendientes y recientes según su estado actual. */
function repartir(cocina: CocinaRespuesta): CocinaRespuesta {
  const todas = [...cocina.pendientes, ...cocina.recientes];
  return {
    ...cocina,
    pendientes: todas.filter(estaPendiente).sort(porLlegada),
    recientes: todas.filter((c) => !estaPendiente(c)).sort((a, b) => porLlegada(b, a)),
  };
}

function conComandas(
  cocina: CocinaRespuesta,
  cambiar: (comanda: ComandaKds) => ComandaKds,
): CocinaRespuesta {
  const aplicar = (lista: ComandaKds[]) => lista.map(cambiar);
  return repartir({
    ...cocina,
    pendientes: aplicar(cocina.pendientes),
    recientes: aplicar(cocina.recientes),
  });
}

/** Una línea pasa a `estado` (criterio 58); una línea anulada no se toca. */
export function conLineaEn(
  cocina: CocinaRespuesta,
  lineaId: string,
  estado: EstadoElegible,
): CocinaRespuesta {
  return conComandas(cocina, (c) =>
    c.lineas.some((l) => l.id === lineaId)
      ? {
          ...c,
          lineas: c.lineas.map((l) =>
            l.id === lineaId && l.estado !== 'ANULADO' ? { ...l, estado } : l,
          ),
        }
      : c,
  );
}

/** Todas las líneas no anuladas de la comanda pasan a "Listo" (criterio 59). */
export function conTodoListo(cocina: CocinaRespuesta, comandaId: string): CocinaRespuesta {
  return conComandas(cocina, (c) =>
    c.id === comandaId && esDeCocina(c)
      ? {
          ...c,
          lineas: c.lineas.map((l) => (l.estado === 'ANULADO' ? l : { ...l, estado: 'LISTO' })),
        }
      : c,
  );
}

/** Una marcha o anulación queda vista (criterio 59). */
export function conComandaVista(
  cocina: CocinaRespuesta,
  comandaId: string,
  vistaEn: string,
): CocinaRespuesta {
  return conComandas(cocina, (c) =>
    c.id === comandaId && !esDeCocina(c) && c.vistaEn === null ? { ...c, vistaEn } : c,
  );
}

/** Las estaciones que se ven en las comandas, para los filtros cuando no se sabe la lista completa. */
export function estacionesDeLasComandas(
  cocina: CocinaRespuesta | undefined,
): { id: string; nombre: string }[] {
  const vistas = new Map<string, string>();
  for (const c of [...(cocina?.pendientes ?? []), ...(cocina?.recientes ?? [])])
    vistas.set(c.estacion.id, c.estacion.nombre);
  return [...vistas].map(([id, nombre]) => ({ id, nombre }));
}
