import { Inject, Injectable } from '@nestjs/common';
import type { SerieEntrada, SerieRespuesta } from '@restaurante/contratos';
import type { TipoComprobante } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { primerNumeroDistinto, serieAgotada, serieOcupada, sinSerie } from './errores-facturacion';

/**
 * Series de comprobantes por caja (historia 006, criterios 3 a 5 y 70; ruta crítica P4): dueño de la tabla `serie`.
 * Una serie pertenece al emisor de la sucursal de la caja al crearla, es única por emisor y tipo (en ninguna caja ni
 * sucursal se repite, activa o inactiva) y no se edita ni se borra: solo se activa o se desactiva. Numera con
 * `UPDATE … RETURNING` dentro de la transacción del cobro, así una reversión no deja huecos (criterio 71).
 */

/** Índice único por emisor, tipo y serie (migración `202611040003-facturacion`). */
const INDICE_SERIE_UNICA = 'serie_emisor_tipo_serie_unica';
/** `CHECK` del correlativo (`primer_numero - 1` a 99999999): al pasarse es `SERIE_AGOTADA`. */
const CHECK_ULTIMO_NUMERO = 'serie_ultimo_numero_ck';
const SQLSTATE_CHECK = '23514';

export interface ConfigurarSerie {
  sucursalId: string;
  cajaId: string;
  /** El emisor de la sucursal de la caja ahora (lo da plataforma): una serie pertenece al emisor con que se creó. */
  emisorId: string;
  tipo: TipoComprobante;
  entrada: SerieEntrada;
}

/** El número que tomó un comprobante de la serie de su caja. */
export interface NumeroTomado {
  serieId: string;
  serie: string;
  numero: number;
}

interface FilaSerie {
  id: string;
  caja_id: string;
  primer_numero: number;
  ultimo_numero: number;
  activa: boolean;
}

