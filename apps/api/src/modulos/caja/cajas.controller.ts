import { Body, Controller, Get, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import {
  cajaEntradaSchema,
  cajaModificarEntradaSchema,
  serieEntradaDeTipoSchema,
  serieEntradaSchema,
  tipoSerieSchema,
  type CajaEntrada,
  type CajaModificarEntrada,
  type CajaRespuesta,
  type SerieEntrada,
} from '@restaurante/contratos';
import type { TipoComprobante } from '@restaurante/dominio';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { CajasService } from './cajas.service';

/**
 * Cajas y series (historia 006, criterios 1 a 7) y la lista de cajas para abrir turno (criterio 27). Las de
 * configuración llevan `ADMINISTRAR` sin módulo y con la sucursal en la ruta (el Administrador configura cualquier
 * sucursal de su empresa, con o sin sucursal activa), como las impresoras; `GET /cajas`, `OPERAR_CAJA` y `CAJA`.
 */
@Controller()
export class CajasController {
  constructor(@Inject(CajasService) private readonly cajas: CajasService) {}

  /** 200 `cajaRespuesta[]`; 403; 404 (sucursal de otra empresa o inexistente). */
  @Get('sucursales/:sucursalId/cajas')
  @Permiso('ADMINISTRAR')
  listar(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<CajaRespuesta[]> {
    return this.cajas.listar(sucursalId);
  }

  /** 201 `cajaRespuesta`; 400; 403; 404; 409 `CONFLICTO` (nombre repetido o más de 10 activas); 422. Con `Idempotency-Key` opcional. */
  @Post('sucursales/:sucursalId/cajas')
  @Idempotente()
  @Permiso('ADMINISTRAR')
  crear(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(cajaEntradaSchema)) entrada: CajaEntrada,
  ): Promise<CajaRespuesta> {
    return this.cajas.crear(sucursalId, entrada);
  }

  /** 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO` (caja con turno abierto); 422. Sin cambios, 200 sin auditoría. */
  @Patch('sucursales/:sucursalId/cajas/:id')
  @Permiso('ADMINISTRAR')
  modificar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(cajaModificarEntradaSchema)) entrada: CajaModificarEntrada,
  ): Promise<CajaRespuesta> {
    return this.cajas.modificar(sucursalId, id, entrada);
  }

  /**
   * 200 `cajaRespuesta`; 400 (la serie no es `B…` para `BOLETA` ni `F…` para `FACTURA`); 403; 404; 409
   * `CONFLICTO` (serie de otra caja del emisor, o `primerNumero` distinto al guardado). Repetir lo que ya está activo
   * responde 200 sin auditoría.
   */
  @Put('sucursales/:sucursalId/cajas/:cajaId/series/:tipo')
  @Permiso('ADMINISTRAR')
  configurarSerie(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('cajaId', PipeUuid) cajaId: string,
    @Param('tipo', new PipeZod(tipoSerieSchema)) tipo: TipoComprobante,
    @Body(new PipeZod(serieEntradaSchema)) entrada: SerieEntrada,
  ): Promise<CajaRespuesta> {
    // El prefijo debe coincidir con el tipo de la ruta (`B…` para boletas, `F…` para facturas).
    const validada = new PipeZod(serieEntradaDeTipoSchema(tipo)).transform(entrada);
    return this.cajas.configurarSerie(sucursalId, cajaId, tipo, validada);
  }

  /** 200 `cajaRespuesta[]` (las activas de la sucursal activa, sin montos); 403. */
  @Get('cajas')
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  activas(): Promise<CajaRespuesta[]> {
    return this.cajas.activasDeLaSucursal();
  }
}
