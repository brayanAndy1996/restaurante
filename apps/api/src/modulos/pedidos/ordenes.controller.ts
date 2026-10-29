import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  abrirOrdenEntradaSchema,
  ordenModificarEntradaSchema,
  type AbrirOrdenEntrada,
  type OrdenModificarEntrada,
  type OrdenRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { OrdenesService } from './ordenes.service';

/**
 * Órdenes: abrir, consultar, comensales, mover, unir, anular y liberar (historia 004, criterios 9 a 13, 42 a
 * 49 y 55). Abrir, consultar y cambiar los comensales llevan `ATENDER_MESA` y `SALON`; el movimiento, la unión,
 * la anulación y la liberación siguen como firmas de la fase A (sin `@Permiso` ni `@RequiereModulo` hasta sus
 * tareas: `MOVER_UNIR_MESAS` en el movimiento y la unión; `ANULAR_ORDEN` en la anulación).
 */
@Controller('ordenes')
export class OrdenesController {
  constructor(@Inject(OrdenesService) private readonly ordenes: OrdenesService) {}

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

  @Post(':id/anulacion')
  anular(): never {
    throw noImplementado();
  }

  @Post(':id/liberacion')
  liberar(): never {
    throw noImplementado();
  }
}
