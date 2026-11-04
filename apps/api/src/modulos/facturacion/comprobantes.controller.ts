import { Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  comprobantesConsultaSchema,
  type ComprobanteRespuesta,
  type ComprobanteResumen,
  type ComprobantesConsulta,
  type ImpresionDeCajaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { ComprobantesService } from './comprobantes.service';

/**
 * Comprobantes (historia 006, criterios 77 y 90). FIRMAS de la fase A: sin `@Permiso`, `@RequiereModulo` ni
 * idempotencia todavía. En la fase C llevan `COBRAR` y `FACTURACION` (y la reimpresión, `Idempotency-Key`).
 */
@Controller('comprobantes')
export class ComprobantesController {
  constructor(@Inject(ComprobantesService) private readonly comprobantes: ComprobantesService) {}

  /** 200 `comprobanteResumen[]` (hasta 200); 400; 403. */
  @Get()
  listar(
    @Query(new PipeZod(comprobantesConsultaSchema)) consulta: ComprobantesConsulta,
  ): Promise<ComprobanteResumen[]> {
    return this.comprobantes.listar(consulta);
  }

  /** 200 `comprobanteRespuesta`; 403; 404. */
  @Get(':id')
  consultar(@Param('id', PipeUuid) id: string): Promise<ComprobanteRespuesta> {
    return this.comprobantes.consultar(id);
  }

  /** 201 `{ trabajoId, impresion }`; 404; 409 `SIN_IMPRESORA`. */
  @Post(':id/impresiones')
  imprimir(@Param('id', PipeUuid) id: string): Promise<ImpresionDeCajaRespuesta> {
    return this.comprobantes.imprimir(id);
  }
}
