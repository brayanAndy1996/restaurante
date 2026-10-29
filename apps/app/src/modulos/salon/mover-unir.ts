import {
  ordenRespuestaSchema,
  type MesaDelSalon,
  type MoverEntrada,
  type OrdenRespuesta,
  type SalonRespuesta,
  type UnirEntrada,
} from '@restaurante/contratos';
import { nombreAccesibleDeMesa, type MesaDeCuadricula } from '@restaurante/ui';
import { api } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { montoEnSoles } from '../../lib/formato';
import { detalleDeMesa, grupoDeMesa } from './salon';

/**
 * Mover la cuenta a otra mesa y unir mesas (criterios 45 a 49 y 94 de 004): las llamadas a la API y las reglas
 * de la pantalla de selección, sin React. Los totales se muestran tal como llegan; aquí no se suma nada.
 */

type ZonaDelSalon = SalonRespuesta['zonas'][number];

/** `POST /ordenes/:id/movimiento` (criterio 45). La clave de idempotencia viene de `enviarSinPerder`. */
export const moverCuenta = (ordenId: string, entrada: MoverEntrada, extra?: ExtraDeEscritura) =>
  api.post(`/ordenes/${ordenId}/movimiento`, entrada, { esquema: ordenRespuestaSchema, ...extra });

/** `POST /ordenes/:id/union` (criterios 46 y 47): responde la cuenta principal ya unida. */
export const unirMesas = (ordenId: string, entrada: UnirEntrada, extra?: ExtraDeEscritura) =>
  api.post(`/ordenes/${ordenId}/union`, entrada, { esquema: ordenRespuestaSchema, ...extra });

// --- Reglas de presentación -----------------------------------------------------------------------

export type ModoDeSeleccion = 'mover' | 'unir';

/** Cuántas mesas se pueden unir de una vez (`unirEntradaSchema`: de 1 a 19). */
export const MAXIMO_MESAS_A_UNIR = 19;

