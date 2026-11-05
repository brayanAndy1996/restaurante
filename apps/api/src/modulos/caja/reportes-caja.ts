import { Inject, Injectable } from '@nestjs/common';
import type { MovimientoRespuesta, ReporteCaja } from '@restaurante/contratos';
import {
  MEDIOS_PAGO,
  esperadoDelTurno,
  type MedioPago,
  type TipoMovimientoCaja,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { ComprobantesService } from '../facturacion';
import { UsuariosConsultaService } from '../seguridad';
import { buscarTurno, turnoARespuesta } from './lectura-turno';
import { noEncontrado } from './errores-caja';

/** Lo que los cobros del turno aportan al reporte: sumas por medio, redondeos y vueltos. */
interface SumasDeCobros {
  porMedio: { medio: MedioPago; cantidad: number; monto: string }[];
  redondeos: string;
  vueltos: string;
}

interface FilaMovimiento {
  id: string;
  tipo: TipoMovimientoCaja;
  monto: string;
  motivo: string;
  creado_en: Date;
  creado_por_usuario_id: string | null;
}

/**
 * Arma el `reporteCaja` de un turno para el X y el Z (historia 006, criterios 29 y 31) con un número fijo de
 * consultas. Caja suma sus propias tablas (cobros, pagos por medio, redondeos, vueltos y movimientos, montos en
 * `NUMERIC`); lo que está en los comprobantes (cantidad y total por tipo, descuentos, cortesías, IGV e ICBPER) lo da
 * `ComprobantesService.resumenDeTurno` de facturación, porque caja no lee `comprobante`. El esperado sale de
 * `esperadoDelTurno` de `packages/dominio`. Un turno cerrado trae además su `cierre`.
 */
@Injectable()
export class ReportesCaja {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ComprobantesService) private readonly comprobantes: ComprobantesService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
  ) {}

  async armar(turnoId: string): Promise<ReporteCaja> {
    const fila = await buscarTurno(this.conexion, turnoId);
    if (fila === undefined) throw noEncontrado('El turno');
    const movimientos = await this.conexion.query<FilaMovimiento>(
      `SELECT id, tipo, monto::text AS monto, motivo, creado_en, creado_por_usuario_id
         FROM movimiento_caja WHERE turno_id = $1 ORDER BY creado_en, id`,
      { bind: [turnoId], type: QueryTypes.SELECT },
    );
    const sumas = (
      await this.conexion.query<{ ingresos: string; egresos: string }>(
        `SELECT coalesce(sum(monto) FILTER (WHERE tipo = 'INGRESO'), 0)::numeric(14, 2)::text AS ingresos,
                coalesce(sum(monto) FILTER (WHERE tipo = 'EGRESO'), 0)::numeric(14, 2)::text AS egresos
           FROM movimiento_caja WHERE turno_id = $1`,
        { bind: [turnoId], type: QueryTypes.SELECT },
      )
    )[0]!;
    const resumen = await this.comprobantes.resumenDeTurno(turnoId);
    const cobros = await this.sumasDeCobros(turnoId);
    const esperado = esperadoDelTurno({
      fondo: fila.fondo,
      pagos: cobros.porMedio.map((m) => ({ medio: m.medio, monto: m.monto })),
      movimientos: movimientos.map((m) => ({ tipo: m.tipo, monto: m.monto })),
    });
    const nombres = await this.usuarios.nombres(
      movimientos.flatMap((m) =>
        m.creado_por_usuario_id === null ? [] : [m.creado_por_usuario_id],
      ),
    );
    const lista: MovimientoRespuesta[] = movimientos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      monto: m.monto,
      motivo: m.motivo,
      creadoEn: m.creado_en.toISOString(),
      creadoPor:
        m.creado_por_usuario_id === null
          ? null
          : { id: m.creado_por_usuario_id, nombre: nombres.get(m.creado_por_usuario_id) ?? '' },
    }));
    const turno = await turnoARespuesta(this.usuarios, fila);
    const reporte: ReporteCaja = {
      turno,
      generadoEn: this.reloj.ahora().toISOString(),
      fondo: fila.fondo,
      ventas: {
        total: resumen.total,
        cantidad: resumen.cantidad,
        porTipo: resumen.porTipo,
        porMedio: cobros.porMedio,
        descuentos: resumen.descuentos,
        cortesias: resumen.cortesias,
        igv: resumen.igv,
        icbper: resumen.icbper,
        redondeos: cobros.redondeos,
        vueltos: cobros.vueltos,
      },
      movimientos: { ingresos: sumas.ingresos, egresos: sumas.egresos, lista },
      esperado,
    };
    if (fila.estado === 'CERRADO' && turno.cerradoEn !== null && turno.cerradoPor !== null) {
      reporte.cierre = {
        cerradoEn: turno.cerradoEn,
        cerradoPor: turno.cerradoPor,
        conteo: await this.conteoGuardado(turnoId),
      };
    }
    return reporte;
  }

  /** El conteo que guardó el cierre, en el orden de `MEDIOS_PAGO`. */
  private async conteoGuardado(
    turnoId: string,
  ): Promise<NonNullable<ReporteCaja['cierre']>['conteo']> {
    const filas = await this.conexion.query<{
      medio: MedioPago;
      esperado: string;
      contado: string;
      diferencia: string;
      motivo: string | null;
    }>(
      `SELECT medio, esperado::text AS esperado, contado::text AS contado, diferencia::text AS diferencia, motivo
         FROM turno_conteo WHERE turno_id = $1`,
      { bind: [turnoId], type: QueryTypes.SELECT },
    );
    return MEDIOS_PAGO.flatMap((medio) => {
      const f = filas.find((x) => x.medio === medio);
      return f === undefined ? [] : [f];
    });
  }

  /**
   * Los cobros del turno por medio, con los redondeos y los vueltos: dos consultas de sumas en `NUMERIC`, sin importar
   * cuántos cobros tenga el turno. `cantidad` es la de pagos del medio; los cinco medios salen siempre, en cero si no
   * hubo ninguno. El efectivo cuenta lo que quedó en la caja (`pago.monto`, sin el vuelto).
   */
  private async sumasDeCobros(turnoId: string): Promise<SumasDeCobros> {
    const pagos = await this.conexion.query<{ medio: MedioPago; cantidad: number; monto: string }>(
      `SELECT medio, count(*)::int AS cantidad, sum(monto)::numeric(14, 2)::text AS monto
         FROM pago WHERE turno_id = $1 GROUP BY medio`,
      { bind: [turnoId], type: QueryTypes.SELECT },
    );
    const [totales] = await this.conexion.query<{ redondeos: string; vueltos: string }>(
      `SELECT coalesce(sum(redondeo), 0)::numeric(14, 2)::text AS redondeos,
              coalesce(sum(vuelto), 0)::numeric(14, 2)::text AS vueltos
         FROM cobro WHERE turno_id = $1`,
      { bind: [turnoId], type: QueryTypes.SELECT },
    );
    return {
      porMedio: MEDIOS_PAGO.map((medio) => {
        const fila = pagos.find((p) => p.medio === medio);
        return { medio, cantidad: fila?.cantidad ?? 0, monto: fila?.monto ?? '0.00' };
      }),
      redondeos: totales?.redondeos ?? '0.00',
      vueltos: totales?.vueltos ?? '0.00',
    };
  }
}
