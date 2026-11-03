import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import {
  llamadoEntradaSchema,
  type EstadoLlamadoPublico,
  type LlamadoEntradaValidada,
  type LlamadoPublico,
  type MesaPublica,
} from '@restaurante/contratos';
import type { Request } from 'express';
import { PipeZod } from '../../nucleo/errores/pipes';
import { CreacionLlamadosService } from './creacion-llamados.service';
import { VistaLlamadosService } from './vista-llamados.service';

/**
 * La mesa vista por el cliente (historia 005, criterios 25, 26 y 38). FIRMAS: sin `@Publica()` hasta la fase C
 * (T9 y T10), que también valida la forma del código (404 sin consultar la base) y resuelve la empresa.
 */
@Controller('publico/mesas/:codigo')
export class MesaPublicaController {
  constructor(
    @Inject(VistaLlamadosService) private readonly vista: VistaLlamadosService,
    @Inject(CreacionLlamadosService) private readonly creacion: CreacionLlamadosService,
  ) {}

  /** 200 `mesaPublica`; 404. */
  @Get()
  mesa(@Param('codigo') codigo: string): Promise<MesaPublica> {
    return this.vista.mesaPublica(codigo);
  }

  /**
   * 201 `llamadoPublico` (también la réplica del mismo `id`); 400; 404; 409 `FUERA_DE_HORARIO`,
   * `LLAMADO_PENDIENTE` o `CONFLICTO`; 413; 422; 429 `DEMASIADOS_LLAMADOS`.
   */
  @Post('llamados')
  crear(
    @Param('codigo') codigo: string,
    @Body(new PipeZod(llamadoEntradaSchema)) entrada: LlamadoEntradaValidada,
    @Req() peticion: Request,
  ): Promise<LlamadoPublico> {
    return this.creacion.crear(codigo, entrada, peticion.socket.remoteAddress);
  }

  /** 200 `estadoLlamadoPublico`; 404. */
  @Get('llamados/:id')
  estado(@Param('codigo') codigo: string, @Param('id') id: string): Promise<EstadoLlamadoPublico> {
    return this.vista.estadoPublico(codigo, id);
  }
}
