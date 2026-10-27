import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorTransaccion } from './actor';
import type { ResolutorEmpresa } from './resolutor-empresa';

/** Siempre `null`: el resolutor de respaldo si ningún módulo registra el suyo (todo responde 401). */
@Injectable()
export class ResolutorEmpresaNulo implements ResolutorEmpresa {
  async resolver(_peticion: Request): Promise<string | null> {
    return null;
  }

  async actor(_peticion: Request): Promise<ActorTransaccion | null> {
    return null;
  }
}
