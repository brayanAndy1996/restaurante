import type { SesionRespuesta } from '@restaurante/contratos';
import type { Accion, Modulo } from '@restaurante/dominio';
import { requisitoDeSesion } from './permisos';

/** Una sesión sin lo que no hace falta para decidir la navegación (sirve igual en las pruebas). */
type SesionDeNavegacion = Pick<SesionRespuesta, 'permisos' | 'modulos' | 'esAdministrador'>;

export type IdDeDestino = 'inicio' | 'salon' | 'cocina' | 'carta' | 'disponibilidad' | 'ajustes';

export interface Destino {
  id: IdDeDestino;
  a: string;
  etiqueta: string;
  /** El enlace está activo solo en esa ruta exacta (Inicio), no en las que cuelgan de ella. */
  fin: boolean;
}

/** `true` si la persona tiene la acción (como `permitido` o con `clave`) y el plan de la sucursal el módulo. */
function puede(sesion: SesionDeNavegacion, accion: Accion, modulo?: Modulo): boolean {
  if (requisitoDeSesion(sesion.permisos, accion) === 'prohibido') return false;
  return modulo === undefined || sesion.modulos.includes(modulo);
}

/** "Salón": quien atiende mesas, si la sucursal tiene el módulo de Salón. */
export function veElSalon(sesion: SesionDeNavegacion | null | undefined): boolean {
  return sesion ? puede(sesion, 'ATENDER_MESA', 'SALON') : false;
}

/** "Cocina": quien usa la pantalla de cocina, si la sucursal tiene el módulo de Cocina. */
export function veLaCocina(sesion: SesionDeNavegacion | null | undefined): boolean {
  return sesion ? puede(sesion, 'USAR_KDS', 'COCINA') : false;
}

/**
 * A dónde se entra (criterio 87 de 004): "Salón" para quien atiende mesas y "Cocina" para quien solo usa
 * la pantalla de cocina. `null` si no tiene ninguna de las dos (por ejemplo, el plan no incluye el módulo):
 * entonces se queda en Inicio.
 */
export function destinoInicial(sesion: SesionDeNavegacion | null | undefined): string | null {
  if (veElSalon(sesion)) return '/salon';
  if (veLaCocina(sesion)) return '/cocina';
  return null;
}

/**
 * Navegación por rol (criterio 87 de 004), en este orden y como máximo cinco destinos. Sale de `permisos` y
 * `modulos` de `GET /sesion`, no del nombre del rol:
 *
 * - Mozo: Salón. Cajero: Salón y Carta. Cocina/Barra: Cocina y Disponibilidad.
 * - Supervisor: Salón, Cocina y Disponibilidad.
 * - Administrador: Salón, Cocina, Carta, Disponibilidad y Ajustes.
 *
 * "Inicio" solo aparece si la persona no tiene ni Salón ni Cocina, porque entonces es donde aterriza.
 * Las acciones que no puede hacer no aparecen (no se muestran apagadas).
 */
export function destinosDeNavegacion(sesion: SesionDeNavegacion | null | undefined): Destino[] {
  if (!sesion) return [];
  const destinos: Destino[] = [];
  if (destinoInicial(sesion) === null)
    destinos.push({ id: 'inicio', a: '/', etiqueta: 'Inicio', fin: true });
  if (veElSalon(sesion)) destinos.push({ id: 'salon', a: '/salon', etiqueta: 'Salón', fin: false });
  if (veLaCocina(sesion))
    destinos.push({ id: 'cocina', a: '/cocina', etiqueta: 'Cocina', fin: false });
  // La carta la edita quien tiene `EDITAR_CARTA` con su rol en la sucursal activa (Administrador y Cajero).
  if (requisitoDeSesion(sesion.permisos, 'EDITAR_CARTA') === 'permitido')
    destinos.push({ id: 'carta', a: '/carta', etiqueta: 'Carta', fin: false });
  // La disponibilidad (agotados y menú del día): Cocina/Barra, Supervisor y Administrador.
  if (requisitoDeSesion(sesion.permisos, 'GESTIONAR_DISPONIBILIDAD') === 'permitido')
    destinos.push({
      id: 'disponibilidad',
      a: '/disponibilidad',
      etiqueta: 'Disponibilidad',
      fin: false,
    });
  // "Ajustes" agrupa Usuarios, Acceso, Mapa de mesas y, en 3b, Impresión.
  if (sesion.esAdministrador)
    destinos.push({ id: 'ajustes', a: '/administracion', etiqueta: 'Ajustes', fin: false });
  return destinos;
}
