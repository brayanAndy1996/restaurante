import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CartaModule } from '../carta';
import { SeguridadModule } from '../seguridad';
import { CartaPublicaController } from './carta-publica.controller';
import { CartaPublicaService } from './carta-publica.service';
import { CartaWebConsultaService } from './carta-web-consulta.service';
import { CartaWebController } from './carta-web.controller';
import { CartaWebService } from './carta-web.service';
import { LogoCartaWebController } from './logo-carta-web.controller';
import { LogoCartaWebService } from './logo-carta-web.service';

/**
 * Carta web (historia 005): dueño de `carta_web` y `carta_web_sucursal` (migración `202611020001-carta-web`).
 * Importa `CartaModule` (`CartaVentaService`), `AuditoriaModule` y `SeguridadModule`; `SucursalesConsultaModule`,
 * `SuscripcionModule` y `ArchivosModule` son globales. No importa `SalonModule` ni `LlamadosModule`. Exporta
 * `CartaWebConsultaService`, que usa el módulo de llamados.
 */
@Module({
  imports: [AuditoriaModule, CartaModule, SeguridadModule],
  controllers: [CartaWebController, LogoCartaWebController, CartaPublicaController],
  providers: [CartaWebService, LogoCartaWebService, CartaPublicaService, CartaWebConsultaService],
  exports: [CartaWebConsultaService],
})
export class CartaWebModule {}
