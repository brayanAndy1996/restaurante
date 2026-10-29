import {
  ordenRespuestaSchema,
  salonRespuestaSchema,
  type AbrirOrdenEntrada,
  type MesaDelSalon,
  type SalonRespuesta,
} from '@restaurante/contratos';
import type { EstadoMesa } from '@restaurante/dominio';
import { nombreAccesibleDeMesa, type MesaDeCuadricula, type TonoEtiqueta } from '@restaurante/ui';
import { api, consultarSiCambio } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { montoEnSoles } from '../../lib/formato';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';

type ZonaDelSalon = SalonRespuesta['zonas'][number];

/** Clave de TanStack Query del mapa del salón de una sucursal; cuelga de `['salon']`, que invalidan los eventos. */
export const claveSalon = (sucursalId: string) =>
  [...CLAVES_TIEMPO_REAL.salon, sucursalId] as const;

/**
 * Lo que se guarda del salón: el cuerpo, el `ETag` con el que se pidió (para `If-None-Match`) y la hora del
 * servidor de esa respuesta junto a la del equipo al recibirla, para decir "hace 25 min" sin fiarse del reloj
 * del celular (el desfase se cancela al restar).
 */
export interface SalonEnCache {
  salon: SalonRespuesta;
  etag: string | null;
  /** `ahora` del servidor en la última respuesta completa (ms de época). */
  ahoraDelServidorMs: number;
  /** Hora de este equipo (ms de época) cuando llegó esa respuesta. */
  recibidoEnMs: number;
}

/** `GET /salon` con `If-None-Match`: si nada cambió responde 304 y no se baja el cuerpo (criterio 7). */
export const consultarSalon = (etag: string | null, segundoPlano: boolean, senal?: AbortSignal) =>
  consultarSiCambio('/salon', {
    esquema: salonRespuestaSchema,
    etag,
    // La consulta automática no insiste ni renueva la inactividad de la sesión.
    ...(segundoPlano ? { segundoPlano: true, reintentos: 1 } : {}),
    ...(senal ? { senal } : {}),
  });

/**
 * Abre una mesa (criterio 9). `entrada.id` lo genera la PWA y se conserva en los reintentos: repetir la
 * llamada con el mismo `id` devuelve la misma orden en vez de abrir otra. La clave de idempotencia viene de
 * `enviarSinPerder`.
 */
export const abrirOrden = (entrada: AbrirOrdenEntrada, extra?: ExtraDeEscritura) =>
  api.post('/ordenes', entrada, { esquema: ordenRespuestaSchema, ...extra });

// --- Reglas de presentación -----------------------------------------------------------------------

