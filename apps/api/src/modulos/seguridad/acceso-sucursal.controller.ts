import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  sucursalAccesoEntradaSchema,
  type SucursalAccesoEntrada,
  type SucursalAccesoRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { SoloAdministrador } from './decoradores';

/** Minutos de inactividad de las sesiones PIN de una sucursal (criterio 40). Lógica en la tarea T34. */
@Controller('sucursales/:id/acceso')
@SoloAdministrador()
export class AccesoSucursalController {
  @Get()
  async obtener(@Param('id', PipeUuid) _id: string): Promise<SucursalAccesoRespuesta> {
    return noImplementado();
  }

  @Patch()
  async configurar(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(sucursalAccesoEntradaSchema)) _entrada: SucursalAccesoEntrada,
  ): Promise<SucursalAccesoRespuesta> {
    return noImplementado();
  }
}
