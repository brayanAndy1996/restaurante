import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { RESOLUTOR_EMPRESA } from '../../nucleo/contexto-empresa';
import {
  ResolutorEmpresaPorCabecera,
  cabeceraHabilitada,
} from '../../nucleo/contexto-empresa/resolutor-empresa-por-cabecera';
import { AuditoriaModule } from '../auditoria';
import { AccesoSucursalController } from './acceso-sucursal.controller';
import { AutenticacionGuard, MODO_PRUEBA } from './autenticacion.guard';
import { AutorizacionesController } from './autorizaciones.controller';
import { AutorizacionService } from './autorizacion.service';
import { Credenciales } from './credenciales';
import { EquipoController } from './equipo.controller';
import { HorarioService } from './horario.service';
import { ResolutorEmpresaSesion } from './resolutor-empresa-sesion';
import { SesionActual } from './sesion-actual';
import { SesionController } from './sesion.controller';
import { SesionesController } from './sesiones.controller';
import { UsuariosController } from './usuarios.controller';

/**
 * Dueño de las tablas de acceso (`usuario`, `acceso_sucursal`, `sucursal_acceso`, `equipo`,
 * `equipo_recordado`, `sesion`, `autorizacion`, `bloqueo_intentos`) y del esquema `autenticacion`.
 *
 * Es global porque registra, para toda la aplicación: el guard de autenticación (`APP_GUARD`: toda ruta
 * exige sesión salvo las `@Publica()`) y el resolutor de empresa por sesión (`RESOLUTOR_EMPRESA`, que
 * lee el interceptor de contexto de empresa del núcleo). Provee también `Credenciales`, `HorarioService`
 * y `SesionActual`.
 */
@Global()
@Module({
  imports: [AuditoriaModule],
  controllers: [
    SesionesController,
    SesionController,
    EquipoController,
    UsuariosController,
    AutorizacionesController,
    AccesoSucursalController,
  ],
  providers: [
    Credenciales,
    HorarioService,
    ResolutorEmpresaSesion,
    { provide: RESOLUTOR_EMPRESA, useExisting: ResolutorEmpresaSesion },
    {
      provide: MODO_PRUEBA,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno): ResolutorEmpresaPorCabecera | null =>
        cabeceraHabilitada(entorno) ? new ResolutorEmpresaPorCabecera(entorno) : null,
    },
    AutenticacionGuard,
    { provide: APP_GUARD, useClass: AutenticacionGuard },
    SesionActual,
    AutorizacionService,
  ],
  exports: [
    Credenciales,
    HorarioService,
    ResolutorEmpresaSesion,
    RESOLUTOR_EMPRESA,
    AutenticacionGuard,
    SesionActual,
    AutorizacionService,
  ],
})
export class SeguridadModule {}
