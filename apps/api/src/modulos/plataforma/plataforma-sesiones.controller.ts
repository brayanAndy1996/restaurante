import { Body, Controller, Delete, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ingresoSuperadministradorEntradaSchema,
  type IngresoSuperadministradorEntrada,
  type IngresoSuperadministradorRespuesta,
} from '@restaurante/contratos';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Publica } from '../seguridad';
import { Superadministrador, SuperadministradorActual } from './superadministrador.decorator';
import { SuperadministradoresService } from './superadministradores.service';
import type { SuperadministradorAutenticado } from './tipos';

/** Sesiones del superadministrador (criterios 61 y 62). */
@Controller('plataforma')
export class PlataformaSesionesController {
  constructor(
    @Inject(SuperadministradoresService)
    private readonly superadministradores: SuperadministradoresService,
  ) {}

  /** Pública. 201 `{ token, superadministrador }`; 401 `CREDENCIALES_INVALIDAS`; 429 `BLOQUEO_TEMPORAL`. */
  @Post('sesiones')
  @Publica()
  async ingresar(
    @Body(new PipeZod(ingresoSuperadministradorEntradaSchema))
    entrada: IngresoSuperadministradorEntrada,
  ): Promise<IngresoSuperadministradorRespuesta> {
    return this.superadministradores.ingresar(entrada);
  }

  /** 204: cierra la sesión del superadministrador. */
  @Delete('sesion')
  @Superadministrador()
  @HttpCode(204)
  async salir(
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
  ): Promise<void> {
    return this.superadministradores.salir(superadministrador);
  }
}
