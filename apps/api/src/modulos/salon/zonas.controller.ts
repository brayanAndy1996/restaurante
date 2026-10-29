import { Body, Controller, Get, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ordenEntradaSchema,
  zonaEntradaSchema,
  zonaModificarEntradaSchema,
  type OrdenEntrada,
  type ZonaEntrada,
  type ZonaModificarEntrada,
  type ZonaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { ZonasService } from './zonas.service';

/**
 * Zonas del salón (historia 004, criterios 1, 2, 5 y 6): `ADMINISTRAR` en todas, con la sucursal en la ruta (el
 * Administrador configura cualquier sucursal de su empresa, con o sin sucursal activa), sin `@RequiereModulo`:
 * las rutas de configuración no dependen del plan, como la carta.
 */
@Controller('sucursales/:sucursalId/zonas')
export class ZonasController {
  constructor(@Inject(ZonasService) private readonly zonas: ZonasService) {}

  /** 200 con las zonas en su orden y todas sus mesas; 403; 404. */
  @Get()
  @Permiso('ADMINISTRAR')
  listar(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<ZonaRespuesta[]> {
    return this.zonas.listar(sucursalId);
  }

  /** 201; 400; 403; 404; 409 `CONFLICTO`. Con `Idempotency-Key` opcional. */
  @Post()
  @Idempotente()
  @Permiso('ADMINISTRAR')
  crear(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(zonaEntradaSchema)) entrada: ZonaEntrada,
  ): Promise<ZonaRespuesta> {
    return this.zonas.crear(sucursalId, entrada);
  }

  /** 200 con las zonas en el orden nuevo; 400 con un id faltante, repetido, inexistente o de otra empresa. */
  @Put('orden')
  @Permiso('ADMINISTRAR')
  ordenar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(ordenEntradaSchema)) entrada: OrdenEntrada,
  ): Promise<ZonaRespuesta[]> {
    return this.zonas.ordenar(sucursalId, entrada);
  }

  /** 200; 400; 403; 404; 409 `CONFLICTO` (nombre o mesas fuera de la cuadrícula) o `EN_USO`. */
  @Patch(':id')
  @Permiso('ADMINISTRAR')
  modificar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(zonaModificarEntradaSchema)) cambios: ZonaModificarEntrada,
  ): Promise<ZonaRespuesta> {
    return this.zonas.modificar(sucursalId, id, cambios);
  }
}
