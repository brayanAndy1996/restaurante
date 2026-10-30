import { Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  trabajosConsultaSchema,
  type EstadoImpresionRespuesta,
  type TrabajoCreadoRespuesta,
  type TrabajoResumen,
  type TrabajosConsulta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereSucursal } from '../seguridad';
import { EstadoImpresionService } from './estado-impresion.service';
import { TrabajosService } from './trabajos.service';

/**
 * Estado de la impresión y trabajos de la sucursal activa (historia 004, criterios 121 y 128): el estado lo ve
 * cualquier rol con sucursal activa (`@RequiereSucursal()`); la lista de trabajos y la reimpresión son de
 * `ATENDER_MESA`, esta con `Idempotency-Key` obligatoria.
 */
@Controller('impresion')
export class ImpresionController {
  constructor(
    @Inject(EstadoImpresionService) private readonly estado: EstadoImpresionService,
    @Inject(TrabajosService) private readonly trabajos: TrabajosService,
  ) {}

  /** 200 `estadoImpresionRespuesta`; 401; 409 `SUCURSAL_NO_ELEGIDA`. */
  @Get('estado')
  @RequiereSucursal()
  verEstado(): Promise<EstadoImpresionRespuesta> {
    return this.estado.estado();
  }

  /** 200 `trabajoResumen[]` de la sucursal activa; 400; 403; 409 `SUCURSAL_NO_ELEGIDA`. */
  @Get('trabajos')
  @Permiso('ATENDER_MESA')
  listar(
    @Query(new PipeZod(trabajosConsultaSchema)) consulta: TrabajosConsulta,
  ): Promise<TrabajoResumen[]> {
    return this.trabajos.listar(consulta);
  }

  /** 201 `{ trabajoId }`; 400 sin `Idempotency-Key`; 403; 404; 409 `SIN_IMPRESORA`. */
  @Post('trabajos/:id/reimpresion')
  @IdempotenteObligatoria()
  @Permiso('ATENDER_MESA')
  reimprimir(@Param('id', PipeUuid) id: string): Promise<TrabajoCreadoRespuesta> {
    return this.trabajos.reimprimir(id);
  }
}
