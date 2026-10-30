import { DynamicModule, Module, Type } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ArchivosModule, type AlmacenArchivos } from './nucleo/archivos';
import { BaseDeDatosModule } from './nucleo/base-de-datos';
import { ContextoEmpresaModule } from './nucleo/contexto-empresa';
import { ErroresModule } from './nucleo/errores';
import { EventosModule, type PublicadorEventos } from './nucleo/eventos';
import { PublicadorSocketIo, TiempoRealModule } from './nucleo/tiempo-real';
import { RelojModule, type Reloj } from './nucleo/reloj';
import { AuditoriaModule } from './modulos/auditoria';
import { CartaModule } from './modulos/carta';
import { ImpresionModule } from './modulos/impresion';
import { InventarioModule, PedidosModule, type InventarioPuerto } from './modulos/pedidos';
import { PlataformaModule } from './modulos/plataforma';
import { SaludModule } from './modulos/salud';
import { SalonModule } from './modulos/salon';
import { SeguridadModule } from './modulos/seguridad';

export interface OpcionesAppModule {
  /** Controladores adicionales (las pruebas registran aquí un controlador sonda). */
  controladoresExtra?: Type[];
  /** Reloj de la aplicación; por defecto el del sistema. Las pruebas pasan un `RelojManual`. */
  reloj?: Reloj;
  /** Publicador de eventos en tiempo real (`PUBLICADOR_EVENTOS`); por defecto el `PublicadorNulo`. */
  publicadorEventos?: PublicadorEventos;
  /** Almacén de archivos (`ALMACEN_ARCHIVOS`); por defecto el que elige el entorno (`ARCHIVOS_DRIVER`: memoria, disco o R2). */
  almacenArchivos?: AlmacenArchivos;
  /** Puerto de inventario (`INVENTARIO`); por defecto el `InventarioNulo`. Las pruebas pasan un `InventarioDePrueba`. */
  inventario?: InventarioPuerto;
  /** Si la API sirve Socket.IO; por defecto no (`crearAplicacion` lo decide con `TIEMPO_REAL` del entorno). */
  tiempoReal?: { habilitado: boolean };
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
    SalonModule,
    PedidosModule,
    ImpresionModule,
    SaludModule,
  ],
})
export class AppModule {
  /** `AppModule` más controladores extra, que pueden inyectar `ContextoEmpresa` y los servicios. */
  static registrar(opciones: OpcionesAppModule = {}): DynamicModule {
    const tiempoReal = opciones.tiempoReal?.habilitado ?? false;
    return {
      module: AppModule,
      imports: [
        RelojModule.registrar(opciones.reloj),
        // Con el tiempo real habilitado y sin un publicador de prueba, los eventos van por Socket.IO.
        EventosModule.registrar(
          opciones.publicadorEventos,
          tiempoReal ? PublicadorSocketIo : undefined,
        ),
        ArchivosModule.registrar(opciones.almacenArchivos),
        InventarioModule.registrar(opciones.inventario),
        TiempoRealModule.registrar({ habilitado: tiempoReal }),
      ],
      controllers: opciones.controladoresExtra ?? [],
    };
  }
}
