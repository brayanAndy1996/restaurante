import { Global, Module } from '@nestjs/common';
import { VALIDADOR_DE_PUENTE } from '../../nucleo/tiempo-real';
import { AuditoriaModule } from '../auditoria';
import { CartaModule } from '../carta';
import { IMPRESION } from '../pedidos/impresion';
import { SeguridadModule } from '../seguridad';
import { AutenticacionPuenteService } from './autenticacion-puente.service';
import { ColaImpresionService } from './cola-impresion.service';
import { DestinosController } from './destinos.controller';
import { DestinosService } from './destinos.service';
import { EstadoImpresionService } from './estado-impresion.service';
import { EventosImpresion } from './eventos-impresion';
import { ImpresionController } from './impresion.controller';
import { ImpresorasController } from './impresoras.controller';
import { ImpresorasService } from './impresoras.service';
import { OrdenesVigentes } from './ordenes-vigentes';
import { PuenteController } from './puente.controller';
import { PuenteGuard, VinculacionGuard } from './puente.guard';
import { PuentesController } from './puentes.controller';
import { PuentesService } from './puentes.service';
import { SenalPuenteService } from './senal-puente.service';
import { TrabajosService } from './trabajos.service';

/**
 * Impresión (historia 004, entrega 3b): dueño de `impresora`, `estacion_destino`, `impresion_sucursal`
 * (migración `202610310001-impresion`), `vinculacion_puente`, `puente` y `trabajo_impresion` (migración
 * `202610310002-puente`). Provee el puerto `IMPRESION` que usa `PedidosModule` (que importa este módulo; este no
 * importa pedidos) y no consulta tablas ajenas: las estaciones las lee con `CartaConsultaService`, las sucursales
 * con `SucursalesConsultaService` y el rol con `SeguridadModule`.
 *
 * Es global porque provee `VALIDADOR_DE_PUENTE` al servidor de Socket.IO del núcleo (el espacio `/puente`), igual
 * que `SeguridadModule` provee el validador de las sesiones.
 */
@Global()
@Module({
  imports: [AuditoriaModule, CartaModule, SeguridadModule],
  controllers: [
    ImpresorasController,
    DestinosController,
    PuentesController,
    ImpresionController,
    PuenteController,
  ],
  providers: [
    ImpresorasService,
    DestinosService,
    EventosImpresion,
    OrdenesVigentes,
    ColaImpresionService,
    { provide: IMPRESION, useExisting: ColaImpresionService },
    AutenticacionPuenteService,
    { provide: VALIDADOR_DE_PUENTE, useExisting: AutenticacionPuenteService },
    PuentesService,
    TrabajosService,
    SenalPuenteService,
    EstadoImpresionService,
    PuenteGuard,
    VinculacionGuard,
  ],
  exports: [IMPRESION, VALIDADOR_DE_PUENTE, OrdenesVigentes],
})
export class ImpresionModule {}
