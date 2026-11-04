import { Body, Controller, Delete, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  cortesiaEntradaSchema,
  type CortesiaEntrada,
  type CortesiaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { CortesiasService } from './cortesias.service';

/**
 * Cortesías (historia 006, criterio 43). FIRMAS de la fase A: sin `@Permiso`, `@RequiereModulo`, clave ni
 * idempotencia todavía. En la fase C llevan `APLICAR_CORTESIA` con `@ClaveDespuesDeValidar`,
 * `@IdempotenteObligatoria()` y `SALON` (el quitar, `ATENDER_MESA` y `SALON`).
 */
@Controller('cuentas/:ordenId/cortesias')
export class CortesiasController {
  constructor(@Inject(CortesiasService) private readonly cortesias: CortesiasService) {}

  /**
   * 201 `cortesiaRespuesta`; 400; 403; 404; 409 `CONFLICTO` / `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`; 422
   * `CORTESIA_INVALIDA`.
   */
  @Post()
  aplicar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Body(new PipeZod(cortesiaEntradaSchema)) entrada: CortesiaEntrada,
  ): Promise<CortesiaRespuesta> {
    return this.cortesias.aplicar(ordenId, entrada);
  }

  /** 204 (también si ya estaba quitada); 404; 409 `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`. */
  @Delete(':id')
  @HttpCode(204)
  quitar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Param('id', PipeUuid) id: string,
  ): Promise<void> {
    return this.cortesias.quitar(ordenId, id);
  }
}
