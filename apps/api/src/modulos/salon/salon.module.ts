import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { SeguridadModule } from '../seguridad';
import { MesasConsultaService } from './mesas-consulta.service';
import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';
import { UsoDeMesas } from './uso-de-mesas';
import { ZonasController } from './zonas.controller';
import { ZonasService } from './zonas.service';

/**
 * Salón (historia 004): dueño de `zona` y `mesa` (migración `202610300001-salon`). Exporta `MesasConsultaService`,
 * que usa el módulo de pedidos, y `UsoDeMesas`, donde pedidos registra cómo saber qué mesas tienen una orden
 * abierta (criterio 4); no importa `PedidosModule` (el mapa con estados vive en pedidos, así no hay ciclo).
 * Importa `SeguridadModule` por `@Permiso`.
 */
@Module({
  imports: [AuditoriaModule, SeguridadModule],
  controllers: [ZonasController, MesasController],
  providers: [ZonasService, MesasService, MesasConsultaService, UsoDeMesas],
  exports: [MesasConsultaService, UsoDeMesas],
})
export class SalonModule {}
