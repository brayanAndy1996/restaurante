import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ResolutorEmpresa } from './resolutor-empresa';

/**
 * Lee la cabecera `x-empresa-id`. Solo con `NODE_ENV` `development` o `test` y
 * `EMPRESA_POR_HEADER=habilitado`; prohibido en producción.
 */
@Injectable()
export class ResolutorEmpresaPorCabecera implements ResolutorEmpresa {
  async resolver(_peticion: Request): Promise<string | null> {
    throw new Error('No implementado');
  }
}
