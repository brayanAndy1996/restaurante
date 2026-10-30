import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import {
  estacionDestinoEntradaSchema,
  impresionSucursalEntradaSchema,
  type EstacionDestinoEntrada,
  type EstacionDestinoRespuesta,
  type ImpresionSucursalEntrada,
  type ImpresionSucursalRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Permiso } from '../seguridad';
import { DestinosService } from './destinos.service';

/**
 * Destino de cada estación y impresora de caja (historia 004, criterios 99 a 102): `ADMINISTRAR` en todas, con la
 * sucursal en la ruta (el Administrador configura cualquier sucursal de su empresa, con o sin sucursal activa), sin
 * `@RequiereModulo`: las rutas de configuración no dependen del plan, como la carta y el mapa de mesas.
 */
@Controller('sucursales/:sucursalId')
export class DestinosController {
  constructor(@Inject(DestinosService) private readonly destinos: DestinosService) {}

  /** 200 con una fila por estación activa (sin configurar, `KDS`); 403; 404. */
  @Get('estaciones-destino')
  @Permiso('ADMINISTRAR')
  listarDestinos(
    @Param('sucursalId', PipeUuid) sucursalId: string,
  ): Promise<EstacionDestinoRespuesta[]> {
    return this.destinos.listar(sucursalId);
  }

  /** 200; 400; 403; 404 (sucursal o estación); 422 `REFERENCIA_INVALIDA` (impresora). Repetirlo no audita. */
  @Put('estaciones-destino/:estacionId')
  @Permiso('ADMINISTRAR')
  configurarDestino(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('estacionId', PipeUuid) estacionId: string,
    @Body(new PipeZod(estacionDestinoEntradaSchema)) entrada: EstacionDestinoEntrada,
  ): Promise<EstacionDestinoRespuesta> {
    return this.destinos.configurar(sucursalId, estacionId, entrada);
  }

  /** 200 `{ impresoraCajaId }`; 403; 404. */
  @Get('impresion')
  @Permiso('ADMINISTRAR')
  verImpresion(
    @Param('sucursalId', PipeUuid) sucursalId: string,
  ): Promise<ImpresionSucursalRespuesta> {
    return this.destinos.verImpresion(sucursalId);
  }

  /** 200; 400; 403; 404; 422 `REFERENCIA_INVALIDA`. Repetirlo no audita. */
  @Put('impresion')
  @Permiso('ADMINISTRAR')
  configurarImpresion(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(impresionSucursalEntradaSchema)) entrada: ImpresionSucursalEntrada,
  ): Promise<ImpresionSucursalRespuesta> {
    return this.destinos.configurarImpresion(sucursalId, entrada);
  }
}
