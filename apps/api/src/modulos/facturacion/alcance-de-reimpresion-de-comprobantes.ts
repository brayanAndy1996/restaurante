import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AlcanceDeReimpresion } from '../impresion';
import { comprobanteNoEncontrado } from './errores-facturacion';
import { ComprobantesService } from './comprobantes.service';

/**
 * Le dice a impresión cómo comprobar el acceso a un trabajo `COMPROBANTE` antes de reimprimirlo con la ruta de 004
 * (historia 006, criterio 90): el mismo permiso y alcance que `POST /comprobantes/:id/impresiones`. Se registra al
 * arrancar; impresión no lee `comprobante`.
 */
@Injectable()
export class AlcanceDeReimpresionDeComprobantes implements OnModuleInit {
  constructor(
    @Inject(AlcanceDeReimpresion) private readonly alcance: AlcanceDeReimpresion,
    @Inject(ComprobantesService) private readonly comprobantes: ComprobantesService,
  ) {}

  onModuleInit(): void {
    this.alcance.registrar(['COMPROBANTE'], async (trabajo) => {
      if (trabajo.comprobanteId === null) throw comprobanteNoEncontrado();
      await this.comprobantes.exigirReimpresion(trabajo.comprobanteId);
    });
  }
}
