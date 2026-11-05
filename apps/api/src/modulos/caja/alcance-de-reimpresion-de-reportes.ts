import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AlcanceDeReimpresion } from '../impresion';
import { noEncontrado } from './errores-caja';
import { TurnosService } from './turnos.service';

/**
 * Le dice a impresión cómo comprobar el acceso a un trabajo `REPORTE_X` o `REPORTE_Z` antes de reimprimirlo con la
 * ruta de 004 (historia 006, criterio 90): el mismo permiso (`OPERAR_CAJA`) y alcance que `GET /turnos/:id/reporte`
 * (un Cajero solo los de sus turnos). Se registra al arrancar; impresión no lee `turno`.
 */
@Injectable()
export class AlcanceDeReimpresionDeReportes implements OnModuleInit {
  constructor(
    @Inject(AlcanceDeReimpresion) private readonly alcance: AlcanceDeReimpresion,
    @Inject(TurnosService) private readonly turnos: TurnosService,
  ) {}

  onModuleInit(): void {
    this.alcance.registrar(['REPORTE_X', 'REPORTE_Z'], async (trabajo) => {
      if (trabajo.turnoId === null) throw noEncontrado('El turno');
      await this.turnos.exigirReimpresion(trabajo.turnoId);
    });
  }
}
