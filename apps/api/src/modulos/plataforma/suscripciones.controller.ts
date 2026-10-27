import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  pagoEntradaSchema,
  suscripcionModificarEntradaSchema,
  suscripcionesConsultaSchema,
  type PagoEntrada,
  type PagoRegistradoRespuesta,
  type SuscripcionModificarEntrada,
  type SuscripcionRespuesta,
  type SuscripcionResumen,
} from '@restaurante/contratos';
import type { z } from 'zod';
import { noImplementado } from '../../nucleo/errores';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Superadministrador } from './superadministrador.decorator';

/** Suscripciones y pagos (criterios 73, 74 y 76). Lógica en la tarea T28. */
@Controller('plataforma/suscripciones')
@Superadministrador()
export class SuscripcionesController {
  /** `?estado=ACTIVA|EN_GRACIA|SUSPENDIDA`. */
  @Get()
  async listar(
    @Query(new PipeZod(suscripcionesConsultaSchema))
    _consulta: z.output<typeof suscripcionesConsultaSchema>,
  ): Promise<SuscripcionResumen[]> {
    return noImplementado();
  }

  /** 200; 400; 404; 422. */
  @Patch(':id')
  async modificar(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(suscripcionModificarEntradaSchema)) _cambios: SuscripcionModificarEntrada,
  ): Promise<SuscripcionRespuesta> {
    return noImplementado();
  }

  /** Con `Idempotency-Key`. 201 `{ pago, suscripcion }`; 400; 404; 422. */
  @Post(':id/pagos')
  @Idempotente()
  async registrarPago(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(pagoEntradaSchema)) _pago: PagoEntrada,
  ): Promise<PagoRegistradoRespuesta> {
    return noImplementado();
  }
}
