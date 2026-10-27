import { Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';

/** Dueño de la tabla `auditoria`; sin dependencias de otros módulos. */
@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
