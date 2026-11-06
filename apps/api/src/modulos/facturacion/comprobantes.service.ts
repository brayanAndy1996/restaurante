import { Inject, Injectable } from '@nestjs/common';
import type {
  ComprobanteRespuesta,
  ComprobanteResumen,
  ComprobantesConsulta,
  ImpresionDeCajaRespuesta,
} from '@restaurante/contratos';
import {
  TIPOS_COMPROBANTE,
  type TipoComprobante,
  type TipoDocumentoElectronico,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { horaLocal } from '../../nucleo/reloj';
import { conMarcas, documentoDeComprobante } from '../impresion';
import { IMPRESION, type ImpresionPuerto } from '../pedidos/impresion';
import { SesionActual, requisitoDeLaPeticion } from '../seguridad';
import { RegistroAlcanceDeTurnos, veTodosLosTurnos } from './alcance-de-turnos';
import { comprobanteDeOtro, comprobanteNoEncontrado } from './errores-facturacion';
import { DevolucionDeNotaParaTicket } from './devolucion-de-nota';
import {
  RegistroIdsDeNotas,
  RegistroImpresoraDeCaja,
  RegistroPagosDeCobro,
} from './impresora-de-caja';
import { RegistroDeConectores } from './pse/registro-de-conectores';
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
  /** Las notas de crédito emitidas con este turno (6b, criterio 136): no son ventas, van aparte. */
  notasCredito: { cantidad: number; total: string };
}

/**
 * Consulta e impresión de comprobantes (historia 006, criterios 77 y 90). Un Cajero solo ve los de sus propios
 * turnos (criterio 100), que filtra con `turno_responsable_id` sin leer `turno`.
 */
