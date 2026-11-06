import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { FacturacionModule } from '../facturacion';
import { PedidosModule } from '../pedidos';
import { PlataformaModule } from '../plataforma';
import { SeguridadModule } from '../seguridad';
import { CajasController } from './cajas.controller';
import { CajasService } from './cajas.service';
import { CobrosDePedidos } from './cobros-de-pedidos';
import { CobrosService } from './cobros.service';
import { CuentasController } from './cuentas.controller';
import { EventosCaja } from './eventos-caja';
import { AlcanceDeReimpresionDeReportes } from './alcance-de-reimpresion-de-reportes';
import { AlcanceDeTurnosDeCaja } from './alcance-de-turnos-de-caja';
import { ImpresoraDeCajas } from './impresora-de-cajas';
import { ParametrosDeCuenta } from './parametros-de-cuenta';
import { MostradorController } from './mostrador.controller';
import { NotasCreditoController } from './notas-credito.controller';
import { NotasCreditoService } from './notas-credito.service';
import { MostradorService } from './mostrador.service';
import { ReportesCaja } from './reportes-caja';
import { TicketsDeCaja } from './tickets-de-caja';
import { TurnosController } from './turnos.controller';
import { TurnosService } from './turnos.service';

/**
 * Caja (historia 006, entrega 6a): dueño de `caja`, `turno`, `turno_conteo`, `movimiento_caja`, `cobro` y `pago`
 * (migración `202611040002-caja`; los cobros y los pagos llegan con la 4). Usa pedidos (`CuentasDePedidos`, y le registra el puerto
 * `COBROS`; en 6b, dueño también de `nota_credito` con `NotasCreditoService`), facturación (`EmisionService`, `FacturadoService`, `SeriesService`, el resumen tributario del turno), plataforma (`SuscripcionService`,
 * `EmisoresService`, `SucursalesConsultaService`), impresión (puerto `IMPRESION`, global) y seguridad. Nunca lee
 * tablas ajenas. Pedidos y facturación no importan este módulo.
 */
@Module({
  imports: [AuditoriaModule, SeguridadModule, PlataformaModule, PedidosModule, FacturacionModule],
  controllers: [
    CajasController,
    TurnosController,
    CuentasController,
    MostradorController,
    NotasCreditoController,
  ],
  providers: [
    CajasService,
    TurnosService,
    CobrosService,
    MostradorService,
    NotasCreditoService,
    CobrosDePedidos,
    ParametrosDeCuenta,
    AlcanceDeTurnosDeCaja,
    AlcanceDeReimpresionDeReportes,
    EventosCaja,
    ImpresoraDeCajas,
    ReportesCaja,
    TicketsDeCaja,
  ],
})
export class CajaModule {}
