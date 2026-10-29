import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { MesasConsultaService } from './mesas-consulta.service';
import { MesasController } from './mesas.controller';
import { ZonasController } from './zonas.controller';

/**
 * Salón (historia 004): dueño de `zona` y `mesa` (las tablas llegan con la migración `202610300001-salon`).
 * Exporta solo `MesasConsultaService`, que usa el módulo de pedidos; no importa `PedidosModule` (el mapa con
 * estados vive en pedidos, así no hay ciclo).
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [ZonasController, MesasController],
  providers: [MesasConsultaService],
  exports: [MesasConsultaService],
})
export class SalonModule {}
