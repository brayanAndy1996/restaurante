import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  sucursalConfigurarEntradaSchema,
  type SucursalConfigurarEntrada,
  type SucursalRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores';
import { SucursalService } from './sucursal.service';

@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly sucursales: SucursalService) {}

  @Get()
  async listar(): Promise<SucursalRespuesta[]> {
    throw new Error('No implementado');
  }

  @Get(':id')
  async obtener(@Param('id', PipeUuid) _id: string): Promise<SucursalRespuesta> {
    throw new Error('No implementado');
  }

  @Patch(':id')
  async configurar(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(sucursalConfigurarEntradaSchema)) _cambios: SucursalConfigurarEntrada,
  ): Promise<SucursalRespuesta> {
    throw new Error('No implementado');
  }
}
