/**
 * Reglas puras de estados de Salón y Cocina (historia 004, criterios 8, 58 y 77). No es ruta crítica: las
 * pruebas son del desarrollador.
 */
import {
  ESTADOS_LINEA_ELEGIBLES,
  type EstadoLineaElegible,
  type EstadoLineaKds,
  type EstadoMesa,
  type EstadoOrden,
} from './catalogos';

/** Una orden está abierta si está `ABIERTA` o `EN_PRECUENTA` (glosario). */
export function esOrdenAbierta(estado: EstadoOrden): boolean {
  return estado === 'ABIERTA' || estado === 'EN_PRECUENTA';
}

/**
 * Estado de una mesa a partir del estado de su orden abierta (criterio 8): `LIBRE` sin orden abierta (también
 * si la última orden se anuló, se unió a otra o se cerró), `OCUPADA` con una `ABIERTA` y `EN_PRECUENTA` con una
 * `EN_PRECUENTA`.
 */
export function estadoDeMesa(estadoOrden: EstadoOrden | null): EstadoMesa {
  if (estadoOrden === 'ABIERTA') return 'OCUPADA';
  if (estadoOrden === 'EN_PRECUENTA') return 'EN_PRECUENTA';
  return 'LIBRE';
}

/**
 * Si una línea de comanda puede pasar de `desde` a `hacia` desde la pantalla de cocina (criterio 58): de
 * cualquiera de `ENVIADO`, `EN_PREPARACION` y `LISTO` a cualquiera de esos tres (corregir un "Listo" puesto por
 * error), y repetir el mismo estado es válido (no hace nada). Una línea `ANULADO` no cambia, y `ANULADO` no se
 * elige desde la pantalla.
 */
export function transicionKdsValida(desde: EstadoLineaKds, hacia: EstadoLineaKds): boolean {
  if (desde === 'ANULADO') return false;
  return (ESTADOS_LINEA_ELEGIBLES as readonly EstadoLineaKds[]).includes(hacia);
}

/** Estrecha un estado de línea a los que la pantalla de cocina puede elegir. */
export function esEstadoLineaElegible(estado: EstadoLineaKds): estado is EstadoLineaElegible {
  return (ESTADOS_LINEA_ELEGIBLES as readonly EstadoLineaKds[]).includes(estado);
}
