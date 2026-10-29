import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CartaModule } from '../carta';
import { SalonModule } from '../salon';
import { SeguridadModule } from '../seguridad';
import { AnulacionesController } from './anulaciones.controller';
import { CocinaController } from './cocina.controller';
import { EnviosController } from './envios.controller';
import { EnviosService } from './envios.service';
import { EventosPedidos } from './eventos-pedidos';
import { IMPRESION, ImpresionSoloKds } from './impresion';
import { OrdenesController } from './ordenes.controller';
import { OrdenesService } from './ordenes.service';
import { PedidosConsultaService } from './pedidos-consulta.service';
import { PrecuentasController } from './precuentas.controller';
import { SalonController } from './salon.controller';
import { SalonService } from './salon.service';
import { VistaOrdenService } from './vista-orden';

/**
 * Pedidos (historia 004): dueño de `orden`, `orden_mesa`, `envio`, `marcha`, `item`, `comanda`,
 * `comanda_linea` (migración `202610300002-pedidos`), `anulacion_item` y `precuenta` (T22). Usa
 * `MesasConsultaService` (salón), `CartaVentaService` y `CartaConsultaService` (carta) y `UsuariosConsultaService`
 * (seguridad); nunca consulta tablas ajenas. `INVENTARIO` lo provee `InventarioModule` (global). Exporta solo
 * `PedidosConsultaService`, que usará la sección 4.
 */
@Module({
  imports: [AuditoriaModule, SalonModule, CartaModule, SeguridadModule],
  controllers: [
    OrdenesController,
    EnviosController,
    AnulacionesController,
    PrecuentasController,
    SalonController,
    CocinaController,
  ],
  providers: [
    PedidosConsultaService,
    OrdenesService,
    EnviosService,
    SalonService,
    VistaOrdenService,
    EventosPedidos,
    { provide: IMPRESION, useClass: ImpresionSoloKds },
  ],
  exports: [PedidosConsultaService],
})
export class PedidosModule {}
