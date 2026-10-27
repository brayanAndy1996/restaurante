import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  cambiarContrasenaEntradaSchema,
  elegirSucursalEntradaSchema,
  recordarEquipoEntradaSchema,
  type CambiarContrasenaEntrada,
  type ElegirSucursalEntrada,
  type EquipoRecordadoRespuesta,
  type RecordarEquipoEntrada,
  type RecordarEquipoRespuesta,
  type SesionRespuesta,
} from '@restaurante/contratos';
import type { Response } from 'express';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { PermiteContrasenaTemporal } from './decoradores';
import { EquiposService } from './equipos.service';
import { SesionesService } from './sesiones.service';

/** Sesión actual de quien llama y sus equipos recordados. */
@Controller('sesion')
export class SesionController {
  constructor(
    @Inject(SesionesService) private readonly sesiones: SesionesService,
    @Inject(EquiposService) private readonly equipos: EquiposService,
  ) {}

  /** 200 `sesionRespuesta`. También con contraseña temporal. */
  @Get()
  @PermiteContrasenaTemporal()
  async actual(): Promise<SesionRespuesta> {
    return this.sesiones.sesionActual();
  }

  /** Sesiones de contraseña, PIN y soporte. 200 `sesionRespuesta`; 404 `NO_ENCONTRADO`. */
  @Put('sucursal')
  @HttpCode(200)
  async elegirSucursal(
    @Body(new PipeZod(elegirSucursalEntradaSchema)) entrada: ElegirSucursalEntrada,
  ): Promise<SesionRespuesta> {
    return this.sesiones.elegirSucursal(entrada);
  }

  /**
   * Solo sesiones de contraseña. 204; 400; 401 `CREDENCIALES_INVALIDAS`; 403; 429. Sin transacción del
   * interceptor: el servicio abre la suya para guardar los fallos.
   */
  @Put('contrasena')
  @SinEmpresa()
  @PermiteContrasenaTemporal()
  @HttpCode(204)
  async cambiarContrasena(
    @Body(new PipeZod(cambiarContrasenaEntradaSchema)) entrada: CambiarContrasenaEntrada,
  ): Promise<void> {
    return this.sesiones.cambiarContrasena(entrada);
  }

  /** 204: cierra la sesión y el token deja de valer. También con contraseña temporal. */
  @Delete()
  @PermiteContrasenaTemporal()
  @HttpCode(204)
  async salir(): Promise<void> {
    return this.sesiones.salir();
  }

  /**
   * Sesión de contraseña no temporal; `X-Equipo` opcional. 201 `{ equipo, tokenEquipo }` con un equipo nuevo
   * (el token solo se muestra aquí) / 200 `{ equipo }` con un equipo ya conocido; 403 `PROHIBIDO`; 409
   * `CONFLICTO`. Sin transacción del interceptor: el servicio abre la suya porque el actor de lo que escribe
   * lleva el equipo, que puede ser nuevo.
   */
  @Post('equipo')
  @SinEmpresa()
  async recordarEquipo(
    @Headers('x-equipo') equipo: string | undefined,
    @Body(new PipeZod(recordarEquipoEntradaSchema)) entrada: RecordarEquipoEntrada,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RecordarEquipoRespuesta> {
    const resultado = await this.equipos.recordar(entrada, equipo);
    respuesta.status(resultado.nuevo ? 201 : 200);
    return resultado.respuesta;
  }

  /** Sesiones de contraseña y PIN. 200 `equipoRecordadoRespuesta[]` con `actual`; 403 en soporte. */
  @Get('equipos')
  async misEquipos(): Promise<EquipoRecordadoRespuesta[]> {
    return this.equipos.listarPropios();
  }

  /** Sesiones de contraseña y PIN. 204; 404; 403 en soporte. Si es el equipo de la sesión, la cierra. */
  @Delete('equipos/:equipoRecordadoId')
  @HttpCode(204)
  async olvidarEquipo(
    @Param('equipoRecordadoId', PipeUuid) equipoRecordadoId: string,
  ): Promise<void> {
    return this.equipos.olvidar(equipoRecordadoId);
  }
}
