import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  impresoraEntradaSchema,
  impresoraModificarEntradaSchema,
  type ImpresoraEntradaValidada,
  type ImpresoraModificarEntradaValidada,
  type ImpresoraRespuesta,
  type TrabajoCreadoRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente, IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { ImpresorasService } from './impresoras.service';
import { TrabajosService } from './trabajos.service';

/**
 * Impresoras de la sucursal (historia 004, criterios 103 a 105 y 127): `ADMINISTRAR` en todas, con la sucursal en
 * la ruta (el Administrador configura cualquier sucursal de su empresa, con o sin sucursal activa), sin
 * `@RequiereModulo`. La página de prueba (criterio 127) lleva `Idempotency-Key` obligatoria.
 */
@Controller('sucursales/:sucursalId/impresoras')
export class ImpresorasController {
  constructor(
    @Inject(ImpresorasService) private readonly impresoras: ImpresorasService,
    @Inject(TrabajosService) private readonly trabajos: TrabajosService,
  ) {}

  /** 200 con las impresoras (activas e inactivas), su estado y sus pendientes; 403; 404. */
  @Get()
  @Permiso('ADMINISTRAR')
  listar(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<ImpresoraRespuesta[]> {
    return this.impresoras.listar(sucursalId);
  }

  /** 201; 400; 403; 404; 409 `CONFLICTO` (nombre repetido). Con `Idempotency-Key` opcional. */
  @Post()
  @Idempotente()
  @Permiso('ADMINISTRAR')
  crear(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(impresoraEntradaSchema)) entrada: ImpresoraEntradaValidada,
  ): Promise<ImpresoraRespuesta> {
    return this.impresoras.crear(sucursalId, entrada);
  }

  /** 200; 400; 403; 404; 409 `CONFLICTO` (nombre) o `EN_USO` (al desactivar). Sin cambios, 200 sin auditoría. */
  @Patch(':id')
  @Permiso('ADMINISTRAR')
  modificar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(impresoraModificarEntradaSchema)) cambios: ImpresoraModificarEntradaValidada,
  ): Promise<ImpresoraRespuesta> {
    return this.impresoras.modificar(sucursalId, id, cambios);
  }

  /** 201 `{ trabajoId }` (también con la impresora inactiva); 400 sin `Idempotency-Key`; 403; 404. */
  @Post(':id/prueba')
  @IdempotenteObligatoria()
  @Permiso('ADMINISTRAR')
  paginaDePrueba(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('id', PipeUuid) id: string,
  ): Promise<TrabajoCreadoRespuesta> {
    return this.trabajos.paginaDePrueba(sucursalId, id);
  }
}
