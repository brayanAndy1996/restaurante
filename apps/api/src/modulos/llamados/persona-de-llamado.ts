import type { Principal } from '../../nucleo/principal';

/** Quién hizo algo con un llamado (lo guardan `atendido_por_*` y `cerrado_por_*`). */
export interface AutorDeLlamado {
  usuarioId: string | null;
  sesionId: string | null;
}

/**
 * ¿`principal` es la misma persona que `autor`? Una persona con usuario es la misma desde cualquier sesión o equipo
 * (su usuario). Una sesión de soporte no tiene usuario: "la misma" es solo la misma sesión, nunca otra sesión de soporte
 * aunque las dos tengan el usuario nulo (criterio 43). Sin sesión guardada no se puede afirmar que sea la misma.
 */
export function esLaMismaPersona(principal: Principal, autor: AutorDeLlamado): boolean {
  if (principal.usuarioId !== null) return autor.usuarioId === principal.usuarioId;
  return (
    autor.usuarioId === null && principal.sesionId !== null && autor.sesionId === principal.sesionId
  );
}
