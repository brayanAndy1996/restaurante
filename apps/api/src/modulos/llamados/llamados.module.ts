import { Module } from '@nestjs/common';
import { CartaModule } from '../carta';
import { CartaWebModule } from '../carta-web';
import { PedidosModule } from '../pedidos';
import { SalonModule } from '../salon';
import { SeguridadModule } from '../seguridad';
import { AtencionLlamadosService } from './atencion-llamados.service';
import { CreacionLlamadosService } from './creacion-llamados.service';
import { EventosLlamados } from './eventos-llamados';
import { LimitesLlamados } from './limites-llamados';
import { LlamadosController } from './llamados.controller';
import { MesaPublicaController } from './mesa-publica.controller';
import { PasoACuentaService } from './paso-a-cuenta.service';
import { ResolucionMesa } from './resolucion-mesa';
import { TopeDeCreaciones } from './tope-de-creaciones';
import { VistaLlamadosService } from './vista-llamados.service';

/**
 * Llamados desde la mesa (historia 005): dueño de `llamado` (migración `202611020003-llamados`, fase C). Usa
 * `CodigosMesaService` y `MesasConsultaService` (salón), `CartaWebConsultaService` (carta web), `CartaVentaService`
 * (carta), `PedidosConsultaService` y `AperturaDeMesasService` (pedidos) y `SucursalesConsultaService`
 * (plataforma, global); nunca consulta tablas ajenas. `PedidosModule` no exporta el servicio de envíos, así que
 * este módulo no puede mandar nada a cocina (criterio 49). Nadie importa `LlamadosModule`: no hay ciclos.
 */
@Module({
  imports: [SalonModule, CartaWebModule, CartaModule, PedidosModule, SeguridadModule],
  controllers: [MesaPublicaController, LlamadosController],
  providers: [
    CreacionLlamadosService,
    EventosLlamados,
    LimitesLlamados,
    ResolucionMesa,
    TopeDeCreaciones,
    VistaLlamadosService,
    AtencionLlamadosService,
    PasoACuentaService,
  ],
})
export class LlamadosModule {}
