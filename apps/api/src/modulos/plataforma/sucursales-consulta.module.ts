import { Global, Module } from '@nestjs/common';
import { SucursalesConsultaService } from './sucursales-consulta.service';

/**
 * `SucursalesConsultaService` (lecturas de `sucursal` para otros módulos) en un módulo global y sin
 * dependencias de otros módulos, igual que `SuscripcionModule`: el módulo de seguridad no puede importar
 * `PlataformaModule` sin un ciclo. Lo importa `PlataformaModule`.
 */
@Global()
@Module({ providers: [SucursalesConsultaService], exports: [SucursalesConsultaService] })
export class SucursalesConsultaModule {}
