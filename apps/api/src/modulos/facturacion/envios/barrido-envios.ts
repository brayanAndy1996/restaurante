import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  alertaDe,
  MINUTOS_ALERTA_PENDIENTE,
  type EstadoComprobante,
  type EstadoEnvioPse,
  type ResultadoEnvioPse,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../../nucleo/base-de-datos';
import { COLA_PSE, type ColaPse } from '../../../nucleo/colas';
import { ContextoEmpresa } from '../../../nucleo/contexto-empresa';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../../nucleo/eventos';
import { RELOJ, type Reloj } from '../../../nucleo/reloj';
import { EmpresasConsulta } from '../../plataforma';
import { sqlAlerta } from './alertas-sql';
import { publicarAlerta } from './alertas';
import { ArchivadorDePdf } from '../pdf/archivador-de-pdf';
import { ACTOR_WORKER_ENVIO_PSE } from './procesador-envios';

/** Lo que hizo una vuelta del barrido (criterios 126, 130 y 133). */
export interface ResultadoDelBarrido {
  /** Envíos vencidos que se volvieron a encolar. */
  reencolados: number;
  /** Envíos que llegaron a su plazo y quedaron `DETENIDO`. */
  detenidos: number;
  /** Alertas nuevas publicadas. */
  alertas: number;
  /** PDF de comprobantes `ACEPTADO` (o `ANULADO`) que estaban sin PDF y se volvieron a armar. */
  pdfPendientes: number;
}

/** Cada cuánto corre el barrido en el worker (criterio 126). */
export const INTERVALO_DEL_BARRIDO_MS = 60_000;
/** Cuántos envíos vencidos se vuelven a encolar por empresa y vuelta (criterio 126). */
export const MAXIMO_REENCOLADOS_POR_EMPRESA = 500;
/** Cuántos días atrás mira el barrido los rechazos sin alertar (el procesador alerta al rechazar; esto es la red). */
const DIAS_DE_RECHAZOS_REVISADOS = 7;
/** Tope de comprobantes revisados por empresa y vuelta para las alertas. */
const MAXIMO_REVISADOS_POR_EMPRESA = 1000;
const MS_POR_DIA = 24 * 60 * 60_000;

interface FilaRevisada {
  envio_id: string;
  comprobante_id: string;
  sucursal_id: string;
  estado_envio: EstadoEnvioPse;
  ultimo_resultado: ResultadoEnvioPse | null;
  estado: EstadoComprobante;
  emitido_en: Date;
  reemplazado: boolean;
}

/**
 * El barrido de envíos (historia 006, entrega 6b, criterio 126): cada minuto el worker recorre las empresas (la lista de
 * ids la da `EmpresasConsulta.ids()`) y, con el contexto de cada una y el actor `worker:envio-pse`:
 *
 * - **detiene** los envíos que llegaron a `plazo_hasta` sin respuesta final (criterio 130);
 * - **vuelve a encolar** los envíos `PENDIENTE` o `ESPERANDO_RESPUESTA` cuyo `proximo_intento_en` ya pasó y que no tienen
 *   un arriendo vigente (hasta 500 por empresa y vuelta), después de confirmar la transacción;
 * - **levanta las alertas por tiempo** con `alertaDe` (`alertado_en` y `alerta` evitan repetirlas) y las publica;
 * - **arma el PDF** de los comprobantes aceptados que se quedaron sin él (hasta 20 por empresa y vuelta), fuera de la
 *   transacción (criterio 159).
 *
 * Una empresa nunca toca los envíos de otra: cada una corre en su propia transacción con su RLS. El barrido no bloquea
 * comprobantes. Con varias instancias del worker, los `UPDATE` condicionados y el `singletonKey` de la cola evitan dobles
 * efectos. Las pruebas lo llaman a mano con `barrerAhora()`.
 */
