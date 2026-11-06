import { Body, Controller, Inject, Post } from '@nestjs/common';
import {
  notaCreditoEntradaSchema,
  type NotaCreditoEntradaValidada,
  type NotaCreditoRespuesta,
} from '@restaurante/contratos';
import { PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { ClaveDespuesDeValidar, Permiso, RequiereModulo } from '../seguridad';
import { NotasCreditoService } from './notas-credito.service';

/**
 * `POST /notas-credito` (historia 006, entrega 6b, criterios 143 a 157; ruta crítica P8). `EMITIR_NOTA_CREDITO` (el
 * Cajero necesita la clave de un supervisor atada a la nota; el Supervisor y el Administrador emiten sin ella; Mozo y
 * Cocina/Barra, 403 `PROHIBIDO`), módulo `FACTURACION` e `Idempotency-Key` obligatoria. No cuelga de ningún prefijo de 6a
 * (criterio 168).
 *
 * El orden de los decoradores fija el de los interceptores (de abajo hacia arriba): rol, módulo, idempotencia (la réplica
 * de la misma clave devuelve lo guardado sin consumir la autorización), `Idempotency-Key` obligatoria y, al final, la clave
 * del supervisor, que valida antes la entrada y consume la autorización en la transacción de la operación: si la nota falla
 * después, el consumo se revierte con ella y la autorización vuelve (criterio 145). Que la clave sea del objetivo exacto
 * (el total recalculado y lo devuelto) lo comprueba `EmisionService.prepararNotaCredito`.
 */
@Controller('notas-credito')
export class NotasCreditoController {
  constructor(@Inject(NotasCreditoService) private readonly notas: NotasCreditoService) {}

  /**
   * 201 `notaCreditoRespuesta`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` / `PROHIBIDO`; 404; 409
   * `COMPROBANTE_NO_ACEPTADO` / `COMPROBANTE_ANULADO` / `NOTA_CREDITO_CAMBIO` / `TURNO_CERRADO` / `TURNO_AJENO` /
   * `SIN_SERIE` / `SERIE_AGOTADA`; 422 `NOTA_CREDITO_INVALIDA` / `NADA_QUE_ACREDITAR` / `DEVOLUCION_INVALIDA` /
   * `CLIENTE_REQUERIDO` / `COMPROBANTE_NO_PERMITIDO` / `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
   */
  @Post()
  @ClaveDespuesDeValidar({ cuerpo: notaCreditoEntradaSchema })
  @IdempotenteObligatoria()
  @RequiereModulo('FACTURACION')
  @Permiso('EMITIR_NOTA_CREDITO')
  emitir(
    @Body(new PipeZod(notaCreditoEntradaSchema)) entrada: NotaCreditoEntradaValidada,
  ): Promise<NotaCreditoRespuesta> {
    return this.notas.emitir(entrada);
  }
}
