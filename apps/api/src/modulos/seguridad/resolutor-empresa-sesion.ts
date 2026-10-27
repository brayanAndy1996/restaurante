import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorTransaccion, ResolutorEmpresa } from '../../nucleo/contexto-empresa';
import { noImplementado } from '../../nucleo/errores';

/**
 * Resolutor de empresa por sesión: la empresa y el actor salen del principal que dejó el guard de
 * autenticación. Todavía NO está registrado en `RESOLUTOR_EMPRESA` (tarea T10); hasta entonces sus
 * métodos lanzan `Error('No implementado')`.
 */
@Injectable()
export class ResolutorEmpresaSesion implements ResolutorEmpresa {
  async resolver(_peticion: Request): Promise<string | null> {
    return noImplementado();
  }

  async actor(_peticion: Request): Promise<ActorTransaccion | null> {
    return noImplementado();
  }
}
