import {
  sucursalAccesoRespuestaSchema,
  type SucursalAccesoEntrada,
  type SucursalAccesoRespuesta,
} from '@restaurante/contratos';
import { api } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';

export const MINIMO_MINUTOS = 1;
export const MAXIMO_MINUTOS = 120;
/** Cocina/Barra deja la pantalla encendida durante el servicio: su tiempo llega a 12 horas (criterio 63c de 004). */
export const MAXIMO_MINUTOS_COCINA = 720;

export const claveAccesoSucursal = (sucursalId: string) => ['acceso-sucursal', sucursalId] as const;

export const obtenerAccesoSucursal = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/acceso`, {
    esquema: sucursalAccesoRespuestaSchema,
    ...(senal ? { senal } : {}),
  });

/**
 * Cambia el tiempo de inactividad de una sucursal. Se envía solo lo que cambió (el campo que no se envía
 * no cambia) y, como las demás escrituras, no se pierde por un corte: se reintenta con la misma clave.
 */
export const configurarAccesoSucursal = (
  sucursalId: string,
  cambios: SucursalAccesoEntrada,
  extra?: ExtraDeEscritura,
): Promise<SucursalAccesoRespuesta> =>
  api.patch(`/sucursales/${sucursalId}/acceso`, cambios, {
    esquema: sucursalAccesoRespuestaSchema,
    ...extra,
  });

/** Entero de `minimo` a `maximo` o `null` si el texto no lo es. Solo dígitos: sin signos, decimales ni notación científica. */
export function minutosValidos(
  texto: string,
  maximo: number = MAXIMO_MINUTOS,
  minimo: number = MINIMO_MINUTOS,
): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,3}$/.test(limpio)) return null;
  const n = Number(limpio);
  return n >= minimo && n <= maximo ? n : null;
}
