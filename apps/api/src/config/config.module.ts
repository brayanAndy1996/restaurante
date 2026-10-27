import { Global, Module } from '@nestjs/common';
import { ENTORNO, cargarEntorno } from './entorno';

/** Provee `ENTORNO`, leído y validado al crear la aplicación (no al importar el módulo). */
@Global()
@Module({
  providers: [{ provide: ENTORNO, useFactory: () => cargarEntorno(process.env) }],
  exports: [ENTORNO],
})
export class ConfigModule {}
