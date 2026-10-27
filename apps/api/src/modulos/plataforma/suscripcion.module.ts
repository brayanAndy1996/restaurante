import { Global, Module } from '@nestjs/common';
import { SuscripcionService } from './suscripcion.service';

/**
 * `SuscripcionService` (único lector y escritor de las tablas de suscripción) en un módulo global y sin
 * dependencias de otros módulos: lo necesitan el módulo de seguridad (módulos del plan en `GET /sesion` y
 * `ModuloInterceptor`) y las historias de caja y facturación, y el módulo de seguridad no puede importar
 * `PlataformaModule` sin un ciclo. Lo importa `PlataformaModule`.
 */
@Global()
@Module({ providers: [SuscripcionService], exports: [SuscripcionService] })
export class SuscripcionModule {}
