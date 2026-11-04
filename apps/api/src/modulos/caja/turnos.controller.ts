import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  abrirTurnoEntradaSchema,
  cierreEntradaSchema,
  movimientoEntradaSchema,
  type AbrirTurnoEntrada,
  type CierreEntradaValidada,
  type ImpresionDeCajaRespuesta,
  type MovimientoEntrada,
  type MovimientoRespuesta,
  type ReporteCaja,
  type TurnoRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { TurnosService } from './turnos.service';

/**
 * Turnos de caja (historia 006, criterios 24 a 35): `OPERAR_CAJA` y módulo `CAJA` en todas; las escrituras llevan
 * `Idempotency-Key` obligatoria. El orden de los interceptores es el de 004: de abajo hacia arriba, el permiso (con la
 * sucursal activa primero), el módulo y la idempotencia.
 */
@Controller('turnos')
export class TurnosController {
  constructor(@Inject(TurnosService) private readonly turnos: TurnosService) {}

  /** 201 `turnoRespuesta`; 400; 403 (sucursal suspendida, criterio 25); 404; 409 `TURNO_YA_ABIERTO` / `CONFLICTO`; 422. */
  @Post()
  @IdempotenteObligatoria()
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  abrir(
    @Body(new PipeZod(abrirTurnoEntradaSchema)) entrada: AbrirTurnoEntrada,
  ): Promise<TurnoRespuesta> {
    return this.turnos.abrir(entrada);
  }

  /** 200 `turnoRespuesta` (el turno abierto de la persona en la sucursal activa); 404. Antes que `:id`. */
  @Get('mio')
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  mio(): Promise<TurnoRespuesta> {
    return this.turnos.mio();
  }

  /** 200; 403; 404. */
  @Get(':id')
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  consultar(@Param('id', PipeUuid) id: string): Promise<TurnoRespuesta> {
    return this.turnos.consultar(id);
  }

  /** 201; 400; 403; 404; 409 `TURNO_CERRADO` / `TURNO_AJENO`; 422. */
  @Post(':id/movimientos')
  @IdempotenteObligatoria()
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  registrarMovimiento(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(movimientoEntradaSchema)) entrada: MovimientoEntrada,
  ): Promise<MovimientoRespuesta> {
    return this.turnos.registrarMovimiento(id, entrada);
  }

  /** 200 `reporteCaja` (el X de un turno abierto o el Z de uno cerrado); 403; 404. */
  @Get(':id/reporte')
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  reporte(@Param('id', PipeUuid) id: string): Promise<ReporteCaja> {
    return this.turnos.reporte(id);
  }

  /** 201 `{ trabajoId, impresion }`; 403; 404. */
  @Post(':id/reporte-x/impresiones')
  @IdempotenteObligatoria()
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  imprimirReporteX(@Param('id', PipeUuid) id: string): Promise<ImpresionDeCajaRespuesta> {
    return this.turnos.imprimirReporteX(id);
  }

  /**
   * 200 `reporteCaja` con `cierre`; 400; 403; 404; 409 `TURNO_CERRADO` / `TURNO_AJENO` / `CIERRE_BLOQUEADO`; 422
   * `DIFERENCIA_SIN_MOTIVO`.
   */
  @Post(':id/cierre')
  @HttpCode(200)
  @IdempotenteObligatoria()
  @RequiereModulo('CAJA')
  @Permiso('OPERAR_CAJA')
  cerrar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(cierreEntradaSchema)) entrada: CierreEntradaValidada,
  ): Promise<ReporteCaja> {
    return this.turnos.cerrar(id, entrada);
  }
}