/** "5", "5 y 6", "5, 6 y 7": nombres de mesas en una frase. */
export function listaDeNombres(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** Una mesa del salón con la zona donde está, para elegirla desde cualquier zona. */
export interface MesaElegible {
  mesa: MesaDelSalon;
  zona: string;
}

/** Todas las mesas de todas las zonas, por su id. */
export function mesasPorId(zonas: readonly ZonaDelSalon[]): Map<string, MesaElegible> {
  const mapa = new Map<string, MesaElegible>();
  for (const zona of zonas)
    for (const mesa of zona.mesas) mapa.set(mesa.id, { mesa, zona: zona.nombre });
  return mapa;
}

/**
 * Por qué una mesa no se puede elegir, o `null` si se puede (decisión 9):
 * - mover: solo una mesa libre; una ocupada se une, no se mueve a ella;
 * - unir: libres u ocupadas; las mesas de la propia cuenta ya están unidas.
 */
export function motivoNoElegible(
  modo: ModoDeSeleccion,
  mesa: Pick<MesaDelSalon, 'id' | 'orden'>,
  mesasDeLaCuenta: ReadonlySet<string>,
): string | null {
  if (mesasDeLaCuenta.has(mesa.id)) return 'es de esta cuenta';
  if (modo === 'mover' && mesa.orden) return 'ocupada: para juntar cuentas usa Unir';
  return null;
}

/** Las mesas de una zona como las dibuja la cuadrícula en modo selección. */
export function mesasDeSeleccion(
  zona: ZonaDelSalon,
  ahoraMs: number,
  modo: ModoDeSeleccion,
  mesasDeLaCuenta: ReadonlySet<string>,
): MesaDeCuadricula[] {
  return zona.mesas.map((mesa) => {
    const detalle = detalleDeMesa(mesa, ahoraMs);
    const grupo = grupoDeMesa(mesa);
    const motivo = motivoNoElegible(modo, mesa, mesasDeLaCuenta);
    // La mesa de la propia cuenta se reconoce a simple vista: dice "Esta cuenta" donde va el tiempo.
    const detalleFinal = mesasDeLaCuenta.has(mesa.id) ? 'Esta cuenta' : detalle;
    return {
      id: mesa.id,
      nombre: mesa.nombre,
      capacidad: mesa.capacidad,
      forma: mesa.forma,
      columna: mesa.columna,
      fila: mesa.fila,
      estado: mesa.estado,
      ...(detalleFinal ? { detalle: detalleFinal } : {}),
      ...(grupo ? { grupo } : {}),
      ...(motivo ? { noElegible: motivo } : {}),
    };
  });
}

/** Cuántas mesas de la zona se pueden elegir ahora. */
export const cuantasSeEligen = (
  zona: ZonaDelSalon,
  modo: ModoDeSeleccion,
  mesasDeLaCuenta: ReadonlySet<string>,
): number => zona.mesas.filter((m) => motivoNoElegible(modo, m, mesasDeLaCuenta) === null).length;

/** "Mesa 5 · Ocupada · Ana Ríos · S/ 85.00": lo que se lee de una mesa elegida para unir (criterio 94). */
export function resumenDeMesaElegida(mesa: MesaDelSalon): string {
  if (!mesa.orden) return `${nombreAccesibleDeMesa(mesa.nombre)} · Libre`;
  const partes = [
    nombreAccesibleDeMesa(mesa.nombre),
    mesa.estado === 'EN_PRECUENTA' ? 'En pre-cuenta' : 'Ocupada',
    mesa.orden.mozo.nombre,
  ];
  const total = montoEnSoles(mesa.orden.total);
  if (total) partes.push(total);
  return partes.join(' · ');
}

/**
 * La frase de confirmar una unión (criterio 94): "Unir 5 y 6 a la cuenta de la mesa 4: la venta queda a
 * nombre de Ana."
 */
export function fraseDeUnion(
  elegidas: readonly Pick<MesaDelSalon, 'nombre'>[],
  orden: Pick<OrdenRespuesta, 'mesas' | 'mozo'>,
): string {
  const destino = orden.mesas.map((m) => m.nombre);
  const dondeVa =
    destino.length === 1
      ? `la cuenta de la ${nombreAccesibleDeMesa(destino[0] ?? '').toLowerCase()}`
      : `la cuenta de las mesas ${listaDeNombres(destino)}`;
  return `Unir ${listaDeNombres(elegidas.map((m) => m.nombre))} a ${dondeVa}: la venta queda a nombre de ${orden.mozo.nombre}.`;
}

/**
 * Las cuentas que se absorben, una por cada orden distinta entre las mesas elegidas ocupadas (una cuenta
 * con varias mesas elegidas cuenta una sola vez).
 */
export interface CuentaQueSeAbsorbe {
  ordenId: string;
  mesas: string[];
  mozo: string;
  total: string | null;
  enPrecuenta: boolean;
}

export function cuentasQueSeAbsorben(elegidas: readonly MesaDelSalon[]): CuentaQueSeAbsorbe[] {
  const porOrden = new Map<string, CuentaQueSeAbsorbe>();
  for (const mesa of elegidas) {
    const orden = mesa.orden;
    if (!orden) continue;
    const previa = porOrden.get(orden.id);
    if (previa) {
      previa.mesas.push(mesa.nombre);
      continue;
    }
    porOrden.set(orden.id, {
      ordenId: orden.id,
      mesas: [mesa.nombre],
      mozo: orden.mozo.nombre,
      total: montoEnSoles(orden.total),
      enPrecuenta: mesa.estado === 'EN_PRECUENTA',
    });
  }
  return [...porOrden.values()];
}

/** La frase de confirmar un movimiento: la cuenta pasa y sigue a cargo de la misma persona (criterio 45). */
export function fraseDeMovimiento(
  origen: string,
  destino: string,
  orden: Pick<OrdenRespuesta, 'mozo'>,
): string {
  return `La cuenta pasa de la ${nombreAccesibleDeMesa(origen).toLowerCase()} a la ${nombreAccesibleDeMesa(destino).toLowerCase()}. Sigue a cargo de ${orden.mozo.nombre}.`;
}
