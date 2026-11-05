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
import { SesionActual } from '../seguridad';
import { RegistroAlcanceDeTurnos, veTodosLosTurnos } from './alcance-de-turnos';
import { comprobanteDeOtro, comprobanteNoEncontrado } from './errores-facturacion';
import { RegistroImpresoraDeCaja } from './impresora-de-caja';
import { leerComprobante, textoDelNumero } from './lectura-comprobante';

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
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RegistroAlcanceDeTurnos) private readonly turnos: RegistroAlcanceDeTurnos,
  ) {}

  /**
   * Criterios 77 y 100. 404 si es de otra sucursal, de otra empresa (la RLS lo oculta) o no existe; un Cajero solo ve
   * los de sus propios turnos (403 `PROHIBIDO`), copiados al comprobante como `turno_responsable_id`.
   */
  async consultar(id: string): Promise<ComprobanteRespuesta> {
    await this.exigirVisible(id);
    const comprobante = await leerComprobante(this.conexion, id.toLowerCase());
    if (comprobante === null) throw comprobanteNoEncontrado();
    return comprobante;
  }

  /** 404 si el comprobante es de otra sucursal, de otra empresa o no existe; 403 si es del turno de otro Cajero. */
  private async exigirVisible(id: string): Promise<void> {
    const filas = await this.conexion.query<{ sucursal_id: string; turno_responsable_id: string }>(
      'SELECT sucursal_id, turno_responsable_id FROM comprobante WHERE id = $1',
      { bind: [id.toLowerCase()], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined || fila.sucursal_id !== this.sesion.sucursalActiva()) {
      throw comprobanteNoEncontrado();
    }
    const principal = this.sesion.principal();
    if (!veTodosLosTurnos(principal) && fila.turno_responsable_id !== principal.usuarioId) {
      throw comprobanteDeOtro();
    }
  }

  /**
   * Hasta 200 de la sucursal activa, del más nuevo al más antiguo, de un turno o de una orden (criterio 77). Un Cajero
   * solo ve los de sus propios turnos (criterio 100): pedir los de un turno ajeno es 403 `PROHIBIDO`, aunque ese turno
   * todavía no tenga ninguno, y sin `turnoId` la lista se limita a los suyos.
   */
  async listar(consulta: ComprobantesConsulta): Promise<ComprobanteResumen[]> {
    const principal = this.sesion.principal();
    const propios = !veTodosLosTurnos(principal);
    if (propios && consulta.turnoId !== undefined) {
      const responsable = await this.turnos.responsableDe(consulta.turnoId.toLowerCase());
      if (responsable === null || responsable !== principal.usuarioId) throw comprobanteDeOtro();
    }
    const filas = await this.conexion.query<{
      id: string;
      tipo: TipoComprobante;
      serie: string;
      numero: number;
      estado: ComprobanteResumen['estado'];
      total: string;
      emitido_en: Date;
      cliente_nombre: string | null;
      caja_id: string;
      turno_id: string;
      orden_id: string | null;
    }>(
      `SELECT id, tipo, serie, numero, estado, total::text AS total, emitido_en, cliente_nombre, caja_id, turno_id,
              orden_id
         FROM comprobante
        WHERE sucursal_id = $1
          AND ($2::uuid IS NULL OR turno_id = $2::uuid)
          AND ($3::uuid IS NULL OR orden_id = $3::uuid)
          AND ($4::uuid IS NULL OR turno_responsable_id = $4::uuid)
        ORDER BY emitido_en DESC, numero_parte DESC NULLS LAST, serie, numero DESC, id
        LIMIT 200`,
      {
        bind: [
          this.sesion.sucursalActiva(),
          consulta.turnoId?.toLowerCase() ?? null,
          consulta.ordenId?.toLowerCase() ?? null,
          propios ? principal.usuarioId : null,
        ],
        type: QueryTypes.SELECT,
      },
    );
    return filas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      numero: textoDelNumero(f.serie, f.numero),
      estado: f.estado,
      total: f.total,
      emitidoEn: f.emitido_en.toISOString(),
      cliente: f.cliente_nombre,
      cajaId: f.caja_id,
      turnoId: f.turno_id,
      ordenId: f.orden_id,
    }));
  }

  /** Tipo y número de cada comprobante, para la cuenta (`cobros[].comprobante`); caja no lee `comprobante`. */
  async numerosDe(
    ids: readonly string[],
  ): Promise<
    Map<string, { id: string; tipo: TipoComprobante; numero: string; numeroParte: number }>
  > {
    if (ids.length === 0) return new Map();
    const filas = await this.conexion.query<{
      id: string;
      tipo: TipoComprobante;
      serie: string;
      numero: number;
      numero_parte: number | null;
    }>('SELECT id, tipo, serie, numero, numero_parte FROM comprobante WHERE id = ANY($1::uuid[])', {
      bind: [ids],
      type: QueryTypes.SELECT,
    });
    return new Map(
      filas.map((f) => [
        f.id,
        {
          id: f.id,
          tipo: f.tipo,
          numero: textoDelNumero(f.serie, f.numero),
          numeroParte: f.numero_parte ?? 0,
        },
      ]),
    );
  }

  /**
   * Reimprime el ticket con la marca "REIMPRESIÓN" en la impresora de la caja del comprobante, que le da el módulo
   * de caja por `RegistroImpresoraDeCaja`. 409 `SIN_IMPRESORA` si no hay impresora de caja.
   */
  async imprimir(id: string): Promise<ImpresionDeCajaRespuesta> {
    // El alcance (404 y 403) se comprueba ya; el trabajo de reimpresión llega con la tarea T21.
    await this.exigirVisible(id);
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
