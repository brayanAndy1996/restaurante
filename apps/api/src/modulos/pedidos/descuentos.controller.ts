import { Body, Controller, Delete, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  descuentoEntradaSchema,
  type DescuentoEntrada,
  type DescuentoRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { DescuentosService } from './descuentos.service';

/**
 * Descuentos (historia 006, criterios 38 a 42). FIRMAS de la fase A: sin `@Permiso`, `@RequiereModulo`, clave ni
 * idempotencia todavía. En la fase C llevan `APLICAR_DESCUENTO` con `@ClaveDespuesDeValidar`,
 * `@IdempotenteObligatoria()` y `SALON` (el quitar, `ATENDER_MESA` y `SALON`).
 */
@Controller('cuentas/:ordenId/descuentos')
export class DescuentosController {
  constructor(@Inject(DescuentosService) private readonly descuentos: DescuentosService) {}

  /**
   * 201 `descuentoRespuesta`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` / `PROHIBIDO`; 404; 409
   * `CONFLICTO` / `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`; 422 `DESCUENTO_INVALIDO`.
   */
  @Post()
  aplicar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Body(new PipeZod(descuentoEntradaSchema)) entrada: DescuentoEntrada,
  ): Promise<DescuentoRespuesta> {
    return this.descuentos.aplicar(ordenId, entrada);
  }

  /** 204 (también si ya estaba quitado); 404; 409 `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`. */
  @Delete(':id')
  @HttpCode(204)
  quitar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Param('id', PipeUuid) id: string,
  ): Promise<void> {
    return this.descuentos.quitar(ordenId, id);
  }
}