@Injectable()
export class BarridoEnviosPse {
  private readonly logger = new Logger(BarridoEnviosPse.name);
  private temporizador: NodeJS.Timeout | null = null;
  private vueltaEnCurso: Promise<ResultadoDelBarrido> | null = null;

  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(COLA_PSE) private readonly cola: ColaPse,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
    @Inject(EmpresasConsulta) private readonly empresas: EmpresasConsulta,
    @Inject(ArchivadorDePdf) private readonly pdf: ArchivadorDePdf,
  ) {}

  /** Una vuelta completa sobre todas las empresas. Una empresa que falla no impide las demás. */
  async barrerAhora(): Promise<ResultadoDelBarrido> {
    const total: ResultadoDelBarrido = {
      reencolados: 0,
      detenidos: 0,
      alertas: 0,
      pdfPendientes: 0,
    };
    for (const empresaId of await this.empresas.ids()) {
      try {
        const parcial = await this.barrerEmpresa(empresaId);
        total.reencolados += parcial.reencolados;
        total.detenidos += parcial.detenidos;
        total.alertas += parcial.alertas;
        total.pdfPendientes += parcial.pdfPendientes;
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            evento: 'pse.barrido_fallido',
            empresaId,
            error: error instanceof Error ? error.name : 'error desconocido',
          }),
        );
      }
    }
    return total;
  }

  /** Arranca el temporizador de 60 segundos del worker (`unref`). Una vuelta no empieza si la anterior sigue. */
  iniciar(): void {
    if (this.temporizador !== null) return;
    this.temporizador = setInterval(() => {
      if (this.vueltaEnCurso !== null) return;
      const vuelta = this.barrerAhora();
      this.vueltaEnCurso = vuelta;
      void vuelta
        .catch((error: unknown) => {
          this.logger.warn(
            JSON.stringify({
              evento: 'pse.barrido_fallido',
              error: error instanceof Error ? error.name : 'error desconocido',
            }),
          );
        })
        .finally(() => {
          this.vueltaEnCurso = null;
        });
    }, INTERVALO_DEL_BARRIDO_MS);
    this.temporizador.unref();
  }

  /** Detiene el temporizador y espera la vuelta en curso, si la hay. */
  async detener(): Promise<void> {
    if (this.temporizador !== null) clearInterval(this.temporizador);
    this.temporizador = null;
    await this.vueltaEnCurso?.catch(() => undefined);
  }

  private async barrerEmpresa(empresaId: string): Promise<ResultadoDelBarrido> {
    const resultado: ResultadoDelBarrido = {
      reencolados: 0,
      detenidos: 0,
      alertas: 0,
      pdfPendientes: 0,
    };
    const sinPdf = await this.contexto.ejecutar(
      empresaId,
      async () => {
        const ahora = this.reloj.ahora();
        resultado.detenidos = await this.detenerVencidos(ahora);
        await this.reencolar(empresaId, ahora, resultado);
        resultado.alertas = await this.alertar(empresaId, ahora);
        return this.pdf.pendientes();
      },
      { actor: { sistema: ACTOR_WORKER_ENVIO_PSE } },
    );
    // (d) Los aceptados que se quedaron sin PDF se arman ahora, ya fuera de la transacción (criterio 159).
    for (const comprobanteId of sinPdf) {
      if (await this.pdf.generar(empresaId, comprobanteId)) resultado.pdfPendientes += 1;
    }
    return resultado;
  }

  /**
   * (b) Los envíos que llegaron a su plazo sin terminar quedan `DETENIDO`, sin arriendo (criterio 130). Uno con la marca de
   * reintento manual (`reintento_manual_en`, criterio 132) no se detiene: el worker aún no hizo ese intento y es él quien, si
   * falla pasado el plazo, lo vuelve a dejar `DETENIDO`.
   */
  private async detenerVencidos(ahora: Date): Promise<number> {
    const filas = await this.conexion.query<{ id: string }>(
      `UPDATE envio_pse
          SET estado = 'DETENIDO', proximo_intento_en = NULL, en_curso_hasta = NULL, intento_en_curso = NULL,
              actualizado_en = $1
        WHERE estado IN ('PENDIENTE', 'ESPERANDO_RESPUESTA')
          AND plazo_hasta <= $1
          AND (en_curso_hasta IS NULL OR en_curso_hasta < $1)
          AND reintento_manual_en IS NULL
        RETURNING id`,
      { bind: [ahora], type: QueryTypes.SELECT },
    );
    return filas.length;
  }

  /** (a) Los envíos vencidos sin arriendo vigente se encolan después de confirmar (criterio 126). */
  private async reencolar(
    empresaId: string,
    ahora: Date,
    resultado: ResultadoDelBarrido,
  ): Promise<void> {
    const filas = await this.conexion.query<{ comprobante_id: string }>(
      `SELECT comprobante_id
         FROM envio_pse
        WHERE estado IN ('PENDIENTE', 'ESPERANDO_RESPUESTA')
          AND proximo_intento_en <= $1
          AND (en_curso_hasta IS NULL OR en_curso_hasta < $1)
        ORDER BY proximo_intento_en, id
        LIMIT ${MAXIMO_REENCOLADOS_POR_EMPRESA}`,
      { bind: [ahora], type: QueryTypes.SELECT },
    );
    if (filas.length === 0) return;
    this.contexto.alConfirmar(async () => {
      for (const { comprobante_id: comprobanteId } of filas) {
        try {
          await this.cola.encolar({ empresaId, comprobanteId });
          resultado.reencolados += 1;
        } catch (error) {
          this.logger.warn(
            JSON.stringify({
              evento: 'pse.encolado_fallido',
              empresaId,
              comprobanteId,
              error: error instanceof Error ? error.name : 'error desconocido',
            }),
          );
        }
      }
    });
  }

  /**
   * (c) Las alertas nuevas (demora, plazo vencido, configuración, rechazo) se marcan y se publican una sola vez por
   * comprobante y motivo (criterio 133). La consulta ya excluye los comprobantes cuyo motivo actual se publicó antes (`alerta`
   * más `alertas_previas`): los ya tratados no ocupan el cupo de la vuelta y los nuevos nunca quedan esperando detrás.
   */
  private async alertar(empresaId: string, ahora: Date): Promise<number> {
    const filas = await this.conexion.query<FilaRevisada>(
      `SELECT t.envio_id, t.comprobante_id, t.sucursal_id, t.estado_envio, t.ultimo_resultado, t.estado, t.emitido_en,
              t.reemplazado
         FROM (SELECT e.id AS envio_id, e.comprobante_id, c.sucursal_id, e.estado AS estado_envio, e.ultimo_resultado,
                      e.alerta, e.alertas_previas, c.estado, c.emitido_en,
                      EXISTS (SELECT 1 FROM comprobante r WHERE r.reemplaza_a_id = c.id) AS reemplazado,
                      ${sqlAlerta('$1')} AS motivo
                 FROM envio_pse e
                 JOIN comprobante c ON c.id = e.comprobante_id AND c.empresa_id = e.empresa_id
                WHERE (c.estado IN ('POR_ENVIAR', 'ENVIADO')
                       AND (e.estado = 'DETENIDO' OR e.ultimo_resultado = 'ERROR_CONFIGURACION'
                            OR c.emitido_en < $1::timestamptz - interval '${MINUTOS_ALERTA_PENDIENTE} minutes'))
                   OR (c.estado = 'RECHAZADO' AND c.rechazado_en >= $2)) t
        WHERE t.motivo IS NOT NULL
          AND NOT (t.motivo = ANY (t.alertas_previas || COALESCE(t.alerta, '')))
        ORDER BY t.emitido_en, t.envio_id
        LIMIT ${MAXIMO_REVISADOS_POR_EMPRESA}`,
      {
        bind: [ahora, new Date(ahora.getTime() - DIAS_DE_RECHAZOS_REVISADOS * MS_POR_DIA)],
        type: QueryTypes.SELECT,
      },
    );
    let nuevas = 0;
    for (const fila of filas) {
      const motivo = alertaDe(
        {
          estado: fila.estado,
          estadoEnvio: fila.estado_envio,
          emitidoEn: fila.emitido_en,
          ultimoResultado: fila.ultimo_resultado,
          reemplazado: fila.reemplazado,
        },
        ahora,
      );
      if (motivo === null) continue;
      // Condicionado: con dos workers a la vez, solo uno marca (y publica) la alerta. El motivo anterior pasa a las previas.
      const marcadas = await this.conexion.query<{ id: string }>(
        `UPDATE envio_pse
            SET alertado_en = $2, actualizado_en = $2,
                alertas_previas = CASE WHEN alerta IS NULL THEN alertas_previas
                                       ELSE array_append(alertas_previas, alerta) END,
                alerta = $3
          WHERE id = $1 AND NOT ($3 = ANY (alertas_previas || COALESCE(alerta, '')))
          RETURNING id`,
        { bind: [fila.envio_id, ahora, motivo], type: QueryTypes.SELECT },
      );
      if (marcadas.length === 0) continue;
      nuevas += 1;
      this.contexto.alConfirmar(() =>
        publicarAlerta(this.publicador, {
          empresaId,
          comprobanteId: fila.comprobante_id,
          sucursalId: fila.sucursal_id,
          motivo,
        }),
      );
    }
    return nuevas;
  }
}
