import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { ContextoEmpresa } from './contexto-empresa';
import { ContextoEmpresaInterceptor } from './contexto-empresa.interceptor';
import { RESOLUTOR_EMPRESA, type ResolutorEmpresa } from './resolutor-empresa';
import { ResolutorEmpresaNulo } from './resolutor-empresa-nulo';
import { ResolutorEmpresaPorCabecera, cabeceraHabilitada } from './resolutor-empresa-por-cabecera';

/**
 * El resolutor se elige por configuración: por cabecera si `NODE_ENV` es `development` o `test` y
 * `EMPRESA_POR_HEADER=habilitado`; en cualquier otro caso, el nulo (siempre 401). La historia 002
 * registra aquí su resolutor de sesión en el mismo token.
 */
@Global()
@Module({
  providers: [
    ContextoEmpresa,
    { provide: APP_INTERCEPTOR, useClass: ContextoEmpresaInterceptor },
    {
      provide: RESOLUTOR_EMPRESA,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno): ResolutorEmpresa =>
        cabeceraHabilitada(entorno)
          ? new ResolutorEmpresaPorCabecera(entorno)
          : new ResolutorEmpresaNulo(),
    },
  ],
  exports: [ContextoEmpresa, RESOLUTOR_EMPRESA],
})
export class ContextoEmpresaModule {}
