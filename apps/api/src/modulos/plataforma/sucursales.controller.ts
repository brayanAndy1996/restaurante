import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import {
  sucursalConfigurarEntradaSchema,
  type SucursalConfigurarEntrada,
  type SucursalRespuesta,
} from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { SucursalService } from './sucursal.service';

/**
 * Rutas de sucursal. Corren dentro del contexto de empresa que fija el interceptor global; en
 * producción responden 401 hasta que la historia 002 instale su resolutor. La historia 002 también
 * exigirá el rol Administrador en `PATCH`.
 */
@Controller('sucursales')
export class SucursalesController {
  constructor(@Inject(SucursalService) private readonly sucursales: SucursalService) {}

  @Get()
  async listar(): Promise<SucursalRespuesta[]> {
    return this.sucursales.listar();
  }

  @Get(':id')
  async obtener(@Param('id', PipeUuid) id: string): Promise<SucursalRespuesta> {
    const sucursal = await this.sucursales.obtener(id);
    if (!sucursal) throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
    return sucursal;
  }

  @Patch(':id')
  async configurar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(sucursalConfigurarEntradaSchema)) cambios: SucursalConfigurarEntrada,
  ): Promise<SucursalRespuesta> {
    return this.sucursales.configurar(id, cambios);
  }
}
