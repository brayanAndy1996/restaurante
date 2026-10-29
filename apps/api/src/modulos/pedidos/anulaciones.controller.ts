import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import {
  anularItemEntradaSchema,
  type AnulacionRespuesta,
  type AnularItemEntrada,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { ClaveDespuesDeValidar, Permiso, RequiereModulo } from '../seguridad';
import { AnulacionesService } from './anulaciones.service';

/**
 * Anular un ítem enviado (historia 004, criterios 34 a 41; ruta crítica P3). `ANULAR_ITEM_ENVIADO` (con clave
 * para Mozo y Cajero; el Supervisor y el Administrador anulan sin ella; Cocina/Barra, 403) y `SALON`, con
 * `Idempotency-Key` obligatoria.
 *
 * El orden de los decoradores fija el de los interceptores (de abajo hacia arriba): rol, módulo, idempotencia
 * (la réplica de la misma clave devuelve lo guardado sin pasar por la clave), `Idempotency-Key` obligatoria y, al
 * final, la clave del supervisor, que valida antes la entrada y consume la autorización en la transacción de la
 * anulación.
 */
@Controller('ordenes/:id/items/:itemId')
export class AnulacionesController {
  constructor(@Inject(AnulacionesService) private readonly anulaciones: AnulacionesService) {}

  /**
   * 201 `anulacionRespuesta`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` / `PROHIBIDO`; 404 (orden o
   * ítem de otra orden, de otra sucursal, de otra empresa o inexistente); 409 `ORDEN_NO_ABIERTA` o
   * `ITEM_NO_ANULABLE`; 422 `DATOS_INVALIDOS` (cantidad mayor que la vigente) o `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
   */
  @Post('anulaciones')
  @ClaveDespuesDeValidar({ cuerpo: anularItemEntradaSchema, uuids: ['id', 'itemId'] })
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('ANULAR_ITEM_ENVIADO')
  anular(
    @Param('id', PipeUuid) ordenId: string,
    @Param('itemId', PipeUuid) itemId: string,
    @Body(new PipeZod(anularItemEntradaSchema)) entrada: AnularItemEntrada,
  ): Promise<AnulacionRespuesta> {
    return this.anulaciones.anularItem(ordenId, itemId, entrada);
  }
}
