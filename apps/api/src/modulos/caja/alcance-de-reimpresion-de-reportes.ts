import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { principalActual } from '../../nucleo/principal';
import { AlcanceDeReimpresion } from '../impresion';
import { SuscripcionService } from '../plataforma';
import { noEncontrado } from './errores-caja';
import { TurnosService } from './turnos.service';

/**
 * Le dice a impresión cómo comprobar el acceso a un trabajo `REPORTE_X` o `REPORTE_Z` antes de reimprimirlo con la
 * ruta de 004 (historia 006, criterio 90): el mismo módulo del plan (`CAJA`), permiso (`OPERAR_CAJA`) y alcance que `GET /turnos/:id/reporte`
 * (un Cajero solo los de sus turnos). Se registra al arrancar; impresión no lee `turno`.
 */
@Injectable()
export class AlcanceDeReimpresionDeReportes implements OnModuleInit {
  constructor(
    @Inject(AlcanceDeReimpresion) private readonly alcance: AlcanceDeReimpresion,
    @Inject(TurnosService) private readonly turnos: TurnosService,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
  ) {}

  onModuleInit(): void {
    this.alcance.registrar(['REPORTE_X', 'REPORTE_Z'], async (trabajo) => {
      // Como `@RequiereModulo('CAJA')` de la ruta propia del documento (criterio 77): sin el módulo, 403.
      const sucursalId = principalActual()?.sucursalId ?? null;
      const incluidos =
        sucursalId === null ? [] : await this.suscripciones.modulosDeSucursal(sucursalId);
      if (!incluidos.includes('CAJA')) {
        throw new ErrorAplicacion(
          403,
          'MODULO_NO_INCLUIDO',
          'El plan de la sucursal no incluye esta función',
        );
      }
      if (trabajo.turnoId === null) throw noEncontrado('El turno');
      await this.turnos.exigirReimpresion(trabajo.turnoId);
    });
  }
}