@Injectable()
export class ComprobantesService {
  constructor(
    @Inject(RegistroImpresoraDeCaja) private readonly impresoras: RegistroImpresoraDeCaja,
    @Inject(RegistroPagosDeCobro) private readonly pagos: RegistroPagosDeCobro,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RegistroAlcanceDeTurnos) private readonly turnos: RegistroAlcanceDeTurnos,
    @Inject(RegistroDeConectores) private readonly conectores: RegistroDeConectores,
    @Inject(DevolucionDeNotaParaTicket) private readonly devoluciones: DevolucionDeNotaParaTicket,
    @Inject(RegistroIdsDeNotas) private readonly idsDeNotas: RegistroIdsDeNotas,
  ) {}

  /**
   * Criterios 77 y 100. 404 si es de otra sucursal, de otra empresa (la RLS lo oculta) o no existe; un Cajero solo ve
   * los de sus propios turnos (403 `PROHIBIDO`), copiados al comprobante como `turno_responsable_id`.
   */
  async consultar(id: string): Promise<ComprobanteRespuesta> {
    await this.exigirVisible(id);
    const comprobante = await leerComprobante(this.conexion, id.toLowerCase(), this.idsDeNotas);
    if (comprobante === null) throw comprobanteNoEncontrado();
    return comprobante;
  }

  /** El emisor de un comprobante visible (para la dirección de consulta de su ticket). */
  private async emisorDe(comprobanteId: string): Promise<string> {
    const filas = await this.conexion.query<{ emisor_id: string }>(
      'SELECT emisor_id FROM comprobante WHERE id = $1',
      { bind: [comprobanteId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw comprobanteNoEncontrado();
    return filas[0].emisor_id;
  }

  /** El texto del número (`B001-00000124`) de un comprobante visible; 404 si no existe (la RLS oculta los de otra empresa). */
  async numeroDe(id: string): Promise<string> {
    const filas = await this.conexion.query<{ serie: string; numero: number }>(
      'SELECT serie, numero FROM comprobante WHERE id = $1',
      { bind: [id.toLowerCase()], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw comprobanteNoEncontrado();
    return textoDelNumero(filas[0].serie, filas[0].numero);
  }

  /**
   * La reimpresión de 004 de un trabajo `COMPROBANTE` (criterio 90): el mismo permiso (`COBRAR`) y el mismo alcance que
   * `POST /comprobantes/:id/impresiones`: 403 `PROHIBIDO` para quien no tiene el permiso o es un Cajero que pide el
   * comprobante del turno de otro; 404 si es de otra sucursal.
   */
  async exigirReimpresion(id: string): Promise<void> {
    if (requisitoDeLaPeticion('COBRAR') !== 'permitido') throw comprobanteDeOtro();
    await this.exigirVisible(id);
  }

  /**
   * 404 si el comprobante es de otra sucursal, de otra empresa o no existe; 403 si es del turno de otro Cajero.
   * Devuelve la caja y el cobro del comprobante (`null` en las notas de crédito, las reemisiones y las facturas de un
   * cambio, que no nacen de un cobro).
   */
  async exigirVisible(
    id: string,
  ): Promise<{ sucursalId: string; cajaId: string; cobroId: string | null }> {
    const filas = await this.conexion.query<{
      sucursal_id: string;
      turno_responsable_id: string;
      caja_id: string;
      cobro_id: string | null;
    }>(
      'SELECT sucursal_id, turno_responsable_id, caja_id, cobro_id FROM comprobante WHERE id = $1',
      {
        bind: [id.toLowerCase()],
        type: QueryTypes.SELECT,
      },
    );
    const fila = filas[0];
    if (fila === undefined || fila.sucursal_id !== this.sesion.sucursalActiva()) {
      throw comprobanteNoEncontrado();
    }
    const principal = this.sesion.principal();
    if (!veTodosLosTurnos(principal) && fila.turno_responsable_id !== principal.usuarioId) {
      throw comprobanteDeOtro();
    }
    return { sucursalId: fila.sucursal_id, cajaId: fila.caja_id, cobroId: fila.cobro_id };
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
      tipo: TipoDocumentoElectronico;
      serie: string;
      numero: number;
      estado: ComprobanteResumen['estado'];
      total: string;
      emitido_en: Date;
      cliente_nombre: string | null;
      caja_id: string;
      turno_id: string | null;
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
   * Criterio 90: reimprime el ticket con la marca "REIMPRESIÓN" en la impresora de la caja del comprobante, que le da el
   * módulo de caja por `RegistroImpresoraDeCaja`. Copia el documento del ticket de la emisión (sin el pulso de la
   * gaveta: criterio 94) y, si el comprobante se emitió sin impresora, lo arma de nuevo con los pagos del cobro.
   * 409 `SIN_IMPRESORA` si no hay impresora de caja ni de la sucursal.
   */
  async imprimir(id: string): Promise<ImpresionDeCajaRespuesta> {
    const visible = await this.exigirVisible(id);
    const comprobanteId = id.toLowerCase();
    const impresora = await this.impresoras.deLaCaja(visible.cajaId);
    if (impresora === null) {
      throw new ErrorAplicacion(
        409,
        'SIN_IMPRESORA',
        'No hay una impresora activa donde reimprimir este ticket',
      );
    }
    const comprobante = await leerComprobante(this.conexion, comprobanteId, null);
    if (comprobante === null) throw comprobanteNoEncontrado();
    const original = await this.impresion.trabajoDeComprobante(comprobanteId);
    let documento;
    if (original !== null) {
      const sinPulso = original.documento.bloques.filter((b) => b.tipo !== 'gaveta');
      documento = conMarcas({ ...original.documento, bloques: sinPulso }, { reimpresion: true });
    } else {
      const cobro = visible.cobroId === null ? null : await this.pagos.deCobro(visible.cobroId);
      // La leyenda con la dirección de consulta del emisor y, en una nota de crédito, la devolución por medio (criterio
      // 157): facturación no lee `movimiento_caja`, así que los egresos los da el puerto de caja (falla cerrado).
      const urlConsulta = await this.conectores.urlConsulta(await this.emisorDe(comprobanteId));
      const esNota = comprobante.afectaA !== undefined && comprobante.afectaA !== null;
      const devolucion = esNota ? await this.devoluciones.de(comprobanteId) : null;
      documento = conMarcas(
        documentoDeComprobante(comprobante, {
          hora: horaLocal(new Date(comprobante.emitidoEn)),
          pagos: cobro?.pagos ?? [],
          vuelto: cobro?.vuelto ?? '0.00',
          redondeo: cobro?.redondeo ?? '0.00',
          abreGaveta: false,
          urlConsulta,
          devolucion,
        }),
        { reimpresion: true },
      );
    }
    const orden = comprobante.orden;
    const [trabajoId] = await this.impresion.encolar([
      {
        sucursalId: visible.sucursalId,
        impresoraId: impresora.id,
        estacionId: null,
        tipo: 'COMPROBANTE',
        comandaId: null,
        precuentaId: null,
        comprobanteId,
        turnoId: null,
        reimpresionDeId: original?.id ?? null,
        mesa:
          orden === null
            ? null
            : orden.numeroLlamado !== null
              ? `Llamado ${orden.numeroLlamado}`
              : orden.mesas.join(', '),
        ordenId: orden?.id ?? null,
        envioNumero: null,
        documento,
      },
    ]);
    return { trabajoId: trabajoId ?? null, impresion: 'EN_COLA' };
  }

  /**
   * El resumen tributario de un turno para el X y la Z (montos en `NUMERIC`): cuántos comprobantes, su total (lo
   * emitido, con ICBPER y sin restar el redondeo), el total por tipo, los descuentos, el valor referencial de las
   * cortesías (suma de las líneas gratuitas, así cuenta también con un emisor Nuevo RUS), el IGV y el ICBPER. Suma solo
   * los comprobantes nacidos de un cobro (`cobro_id` no nulo, 6b criterio 136): ni las notas de crédito, ni las
   * reemisiones, ni las facturas de un cambio son dinero nuevo, y el estado ante SUNAT no cuenta. Las notas de crédito
   * emitidas con el turno se devuelven aparte en `notasCredito`, sin contar dos veces una nota rechazada y su reemisión:
   * la que reemplazó una reemisión no cuenta (criterios 136 y 148), igual que al calcular lo que queda por acreditar.
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
        WHERE c.turno_id = $1 AND c.cobro_id IS NOT NULL
        GROUP BY ROLLUP (c.tipo)`,
      { bind: [turnoId], type: QueryTypes.SELECT },
    );
    const notas = await this.conexion.query<{ cantidad: number; total: string }>(
      `SELECT count(*)::int AS cantidad, coalesce(sum(n.total), 0)::numeric(14, 2)::text AS total
         FROM comprobante n
        WHERE n.turno_id = $1 AND n.afecta_a_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM comprobante r WHERE r.reemplaza_a_id = n.id)`,
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
      notasCredito: { cantidad: notas[0]?.cantidad ?? 0, total: notas[0]?.total ?? '0.00' },
    };
  }
}