@Injectable()
export class SeriesService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Deja la serie dada como la activa de ese tipo en la caja (la anterior queda inactiva con sus números) o reactiva
   * una inactiva de la caja. Quien llama (el módulo de caja) ya comprobó que la caja es de la sucursal y tomó su fila
   * para turnar las configuraciones de la caja. 409 `CONFLICTO` con `campos.serie` si otra caja del emisor ya la usa
   * y con `campos.primerNumero` si la serie ya existe con otro primer número. Repetir lo que ya está activo no
   * cambia nada ni deja fila de auditoría.
   */
  async configurar(datos: ConfigurarSerie): Promise<void> {
    const { sucursalId, cajaId, emisorId, tipo, entrada } = datos;
    const existentes = await this.conexion.query<FilaSerie>(
      `SELECT id, caja_id, primer_numero, ultimo_numero, activa FROM serie
        WHERE emisor_id = $1 AND tipo = $2 AND serie = $3 FOR UPDATE`,
      { bind: [emisorId, tipo, entrada.serie], type: QueryTypes.SELECT },
    );
    const existente = existentes[0];
    if (existente !== undefined && existente.caja_id !== cajaId) {
      throw serieOcupada(entrada.serie);
    }
    if (
      existente !== undefined &&
      entrada.primerNumero !== undefined &&
      entrada.primerNumero !== existente.primer_numero
    ) {
      throw primerNumeroDistinto(existente.primer_numero);
    }
    if (existente?.activa === true) return;

    const ahora = this.reloj.ahora();
    const desactivadas = await this.conexion.query<{ serie: string }>(
      `UPDATE serie SET activa = false, actualizado_en = $3
        WHERE caja_id = $1 AND tipo = $2 AND activa RETURNING serie`,
      { bind: [cajaId, tipo, ahora], type: QueryTypes.SELECT },
    );
    let serieId: string;
    let primerNumero: number;
    let ultimoNumero: number;
    if (existente !== undefined) {
      await this.conexion.query(
        `UPDATE serie SET activa = true, actualizado_en = $2 WHERE id = $1`,
        {
          bind: [existente.id, ahora],
          type: QueryTypes.UPDATE,
        },
      );
      serieId = existente.id;
      primerNumero = existente.primer_numero;
      ultimoNumero = existente.ultimo_numero;
    } else {
      primerNumero = entrada.primerNumero ?? 1;
      ultimoNumero = primerNumero - 1;
      try {
        const creadas = await this.conexion.query<{ id: string }>(
          `INSERT INTO serie (empresa_id, caja_id, emisor_id, tipo, serie, primer_numero, ultimo_numero, activa,
                              creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $8) RETURNING id`,
          {
            bind: [
              this.contexto.empresaActual(),
              cajaId,
              emisorId,
              tipo,
              entrada.serie,
              primerNumero,
              ultimoNumero,
              ahora,
            ],
            type: QueryTypes.SELECT,
          },
        );
        serieId = creadas[0]!.id;
      } catch (error) {
        if (
          sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD &&
          restriccionDe(error) === INDICE_SERIE_UNICA
        ) {
          throw serieOcupada(entrada.serie);
        }
        throw error;
      }
    }
    await this.auditoria.registrar({
      accion: 'configurar_serie',
      sucursalId,
      entidad: 'serie',
      entidadId: serieId,
      detalle: {
        sucursalId,
        cajaId,
        tipo,
        serie: entrada.serie,
        primerNumero,
        ultimoNumero,
        reactivada: existente !== undefined,
        reemplaza: desactivadas.map((d) => d.serie),
      },
    });
  }

  /**
   * Las series de cada caja pedida, activas e inactivas, para armar la `cajaRespuesta`: primero las de boleta y luego
   * las de factura, y dentro de cada tipo la activa antes que las inactivas. Una consulta sin importar cuántas cajas.
   */
  async seriesDeCajas(cajaIds: readonly string[]): Promise<Map<string, SerieRespuesta[]>> {
    const porCaja = new Map<string, SerieRespuesta[]>(cajaIds.map((id) => [id, []]));
    if (cajaIds.length === 0) return porCaja;
    const filas = await this.conexion.query<{
      caja_id: string;
      tipo: TipoComprobante;
      serie: string;
      ultimo_numero: number;
      activa: boolean;
      emisor_id: string;
    }>(
      `SELECT caja_id, tipo, serie, ultimo_numero, activa, emisor_id FROM serie
        WHERE caja_id = ANY($1::uuid[])
        ORDER BY caja_id, tipo, NOT activa, creado_en, serie`,
      { bind: [[...cajaIds]], type: QueryTypes.SELECT },
    );
    for (const f of filas) {
      porCaja.get(f.caja_id)?.push({
        tipo: f.tipo,
        serie: f.serie,
        ultimoNumero: f.ultimo_numero,
        activa: f.activa,
        emisorId: f.emisor_id,
      });
    }
    return porCaja;
  }

  /**
   * Toma el número siguiente de la serie activa de la caja para el emisor (criterios 70 y 71). Debe correr en la
   * transacción del cobro: si el cobro falla después, el incremento se deshace y el número no se pierde. El `UPDATE`
   * bloquea la fila hasta el `COMMIT`: dos cobros de la misma caja se turnan y dos cajas, que usan filas distintas,
   * no compiten. 409 `SIN_SERIE` (no hay serie activa del tipo para ese emisor) o `SERIE_AGOTADA`.
   */
  async tomarNumero(
    cajaId: string,
    tipo: TipoComprobante,
    emisorId: string,
  ): Promise<NumeroTomado> {
    try {
      const filas = await this.conexion.query<{ id: string; serie: string; ultimo_numero: number }>(
        `UPDATE serie SET ultimo_numero = ultimo_numero + 1, actualizado_en = $4
          WHERE caja_id = $1 AND tipo = $2 AND activa AND emisor_id = $3
          RETURNING id, serie, ultimo_numero`,
        { bind: [cajaId, tipo, emisorId, this.reloj.ahora()], type: QueryTypes.SELECT },
      );
      const fila = filas[0];
      if (fila === undefined) throw sinSerie();
      return { serieId: fila.id, serie: fila.serie, numero: fila.ultimo_numero };
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE_CHECK && restriccionDe(error) === CHECK_ULTIMO_NUMERO) {
        throw serieAgotada();
      }
      throw error;
    }
  }
}
