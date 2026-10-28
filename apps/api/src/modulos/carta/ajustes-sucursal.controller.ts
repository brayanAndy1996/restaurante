import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import {
  ajusteSucursalEntradaSchema,
  type AjusteSucursalEntrada,
  type AjusteSucursalRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Permiso } from '../seguridad';
import { AjustesSucursalService } from './ajustes-sucursal.service';

/**
 * Precio y disponibilidad de un producto por sucursal (criterios 18 a 23 y 19b): `EDITAR_CARTA` con el rol
 * de la sucursal activa (el Administrador y el Cajero). El `PUT` exige además `EDITAR_CARTA` permitido con el
 * rol de la persona en la sucursal ajustada (`PermisosCarta`, después del 404).
 */
@Controller('carta/productos/:id/sucursales')
export class AjustesSucursalController {
  constructor(@Inject(AjustesSucursalService) private readonly ajustes: AjustesSucursalService) {}

  /** 200 `ajusteSucursalRespuesta[]` de todas las sucursales de la empresa; 403; 404. */
  @Get()
  @Permiso('EDITAR_CARTA')
  listar(@Param('id', PipeUuid) id: string): Promise<AjusteSucursalRespuesta[]> {
    return this.ajustes.listar(id);
  }

  /** 200; 400; 403 (`PROHIBIDO`, también en una sucursal donde no es Cajero); 404 (producto o sucursal). */
  @Put(':sucursalId')
  @Permiso('EDITAR_CARTA')
  ajustar(
    @Param('id', PipeUuid) id: string,
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(ajusteSucursalEntradaSchema)) entrada: AjusteSucursalEntrada,
  ): Promise<AjusteSucursalRespuesta> {
    return this.ajustes.ajustar(id, sucursalId, entrada);
  }
}
