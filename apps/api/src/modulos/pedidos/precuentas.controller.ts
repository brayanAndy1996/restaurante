import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import {
  precuentaEntradaSchema,
  type PrecuentaEntrada,
  type PrecuentaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { PrecuentasService } from './precuentas.service';

/**
 * Pre-cuenta (historia 004, criterios 50 a 54). `ATENDER_MESA` y `SALON`, con `Idempotency-Key` obligatoria
 * (400 `DATOS_INVALIDOS` sin ella).
 */
@Controller('ordenes/:id/precuentas')
export class PrecuentasController {
  constructor(@Inject(PrecuentasService) private readonly precuentas: PrecuentasService) {}

  /**
   * 201 `precuentaRespuesta` (también la vigente que se devuelve sin cambios y la réplica del mismo `id`); 400;
   * 403; 404 (orden de otra sucursal, de otra empresa o inexistente); 409 `ORDEN_NO_ABIERTA` u
   * `ORDEN_SIN_CONSUMO`; 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` (el `id` es de otra orden).
   */
  @Post()
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  emitir(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(precuentaEntradaSchema)) entrada: PrecuentaEntrada,
  ): Promise<PrecuentaRespuesta> {
    return this.precuentas.emitir(id, entrada);
  }
}
