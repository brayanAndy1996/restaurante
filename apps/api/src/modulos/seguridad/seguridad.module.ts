import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { AccesoSucursalController } from './acceso-sucursal.controller';
import { AutenticacionGuard } from './autenticacion.guard';
import { AutorizacionesController } from './autorizaciones.controller';
import { AutorizacionService } from './autorizacion.service';
import { EquipoController } from './equipo.controller';
import { ResolutorEmpresaSesion } from './resolutor-empresa-sesion';
import { SesionActual } from './sesion-actual';
import { SesionController } from './sesion.controller';
import { SesionesController } from './sesiones.controller';
import { UsuariosController } from './usuarios.controller';

/**
 * Dueño de las tablas de acceso (`usuario`, `acceso_sucursal`, `sucursal_acceso`, `equipo`,
 * `equipo_recordado`, `sesion`, `autorizacion`, `bloqueo_intentos`) y del esquema `autenticacion`.
 * Fase A de la historia 002: solo las firmas y las rutas; todavía no hay tablas, guard registrado ni
 * lógica.
 */
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
  providers: [AutenticacionGuard, ResolutorEmpresaSesion, SesionActual, AutorizacionService],
  exports: [AutenticacionGuard, ResolutorEmpresaSesion, SesionActual, AutorizacionService],
})
export class SeguridadModule {}
