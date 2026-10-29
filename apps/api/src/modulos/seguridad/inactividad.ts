import type { Rol } from '@restaurante/dominio';
import {
  MINUTOS_INACTIVIDAD_COCINA_POR_DEFECTO,
  MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO,
} from './constantes-acceso';

/** Lo que decide cuánto tiempo sin uso aguanta una sesión. */
export interface EntradaInactividad {
  tipo: 'CONTRASENA' | 'PIN' | 'SOPORTE';
  /**
   * El rol de la persona en la sucursal activa: el mismo que da los permisos de la petición. `null` sin
   * sucursal activa o sin rol; `ADMINISTRADOR` para el Administrador.
   */
  rol: Rol | null;
  /** `minutosInactividad` configurados en la sucursal activa (`null` sin sucursal o sin fila). */
  minutosSucursal: number | null;
  /** `minutosInactividadCocina` configurados en la sucursal activa (`null` sin sucursal o sin fila). */
  minutosCocina: number | null;
  /** Lo guardado en la sesión (`sesion.minutos_inactividad`): 30 en contraseña y en soporte. */
  minutosSesion: number;
}

/**
 * Minutos de inactividad que rigen para una sesión (historia 004, criterios 63b y 63c, decisión 11). Es el único
 * cálculo: lo usan el guard de autenticación, `GET /sesion`, el ingreso con contraseña, el ingreso con PIN y la
 * revisión de Socket.IO, para que todos den el mismo vencimiento. En este orden:
 *
 * 1. Sesión de soporte: lo guardado (30), sin cambios.
 * 2. Sesión de PIN o de contraseña con rol Cocina/Barra en la sucursal activa: `minutosCocina` (60 por defecto).
 * 3. Otra sesión de PIN (también sin sucursal activa): `minutosSucursal` (5 por defecto).
 * 4. Otra sesión de contraseña: lo guardado (30).
 */
export function minutosDeInactividad(entrada: EntradaInactividad): number {
  if (entrada.tipo === 'SOPORTE') return entrada.minutosSesion;
  if (entrada.rol === 'COCINA_BARRA') {
    return entrada.minutosCocina ?? MINUTOS_INACTIVIDAD_COCINA_POR_DEFECTO;
  }
  if (entrada.tipo === 'PIN') return entrada.minutosSucursal ?? MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO;
  return entrada.minutosSesion;
}
