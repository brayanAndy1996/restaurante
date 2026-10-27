import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  planCrearEntradaSchema,
  planModificarEntradaSchema,
  type PlanCrearEntrada,
  type PlanModificarEntrada,
  type PlanRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { PlanesService } from './planes.service';
import { Superadministrador, SuperadministradorActual } from './superadministrador.decorator';
import type { SuperadministradorAutenticado } from './tipos';

/**
 * Planes de suscripción (criterio 75). Corren por la vía de `OperacionPlataforma`, con el id del
 * superadministrador como actor de la auditoría (`crear_plan`, `modificar_plan`, sin empresa) y de la
 * trazabilidad.
 */
@Controller('plataforma/planes')
@Superadministrador()
export class PlanesController {
  constructor(@Inject(PlanesService) private readonly planes: PlanesService) {}

  /** 200: el plan por defecto primero. */
  @Get()
  async listar(): Promise<PlanRespuesta[]> {
    return this.planes.listar();
  }

  /** 201; 400; 409 `CONFLICTO` (código repetido o plan por defecto inactivo). */
  @Post()
  async crear(
    @Body(new PipeZod(planCrearEntradaSchema)) entrada: PlanCrearEntrada,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
  ): Promise<PlanRespuesta> {
    return this.planes.crear(entrada, superadministrador.id);
  }

  /** 200; 400; 404; 409 `CONFLICTO` (dejar al sistema sin plan por defecto, o inactivo). */
  @Patch(':id')
  async modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(planModificarEntradaSchema)) cambios: PlanModificarEntrada,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
  ): Promise<PlanRespuesta> {
    return this.planes.modificar(id, cambios, superadministrador.id);
  }
}
