import { Inject, Injectable, Logger } from '@nestjs/common';
import { plazoDeEnvio, type TipoDocumentoElectronico } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../../nucleo/base-de-datos';
import { COLA_PSE, type ColaPse } from '../../../nucleo/colas';
import { ContextoEmpresa } from '../../../nucleo/contexto-empresa';

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
