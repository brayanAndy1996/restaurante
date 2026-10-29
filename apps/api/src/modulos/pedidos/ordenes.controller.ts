import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  abrirOrdenEntradaSchema,
  anularOrdenEntradaSchema,
  moverEntradaSchema,
  ordenModificarEntradaSchema,
  unirEntradaSchema,
  type AbrirOrdenEntrada,
  type AnularOrdenEntrada,
  type MoverEntrada,
  type OrdenModificarEntrada,
  type OrdenRespuesta,
  type UnirEntrada,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { ClaveDespuesDeValidar, Permiso, RequiereModulo } from '../seguridad';
import { AnulacionesService } from './anulaciones.service';
import { MovimientosService } from './movimientos.service';
import { OrdenesService } from './ordenes.service';

/**
 * Órdenes: abrir, consultar, comensales, mover, unir, anular y liberar (historia 004, criterios 9 a 13, 42 a
 * 49 y 55). Abrir, consultar, cambiar los comensales y liberar la mesa llevan `ATENDER_MESA` y `SALON`; anular la
 * orden, `ANULAR_ORDEN` (con clave para Mozo y Cajero) y `SALON`; mover y unir mesas, `MOVER_UNIR_MESAS` y `SALON`.
 */
@Controller('ordenes')
export class OrdenesController {
  constructor(
    @Inject(OrdenesService) private readonly ordenes: OrdenesService,
    @Inject(AnulacionesService) private readonly anulaciones: AnulacionesService,
    @Inject(MovimientosService) private readonly movimientos: MovimientosService,
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

  /**
   * 200 `ordenRespuesta` (también si la orden ya está en la mesa de destino); 400 (`mesaOrigenId` obligatoria si
   * la orden tiene varias mesas); 403; 404 (orden o mesa de otra sucursal, de otra empresa o inexistente);
   * 409 `ORDEN_NO_ABIERTA`, `MESA_OCUPADA` (con `ordenId`) o `CONFLICTO` (mesa inactiva); 422
   * `REFERENCIA_INVALIDA` (la mesa de origen no es de la orden).
   */
  @Post(':id/movimiento')
  @HttpCode(200)
  @RequiereModulo('SALON')
  @Permiso('MOVER_UNIR_MESAS')
  mover(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(moverEntradaSchema)) entrada: MoverEntrada,
  ): Promise<OrdenRespuesta> {
    return this.movimientos.mover(id, entrada);
  }

  /**
   * 200 `ordenRespuesta` (también si no queda ninguna mesa por unir); 400; 403; 404; 409 `ORDEN_NO_ABIERTA` o
   * `CONFLICTO` (mesa inactiva o una carrera con otra operación, que se puede repetir); 422 `DATOS_INVALIDOS`
   * (la orden pasaría de 20 mesas).
   */
  @Post(':id/union')
  @HttpCode(200)
  @RequiereModulo('SALON')
  @Permiso('MOVER_UNIR_MESAS')
  unir(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(unirEntradaSchema)) entrada: UnirEntrada,
  ): Promise<OrdenRespuesta> {
    return this.movimientos.unir(id, entrada);
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
