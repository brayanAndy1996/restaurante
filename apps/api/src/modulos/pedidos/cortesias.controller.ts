import { Body, Controller, Delete, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  cortesiaEntradaSchema,
  type CortesiaEntrada,
  type CortesiaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { ClaveDespuesDeValidar, Permiso, RequiereModulo } from '../seguridad';
import { CortesiasService } from './cortesias.service';

/**
 * Cortesías (historia 006, criterios 43 a 46): como los descuentos. Aplicar lleva `APLICAR_CORTESIA` (con clave atada
 * al ítem y la cantidad), `SALON` e `Idempotency-Key` obligatoria; quitar, `ATENDER_MESA` y `SALON`, sin clave.
 */
@Controller('cuentas/:ordenId/cortesias')
export class CortesiasController {
  constructor(@Inject(CortesiasService) private readonly cortesias: CortesiasService) {}

  /**
   * 201 `cortesiaRespuesta`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` / `PROHIBIDO`; 404; 409 `CONFLICTO` /
   * `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`; 422 `CORTESIA_INVALIDA`.
   */
  @Post()
  @ClaveDespuesDeValidar({ cuerpo: cortesiaEntradaSchema, uuids: ['ordenId'] })
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('APLICAR_CORTESIA')
  aplicar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Body(new PipeZod(cortesiaEntradaSchema)) entrada: CortesiaEntrada,
  ): Promise<CortesiaRespuesta> {
    return this.cortesias.aplicar(ordenId, entrada);
  }

  /** 204 (también si ya estaba quitada); 404; 409 `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`. */
  @Delete(':id')
  @HttpCode(204)
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  quitar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Param('id', PipeUuid) id: string,
  ): Promise<void> {
    return this.cortesias.quitar(ordenId, id);
  }
}
