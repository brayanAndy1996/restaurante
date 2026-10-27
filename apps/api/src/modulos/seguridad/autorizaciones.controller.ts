import { Body, Controller, Post } from '@nestjs/common';
import {
  autorizacionEntradaSchema,
  type AutorizacionEntrada,
  type AutorizacionRespuesta,
} from '@restaurante/contratos';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { noImplementado } from '../../nucleo/errores';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { RequiereSucursal } from './decoradores';

/** Clave de supervisor (HU-03). Lógica en la tarea T38. */
@Controller('autorizaciones')
export class AutorizacionesController {
  /**
   * 201 `autorizacionRespuesta`; 400; 403 `CLAVE_INVALIDA` / `PROHIBIDO`; 409 `CLAVE_INNECESARIA` /
   * `SUCURSAL_NO_ELEGIDA`; 429. Sin transacción del interceptor: el servicio abre la suya para guardar
   * los fallos y su auditoría aunque responda un error.
   */
  @Post()
  @SinEmpresa()
  @RequiereSucursal()
  @Idempotente()
  async autorizar(
    @Body(new PipeZod(autorizacionEntradaSchema)) _entrada: AutorizacionEntrada,
  ): Promise<AutorizacionRespuesta> {
    return noImplementado();
  }
}
