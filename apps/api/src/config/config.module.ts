import { Global, Module } from '@nestjs/common';
import { CLAVE_HUELLA, derivarClaveHuella } from '../nucleo/idempotencia/huella';
import { ENTORNO, cargarEntorno, type Entorno } from './entorno';

/**
 * Provee `ENTORNO`, leído y validado al crear la aplicación (no al importar el módulo), y `CLAVE_HUELLA`,
 * la clave secreta (derivada de `PIN_PEPPER`) con la que se calcula la huella de la idempotencia.
 */
@Global()
@Module({
  providers: [
    { provide: ENTORNO, useFactory: () => cargarEntorno(process.env) },
    {
      provide: CLAVE_HUELLA,
      useFactory: (entorno: Entorno) => derivarClaveHuella(entorno.PIN_PEPPER),
      inject: [ENTORNO],
    },
  ],
  exports: [ENTORNO, CLAVE_HUELLA],
})
export class ConfigModule {}
