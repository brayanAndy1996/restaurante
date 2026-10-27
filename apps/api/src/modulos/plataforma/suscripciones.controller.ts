import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
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
import type { Request } from 'express';
import type { z } from 'zod';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente, leerClaveIdempotencia } from '../../nucleo/idempotencia';
import { Superadministrador, SuperadministradorActual } from './superadministrador.decorator';
import { SuscripcionesPlataformaService } from './suscripciones-plataforma.service';
import type { SuperadministradorAutenticado } from './tipos';

/** Suscripciones y pagos por la vía de plataforma (criterios 73, 74 y 76). */
@Controller('plataforma/suscripciones')
@Superadministrador()
export class SuscripcionesController {
  constructor(
    @Inject(SuscripcionesPlataformaService)
    private readonly suscripciones: SuscripcionesPlataformaService,
  ) {}

  /** `?estado=ACTIVA|EN_GRACIA|SUSPENDIDA`: una fila por sucursal con el consumo de cuota. */
  @Get()
  async listar(
    @Query(new PipeZod(suscripcionesConsultaSchema))
    consulta: z.output<typeof suscripcionesConsultaSchema>,
  ): Promise<SuscripcionResumen[]> {
    return this.suscripciones.listar(consulta.estado);
  }

  /** 200; 400; 404; 422 `PLAN_INVALIDO`. */
  @Patch(':id')
  async modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(suscripcionModificarEntradaSchema)) cambios: SuscripcionModificarEntrada,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
  ): Promise<SuscripcionRespuesta> {
    return this.suscripciones.modificar(id, cambios, superadministrador.id);
  }

  /** Con `Idempotency-Key`. 201 `{ pago, suscripcion }`; 400; 404. */
  @Post(':id/pagos')
  @Idempotente()
  async registrarPago(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(pagoEntradaSchema)) pago: PagoEntrada,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
    @Req() peticion: Request,
  ): Promise<PagoRegistradoRespuesta> {
    const clave = leerClaveIdempotencia(peticion);
    return this.suscripciones.registrarPago(
      id,
      pago,
      superadministrador.id,
      clave === undefined
        ? undefined
        : {
            clave,
            ruta: 'POST /plataforma/suscripciones/:id/pagos',
            actor: superadministrador.id,
            // La suscripción va en el cuerpo de la huella: la misma clave y cuerpo en otra suscripción es otra operación.
            cuerpo: { suscripcionId: id.toLowerCase(), cuerpo: pago },
          },
    );
  }
}
