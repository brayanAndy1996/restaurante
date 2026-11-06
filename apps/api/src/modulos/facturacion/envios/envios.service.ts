import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EnvioPseRespuesta, IntentoPseRespuesta } from '@restaurante/contratos';
import { plazoDeEnvio, type TipoDocumentoElectronico } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../../nucleo/base-de-datos';
import { COLA_PSE, type ColaPse } from '../../../nucleo/colas';
import { ContextoEmpresa } from '../../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../../nucleo/reloj';
import {
  COLUMNAS_ENVIO,
  envioRespuestaDe,
  intentoRespuestaDe,
  type FilaDeEnvio,
  type FilaDeIntento,
} from './envio-respuesta';

/**
 * Registro del envío de un comprobante al PSE (historia 006, entrega 6b, criterio 124): dueño de la escritura de
 * `envio_pse` en la emisión. `registrar` corre dentro de la transacción de la emisión (cobro, venta de mostrador, nota de
 * crédito, factura de un cambio o reemisión) e inserta la fila `PENDIENTE` con su plazo (`plazoDeEnvio`); el trabajo en la
 * cola se registra con `alConfirmar`, así que solo se encola si la transacción se confirma. Nada llama al PSE aquí. Si
 * encolar falla, el envío no se pierde: lo encuentra el barrido (criterio 126).
 */
@Injectable()
export class EnviosService {
  private readonly logger = new Logger(EnviosService.name);

  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(COLA_PSE) private readonly cola: ColaPse,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /**
   * Inserta el envío del comprobante (`estado` `PENDIENTE`, `intentos` 0, `proximo_intento_en` = `emitidoEn`, `plazo_hasta`
   * del criterio 130) y deja el encolado para después de confirmar. `fechaEmision` es la fecha de Lima del comprobante.
   */
  async registrar(
    comprobanteId: string,
    tipo: TipoDocumentoElectronico,
    fechaEmision: string,
    emitidoEn: Date,
  ): Promise<void> {
    const empresaId = this.contexto.empresaActual();
    await this.conexion.query(
      `INSERT INTO envio_pse (empresa_id, comprobante_id, estado, intentos, proximo_intento_en, plazo_hasta,
                              creado_en, actualizado_en)
       VALUES ($1, $2, 'PENDIENTE', 0, $3, $4, $3, $3)`,
      {
        bind: [empresaId, comprobanteId, emitidoEn, plazoDeEnvio(tipo, fechaEmision)],
        type: QueryTypes.INSERT,
      },
    );
    this.contexto.alConfirmar(() => this.encolar(empresaId, comprobanteId));
  }

  /** El envío del comprobante como `envioRespuesta`, o `null` si no tiene (emitido antes de 6b). */
  async envioDe(comprobanteId: string): Promise<EnvioPseRespuesta | null> {
    const filas = await this.conexion.query<FilaDeEnvio>(
      `SELECT ${COLUMNAS_ENVIO} FROM envio_pse e WHERE e.comprobante_id = $1`,
      { bind: [comprobanteId], type: QueryTypes.SELECT },
    );
    return filas[0] === undefined ? null : envioRespuestaDe(filas[0]);
  }

  /** Los intentos del comprobante, del más nuevo al más antiguo, hasta 50 (criterio 135). */
  async intentosDe(comprobanteId: string): Promise<IntentoPseRespuesta[]> {
    const filas = await this.conexion.query<FilaDeIntento>(
      `SELECT numero, operacion, iniciado_en, terminado_en, resultado, codigo, mensaje
         FROM intento_pse WHERE comprobante_id = $1
        ORDER BY numero DESC, iniciado_en DESC, id DESC LIMIT 50`,
      { bind: [comprobanteId], type: QueryTypes.SELECT },
    );
    return filas.map(intentoRespuestaDe);
  }

  /**
   * Reintento manual (criterio 132): pone `proximo_intento_en` en el instante actual (y saca de `DETENIDO` a `PENDIENTE`)
   * y encola el trabajo después de confirmar, como ya hace el barrido. Un envío `TERMINADO` es 409 `ENVIO_TERMINADO`; con
   * un arriendo vigente (un worker lo está enviando) no cambia nada. No se audita: queda en la trazabilidad de `envio_pse`.
   * Quien llama ya comprobó que el comprobante existe y que quien pide puede verlo.
   */
  async reintentar(comprobanteId: string): Promise<EnvioPseRespuesta> {
    const ahora = this.reloj.ahora();
    const bloqueados = await this.conexion.query<{
      id: string;
      estado: string;
      en_curso_hasta: Date | null;
    }>(`SELECT id, estado, en_curso_hasta FROM envio_pse WHERE comprobante_id = $1 FOR UPDATE`, {
      bind: [comprobanteId],
      type: QueryTypes.SELECT,
    });
    const envio = bloqueados[0];
    if (envio === undefined)
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El comprobante no existe');
    if (envio.estado === 'TERMINADO') {
      throw new ErrorAplicacion(
        409,
        'ENVIO_TERMINADO',
        'El envío de este comprobante ya terminó: no hay nada que reintentar',
      );
    }
    const enCurso =
      envio.en_curso_hasta !== null && envio.en_curso_hasta.getTime() > ahora.getTime();
    if (!enCurso) {
      await this.conexion.query(
        `UPDATE envio_pse
            SET proximo_intento_en = $2,
                estado = CASE WHEN estado = 'DETENIDO' THEN 'PENDIENTE' ELSE estado END,
                actualizado_en = $2
          WHERE id = $1`,
        { bind: [envio.id, ahora], type: QueryTypes.UPDATE },
      );
      const empresaId = this.contexto.empresaActual();
      this.contexto.alConfirmar(() => this.encolar(empresaId, comprobanteId));
    }
    const actual = await this.envioDe(comprobanteId);
    if (actual === null)
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El comprobante no existe');
    return actual;
  }

  /** Encola el trabajo con solo los dos ids (criterio 163). No lanza: un fallo se registra y el barrido lo recoge. */
  private async encolar(empresaId: string, comprobanteId: string): Promise<void> {
    try {
      await this.cola.encolar({ empresaId, comprobanteId });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          evento: 'pse.encolado_fallido',
          empresaId,
          comprobanteId,
          error: error instanceof Error ? error.message : 'error desconocido',
        }),
      );
    }
  }
}
