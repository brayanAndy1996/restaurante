import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { principalActual } from '../../nucleo/principal';
import { AlcanceDeReimpresion } from '../impresion';
import { SuscripcionService } from '../plataforma';
import { comprobanteNoEncontrado } from './errores-facturacion';
import { ComprobantesService } from './comprobantes.service';

/**
 * Le dice a impresión cómo comprobar el acceso a un trabajo `COMPROBANTE` antes de reimprimirlo con la ruta de 004
 * (historia 006, criterio 90): el mismo módulo del plan (`FACTURACION`), permiso y alcance que
 * `POST /comprobantes/:id/impresiones`. Se registra al arrancar; impresión no lee `comprobante`.
 */
@Injectable()
export class AlcanceDeReimpresionDeComprobantes implements OnModuleInit {
  constructor(
    @Inject(AlcanceDeReimpresion) private readonly alcance: AlcanceDeReimpresion,
    @Inject(ComprobantesService) private readonly comprobantes: ComprobantesService,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
  ) {}

  onModuleInit(): void {
    this.alcance.registrar(['COMPROBANTE'], async (trabajo) => {
      // Como `@RequiereModulo('FACTURACION')` de la ruta propia del documento (criterio 77): sin el módulo, 403.
      const sucursalId = principalActual()?.sucursalId ?? null;
      const incluidos =
        sucursalId === null ? [] : await this.suscripciones.modulosDeSucursal(sucursalId);
      if (!incluidos.includes('FACTURACION')) {
        throw new ErrorAplicacion(
          403,
          'MODULO_NO_INCLUIDO',
          'El plan de la sucursal no incluye esta función',
        );
      }
      if (trabajo.comprobanteId === null) throw comprobanteNoEncontrado();
      await this.comprobantes.exigirReimpresion(trabajo.comprobanteId);
    });
  }
}
