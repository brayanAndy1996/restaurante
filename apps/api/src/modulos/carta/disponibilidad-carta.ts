import { agotadoVigente, type HastaAgotado } from '@restaurante/dominio';

/**
 * La única regla de "este producto está disponible como componente u opción" de la carta (criterios 45 y 59):
 * un producto está disponible si está activo, se ofrece en la sucursal y no tiene un agotado vigente. La usan
 * la vista de la sucursal y el menú del día (`disponible` de cada opción), así que no puede haber dos
 * versiones. El día operativo actual lo calcula quien llama con el reloj de la API y la hora de corte.
 */
export interface EstadoDeDisponibilidad {
  activo: boolean;
  /** Se ofrece en la sucursal (`producto_sucursal.disponible`, por defecto sí). */
  disponible: boolean;
  /** El agotado guardado en la sucursal, vigente o vencido; `null` si no hay fila. */
  agotado: { diaOperativo: string; hasta: HastaAgotado } | null;
}

/** `true` si el agotado guardado sigue vigente en `hoy` (el día operativo actual de la sucursal). */
export const agotadoEstaVigente = (
  agotado: EstadoDeDisponibilidad['agotado'],
  hoy: string,
): boolean => agotado !== null && agotadoVigente(agotado, hoy);

/** Activo, disponible en la sucursal y sin agotado vigente. */
export const productoDisponible = (estado: EstadoDeDisponibilidad, hoy: string): boolean =>
  estado.activo && estado.disponible && !agotadoEstaVigente(estado.agotado, hoy);
