import { Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { PuenteRespuesta, VinculacionRespuesta } from '@restaurante/contratos';
import { PipeUuid } from '../../nucleo/errores/pipes';
import { Permiso } from '../seguridad';
import { PuentesService } from './puentes.service';

/**
 * Vinculación y lista de puentes de la sucursal (historia 004, criterios 106 y 108): `ADMINISTRAR` en todas, con la
 * sucursal en la ruta (el Administrador configura cualquier sucursal de su empresa, con o sin sucursal activa), sin
 * `@RequiereModulo`.
 */
@Controller('sucursales/:sucursalId')
export class PuentesController {
  constructor(@Inject(PuentesService) private readonly puentes: PuentesService) {}

  /**
   * 201 `{ token, qr, expiraEn }`; 403; 404; 503 `CONFIGURACION_INCOMPLETA` sin `API_URL_PUBLICA`. Invalida los
   * códigos pendientes. No es idempotente a propósito: la respuesta lleva el secreto del código y la idempotencia
   * la guardaría; un reintento solo crea otro código e invalida el anterior.
   */
  @Post('vinculaciones-puente')
  @Permiso('ADMINISTRAR')
  crearVinculacion(
    @Param('sucursalId', PipeUuid) sucursalId: string,
  ): Promise<VinculacionRespuesta> {
    return this.puentes.crearVinculacion(sucursalId);
  }

  /** 200 con los puentes de la sucursal, activos y revocados; 403; 404. */
  @Get('puentes')
  @Permiso('ADMINISTRAR')
  listar(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<PuenteRespuesta[]> {
    return this.puentes.listar(sucursalId);
  }

  /** 204 (también si ya estaba revocado); 403; 404. */
  @Delete('puentes/:id')
  @Permiso('ADMINISTRAR')
  @HttpCode(204)
  async revocar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('id', PipeUuid) id: string,
  ): Promise<void> {
    await this.puentes.revocar(sucursalId, id);
  }
}
