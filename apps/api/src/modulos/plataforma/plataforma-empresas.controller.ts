import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
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
} from '@restaurante/contratos';
import type { Request } from 'express';
import type { z } from 'zod';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente, leerClaveIdempotencia } from '../../nucleo/idempotencia';
import { PlataformaEmpresasService, type SucursalCreada } from './plataforma-empresas.service';
import { SoporteService } from './soporte.service';
import { Superadministrador, SuperadministradorActual } from './superadministrador.decorator';
import type { IdempotenciaPlataforma, SuperadministradorAutenticado } from './tipos';

/**
 * Empresas por HTTP para el superadministrador (criterios 63 a 66). Corren sin contexto de empresa, por
 * la vía de `OperacionPlataforma`, con el id del superadministrador como actor de la auditoría y de la
 * trazabilidad.
 */
@Controller('plataforma/empresas')
@Superadministrador()
export class PlataformaEmpresasController {
  constructor(
    @Inject(PlataformaEmpresasService) private readonly empresas: PlataformaEmpresasService,
    @Inject(SoporteService) private readonly soporte: SoporteService,
  ) {}

  /** 200: las empresas con sus sucursales y el estado de cada suscripción. */
  @Get()
  async listar(): Promise<EmpresaPlataformaResumen[]> {
    return this.empresas.listarConSucursales();
  }

  /** 200: emisores, sucursales, suscripciones y administradores; 404. */
  @Get(':id')
  async obtener(@Param('id', PipeUuid) id: string): Promise<EmpresaPlataformaDetalle> {
    return this.empresas.obtenerDetalle(id);
  }

  /** 201 `altaEmpresaRespuesta` (con la suscripción de cada sucursal y el PIN del primer Administrador); 400; 409; 422 `PLAN_INVALIDO`. */
  @Post()
  async registrar(
    @Body(new PipeZod(altaEmpresaEntradaSchema))
    entrada: z.output<typeof altaEmpresaEntradaSchema>,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
  ): Promise<AltaEmpresaRespuesta> {
    const { motivo, ...datos } = entrada;
    const resultado = await this.empresas.registrarEmpresaConSuscripciones(datos, {
      actor: { superadministradorId: superadministrador.id },
      motivo,
    });
    // `administrador` siempre viene: el esquema de entrada lo exige.
    return resultado as AltaEmpresaRespuesta;
  }

  /** 201; 400; 404. Con `Idempotency-Key` opcional. */
  @Post(':id/emisores')
  @Idempotente()
  async agregarEmisor(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(emisorPlataformaEntradaSchema))
    entrada: z.output<typeof emisorPlataformaEntradaSchema>,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
    @Req() peticion: Request,
  ): Promise<EmisorRespuesta> {
    const { motivo, ...emisor } = entrada;
    return this.empresas.agregarEmisorPorHttp(
      id,
      emisor,
      { actor: { superadministradorId: superadministrador.id }, motivo },
      this.idempotencia(
        peticion,
        'POST /plataforma/empresas/:id/emisores',
        id,
        superadministrador,
        entrada,
      ),
    );
  }

  /** 201 con la sucursal y su suscripción; 400; 404; 422. Con `Idempotency-Key` opcional. */
  @Post(':id/sucursales')
  @Idempotente()
  async agregarSucursal(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(sucursalPlataformaEntradaSchema))
    entrada: z.output<typeof sucursalPlataformaEntradaSchema>,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
    @Req() peticion: Request,
  ): Promise<SucursalCreada> {
    const { motivo, ...sucursal } = entrada;
    return this.empresas.agregarSucursalPorHttp(
      id,
      sucursal,
      { actor: { superadministradorId: superadministrador.id }, motivo },
      this.idempotencia(
        peticion,
        'POST /plataforma/empresas/:id/sucursales',
        id,
        superadministrador,
        entrada,
      ),
    );
  }

  /** 201 `{ token, sesion }` de una sesión `SOPORTE` de esa empresa; 400; 404. */
  @Post(':id/soporte')
  async iniciarSoporte(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(soporteEntradaSchema)) entrada: z.output<typeof soporteEntradaSchema>,
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
  ): Promise<IngresoRespuesta> {
    return this.soporte.iniciar(id.toLowerCase(), entrada, superadministrador);
  }

  /** La clave de idempotencia de la petición, si la trae (el cuerpo incluye la empresa: otra ruta, otra huella). */
  private idempotencia(
    peticion: Request,
    ruta: string,
    empresaId: string,
    superadministrador: SuperadministradorAutenticado,
    cuerpo: unknown,
  ): IdempotenciaPlataforma | undefined {
    const clave = leerClaveIdempotencia(peticion);
    if (clave === undefined) return undefined;
    return {
      clave,
      ruta,
      actor: superadministrador.id,
      cuerpo: { empresaId: empresaId.toLowerCase(), cuerpo },
    };
  }
}
