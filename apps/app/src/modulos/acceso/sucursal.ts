import { sesionRespuestaSchema, type SesionRespuesta } from '@restaurante/contratos';
import { api } from '../../lib/api';

/** `PUT /sesion/sucursal`: devuelve la sesión con la sucursal y el rol nuevos. */
export function elegirSucursal(sucursalId: string): Promise<SesionRespuesta> {
  return api.put('/sesion/sucursal', { sucursalId }, { esquema: sesionRespuestaSchema });
}

/** Mensajes propios de esta pantalla para los errores de `PUT /sesion/sucursal`. */
export const MENSAJES_SUCURSAL = {
  NO_ENCONTRADO: 'Esa sucursal ya no está disponible para ti. Elige otra.',
} as const;
