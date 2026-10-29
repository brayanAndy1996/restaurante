import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CartaModule } from '../carta';
import { SalonModule } from '../salon';
import { SeguridadModule } from '../seguridad';
import { AnulacionesController } from './anulaciones.controller';
import { CocinaController } from './cocina.controller';
import { EnviosController } from './envios.controller';
import { IMPRESION, ImpresionSoloKds } from './impresion';
import { OrdenesController } from './ordenes.controller';
import { PedidosConsultaService } from './pedidos-consulta.service';
import { PrecuentasController } from './precuentas.controller';
import { SalonController } from './salon.controller';

/**
 * Pedidos (historia 004): dueño de `orden`, `orden_mesa`, `envio`, `marcha`, `item`, `comanda`,
 * `comanda_linea`, `anulacion_item` y `precuenta` (las tablas llegan con sus migraciones de la fase C). Usa
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
  providers: [PedidosConsultaService, { provide: IMPRESION, useClass: ImpresionSoloKds }],
  exports: [PedidosConsultaService],
})
export class PedidosModule {}
