import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import {
  configuracionPseEntradaSchema,
  type ConfiguracionPseEntrada,
  type ConfiguracionPseRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { ConfiguracionPseService } from './configuracion-pse.service';
import { Superadministrador } from './superadministrador.decorator';

/**
 * `GET` y `PUT /plataforma/empresas/:empresaId/emisores/:emisorId/pse` (historia 006, entrega 6b, criterios 122 y 123): solo
 * el superadministrador. Un emisor de otra empresa responde 404. Deja `configurar_pse_emisor` en `auditoria` (origen `plataforma`).
 */
@Controller('plataforma/empresas/:empresaId/emisores/:emisorId/pse')
@Superadministrador()
export class ConfiguracionPseController {
  constructor(
    @Inject(ConfiguracionPseService) private readonly configuracion: ConfiguracionPseService,
  ) {}

  /** 200 `configuracionPseRespuesta`; 404. */
  @Get()
  obtener(
    @Param('empresaId', PipeUuid) empresaId: string,
    @Param('emisorId', PipeUuid) emisorId: string,
  ): Promise<ConfiguracionPseRespuesta> {
    return this.configuracion.obtener(empresaId, emisorId);
  }

  /** 200 `configuracionPseRespuesta`; 400; 404; 409 `PSE_NO_CONFIGURADO` / `MODO_PSE_INVALIDO`. */
  @Put()
  configurar(
    @Param('empresaId', PipeUuid) empresaId: string,
    @Param('emisorId', PipeUuid) emisorId: string,
    @Body(new PipeZod(configuracionPseEntradaSchema)) entrada: ConfiguracionPseEntrada,
  ): Promise<ConfiguracionPseRespuesta> {
    return this.configuracion.configurar(empresaId, emisorId, entrada);
  }
}
