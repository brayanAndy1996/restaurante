/**
 * Reglas del horario y de los destinatarios de los llamados (historia 005, criterios 35, 36 y 56; ruta crítica
 * P2).
 */
import { dentroDeHorario, type TramoHorario } from '../horario';

/**
 * `true` si la mesa acepta llamados: si tiene una cuenta abierta, si la sucursal no tiene horario cargado (lista
 * vacía o `null`) o si `ahora` cae dentro del horario (`dentroDeHorario`).
 */
export function aceptaLlamados(entrada: {
  horario: readonly TramoHorario[] | null;
  ahora: Date;
  mesaConCuenta: boolean;
}): boolean {
  if (entrada.mesaConCuenta) return true;
  if (entrada.horario === null || entrada.horario.length === 0) return true;
  return dentroDeHorario([...entrada.horario], entrada.ahora);
}

/**
 * Destinatarios del aviso `llamado.nuevo`: `[mozoResponsableId]` si la mesa tiene una orden abierta o `null` (todas
 * las personas que atienden mesas en la sucursal) si está libre.
 */
export function destinatariosDeLlamado(mozoResponsableId: string | null): string[] | null {
  return mozoResponsableId === null ? null : [mozoResponsableId];
}
