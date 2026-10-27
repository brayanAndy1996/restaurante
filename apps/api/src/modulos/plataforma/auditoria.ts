import {
  MENSAJE_NUL,
  MENSAJE_SUSTITUTO_SUELTO,
  sinNul,
  sinSustitutosSueltos,
  uuidSchema,
} from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import type { ActorPlataforma } from './tipos';

/**
 * Texto recortado; lanza 400 DATOS_INVALIDOS (indicando el campo) si queda vacío o si contiene el
 * carácter NUL (criterio 40b) o un sustituto UTF-16 sin pareja (criterio 40c): nunca se guarda alterado.
 */
export function textoObligatorio(campo: string, valor: unknown, nombre: string): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!sinNul(texto)) {
    throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', `${nombre} no es válido`, [
      { campo, mensaje: MENSAJE_NUL },
    ]);
  }
  if (!sinSustitutosSueltos(texto)) {
    throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', `${nombre} no es válido`, [
      { campo, mensaje: MENSAJE_SUSTITUTO_SUELTO },
    ]);
  }
  if (texto === '') {
    throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', `${nombre} es obligatorio`, [
      { campo, mensaje: `${nombre} no puede estar vacío` },
    ]);
  }
  return texto;
}

/** Largo máximo del actor de sistema (`fijar_contexto_actor`, criterio 116). */
const MAXIMO_ACTOR_DE_SISTEMA = 100;

/**
 * Valida y recorta `actor` y `motivo` de una operación de plataforma. El actor es un texto de sistema (de
 * 1 a 100 caracteres) o `{ superadministradorId }` con un UUID.
 */
export function validarAuditoria(entrada: { actor: unknown; motivo: unknown }): {
  actor: ActorPlataforma;
  motivo: string;
} {
  const actor = validarActor(entrada.actor);
  const motivo = textoObligatorio('motivo', entrada.motivo, 'El motivo');
  return { actor, motivo };
}

function validarActor(bruto: unknown): ActorPlataforma {
  if (typeof bruto === 'object' && bruto !== null) {
    const id = (bruto as { superadministradorId?: unknown }).superadministradorId;
    if (
      Object.keys(bruto).length !== 1 ||
      typeof id !== 'string' ||
      !uuidSchema.safeParse(id).success
    ) {
      throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'El actor no es válido', [
        { campo: 'actor', mensaje: 'Debe ser un texto o { superadministradorId } con un UUID' },
      ]);
    }
    return { superadministradorId: id.toLowerCase() };
  }
  const actor = textoObligatorio('actor', bruto, 'El actor');
  if ([...actor].length > MAXIMO_ACTOR_DE_SISTEMA) {
    throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'El actor no es válido', [
      { campo: 'actor', mensaje: `No puede pasar de ${MAXIMO_ACTOR_DE_SISTEMA} caracteres` },
    ]);
  }
  return actor;
}
