import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  planCrearEntradaSchema,
  planModificarEntradaSchema,
  type PlanCrearEntrada,
  type PlanModificarEntrada,
  type PlanRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Superadministrador } from './superadministrador.decorator';

/** Planes de suscripción (criterio 75). Lógica en la tarea T28. */
@Controller('plataforma/planes')
@Superadministrador()
export class PlanesController {
  @Get()
  async listar(): Promise<PlanRespuesta[]> {
    return noImplementado();
  }

  /** 201; 400; 409 `CONFLICTO`. */
  @Post()
  async crear(
    @Body(new PipeZod(planCrearEntradaSchema)) _entrada: PlanCrearEntrada,
  ): Promise<PlanRespuesta> {
    return noImplementado();
  }

  /** 200; 400; 404; 409 `CONFLICTO`. */
  @Patch(':id')
  async modificar(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(planModificarEntradaSchema)) _cambios: PlanModificarEntrada,
  ): Promise<PlanRespuesta> {
    return noImplementado();
  }
}
