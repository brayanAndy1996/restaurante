import type { UsuarioRespuesta } from '@restaurante/contratos';
import { requisitoPermiso, type Rol } from '@restaurante/dominio';
import { etiquetaDeRol } from '../../lib/formato';

export interface PersonaQueAtiende {
  id: string;
  nombre: string;
  /** Su rol en la sucursal ("Mozo", "Administrador"). */
  rol: string;
}

/**
 * Las personas que pueden ser el mozo responsable de una mesa en la sucursal (decisión 8 de 004, criterio
 * 10): activas y que sean Administrador o tengan `ATENDER_MESA` como `permitido` con su rol en esa
 * sucursal (Mozo, Cajero y Supervisor; no Cocina/Barra). La API vuelve a comprobarlo al abrir la mesa.
 */
export function personasQueAtienden(
  usuarios: readonly UsuarioRespuesta[],
  sucursalId: string,
): PersonaQueAtiende[] {
  const personas: PersonaQueAtiende[] = [];
  for (const u of usuarios) {
    if (!u.activo) continue;
    if (u.esAdministrador) {
      personas.push({ id: u.id, nombre: u.nombre, rol: etiquetaDeRol('ADMINISTRADOR') });
      continue;
    }
    const acceso = u.accesos.find((a) => a.sucursalId === sucursalId);
    if (acceso && requisitoPermiso(acceso.rol as Rol, 'ATENDER_MESA') === 'permitido') {
      personas.push({ id: u.id, nombre: u.nombre, rol: etiquetaDeRol(acceso.rol as Rol) });
    }
  }
  return personas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
