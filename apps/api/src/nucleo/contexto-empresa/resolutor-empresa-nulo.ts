import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ResolutorEmpresa } from './resolutor-empresa';

/** Siempre `null`: es el resolutor de producción hasta que la historia 002 instale el suyo. */
@Injectable()
export class ResolutorEmpresaNulo implements ResolutorEmpresa {
  async resolver(_peticion: Request): Promise<string | null> {
    return null;
  }
}
