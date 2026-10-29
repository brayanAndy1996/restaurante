import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { IMPRESION } from '../pedidos/impresion';
import { ColaImpresionService } from './cola-impresion.service';
import { DestinosController } from './destinos.controller';
import { ImpresionController } from './impresion.controller';
import { ImpresorasController } from './impresoras.controller';
import { PuenteController } from './puente.controller';
import { PuenteGuard, VinculacionGuard } from './puente.guard';
import { PuentesController } from './puentes.controller';

/**
 * Impresión (historia 004, entrega 3b): dueño de `impresora`, `estacion_destino`, `impresion_sucursal`,
 * `vinculacion_puente`, `puente` y `trabajo_impresion` (migraciones `202610310001-impresion` y
 * `202610310002-puente`, todavía no creadas). Provee el puerto `IMPRESION` que usa `PedidosModule` (que importa
 * este módulo; este no importa pedidos) y no consulta tablas ajenas.
 *
 * Firmas de la fase A (T35): las rutas existen sin `@Permiso` ni lógica.
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [
    ImpresorasController,
    DestinosController,
    PuentesController,
    ImpresionController,
    PuenteController,
  ],
  providers: [
    ColaImpresionService,
    { provide: IMPRESION, useExisting: ColaImpresionService },
    PuenteGuard,
    VinculacionGuard,
  ],
  exports: [IMPRESION],
})
export class ImpresionModule {}
