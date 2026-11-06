import { DynamicModule, Module, Type } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import {
  AlmacenComprobantesModule,
  ArchivosModule,
  type AlmacenArchivos,
  type AlmacenComprobantes,
} from './nucleo/archivos';
import { CifradoModule } from './nucleo/cifrado';
import { ColasModule, type ColaPse } from './nucleo/colas';
import { BaseDeDatosModule } from './nucleo/base-de-datos';
import { ContextoEmpresaModule } from './nucleo/contexto-empresa';
import { ErroresModule } from './nucleo/errores';
import { EventosModule, type PublicadorEventos } from './nucleo/eventos';
import { PublicadorSocketIo, TiempoRealModule } from './nucleo/tiempo-real';
import { RelojModule, type Reloj } from './nucleo/reloj';
import { AuditoriaModule } from './modulos/auditoria';
import { CajaModule } from './modulos/caja';
import { CartaModule } from './modulos/carta';
import { CartaWebModule } from './modulos/carta-web';
import {
  FacturacionModule,
  OpcionesWorkerModule,
  type OpcionesWorker,
} from './modulos/facturacion';
import { ConectorPseModule, type ConectorPse } from './modulos/facturacion/pse';
import { ImpresionModule } from './modulos/impresion';
import { LlamadosModule } from './modulos/llamados';
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
  /**
   * Conector del PSE (`CONECTOR_PSE`, historia 006 6b): reemplaza el conector para todos los modos de los emisores. Por
   * defecto un `SimuladorPse`. Las pruebas pasan uno con sus reglas.
   */
  pse?: ConectorPse;
  /** Cola de envíos al PSE (`COLA_PSE`); por defecto la que elige el entorno. Las pruebas pasan una `ColaEnMemoria`. */
  colaPse?: ColaPse;
  /** Almacén privado de comprobantes (`ALMACEN_COMPROBANTES`); por defecto el del entorno. */
  almacenComprobantes?: AlmacenComprobantes;
  /** Si la API sirve Socket.IO; por defecto no (`crearAplicacion` lo decide con `TIEMPO_REAL` del entorno). */
  tiempoReal?: { habilitado: boolean };
  /**
   * Si este proceso trabaja en segundo plano (historia 006, criterio 125): `autoIniciar` para `WORKER=habilitado` dentro
   * de la API y `mantenimientoDeCola` para el mantenimiento de pg-boss. Por defecto ninguno (la API de las pruebas).
   */
  worker?: OpcionesWorker;
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
    FacturacionModule,
    CajaModule,
    CartaWebModule,
    LlamadosModule,
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
        CifradoModule,
        OpcionesWorkerModule.registrar(
          opciones.worker ?? { autoIniciar: false, mantenimientoDeCola: false },
        ),
        ColasModule.registrar(opciones.colaPse, {
          mantenimiento: opciones.worker?.mantenimientoDeCola ?? false,
        }),
        AlmacenComprobantesModule.registrar(opciones.almacenComprobantes),
        ConectorPseModule.registrar(opciones.pse),
        TiempoRealModule.registrar({ habilitado: tiempoReal }),
      ],
      controllers: opciones.controladoresExtra ?? [],
    };
  }
}
