import { Inject, Injectable } from '@nestjs/common';
import type {
  ComprobanteRespuesta,
  ComprobanteResumen,
  ComprobantesConsulta,
  ImpresionDeCajaRespuesta,
} from '@restaurante/contratos';
import { TIPOS_COMPROBANTE, type TipoComprobante } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { noImplementado } from '../../nucleo/errores';
import { RegistroImpresoraDeCaja } from './impresora-de-caja';

/**
 * Lo que los comprobantes de un turno aportan al reporte X y a la Z (historia 006, criterio 29): caja no lee
 * `comprobante`, así que facturación lo suma con `comprobante.turno_id`.
 */
export interface ResumenTributarioDeTurno {
  /** Comprobantes del turno y la suma de sus totales. */
  cantidad: number;
  total: string;
  porTipo: { tipo: TipoComprobante; cantidad: number; total: string }[];
  descuentos: string;
  /** Valor referencial de las operaciones gratuitas (cortesías). */
  cortesias: string;
  igv: string;
  icbper: string;
}

/**
 * Consulta e impresión de comprobantes (historia 006, criterios 77 y 90). Un Cajero solo ve los de sus propios
 * turnos (criterio 100), que filtra con `turno_responsable_id` sin leer `turno`. FIRMAS de la fase A.
 */
@Injectable()
export class ComprobantesService {
  constructor(
    @Inject(RegistroImpresoraDeCaja) private readonly impresoras: RegistroImpresoraDeCaja,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
  ) {}

  async consultar(_id: string): Promise<ComprobanteRespuesta> {
    throw noImplementado();
  }

  /** Hasta 200, del más nuevo al más antiguo. */
  async listar(_consulta: ComprobantesConsulta): Promise<ComprobanteResumen[]> {
    throw noImplementado();
  }

  /**
   * Reimprime el ticket con la marca "REIMPRESIÓN" en la impresora de la caja del comprobante, que le da el módulo
   * de caja por `RegistroImpresoraDeCaja`. 409 `SIN_IMPRESORA` si no hay impresora de caja.
   */
  async imprimir(_id: string): Promise<ImpresionDeCajaRespuesta> {
    void this.impresoras;
    throw noImplementado();
  }

  /**
   * El resumen tributario de un turno para el X y la Z (una consulta, montos en `NUMERIC`): cuántos comprobantes, su
   * total (lo emitido, con ICBPER y sin restar el redondeo), el total por tipo, los descuentos, el valor referencial de
   * las cortesías (suma de las líneas gratuitas, así cuenta también con un emisor Nuevo RUS), el IGV y el ICBPER.
   */
  async resumenDeTurno(turnoId: string): Promise<ResumenTributarioDeTurno> {
    const filas = await this.conexion.query<{
      tipo: TipoComprobante | null;
      es_total: boolean;
      cantidad: number;
      total: string;
      descuentos: string;
      cortesias: string;
      igv: string;
      icbper: string;
    }>(
      `SELECT c.tipo, GROUPING(c.tipo) = 1 AS es_total, count(c.id)::int AS cantidad,
              coalesce(sum(c.total), 0)::numeric(14, 2)::text AS total,
              coalesce(sum(c.descuentos), 0)::numeric(14, 2)::text AS descuentos,
              coalesce(sum((SELECT coalesce(sum(l.valor_referencial), 0)
                              FROM comprobante_linea l
                             WHERE l.comprobante_id = c.id AND l.gratuita)), 0)::numeric(14, 2)::text AS cortesias,
              coalesce(sum(c.igv), 0)::numeric(14, 2)::text AS igv,
              coalesce(sum(c.icbper), 0)::numeric(14, 2)::text AS icbper
         FROM comprobante c
        WHERE c.turno_id = $1
        GROUP BY ROLLUP (c.tipo)`,
      { bind: [turnoId], type: QueryTypes.SELECT },
    );
    const total = filas.find((f) => f.es_total);
    const porTipo = TIPOS_COMPROBANTE.flatMap((tipo) => {
      const fila = filas.find((f) => !f.es_total && f.tipo === tipo);
      return fila === undefined ? [] : [{ tipo, cantidad: fila.cantidad, total: fila.total }];
    });
    return {
      cantidad: total?.cantidad ?? 0,
      total: total?.total ?? '0.00',
      porTipo,
      descuentos: total?.descuentos ?? '0.00',
      cortesias: total?.cortesias ?? '0.00',
      igv: total?.igv ?? '0.00',
      icbper: total?.icbper ?? '0.00',
    };
  }
}
