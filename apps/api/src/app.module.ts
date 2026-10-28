import { DynamicModule, Module, Type } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ArchivosModule, type AlmacenArchivos } from './nucleo/archivos';
import { BaseDeDatosModule } from './nucleo/base-de-datos';
import { ContextoEmpresaModule } from './nucleo/contexto-empresa';
import { ErroresModule } from './nucleo/errores';
import { EventosModule, type PublicadorEventos } from './nucleo/eventos';
import { RelojModule, type Reloj } from './nucleo/reloj';
import { AuditoriaModule } from './modulos/auditoria';
import { CartaModule } from './modulos/carta';
import { PlataformaModule } from './modulos/plataforma';
import { SaludModule } from './modulos/salud';
import { SeguridadModule } from './modulos/seguridad';

export interface OpcionesAppModule {
  /** Controladores adicionales (las pruebas registran aquí un controlador sonda). */
  controladoresExtra?: Type[];
  /** Reloj de la aplicación; por defecto el del sistema. Las pruebas pasan un `RelojManual`. */
  reloj?: Reloj;
  /** Publicador de eventos en tiempo real (`PUBLICADOR_EVENTOS`); por defecto el `PublicadorNulo`. */
  publicadorEventos?: PublicadorEventos;
  /** Almacén de archivos (`ALMACEN_ARCHIVOS`); por defecto el de memoria hasta la tarea T10. */
  almacenArchivos?: AlmacenArchivos;
}

@Module({
  imports: [
    ConfigModule,
    ErroresModule,
    BaseDeDatosModule,
    ContextoEmpresaModule,
    PlataformaModule,
    AuditoriaModule,
    SeguridadModule,
    CartaModule,
    SaludModule,
  ],
})
export class AppModule {
  /** `AppModule` más controladores extra, que pueden inyectar `ContextoEmpresa` y los servicios. */
  static registrar(opciones: OpcionesAppModule = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RelojModule.registrar(opciones.reloj),
        EventosModule.registrar(opciones.publicadorEventos),
        ArchivosModule.registrar(opciones.almacenArchivos),
      ],
      controllers: opciones.controladoresExtra ?? [],
    };
  }
}
