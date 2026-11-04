import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CartaModule } from '../carta';
import { ImpresionModule } from '../impresion';
import { SalonModule } from '../salon';
import { SeguridadModule } from '../seguridad';
import { AperturaDeMesasService } from './apertura-de-mesas.service';
import { AnulacionesController } from './anulaciones.controller';
import { AnulacionesService } from './anulaciones.service';
import { COBROS, RegistroDeCobros } from './cobros';
import { CocinaController } from './cocina.controller';
import { CocinaService } from './cocina.service';
import { CortesiasController } from './cortesias.controller';
import { CortesiasService } from './cortesias.service';
import { CuentasDePedidos } from './cuentas-de-pedidos';
import { DescuentosController } from './descuentos.controller';
import { DescuentosService } from './descuentos.service';
import { EnviosController } from './envios.controller';
import { EnviosService } from './envios.service';
import { EventosPedidos } from './eventos-pedidos';
import { LlamadosMostrador } from './llamados-mostrador';
import { MovimientosService } from './movimientos.service';
import { OrdenesController } from './ordenes.controller';
import { OrdenesService } from './ordenes.service';
import { PedidosConsultaService } from './pedidos-consulta.service';
import { PrecuentasController } from './precuentas.controller';
import { PrecuentasService } from './precuentas.service';
import { SalonController } from './salon.controller';
import { SalonService } from './salon.service';
import { TicketsDePedidos } from './tickets-de-pedidos';
import { VistaOrdenService } from './vista-orden';

/**
 * Pedidos (historia 004): dueño de `orden`, `orden_mesa`, `envio`, `marcha`, `item`, `comanda`,
 * `comanda_linea` (migración `202610300002-pedidos`), `anulacion_item` y `precuenta` (T22). Usa
 * `MesasConsultaService` (salón), `CartaVentaService` y `CartaConsultaService` (carta) y `UsuariosConsultaService`
 * (seguridad); nunca consulta tablas ajenas. `INVENTARIO` lo provee `InventarioModule` (global) e `IMPRESION`,
 * `ImpresionModule` (3b). Exporta solo
 * `PedidosConsultaService` (la sección 4 y los llamados de la 005) y `AperturaDeMesasService` (los llamados);
 * nada del envío de comandas.
 *
 * Historia 006 (caja): además es dueño de `descuento`, `cortesia` y `contador_llamado` (todavía sin tablas: fase C) y
 * exporta `CuentasDePedidos` (la cuenta para cobrar, el registro del cobro y la venta de mostrador) y el puerto
 * `COBROS` (`RegistroDeCobros`), donde el módulo de caja se registra al arrancar. No depende de caja.
 */
@Module({
  imports: [AuditoriaModule, SalonModule, CartaModule, SeguridadModule, ImpresionModule],
  controllers: [
    OrdenesController,
    EnviosController,
    AnulacionesController,
    PrecuentasController,
    SalonController,
    CocinaController,
    // Historia 006: sus rutas cuelgan de /cuentas, no de /ordenes (criterio 98).
    DescuentosController,
    CortesiasController,
  ],
  providers: [
    PedidosConsultaService,
    AperturaDeMesasService,
    OrdenesService,
    EnviosService,
    AnulacionesService,
    MovimientosService,
    PrecuentasService,
    CocinaService,
    SalonService,
    VistaOrdenService,
    EventosPedidos,
    TicketsDePedidos,
    CuentasDePedidos,
    DescuentosService,
    CortesiasService,
    LlamadosMostrador,
    RegistroDeCobros,
    { provide: COBROS, useExisting: RegistroDeCobros },
  ],
  exports: [
    PedidosConsultaService,
    AperturaDeMesasService,
    CuentasDePedidos,
    RegistroDeCobros,
    COBROS,
  ],
})
export class PedidosModule {}
