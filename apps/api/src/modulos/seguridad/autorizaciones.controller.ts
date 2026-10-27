import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import {
  autorizacionEntradaSchema,
  type AutorizacionEntrada,
  type AutorizacionRespuesta,
} from '@restaurante/contratos';
import type { Request } from 'express';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente, leerClaveIdempotencia } from '../../nucleo/idempotencia';
import { ClaveSupervisorService } from './clave-supervisor.service';
import { RequiereSucursal } from './decoradores';

/** Clave de supervisor (HU-03). */
@Controller('autorizaciones')
export class AutorizacionesController {
  constructor(@Inject(ClaveSupervisorService) private readonly clave: ClaveSupervisorService) {}

  /**
   * 201 `autorizacionRespuesta`; 400; 403 `CLAVE_INVALIDA` / `PROHIBIDO`; 409 `CLAVE_INNECESARIA` /
   * `SUCURSAL_NO_ELEGIDA`; 429. Sin transacción del interceptor: el servicio abre la suya para guardar
   * los fallos y su auditoría aunque responda un error, y maneja él mismo la `Idempotency-Key`.
   */
  @Post()
  @SinEmpresa()
  @RequiereSucursal()
  @Idempotente()
  async autorizar(
    @Body(new PipeZod(autorizacionEntradaSchema)) entrada: AutorizacionEntrada,
    @Req() peticion: Request,
  ): Promise<AutorizacionRespuesta> {
    return this.clave.autorizar(entrada, leerClaveIdempotencia(peticion));
  }
}
