import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  altaEmpresaEntradaSchema,
  emisorPlataformaEntradaSchema,
  soporteEntradaSchema,
  sucursalPlataformaEntradaSchema,
  type AltaEmpresaRespuesta,
  type EmisorRespuesta,
  type EmpresaPlataformaDetalle,
  type EmpresaPlataformaResumen,
  type IngresoRespuesta,
  type SucursalPlataformaRespuesta,
} from '@restaurante/contratos';
import type { z } from 'zod';
import { noImplementado } from '../../nucleo/errores';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Superadministrador } from './superadministrador.decorator';

/**
 * Empresas por HTTP para el superadministrador (criterios 63 a 66). Corren sin contexto de empresa, por
 * la vía de `OperacionPlataforma`. Lógica en las tareas T15, T16 y T27.
 */
@Controller('plataforma/empresas')
@Superadministrador()
export class PlataformaEmpresasController {
  /** 200: las empresas con sus sucursales y el estado de cada suscripción. */
  @Get()
  async listar(): Promise<EmpresaPlataformaResumen[]> {
    return noImplementado();
  }

  /** 200: emisores, sucursales, suscripciones y administradores; 404. */
  @Get(':id')
  async obtener(@Param('id', PipeUuid) _id: string): Promise<EmpresaPlataformaDetalle> {
    return noImplementado();
  }

  /** 201 `altaEmpresaRespuesta` (con el PIN del primer Administrador); 400; 409; 422 `PLAN_INVALIDO`. */
  @Post()
  async registrar(
    @Body(new PipeZod(altaEmpresaEntradaSchema))
    _entrada: z.output<typeof altaEmpresaEntradaSchema>,
  ): Promise<AltaEmpresaRespuesta> {
    return noImplementado();
  }

  /** 201; 400; 404. */
  @Post(':id/emisores')
  @Idempotente()
  async agregarEmisor(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(emisorPlataformaEntradaSchema))
    _entrada: z.output<typeof emisorPlataformaEntradaSchema>,
  ): Promise<EmisorRespuesta> {
    return noImplementado();
  }

  /** 201 (con su suscripción); 400; 404; 422. */
  @Post(':id/sucursales')
  @Idempotente()
  async agregarSucursal(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(sucursalPlataformaEntradaSchema))
    _entrada: z.output<typeof sucursalPlataformaEntradaSchema>,
  ): Promise<SucursalPlataformaRespuesta> {
    return noImplementado();
  }

  /** 201 `{ token, sesion }` de una sesión `SOPORTE` de esa empresa; 400; 404. */
  @Post(':id/soporte')
  async iniciarSoporte(
    @Param('id', PipeUuid) _id: string,
    @Body(new PipeZod(soporteEntradaSchema)) _entrada: z.output<typeof soporteEntradaSchema>,
  ): Promise<IngresoRespuesta> {
    return noImplementado();
  }
}
