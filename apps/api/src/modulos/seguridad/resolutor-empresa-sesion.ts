import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorTransaccion, ResolutorEmpresa } from '../../nucleo/contexto-empresa';
import type { PeticionConPrincipal, PeticionConPuente, Principal } from '../../nucleo/principal';

/** Actor de trazabilidad de un principal (ver `ResolutorEmpresaSesion`); `null` si no tiene. */
export function actorDePrincipal(principal: Principal): ActorTransaccion | null {
  switch (principal.tipo) {
    case 'CONTRASENA':
    case 'PIN':
      return principal.usuarioId === null
        ? null
        : { usuarioId: principal.usuarioId, equipoId: principal.equipoId };
    case 'SOPORTE':
      return principal.superadministradorId === null
        ? null
        : { superadministradorId: principal.superadministradorId };
    case 'PRUEBA':
      return { sistema: 'prueba' };
  }
}

/**
 * Resolutor de empresa por sesión: la empresa y el actor salen del principal que dejó el guard de
 * autenticación en la petición, nunca de una cabecera, un parámetro ni el cuerpo (criterio 2). Está
 * registrado como `RESOLUTOR_EMPRESA`.
 *
 * Actor (criterio 117): sesión de contraseña o PIN, el usuario y, si la sesión tiene equipo recordado, su
 * equipo; sesión de soporte, el superadministrador; principal de prueba, el sistema `prueba`. Las rutas del puente
 * de impresión (historia 004, 3b, criterio 109) no tienen principal de persona: la empresa y el actor
 * `puente:<id>` salen de lo que dejó su guard en la petición.
 */
@Injectable()
export class ResolutorEmpresaSesion implements ResolutorEmpresa {
  async resolver(peticion: Request): Promise<string | null> {
    const { puente, vinculacion } = peticion as PeticionConPuente;
    return (
      (peticion as PeticionConPrincipal).principal?.empresaId ??
      puente?.empresaId ??
      vinculacion?.empresaId ??
      null
    );
  }

  async actor(peticion: Request): Promise<ActorTransaccion | null> {
    const principal = (peticion as PeticionConPrincipal).principal;
    if (principal !== undefined) return actorDePrincipal(principal);
    // Las rutas del puente (3b, criterio 109): el actor de sistema `puente:<id>`; en la vinculación, el id del
    // puente que nace con ella.
    const { puente, vinculacion } = peticion as PeticionConPuente;
    if (puente !== undefined) return { sistema: `puente:${puente.puenteId}` };
    if (vinculacion !== undefined) return { sistema: `puente:${vinculacion.puenteIdNuevo}` };
    return null;
  }
}
