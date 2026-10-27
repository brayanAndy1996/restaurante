import { uuidSchema } from '@restaurante/contratos';

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
   * Actor de la transacción, fijado junto con la empresa (criterio 117). Sin actor, la transacción
   * puede leer pero no escribir en tablas trazadas (criterio 115); los ingresos lo fijan después de
   * verificar las credenciales con `ContextoEmpresa.fijarActor`.
   */
  actor?: ActorTransaccion;
}

/** Argumentos de `fijar_contexto_actor(usuario, equipo, superadministrador, sistema)`. */
export type ArgumentosDeActor = [
  usuario: string | null,
  equipo: string | null,
  superadministrador: string | null,
  sistema: string | null,
];

const MAXIMO_SISTEMA = 100;

function uuidONulo(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' || !uuidSchema.safeParse(valor).success) {
    throw new TypeError(`El actor de la transacción tiene un ${campo} que no es un UUID`);
  }
  return valor.toLowerCase();
}

/**
 * Argumentos de la función de la base para un actor. Valida la forma antes de llegar a la base (exactamente
 * un actor, equipo solo con usuario, sistema de 1 a 100 caracteres); la base repite las reglas.
 */
export function argumentosDeActor(actor: ActorTransaccion): ArgumentosDeActor {
  const datos = actor as Record<string, unknown>;
  const usuario = uuidONulo(datos.usuarioId, 'usuarioId');
  const equipo = uuidONulo(datos.equipoId, 'equipoId');
  const superadministrador = uuidONulo(datos.superadministradorId, 'superadministradorId');
  const sistema = datos.sistema ?? null;
  if (sistema !== null && (typeof sistema !== 'string' || sistema.length === 0)) {
    throw new TypeError('El actor de sistema debe ser un texto no vacío');
  }
  if (typeof sistema === 'string' && [...sistema].length > MAXIMO_SISTEMA) {
    throw new TypeError(`El actor de sistema no puede pasar de ${MAXIMO_SISTEMA} caracteres`);
  }
  const cantidad = [usuario, superadministrador, sistema].filter((valor) => valor !== null).length;
  if (cantidad !== 1) {
    throw new TypeError(
      'El actor de la transacción debe ser exactamente uno: usuario, superadministrador o sistema',
    );
  }
  if (equipo !== null && usuario === null) {
    throw new TypeError('El equipo del actor solo puede acompañar a un usuario');
  }
  return [usuario, equipo, superadministrador, sistema];
}
