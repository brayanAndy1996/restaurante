import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  sucursalConfigurarEntradaSchema,
  sucursalCrearEntradaSchema,
  type SucursalConfigurarEntrada,
  type SucursalRespuesta,
} from '@restaurante/contratos';
import type { z } from 'zod';
import { noImplementado } from '../../nucleo/errores';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { SoloAdministrador } from '../seguridad';
import { SucursalService } from './sucursal.service';

/**
 * Rutas de sucursal. Corren dentro del contexto de empresa que fija el interceptor global; en
 * producción responden 401 hasta que la historia 002 instale su resolutor. `POST` y `PATCH` son solo
 * para el Administrador (criterio 9; la marca `@SoloAdministrador()` la aplica el guard de la tarea
 * T10).
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

  /**
   * Solo Administrador. Crea la sucursal con suscripción en el plan por defecto y vencimiento el día del
   * alta (criterio 70). Con `Idempotency-Key` opcional. 201; 400; 403; 409. Lógica en la tarea T27.
   */
  @Post()
  @SoloAdministrador()
  @Idempotente()
  async crear(
    @Body(new PipeZod(sucursalCrearEntradaSchema))
    _entrada: z.output<typeof sucursalCrearEntradaSchema>,
  ): Promise<SucursalRespuesta> {
    return noImplementado();
  }

  @Patch(':id')
  @SoloAdministrador()
  async configurar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(sucursalConfigurarEntradaSchema)) cambios: SucursalConfigurarEntrada,
  ): Promise<SucursalRespuesta> {
    return this.sucursales.configurar(id, cambios);
  }
}
