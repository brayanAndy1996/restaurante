import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CartaModule } from '../carta';
import { IMPRESION } from '../pedidos/impresion';
import { SeguridadModule } from '../seguridad';
import { ColaImpresionService } from './cola-impresion.service';
import { DestinosController } from './destinos.controller';
import { DestinosService } from './destinos.service';
import { ImpresionController } from './impresion.controller';
import { ImpresorasController } from './impresoras.controller';
import { ImpresorasService } from './impresoras.service';
import { PuenteController } from './puente.controller';
import { PuenteGuard, VinculacionGuard } from './puente.guard';
import { PuentesController } from './puentes.controller';

/**
 * Impresión (historia 004, entrega 3b): dueño de `impresora`, `estacion_destino`, `impresion_sucursal`
 * (migración `202610310001-impresion`, T37), `vinculacion_puente`, `puente` y `trabajo_impresion` (migración
 * `202610310002-puente`, T40, todavía no creada). Provee el puerto `IMPRESION` que usa `PedidosModule` (que importa
 * este módulo; este no importa pedidos) y no consulta tablas ajenas: las estaciones las lee con
 * `CartaConsultaService`, las sucursales con `SucursalesConsultaService` y el rol con `SeguridadModule`.
 *
 * Implementado en T37: impresoras, destino de cada estación, impresora de caja y `IMPRESION.destinos`. El resto de
 * las rutas siguen como firmas de la fase A (T35) hasta T40, T41 y T44.
 */
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
    ColaImpresionService,
    { provide: IMPRESION, useExisting: ColaImpresionService },
    PuenteGuard,
    VinculacionGuard,
  ],
  exports: [IMPRESION],
})
export class ImpresionModule {}
