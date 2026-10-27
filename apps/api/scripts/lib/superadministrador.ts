// Alta y baja de superadministradores (personal de nuestra empresa). Son las únicas vías: no hay ruta
// HTTP para crearlos ni desactivarlos (criterio 61). Las usa `pnpm plataforma:superadmin` y las pruebas.
// Lógica en la tarea T15 (hasta entonces lanzan `Error('No implementado')`).

export interface DatosNuevoSuperadministrador {
  /** Nombre de usuario (a-z, 0-9, `.`, `_`, `-`; único entre superadministradores, sin distinguir mayúsculas). */
  usuario: string;
  nombre: string;
  /** Contraseña en claro (8 a 128 caracteres); se guarda con scrypt. Nunca se registra ni se audita. */
  contrasena: string;
}

/**
 * Crea un superadministrador con la vía de plataforma (actor `cli:superadmin`, auditoría
 * `crear_superadministrador`). Toma `DATABASE_PLATAFORMA_URL` del entorno. Devuelve su id.
 */
export async function crearSuperadministrador(
  _datos: DatosNuevoSuperadministrador,
): Promise<{ id: string }> {
  throw new Error('No implementado');
}

/**
 * Desactiva un superadministrador: cierra sus sesiones y sus sesiones de soporte abiertas en cualquier
 * empresa (auditoría `desactivar_superadministrador`).
 */
export async function desactivarSuperadministrador(_datos: { usuario: string }): Promise<void> {
  throw new Error('No implementado');
}