/** "25 min", "1 h 05 min": cuánto lleva abierta una mesa. */
export function textoDeDuracion(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  if (m < 60) return `${m} min`;
  const horas = Math.floor(m / 60);
  return `${horas} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Minutos desde que se abrió la orden hasta `ahoraMs`, nunca negativos. */
export function minutosAbierta(abiertaEn: string, ahoraMs: number): number {
  return Math.max(0, Math.floor((ahoraMs - Date.parse(abiertaEn)) / 60_000));
}

/** La hora del servidor ahora mismo: la de su última respuesta más lo que pasó en este equipo desde entonces. */
export function ahoraDelSalon(datos: SalonEnCache | undefined, relojLocalMs: number): number {
  if (!datos) return relojLocalMs;
  return datos.ahoraDelServidorMs + Math.max(0, relojLocalMs - datos.recibidoEnMs);
}

/** "3 · 25 min": comensales y tiempo abierta, lo que sigue al estado en la baldosa (criterio 88). */
export function detalleDeMesa(mesa: MesaDelSalon, ahoraMs: number): string | undefined {
  if (!mesa.orden) return undefined;
  return `${mesa.orden.comensales} · ${textoDeDuracion(minutosAbierta(mesa.orden.abiertaEn, ahoraMs))}`;
}

/**
 * Las otras mesas de la misma cuenta, "5, 6" (criterio 88: "Grupo con 5, 6"); `undefined` si la mesa no
 * está unida a ninguna.
 */
export function grupoDeMesa(mesa: MesaDelSalon): string | undefined {
  const otras = (mesa.orden?.mesas ?? []).filter((m) => m.id !== mesa.id).map((m) => m.nombre);
  return otras.length > 0 ? otras.join(', ') : undefined;
}

/** Las mesas de una zona como las dibuja la cuadrícula, con su estado, su detalle y su grupo. */
export function mesasDeCuadricula(zona: ZonaDelSalon, ahoraMs: number): MesaDeCuadricula[] {
  return zona.mesas.map((mesa) => {
    const detalle = detalleDeMesa(mesa, ahoraMs);
    const grupo = grupoDeMesa(mesa);
    return {
      id: mesa.id,
      nombre: mesa.nombre,
      capacidad: mesa.capacidad,
      forma: mesa.forma,
      columna: mesa.columna,
      fila: mesa.fila,
      estado: mesa.estado,
      ...(detalle ? { detalle } : {}),
      ...(grupo ? { grupo } : {}),
    };
  });
}

/** Cuántas mesas hay en cada estado. */
export function contarEstados(mesas: readonly MesaDelSalon[]): Record<EstadoMesa, number> {
  const cuenta: Record<EstadoMesa, number> = { LIBRE: 0, OCUPADA: 0, EN_PRECUENTA: 0 };
  for (const mesa of mesas) cuenta[mesa.estado] += 1;
  return cuenta;
}

/** Cada cuenta con varias mesas de la zona, una sola vez: la primera mesa y las demás, "Mesa 4 · Grupo con 5, 6". */
export function gruposDeZona(zona: ZonaDelSalon): { ordenId: string; texto: string }[] {
  const vistos = new Set<string>();
  const grupos: { ordenId: string; texto: string }[] = [];
  for (const mesa of zona.mesas) {
    const orden = mesa.orden;
    if (!orden || orden.mesas.length < 2 || vistos.has(orden.id)) continue;
    vistos.add(orden.id);
    const [primera, ...otras] = orden.mesas;
    if (!primera) continue;
    grupos.push({
      ordenId: orden.id,
      texto: `${nombreAccesibleDeMesa(primera.nombre)} · Grupo con ${otras.map((m) => m.nombre).join(', ')}`,
    });
  }
  return grupos;
}

/** Las mesas de la zona en orden de lectura (por fila y columna): la vista de lista. */
export function mesasEnOrdenDeLectura(zona: ZonaDelSalon): MesaDelSalon[] {
  return [...zona.mesas].sort((a, b) => a.fila - b.fila || a.columna - b.columna);
}

export const TONO_DE_ESTADO: Record<EstadoMesa, TonoEtiqueta> = {
  LIBRE: 'ok',
  OCUPADA: 'mal',
  EN_PRECUENTA: 'alerta',
};

export const TEXTO_DE_ESTADO: Record<EstadoMesa, string> = {
  LIBRE: 'Libre',
  OCUPADA: 'Ocupada',
  EN_PRECUENTA: 'Pre-cuenta',
};

/** "5 libres", "1 ocupada", "2 en pre-cuenta": lo que dicen las etiquetas de color sobre el mapa. */
export function textoDeConteo(estado: EstadoMesa, cantidad: number): string {
  if (estado === 'LIBRE') return `${cantidad} ${cantidad === 1 ? 'libre' : 'libres'}`;
  if (estado === 'OCUPADA') return `${cantidad} ${cantidad === 1 ? 'ocupada' : 'ocupadas'}`;
  return `${cantidad} en pre-cuenta`;
}

/** Segunda línea de una fila de la lista: "3 personas · 25 min · Ana · Grupo con 5, 6". */
export function ayudaDeFila(mesa: MesaDelSalon, ahoraMs: number): string {
  const orden = mesa.orden;
  if (!orden) return `Capacidad ${mesa.capacidad}`;
  const partes = [
    `${orden.comensales} ${orden.comensales === 1 ? 'persona' : 'personas'}`,
    textoDeDuracion(minutosAbierta(orden.abiertaEn, ahoraMs)),
    orden.mozo.nombre,
  ];
  const grupo = grupoDeMesa(mesa);
  if (grupo) partes.push(`Grupo con ${grupo}`);
  return partes.join(' · ');
}

/** El total de la cuenta como lo muestra la lista ("S/ 120.00"); lo calcula la API con `packages/dominio`. */
export function totalDeMesa(mesa: MesaDelSalon): string | null {
  return mesa.orden ? montoEnSoles(mesa.orden.total) : null;
}

/** Ruta de la cuenta de una mesa (T16 la dibuja completa). */
export const rutaDeOrden = (ordenId: string) => `/salon/ordenes/${ordenId}`;

// --- Medidas del mapa -----------------------------------------------------------------------------

/** Lado mínimo de una baldosa en el mapa: con menos, "Pre-cuenta" y "3 · 25 min" no caben en su línea. */
export const CELDA_MINIMA = 88;
export const CELDA_MAXIMA = 104;
/** Junta entre celdas (4 px) y relleno con borde de la cuadrícula (8 px + 1 px por lado). */
const JUNTA = 4;
const MARCO_DE_CUADRICULA = 18;

/**
 * Lado de cada celda para que las columnas llenen el ancho disponible, entre 88 y 104 px. Con ancho 0 (aún
 * no se midió) usa el mínimo.
 */
export function ladoDeCelda(anchoDisponible: number, columnas: number): number {
  if (anchoDisponible <= 0 || columnas < 1) return CELDA_MINIMA;
  const lado = Math.floor(
    (anchoDisponible - MARCO_DE_CUADRICULA - (columnas - 1) * JUNTA) / columnas,
  );
  return Math.min(CELDA_MAXIMA, Math.max(CELDA_MINIMA, lado));
}

/**
 * `true` si todas las columnas caben a lo ancho con baldosas de tamaño legible. Sin medida (ancho 0), sí: el
 * mapa es la vista por defecto y la lista solo se ofrece cuando se sabe que no cabe.
 */
export function cabeElMapa(anchoDisponible: number, columnas: number): boolean {
  if (anchoDisponible <= 0) return true;
  return columnas * CELDA_MINIMA + (columnas - 1) * JUNTA + MARCO_DE_CUADRICULA <= anchoDisponible;
}
