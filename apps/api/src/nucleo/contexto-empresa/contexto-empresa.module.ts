import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrincipalInterceptor } from '../principal/principal.interceptor';
import { ContextoEmpresa } from './contexto-empresa';
import { ContextoEmpresaInterceptor } from './contexto-empresa.interceptor';

/**
 * Contexto de empresa de cada petición. Registra dos interceptores globales, en este orden (los
 * `APP_INTERCEPTOR` de un mismo módulo corren en el orden de su registro):
 * 1. `PrincipalInterceptor`: guarda el principal que dejó el guard de autenticación en un almacén
 *    asíncrono para el resto de la petición.
 * 2. `ContextoEmpresaInterceptor`: abre `ContextoEmpresa.ejecutar` con la empresa y el actor que da el
 *    resolutor `RESOLUTOR_EMPRESA`.
 * El resolutor lo registra el módulo de seguridad (`ResolutorEmpresaSesion`, global): la empresa y el
 * actor salen siempre de la sesión. Sin resolutor registrado se usa el nulo (todo responde 401).
 */
@Global()
@Module({
  providers: [
    ContextoEmpresa,
    { provide: APP_INTERCEPTOR, useClass: PrincipalInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ContextoEmpresaInterceptor },
  ],
  exports: [ContextoEmpresa],
})
export class ContextoEmpresaModule {}
