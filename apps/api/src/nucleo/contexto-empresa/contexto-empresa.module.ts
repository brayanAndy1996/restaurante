import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContextoEmpresa } from './contexto-empresa';
import { ContextoEmpresaInterceptor } from './contexto-empresa.interceptor';
import { RESOLUTOR_EMPRESA } from './resolutor-empresa';
import { ResolutorEmpresaNulo } from './resolutor-empresa-nulo';
import { ResolutorEmpresaPorCabecera } from './resolutor-empresa-por-cabecera';

// FASE A: el resolutor registrado es el nulo; T12 lo elige según NODE_ENV y EMPRESA_POR_HEADER.
@Global()
@Module({
  providers: [
    ContextoEmpresa,
    ResolutorEmpresaNulo,
    ResolutorEmpresaPorCabecera,
    { provide: RESOLUTOR_EMPRESA, useExisting: ResolutorEmpresaNulo },
    { provide: APP_INTERCEPTOR, useClass: ContextoEmpresaInterceptor },
  ],
  exports: [ContextoEmpresa, RESOLUTOR_EMPRESA],
})
export class ContextoEmpresaModule {}
