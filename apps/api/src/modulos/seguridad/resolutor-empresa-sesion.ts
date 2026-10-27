import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorTransaccion, ResolutorEmpresa } from '../../nucleo/contexto-empresa';
import type { PeticionConPrincipal } from '../../nucleo/principal';

/**
 * Resolutor de empresa por sesión: la empresa y el actor salen del principal que dejó el guard de
 * autenticación en la petición, nunca de una cabecera, un parámetro ni el cuerpo (criterio 2). Está
 * registrado como `RESOLUTOR_EMPRESA`.
 *
 * Actor (criterio 117): sesión de contraseña o PIN, el usuario y, si la sesión tiene equipo recordado, su
 * equipo; sesión de soporte, el superadministrador; principal de prueba, el sistema `prueba`.
 */
@Injectable()
export class ResolutorEmpresaSesion implements ResolutorEmpresa {
  async resolver(peticion: Request): Promise<string | null> {
    return (peticion as PeticionConPrincipal).principal?.empresaId ?? null;
  }

  async actor(peticion: Request): Promise<ActorTransaccion | null> {
    const principal = (peticion as PeticionConPrincipal).principal;
    if (principal === undefined) return null;
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
}
