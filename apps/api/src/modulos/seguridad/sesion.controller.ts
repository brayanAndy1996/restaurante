import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
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
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { noImplementado } from '../../nucleo/errores';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { PermiteContrasenaTemporal } from './decoradores';

/** Sesión actual de quien llama y sus equipos recordados. Lógica en las tareas T12 y T33. */
@Controller('sesion')
export class SesionController {
  /** 200 `sesionRespuesta`. También con contraseña temporal. */
  @Get()
  @PermiteContrasenaTemporal()
  async actual(): Promise<SesionRespuesta> {
    return noImplementado();
  }

  /** Sesiones de contraseña, PIN y soporte. 200 `sesionRespuesta`; 404 `NO_ENCONTRADO`. */
  @Put('sucursal')
  async elegirSucursal(
    @Body(new PipeZod(elegirSucursalEntradaSchema)) _entrada: ElegirSucursalEntrada,
  ): Promise<SesionRespuesta> {
    return noImplementado();
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
    @Body(new PipeZod(cambiarContrasenaEntradaSchema)) _entrada: CambiarContrasenaEntrada,
  ): Promise<void> {
    return noImplementado();
  }

  /** 204: cierra la sesión y el token deja de valer. También con contraseña temporal. */
  @Delete()
  @PermiteContrasenaTemporal()
  @HttpCode(204)
  async salir(): Promise<void> {
    return noImplementado();
  }

  /** Sesión de contraseña no temporal; `X-Equipo` opcional. 201 `{ equipo, tokenEquipo }` / 200 `{ equipo }`; 403; 409. */
  @Post('equipo')
  async recordarEquipo(
    @Body(new PipeZod(recordarEquipoEntradaSchema)) _entrada: RecordarEquipoEntrada,
  ): Promise<RecordarEquipoRespuesta> {
    return noImplementado();
  }

  /** Sesiones de contraseña y PIN. 200 `equipoRecordadoRespuesta[]` con `actual`. */
  @Get('equipos')
  async equipos(): Promise<EquipoRecordadoRespuesta[]> {
    return noImplementado();
  }

  /** Sesiones de contraseña y PIN. 204; 404. */
  @Delete('equipos/:equipoRecordadoId')
  @HttpCode(204)
  async olvidarEquipo(
    @Param('equipoRecordadoId', PipeUuid) _equipoRecordadoId: string,
  ): Promise<void> {
    return noImplementado();
  }
}
