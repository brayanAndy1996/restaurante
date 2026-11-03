import { Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  llamadoEntradaSchema,
  type EstadoLlamadoPublico,
  type LlamadoEntradaValidada,
  type LlamadoPublico,
  type MesaPublica,
} from '@restaurante/contratos';
import type { Request, Response } from 'express';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { PipeZod } from '../../nucleo/errores/pipes';
import { ipDelCliente } from '../../nucleo/http/ip-cliente';
import { Publica } from '../seguridad';
import { CreacionLlamadosService } from './creacion-llamados.service';
import { VistaLlamadosService } from './vista-llamados.service';

/**
 * La mesa vista por el cliente (historia 005, criterios 25, 26 y 38). Las tres rutas son `@Publica()`: no hay sesión,
 * la empresa sale solo del código de la mesa (`ContextoPublico`) y se ignoran `Authorization` y `x-empresa-id`. Un
 * código con otra forma responde 404 sin consultar la base; el cuerpo del `POST` se valida antes (400) y un cuerpo
 * de más de 16 KB responde 413 antes de llegar aquí (`aplicacion.ts`).
 */
@Controller('publico/mesas/:codigo')
export class MesaPublicaController {
  constructor(
    @Inject(VistaLlamadosService) private readonly vista: VistaLlamadosService,
    @Inject(CreacionLlamadosService) private readonly creacion: CreacionLlamadosService,
    @Inject(ENTORNO) private readonly entorno: Entorno,
  ) {}

  /** 200 `mesaPublica` (sin caché, sin indexar y sin `Referer`); 404. */
  @Get()
  @Publica()
  async mesa(
    @Param('codigo') codigo: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<MesaPublica> {
    sinCache(respuesta);
    return this.vista.mesaPublica(codigo);
  }

  /**
   * 201 `llamadoPublico` (también la réplica del mismo `id`); 400; 404; 409 `FUERA_DE_HORARIO`,
   * `LLAMADO_PENDIENTE` o `CONFLICTO`; 413; 422; 429 `DEMASIADOS_LLAMADOS`.
   */
  @Post('llamados')
  @Publica()
  async crear(
    @Param('codigo') codigo: string,
    @Body(new PipeZod(llamadoEntradaSchema)) entrada: LlamadoEntradaValidada,
    @Req() peticion: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<LlamadoPublico> {
    sinCache(respuesta);
    return this.creacion.crear(
      codigo,
      entrada,
      ipDelCliente(peticion, this.entorno.CABECERA_IP_CLIENTE),
    );
  }

  /** 200 `estadoLlamadoPublico` (sin caché); 404. */
  @Get('llamados/:id')
  @Publica()
  async estado(
    @Param('codigo') codigo: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<EstadoLlamadoPublico> {
    sinCache(respuesta);
    return this.vista.estadoPublico(codigo, id);
  }
}

/** Las respuestas de la mesa no se guardan, no se indexan y no dejan el código en el `Referer` (criterio 25). */
function sinCache(respuesta: Response): void {
  respuesta.setHeader('Cache-Control', 'no-store');
  respuesta.setHeader('X-Robots-Tag', 'noindex');
  respuesta.setHeader('Referrer-Policy', 'no-referrer');
}
