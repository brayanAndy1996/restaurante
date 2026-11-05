import { Body, Controller, Delete, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  descuentoEntradaSchema,
  type DescuentoEntrada,
  type DescuentoRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { ClaveDespuesDeValidar, Permiso, RequiereModulo } from '../seguridad';
import { DescuentosService } from './descuentos.service';

/**
 * Descuentos (historia 006, criterios 38 a 46). Aplicar lleva `APLICAR_DESCUENTO` (con clave para el Mozo y el Cajero,
 * atada al objetivo exacto; el Supervisor y el Administrador aplican sin ella; Cocina/Barra, 403), `SALON` e
 * `Idempotency-Key` obligatoria. Quitar lleva `ATENDER_MESA` y `SALON`, sin clave ni `Idempotency-Key` (sube el monto).
 *
 * El orden de los decoradores fija el de los interceptores (de abajo hacia arriba): rol, módulo, idempotencia (la
 * réplica de la misma clave devuelve lo guardado sin consumir la autorización), `Idempotency-Key` obligatoria y, al
 * final, la clave del supervisor, que valida antes la entrada y consume la autorización en la transacción de la
 * operación (como la anulación de un ítem, 004).
 */
@Controller('cuentas/:ordenId/descuentos')
export class DescuentosController {
  constructor(@Inject(DescuentosService) private readonly descuentos: DescuentosService) {}

  /**
   * 201 `descuentoRespuesta`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` / `PROHIBIDO`; 404; 409
   * `CONFLICTO` / `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`; 422 `DESCUENTO_INVALIDO`.
   */
  @Post()
  @ClaveDespuesDeValidar({ cuerpo: descuentoEntradaSchema, uuids: ['ordenId'] })
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('APLICAR_DESCUENTO')
  aplicar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Body(new PipeZod(descuentoEntradaSchema)) entrada: DescuentoEntrada,
  ): Promise<DescuentoRespuesta> {
    return this.descuentos.aplicar(ordenId, entrada);
  }

  /** 204 (también si ya estaba quitado); 404; 409 `CUENTA_EN_COBRO` / `ORDEN_NO_ABIERTA`. */
  @Delete(':id')
  @HttpCode(204)
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  quitar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Param('id', PipeUuid) id: string,
  ): Promise<void> {
    return this.descuentos.quitar(ordenId, id);
  }
}
