import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CartaWebModule } from '../carta-web';
import { SeguridadModule } from '../seguridad';
import { CodigosMesaService } from './codigos-mesa.service';
import { MesasConsultaService } from './mesas-consulta.service';
import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';
import { QrMesasController } from './qr-mesas.controller';
import { QrMesasService } from './qr-mesas.service';
import { UsoDeMesas } from './uso-de-mesas';
import { ZonasController } from './zonas.controller';
import { ZonasService } from './zonas.service';

/**
 * Salón (historia 004): dueño de `zona` y `mesa` (migración `202610300001-salon`). Exporta `MesasConsultaService`,
 * que usa el módulo de pedidos, y `UsoDeMesas`, donde pedidos registra cómo saber qué mesas tienen una orden
 * abierta (criterio 4); no importa `PedidosModule` (el mapa con estados vive en pedidos, así no hay ciclo).
 * Importa `SeguridadModule` por `@Permiso`. Desde la 005 también es dueño de `mesa_qr` (el código QR de cada mesa):
 * `CodigosMesaService` (exportado) y `QrMesasController`. Importa `CartaWebModule` solo para saber si la carta de la
 * sucursal está publicada (el aviso de la hoja de QR); `CartaWebModule` no importa el salón, así que no hay ciclo.
 */
@Module({
  imports: [AuditoriaModule, CartaWebModule, SeguridadModule],
  controllers: [ZonasController, MesasController, QrMesasController],
  providers: [
    ZonasService,
    MesasService,
    MesasConsultaService,
    CodigosMesaService,
    QrMesasService,
    UsoDeMesas,
  ],
  exports: [MesasConsultaService, CodigosMesaService, UsoDeMesas],
})
export class SalonModule {}
