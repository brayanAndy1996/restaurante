import { Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  comprobantesConsultaSchema,
  type ComprobanteRespuesta,
  type ComprobanteResumen,
  type ComprobantesConsulta,
  type ImpresionDeCajaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { ComprobantesService } from './comprobantes.service';

/**
 * Comprobantes (historia 006, criterios 77, 90 y 100): `COBRAR` y módulo `FACTURACION` en todas; la reimpresión lleva
 * `Idempotency-Key` obligatoria. Un Cajero solo ve los comprobantes de sus propios turnos.
 */
@Controller('comprobantes')
export class ComprobantesController {
  constructor(@Inject(ComprobantesService) private readonly comprobantes: ComprobantesService) {}

  /** 200 `comprobanteResumen[]` (hasta 200); 400; 403. */
  @Get()
  @RequiereModulo('FACTURACION')
  @Permiso('COBRAR')
  listar(
    @Query(new PipeZod(comprobantesConsultaSchema)) consulta: ComprobantesConsulta,
  ): Promise<ComprobanteResumen[]> {
    return this.comprobantes.listar(consulta);
  }

  /** 200 `comprobanteRespuesta`; 403; 404. */
  @Get(':id')
  @RequiereModulo('FACTURACION')
  @Permiso('COBRAR')
  consultar(@Param('id', PipeUuid) id: string): Promise<ComprobanteRespuesta> {
    return this.comprobantes.consultar(id);
  }

  /** 201 `{ trabajoId, impresion }`; 404; 409 `SIN_IMPRESORA`. */
  @Post(':id/impresiones')
  @IdempotenteObligatoria()
  @RequiereModulo('FACTURACION')
  @Permiso('COBRAR')
  imprimir(@Param('id', PipeUuid) id: string): Promise<ImpresionDeCajaRespuesta> {
    return this.comprobantes.imprimir(id);
  }
}
