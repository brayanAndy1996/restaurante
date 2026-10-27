import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  restablecerContrasenaEntradaSchema,
  usuarioCrearEntradaSchema,
  usuarioModificarEntradaSchema,
  type EquipoRecordadoRespuesta,
  type PinRespuesta,
  type RestablecerContrasenaEntrada,
  type UsuarioCrearEntrada,
  type UsuarioCreadoRespuesta,
  type UsuarioModificadoRespuesta,
  type UsuarioModificarEntrada,
  type UsuarioRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { SoloAdministrador } from './decoradores';

/** Usuarios y accesos (RF-08): solo el Administrador (criterio 25). Lógica en las tareas T13 y T33. */
@Controller('usuarios')
@SoloAdministrador()
export class UsuariosController {
  @Get()
  async listar(): Promise<UsuarioRespuesta[]> {
    return noImplementado();
  }

  @Get(':id')
  async obtener(@Param('id', PipeUuid) _id: string): Promise<UsuarioRespuesta> {
    return noImplementado();
  }

  /** 201 con el `pin` (única vez que se muestra); 400; 409 `CONFLICTO`; 422 `SUCURSAL_INVALIDA`. */
  @Post()
  async crear(
    @Body(new PipeZod(usuarioCrearEntradaSchema)) _entrada: UsuarioCrearEntrada,
  ): Promise<UsuarioCreadoRespuesta> {
    return noImplementado();
  }

  /** 200; trae `pin` solo si cambió su largo (criterio 21b); 409 `ULTIMO_ADMINISTRADOR`. */
  @Patch(':id')
  async modificar(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(usuarioModificarEntradaSchema)) _cambios: UsuarioModificarEntrada,
  ): Promise<UsuarioModificadoRespuesta> {
    return noImplementado();
  }

  /** 200 `{ pin }`: PIN nuevo del largo vigente. */
  @Post(':id/pin')
  @HttpCode(200)
  async regenerarPin(@Param('id', PipeUuid) _id: string): Promise<PinRespuesta> {
    return noImplementado();
  }

  /** 204: contraseña temporal nueva; cierra sesiones y revoca equipos. */
  @Post(':id/contrasena')
  @HttpCode(204)
  async restablecerContrasena(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(restablecerContrasenaEntradaSchema)) _entrada: RestablecerContrasenaEntrada,
  ): Promise<void> {
    return noImplementado();
  }

  /** 200 `equipoRecordadoRespuesta[]`; 404. */
  @Get(':id/equipos')
  async equipos(@Param('id', PipeUuid) _id: string): Promise<EquipoRecordadoRespuesta[]> {
    return noImplementado();
  }

  /** 204; 404. */
  @Delete(':id/equipos/:equipoRecordadoId')
  @HttpCode(204)
  async revocarEquipo(
    @Param('id', PipeUuid) _id: string,
    @Param('equipoRecordadoId', PipeUuid) _equipoRecordadoId: string,
  ): Promise<void> {
    return noImplementado();
  }

  /** 204: revoca todos los equipos del usuario; 404. */
  @Delete(':id/equipos')
  @HttpCode(204)
  async revocarEquipos(@Param('id', PipeUuid) _id: string): Promise<void> {
    return noImplementado();
  }
}
