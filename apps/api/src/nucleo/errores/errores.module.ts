import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { FiltroGlobalErrores } from './filtro-global-errores';

@Module({
  providers: [{ provide: APP_FILTER, useClass: FiltroGlobalErrores }],
})
export class ErroresModule {}
