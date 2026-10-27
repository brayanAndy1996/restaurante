/**
 * Quién hace los cambios de una transacción (trazabilidad, criterios 113 a 120): exactamente uno entre
 * un usuario de la empresa (con su equipo, si la sesión lo tiene), un superadministrador o un actor de
 * sistema (`semilla`, `cli:<script>`, `migracion:<nombre>`, `autenticacion`, `prueba`).
 */
export type ActorTransaccion =
  | { usuarioId: string; equipoId?: string | null }
  | { superadministradorId: string }
  | { sistema: string };

export interface OpcionesEjecucion {
  /**
   * Actor de la transacción, fijado junto con la empresa. Hasta la tarea T7 se acepta y se ignora.
   * Sin actor, la transacción puede leer pero no escribir en tablas trazadas (criterio 115).
   */
  actor?: ActorTransaccion;
}
