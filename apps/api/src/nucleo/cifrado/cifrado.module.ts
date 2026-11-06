import { Global, Module } from '@nestjs/common';
import { Cifrado } from './cifrado';

/** Provee `Cifrado` a toda la aplicación (lo usan plataforma, para la credencial del PSE, y facturación, para los enlaces). */
@Global()
@Module({ providers: [Cifrado], exports: [Cifrado] })
export class CifradoModule {}
