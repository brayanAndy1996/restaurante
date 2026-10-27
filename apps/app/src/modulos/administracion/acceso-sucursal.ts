import {
  sucursalAccesoRespuestaSchema,
  type SucursalAccesoRespuesta,
} from '@restaurante/contratos';
import { api } from '../../lib/api';

export const MINIMO_MINUTOS = 1;
export const MAXIMO_MINUTOS = 120;

export const claveAccesoSucursal = (sucursalId: string) => ['acceso-sucursal', sucursalId] as const;

export const obtenerAccesoSucursal = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/acceso`, {
    esquema: sucursalAccesoRespuestaSchema,
    ...(senal ? { senal } : {}),
  });

export const configurarAccesoSucursal = (
  sucursalId: string,
  minutosInactividad: number,
): Promise<SucursalAccesoRespuesta> =>
  api.patch(
    `/sucursales/${sucursalId}/acceso`,
    { minutosInactividad },
    { esquema: sucursalAccesoRespuestaSchema },
  );

/** Entero de 1 a 120 o `null` si el texto no lo es. Solo dígitos: sin signos, decimales ni notación científica. */
export function minutosValidos(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,3}$/.test(limpio)) return null;
  const n = Number(limpio);
  return n >= MINIMO_MINUTOS && n <= MAXIMO_MINUTOS ? n : null;
}
