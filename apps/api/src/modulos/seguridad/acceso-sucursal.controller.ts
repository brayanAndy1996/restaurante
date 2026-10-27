import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import {
  sucursalAccesoEntradaSchema,
  type SucursalAccesoEntrada,
  type SucursalAccesoRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { AccesoSucursalService } from './acceso-sucursal.service';
import { SoloAdministrador } from './decoradores';

/** Minutos de inactividad de las sesiones PIN de una sucursal (criterio 40): solo el Administrador. */
@Controller('sucursales/:id/acceso')
@SoloAdministrador()
export class AccesoSucursalController {
  constructor(@Inject(AccesoSucursalService) private readonly acceso: AccesoSucursalService) {}

  /** 200 `{ sucursalId, minutosInactividad }` (5 si no se configuró); 404. */
  @Get()
  async obtener(@Param('id', PipeUuid) id: string): Promise<SucursalAccesoRespuesta> {
    return this.acceso.obtener(id.toLowerCase());
  }

  /** 200 con el valor nuevo; 400 fuera de 1 a 120; 404. Se audita. */
  @Patch()
  async configurar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(sucursalAccesoEntradaSchema)) entrada: SucursalAccesoEntrada,
  ): Promise<SucursalAccesoRespuesta> {
    return this.acceso.configurar(id.toLowerCase(), entrada.minutosInactividad);
  }
}
