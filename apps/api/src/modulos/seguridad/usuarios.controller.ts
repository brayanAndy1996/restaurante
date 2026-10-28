import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
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
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { SoloAdministrador } from './decoradores';
import { EquiposService } from './equipos.service';
import { UsuariosService } from './usuarios.service';

/** Usuarios y accesos (RF-08): solo el Administrador (criterio 25).  */
@Controller('usuarios')
@SoloAdministrador()
export class UsuariosController {
  constructor(
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
    @Inject(EquiposService) private readonly equipos: EquiposService,
  ) {}

  @Get()
  async listar(): Promise<UsuarioRespuesta[]> {
    return this.usuarios.listar();
  }

  @Get(':id')
  async obtener(@Param('id', PipeUuid) id: string): Promise<UsuarioRespuesta> {
    return this.usuarios.obtener(id);
  }

  /** 201 con el `pin` (única vez que se muestra); 400; 409 `CONFLICTO`; 422 `SUCURSAL_INVALIDA`. */
  @Post()
  @SinEmpresa() // el servicio calcula el scrypt (por el cupo) y recién después abre la transacción
  async crear(
    @Body(new PipeZod(usuarioCrearEntradaSchema)) entrada: UsuarioCrearEntrada,
  ): Promise<UsuarioCreadoRespuesta> {
    return this.usuarios.crearDesdeSesion(entrada);
  }

  /** 200; trae `pin` solo si cambió su largo (criterio 21b); 409 `ULTIMO_ADMINISTRADOR`. */
  @Patch(':id')
  async modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(usuarioModificarEntradaSchema)) cambios: UsuarioModificarEntrada,
  ): Promise<UsuarioModificadoRespuesta> {
    return this.usuarios.modificar(id, cambios);
  }

  /** 200 `{ pin }`: PIN nuevo del largo vigente. */
  @Post(':id/pin')
  @HttpCode(200)
  async regenerarPin(@Param('id', PipeUuid) id: string): Promise<PinRespuesta> {
    return this.usuarios.regenerarPin(id);
  }

  /** 204: contraseña temporal nueva; cierra sesiones y revoca equipos. */
  @Post(':id/contrasena')
  @SinEmpresa() // el servicio calcula el scrypt (por el cupo) y recién después abre la transacción
  @HttpCode(204)
  async restablecerContrasena(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(restablecerContrasenaEntradaSchema)) entrada: RestablecerContrasenaEntrada,
  ): Promise<void> {
    return this.usuarios.restablecerDesdeSesion(id, entrada.contrasenaTemporal);
  }

  /** 200 `equipoRecordadoRespuesta[]`; 404. */
  @Get(':id/equipos')
  async equiposDe(@Param('id', PipeUuid) id: string): Promise<EquipoRecordadoRespuesta[]> {
    return this.equipos.listarDeUsuario(id);
  }

  /** 204; 404. Repetirlo responde 204 sin otro efecto ni otra auditoría. */
  @Delete(':id/equipos/:equipoRecordadoId')
  @HttpCode(204)
  async revocarEquipo(
    @Param('id', PipeUuid) id: string,
    @Param('equipoRecordadoId', PipeUuid) equipoRecordadoId: string,
  ): Promise<void> {
    return this.equipos.revocarUno(id, equipoRecordadoId);
  }

  /** 204: revoca todos los equipos del usuario; 404. */
  @Delete(':id/equipos')
  @HttpCode(204)
  async revocarEquipos(@Param('id', PipeUuid) id: string): Promise<void> {
    return this.equipos.revocarTodos(id);
  }
}
