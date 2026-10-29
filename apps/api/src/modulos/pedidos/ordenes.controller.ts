import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  abrirOrdenEntradaSchema,
  anularOrdenEntradaSchema,
  ordenModificarEntradaSchema,
  type AbrirOrdenEntrada,
  type AnularOrdenEntrada,
  type OrdenModificarEntrada,
  type OrdenRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { ClaveDespuesDeValidar, Permiso, RequiereModulo } from '../seguridad';
import { AnulacionesService } from './anulaciones.service';
import { OrdenesService } from './ordenes.service';

/**
 * Órdenes: abrir, consultar, comensales, mover, unir, anular y liberar (historia 004, criterios 9 a 13, 42 a
 * 49 y 55). Abrir, consultar, cambiar los comensales y liberar la mesa llevan `ATENDER_MESA` y `SALON`; anular la
 * orden, `ANULAR_ORDEN` (con clave para Mozo y Cajero) y `SALON`; el movimiento y la unión siguen como firmas de
 * la fase A (sin `@Permiso` ni `@RequiereModulo` hasta su tarea: `MOVER_UNIR_MESAS`).
 */
@Controller('ordenes')
export class OrdenesController {
  constructor(
    @Inject(OrdenesService) private readonly ordenes: OrdenesService,
    @Inject(AnulacionesService) private readonly anulaciones: AnulacionesService,
  ) {}

  /**
   * 201 `ordenRespuesta`; 400 (con `Idempotency-Key` obligatoria); 403; 404 (mesa); 409 `MESA_OCUPADA` con
   * `ordenId` o `CONFLICTO` (mesa inactiva); 422 `REFERENCIA_INVALIDA` (`mozoId`) o `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
   */
  @Post()
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  abrir(
    @Body(new PipeZod(abrirOrdenEntradaSchema)) entrada: AbrirOrdenEntrada,
  ): Promise<OrdenRespuesta> {
    return this.ordenes.abrir(entrada);
  }

  /** 200 `ordenRespuesta`; 403; 404 (de otra sucursal, de otra empresa o inexistente). */
  @Get(':id')
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  consultar(@Param('id', PipeUuid) id: string): Promise<OrdenRespuesta> {
    return this.ordenes.consultar(id);
  }

  /** 200 `ordenRespuesta`; 400; 403; 404; 409 `ORDEN_NO_ABIERTA`. */
  @Patch(':id')
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(ordenModificarEntradaSchema)) entrada: OrdenModificarEntrada,
  ): Promise<OrdenRespuesta> {
    return this.ordenes.modificarComensales(id, entrada);
  }

  @Post(':id/movimiento')
  mover(): never {
    throw noImplementado();
  }

  @Post(':id/union')
  unir(): never {
    throw noImplementado();
  }

  /**
   * 200 `ordenRespuesta` con la orden `ANULADA`; 400; 403 `CLAVE_REQUERIDA` / `AUTORIZACION_INVALIDA` /
   * `PROHIBIDO`; 404; 409 `ORDEN_NO_ABIERTA`. Con `Idempotency-Key` obligatoria; la clave del supervisor se pide
   * después de la idempotencia y de validar la entrada (la réplica de la misma clave no la consume de nuevo).
   */
  @Post(':id/anulacion')
  @HttpCode(200)
  @ClaveDespuesDeValidar({ cuerpo: anularOrdenEntradaSchema, uuids: ['id'] })
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('ANULAR_ORDEN')
  anular(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(anularOrdenEntradaSchema)) entrada: AnularOrdenEntrada,
  ): Promise<OrdenRespuesta> {
    return this.anulaciones.anularOrden(id, entrada);
  }

  /**
   * 200 `ordenRespuesta` con la orden `ANULADA` y `sinConsumo`, sin clave (decisión 7); 400; 403; 404; 409
   * `ORDEN_CON_CONSUMO` u `ORDEN_NO_ABIERTA`. Con `Idempotency-Key` obligatoria.
   */
  @Post(':id/liberacion')
  @HttpCode(200)
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  liberar(@Param('id', PipeUuid) id: string): Promise<OrdenRespuesta> {
    return this.ordenes.liberar(id);
  }
}
