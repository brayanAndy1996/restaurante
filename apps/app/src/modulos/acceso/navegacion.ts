import type { SesionRespuesta } from '@restaurante/contratos';
import type { Accion, Modulo } from '@restaurante/dominio';
import { requisitoDeSesion } from './permisos';

/** Una sesión sin lo que no hace falta para decidir la navegación (sirve igual en las pruebas). */
type SesionDeNavegacion = Pick<SesionRespuesta, 'permisos' | 'modulos' | 'esAdministrador'>;

export type IdDeDestino =
  'inicio' | 'salon' | 'caja' | 'cocina' | 'carta' | 'disponibilidad' | 'ajustes';

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
 * "Caja": quien cobra u opera la caja (`COBRAR` u `OPERAR_CAJA`), si la sucursal tiene el módulo de Caja
 * (criterio 108 de 006).
 */
export function veLaCaja(sesion: SesionDeNavegacion | null | undefined): boolean {
  return sesion ? puede(sesion, 'COBRAR', 'CAJA') || puede(sesion, 'OPERAR_CAJA', 'CAJA') : false;
}

/**
 * La cuenta con sus descuentos y cortesías (`/caja/cuentas/:id`, criterio 36 de 006): quien atiende mesas
 * (`ATENDER_MESA`), si la sucursal tiene el módulo de Caja, que es de donde sale `GET /cuentas/:ordenId`.
 */
export function veLaCuenta(sesion: SesionDeNavegacion | null | undefined): boolean {
  return sesion ? puede(sesion, 'ATENDER_MESA', 'CAJA') : false;
}

/** La sucursal tiene el módulo de Facturación en su plan: sin él no hay envío a SUNAT que mostrar (006, 6b). */
export function tieneFacturacion(
  sesion: Pick<SesionRespuesta, 'modulos'> | null | undefined,
): boolean {
  return sesion?.modulos.includes('FACTURACION') ?? false;
}

/**
 * El panel de comprobantes (006, 6b, criterio 174): quien puede cobrar (`COBRAR`: el Cajero con sus turnos, el
 * Supervisor y el Administrador, pregunta 40), si la sucursal tiene el módulo de Facturación. La API decide el alcance.
 */
export function veLosComprobantes(sesion: SesionDeNavegacion | null | undefined): boolean {
  return sesion ? puede(sesion, 'COBRAR', 'FACTURACION') : false;
}

/**
 * Los avisos de alertas, de modo simulado y de facturación no activada (criterio 175) son del Administrador y del
 * Supervisor; el Cajero se entera por el resultado de su cobro.
 */
export function veLosAvisosDeFacturacion(
  sesion: Pick<SesionRespuesta, 'rol' | 'esAdministrador' | 'modulos'> | null | undefined,
): boolean {
  if (!sesion || !tieneFacturacion(sesion)) return false;
  return sesion.esAdministrador || sesion.rol === 'ADMINISTRADOR' || sesion.rol === 'SUPERVISOR';
}

/**
 * "Disponibilidad" va dentro de Cocina para el Administrador (su barra ya tiene cinco destinos, criterio 108 de
 * 006). Si el plan no le da Cocina, vuelve a la barra: es la única puerta.
 */
export function disponibilidadVaEnCocina(sesion: SesionDeNavegacion | null | undefined): boolean {
  return !!sesion?.esAdministrador && veLaCocina(sesion);
}

/**
 * A dónde se entra (criterio 87 de 004): "Salón" para quien atiende mesas, "Cocina" para quien solo usa
 * la pantalla de cocina y "Caja" para quien solo opera la caja. `null` si no tiene ninguna (por ejemplo, el plan
 * no incluye el módulo): entonces se queda en Inicio.
 */
export function destinoInicial(sesion: SesionDeNavegacion | null | undefined): string | null {
  if (veElSalon(sesion)) return '/salon';
  if (veLaCocina(sesion)) return '/cocina';
  if (veLaCaja(sesion)) return '/caja';
  return null;
}

/**
 * Navegación por rol (criterio 108 de 006, que cambia el 87 de 004), en este orden y como máximo cinco destinos.
 * Sale de `permisos` y `modulos` de `GET /sesion`, no del nombre del rol:
 *
 * - Mozo: Salón. Cajero: Salón, Caja y Carta. Cocina/Barra: Cocina y Disponibilidad.
 * - Supervisor: Salón, Caja, Cocina y Disponibilidad.
 * - Administrador: Salón, Caja, Cocina, Carta y Ajustes; "Disponibilidad" es un acceso dentro de Cocina.
 *
 * "Caja" solo aparece con el módulo de Caja en el plan. "Inicio" solo aparece si la persona no tiene ni Salón ni
 * Cocina ni Caja, porque entonces es donde aterriza. Las acciones que no puede hacer no aparecen (no se muestran
 * apagadas).
 */
export function destinosDeNavegacion(sesion: SesionDeNavegacion | null | undefined): Destino[] {
  if (!sesion) return [];
  const destinos: Destino[] = [];
  if (destinoInicial(sesion) === null)
    destinos.push({ id: 'inicio', a: '/', etiqueta: 'Inicio', fin: true });
  if (veElSalon(sesion)) destinos.push({ id: 'salon', a: '/salon', etiqueta: 'Salón', fin: false });
  if (veLaCaja(sesion)) destinos.push({ id: 'caja', a: '/caja', etiqueta: 'Caja', fin: false });
  if (veLaCocina(sesion))
    destinos.push({ id: 'cocina', a: '/cocina', etiqueta: 'Cocina', fin: false });
  // La carta la edita quien tiene `EDITAR_CARTA` con su rol en la sucursal activa (Administrador y Cajero).
  if (requisitoDeSesion(sesion.permisos, 'EDITAR_CARTA') === 'permitido')
    destinos.push({ id: 'carta', a: '/carta', etiqueta: 'Carta', fin: false });
  // La disponibilidad (agotados y menú del día): Cocina/Barra, Supervisor y Administrador. El Administrador la
  // abre desde Cocina (no cabría en su barra de cinco destinos).
  if (
    requisitoDeSesion(sesion.permisos, 'GESTIONAR_DISPONIBILIDAD') === 'permitido' &&
    !disponibilidadVaEnCocina(sesion)
  )
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
