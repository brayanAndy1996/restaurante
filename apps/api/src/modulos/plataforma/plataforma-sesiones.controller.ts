import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import {
  ingresoSuperadministradorEntradaSchema,
  type IngresoSuperadministradorEntrada,
  type IngresoSuperadministradorRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Publica } from '../seguridad';
import { Superadministrador } from './superadministrador.decorator';

/** Sesiones del superadministrador (criterios 61 y 62). Lógica en la tarea T15. */
@Controller('plataforma')
export class PlataformaSesionesController {
  /** Pública. 201 `{ token, superadministrador }`; 401 `CREDENCIALES_INVALIDAS`; 429 `BLOQUEO_TEMPORAL`. */
  @Post('sesiones')
  @Publica()
  async ingresar(
    @Body(new PipeZod(ingresoSuperadministradorEntradaSchema))
    _entrada: IngresoSuperadministradorEntrada,
  ): Promise<IngresoSuperadministradorRespuesta> {
    return noImplementado();
  }

  /** 204: cierra la sesión del superadministrador. */
  @Delete('sesion')
  @Superadministrador()
  @HttpCode(204)
  async salir(): Promise<void> {
    return noImplementado();
  }
}
