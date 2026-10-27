import { Inject, Injectable } from '@nestjs/common';
import type {
  PagoEntrada,
  PagoRegistradoRespuesta,
  SuscripcionModificarEntrada,
  SuscripcionRespuesta,
  SuscripcionResumen,
} from '@restaurante/contratos';
import { fechaLima } from '@restaurante/dominio';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { OperacionPlataforma } from './operacion-plataforma';
import { PlanesService } from './planes.service';
import { SuscripcionService } from './suscripcion.service';
import type { IdempotenciaPlataforma } from './tipos';

/**
 * Suscripciones por la vía de plataforma (criterios 73, 74 y 76): cada operación corre en
 * `OperacionPlataforma` (actor = el superadministrador, auditoría en la misma transacción, idempotencia
 * donde corresponde) y delega el SQL en `SuscripcionService`, que es el único que toca las tablas.
 */
@Injectable()
export class SuscripcionesPlataformaService {
  constructor(
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
    @Inject(PlanesService) private readonly planes: PlanesService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** `GET /plataforma/suscripciones?estado=`. */
  async listar(estado: SuscripcionRespuesta['estado'] | undefined): Promise<SuscripcionResumen[]> {
    const ahora = this.reloj.ahora();
    return this.operacion.consultar((transaccion) =>
      this.suscripciones.listar(transaccion, ahora, estado),
    );
  }

  /** `PATCH /plataforma/suscripciones/:id`: cambia el plan o ajusta el vencimiento (`modificar_suscripcion`). */
  async modificar(
    id: string,
    entrada: SuscripcionModificarEntrada,
    superadministradorId: string,
  ): Promise<SuscripcionRespuesta> {
    const ahora = this.reloj.ahora();
    return this.operacion.ejecutar(
      {
        actor: { superadministradorId },
        motivo: entrada.motivo,
        operacion: 'modificar_suscripcion',
      },
      async (transaccion) => {
        const cambio = await this.suscripciones.modificar(
          transaccion,
          id,
          {
            ...(entrada.planId === undefined ? {} : { planId: entrada.planId }),
            ...(entrada.vencimiento === undefined ? {} : { vencimiento: entrada.vencimiento }),
          },
          (planId) => this.planes.elegirParaSuscripcion(transaccion, planId),
          ahora,
        );
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          empresaId: cambio.antes.empresaId,
          sucursalId: cambio.antes.sucursalId,
          entidad: 'suscripcion',
          entidadId: cambio.suscripcion.id,
          detalle: {
            antes: { planId: cambio.antes.planId, vencimiento: cambio.antes.vencimiento },
            despues: cambio.despues,
          },
        });
        return cambio.suscripcion;
      },
    );
  }

  /**
   * `POST /plataforma/suscripciones/:id/pagos` (201): `fechaPago` no puede ser posterior a hoy (fecha de
   * Lima del reloj de la API); que `vencimientoNuevo` sea posterior al actual lo comprueba el servicio con
   * la suscripción bloqueada. Auditoría `registrar_pago`. Con `Idempotency-Key`, repetir devuelve lo mismo.
   */
  async registrarPago(
    id: string,
    entrada: PagoEntrada,
    superadministradorId: string,
    idempotencia?: IdempotenciaPlataforma,
  ): Promise<PagoRegistradoRespuesta> {
    const ahora = this.reloj.ahora();
    if (entrada.fechaPago > fechaLima(ahora)) {
      throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'La fecha de pago no puede ser futura', [
        { campo: 'fechaPago', mensaje: 'No puede ser posterior a hoy' },
      ]);
    }
    return this.operacion.ejecutar(
      {
        actor: { superadministradorId },
        motivo: entrada.motivo,
        operacion: 'registrar_pago',
        ...(idempotencia === undefined ? {} : { idempotencia }),
      },
      async (transaccion) => {
        const resultado = await this.suscripciones.registrarPago(transaccion, id, entrada, ahora);
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          empresaId: resultado.suscripcion.empresaId,
          sucursalId: resultado.suscripcion.sucursalId,
          entidad: 'pago_suscripcion',
          entidadId: resultado.pago.id,
          detalle: {
            suscripcionId: resultado.suscripcion.id,
            monto: resultado.pago.monto,
            fechaPago: resultado.pago.fechaPago,
            medio: resultado.pago.medio,
            referencia: resultado.pago.referencia,
            vencimientoAnterior: resultado.pago.vencimientoAnterior,
            vencimientoNuevo: resultado.pago.vencimientoNuevo,
          },
        });
        return resultado;
      },
    );
  }
}
