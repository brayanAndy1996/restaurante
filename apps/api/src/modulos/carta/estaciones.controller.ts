import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  estacionEntradaSchema,
  estacionModificarEntradaSchema,
  type EstacionEntrada,
  type EstacionModificarEntrada,
  type EstacionRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { EstacionesService } from './estaciones.service';

/**
 * Estaciones de producción (criterios 1, 2 y 2b). El Administrador las define (`ADMINISTRAR` en `POST` y
 * `PATCH`); el Cajero las lee para asignarlas a los productos (`EDITAR_CARTA` en `GET`).
 */
@Controller('carta/estaciones')
export class EstacionesController {
  constructor(@Inject(EstacionesService) private readonly estaciones: EstacionesService) {}

  @Get()
  @Permiso('EDITAR_CARTA')
  listar(): Promise<EstacionRespuesta[]> {
    return this.estaciones.listar();
  }

  /** 201; 400; 403; 409 `CONFLICTO`. Con `Idempotency-Key` opcional. */
  @Post()
  @Idempotente()
  @Permiso('ADMINISTRAR')
  crear(
    @Body(new PipeZod(estacionEntradaSchema)) entrada: EstacionEntrada,
  ): Promise<EstacionRespuesta> {
    return this.estaciones.crear(entrada);
  }

  /** 200; 400; 403; 404; 409 `CONFLICTO` o `EN_USO`. */
  @Patch(':id')
  @Permiso('ADMINISTRAR')
  modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(estacionModificarEntradaSchema)) cambios: EstacionModificarEntrada,
  ): Promise<EstacionRespuesta> {
    return this.estaciones.modificar(id, cambios);
  }
}
