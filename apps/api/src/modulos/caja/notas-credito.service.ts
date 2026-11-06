import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { NotaCreditoEntradaValidada, NotaCreditoRespuesta } from '@restaurante/contratos';
import type { MedioPago } from '@restaurante/dominio';
import { sumarMontos, validarPagos } from '@restaurante/dominio/caja';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { jsonCanonico } from '../../nucleo/idempotencia';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { EmisionService, veTodosLosTurnos } from '../facturacion';
import { SesionActual, normalizarValor, type ReplicaDeClave } from '../seguridad';
import { CobrosService } from './cobros.service';
import { idDeClienteReutilizado, turnoDeOtro } from './errores-caja';
import { EventosCaja } from './eventos-caja';
import { ImpresoraDeCajas } from './impresora-de-cajas';

const sha256 = (texto: string): Buffer => createHash('sha256').update(texto, 'utf8').digest();

/** 422 `DEVOLUCION_INVALIDA`: los pagos de la devolución no cuadran con el total de la nota (criterio 150). */
const devolucionInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'DEVOLUCION_INVALIDA',
    'Lo que se devuelve no cuadra con el total de la nota de crédito',
    [
      {
        campo: 'devolucion.pagos',
        mensaje: 'Los pagos y el redondeo deben sumar exactamente el total',
      },
    ],
  );

/** La entrada de una nota normalizada (ids en minúsculas y montos con 2 decimales), sin `total` ni `motivo`. */
interface EntradaNormalizada {
  comprobanteId: string;
  tipo: NotaCreditoEntradaValidada['tipo'];
  lineas: { posicion: number; cantidad: number }[] | null;
  devolucion: {
    turnoId: string;
    pagos: { medio: MedioPago; monto: string; operacion: string | null }[];
    redondeo: string;
  } | null;
  cliente: {
    tipoDocumento: string;
    numero: string;
    nombre: string;
    direccion: string | null;
  } | null;
}

function normalizar(entrada: NotaCreditoEntradaValidada): EntradaNormalizada {
  const cliente = entrada.cliente;
  return {
    comprobanteId: entrada.comprobanteId.toLowerCase(),
    tipo: entrada.tipo,
    lineas:
      entrada.lineas === undefined
        ? null
        : entrada.lineas
            .map((l) => ({ posicion: l.posicion, cantidad: l.cantidad }))
            .sort((a, b) => a.posicion - b.posicion || a.cantidad - b.cantidad),
    devolucion:
      entrada.devolucion === undefined || entrada.devolucion === null
        ? null
        : {
            turnoId: entrada.devolucion.turnoId.toLowerCase(),
            pagos: entrada.devolucion.pagos
              .map((p) => ({
                medio: p.medio,
                monto: normalizarValor(p.monto),
                operacion: p.operacion ?? null,
              }))
              .sort((a, b) => (a.medio < b.medio ? -1 : a.medio > b.medio ? 1 : 0)),
            redondeo: normalizarValor(entrada.devolucion.redondeo),
          },
    cliente:
      cliente === undefined
        ? null
        : {
            tipoDocumento: cliente.tipoDocumento,
            numero: cliente.numero,
            nombre: cliente.nombre,
            direccion: cliente.direccion ?? null,
          },
  };
}

/**
 * La huella de la entrada para reconocer la réplica por `id` (criterio 153): el comprobante, el tipo, las líneas, la
 * devolución y el cliente. Sin `total` ni `motivo`: son lo que vio la persona y pueden cambiar entre reintentos sin que
 * la nota sea otra.
 */
function huellaDe(e: EntradaNormalizada): Buffer {
  return sha256(jsonCanonico(e));
}

interface FilaReplica {
  huella_entrada: Buffer;
  respuesta: NotaCreditoRespuesta;
  sucursal_id: string;
}

/**
 * Notas de crédito (historia 006, entrega 6b, criterios 143 a 157; ruta crítica P8): dueño de `nota_credito`. Orquesta la
 * operación como el cobro, en una sola transacción y con el orden fijo de cerrojos del plan: el cerrojo consultivo por el
 * `id` de la nota (las réplicas simultáneas se turnan y la segunda devuelve lo guardado), el comprobante original
 * (`EmisionService.prepararNotaCredito`, que lo toma `FOR UPDATE`, calcula con `packages/dominio` y compara el total y el
 * objetivo de la clave), el turno de la devolución (`FOR SHARE`, como un cobro, así una devolución y el cierre del mismo
 * turno se turnan), los pagos de la devolución (`validarPagos`), `EmisionService.numerarNotaCredito` (emisor, series,
 * cuota, envíos y tickets) y, por último, los egresos de caja, el registro de la nota con su respuesta, la auditoría y
 * `turno.cambio`. Si algo falla, se revierte todo: el número, la cuota, los egresos, los tickets, los envíos y la
 * autorización de supervisor que consumió la clave diferida.
 */
@Injectable()
export class NotasCreditoService implements ReplicaDeClave {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(EmisionService) private readonly emision: EmisionService,
    @Inject(CobrosService) private readonly cobros: CobrosService,
    @Inject(ImpresoraDeCajas) private readonly impresoras: ImpresoraDeCajas,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCaja) private readonly eventos: EventosCaja,
  ) {}

  /**
   * ¿Ya hay una nota con este `id` de cliente? Lo consulta `ClaveDiferidaInterceptor` antes de exigir y consumir la clave
   * del supervisor (criterios 145 y 153): la réplica por `id` no es una nota nueva, así que no pide ni gasta la
   * autorización (aunque sea de otro objetivo) y la resuelve `emitir` (201 con la nota guardada, o 422 si el `id` es otra
   * petición). Toma antes el mismo cerrojo por `id` que `emitir`: si dos peticiones con el mismo `id` llegan a la vez, la
   * segunda espera a que la primera confirme y ve su nota, en lugar de consumir su clave y devolver la réplica.
   */
  async yaExiste(cuerpo: unknown): Promise<boolean> {
    const id = (cuerpo as { id: string }).id.toLowerCase();
    await this.cobros.turnarPor(`nota-credito-id:${id}`);
    const filas = await this.conexion.query('SELECT 1 FROM nota_credito WHERE id = $1', {
      bind: [id],
      type: QueryTypes.SELECT,
    });
    return filas.length > 0;
  }

  async emitir(entrada: NotaCreditoEntradaValidada): Promise<NotaCreditoRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const id = entrada.id.toLowerCase();
    const normal = normalizar(entrada);
    const huella = huellaDe(normal);

    // Réplica por id (criterio 153). El cerrojo hace que las réplicas simultáneas se turnen y la segunda vea lo ya
    // confirmado en lugar de chocar con la clave primaria.
    await this.cobros.turnarPor(`nota-credito-id:${id}`);
    const previa = await this.replica(id, sucursalId, huella);
    if (previa !== undefined) return previa;

    // El original, bloqueado, con la nota calculada y la clave comprobada (criterios 144 a 148).
    const preparada = await this.emision.prepararNotaCredito(entrada);

    // La devolución: el turno (`FOR SHARE`, después del original y antes del emisor) y los pagos (criterio 150).
    const devolucion = normal.devolucion;
    const turno =
      devolucion === null
        ? null
        : await this.cobros.turnoParaCobrar(devolucion.turnoId, sucursalId);
    if (devolucion !== null) this.exigirPagosQueCuadran(preparada.total, devolucion);

    const cajaId = turno?.caja_id ?? preparada.cajaDelOriginalId;
    const impresora = await this.impresoras.deLaCaja(cajaId);
    const pagos = devolucion?.pagos ?? [];
    const emitido = await this.emision.numerarNotaCredito(preparada, {
      cajaId,
      turno: turno === null ? null : { id: turno.id, responsableId: turno.responsable_id },
      impresora,
      devolucionEnEfectivo: pagos.some((p) => p.medio === 'EFECTIVO'),
      pagos: pagos.map((p) => ({
        medio: p.medio,
        monto: p.monto,
        recibido: null,
        operacion: p.operacion,
      })),
      redondeo: devolucion?.redondeo ?? '0.00',
    });
    const nota = emitido.nota.comprobante;
    const instante = emitido.nota.emitidoEn;

    // Los egresos del turno, uno por pago y en su medio (criterio 150).
    const movimientoIds: string[] = [];
    if (devolucion !== null && turno !== null) {
      for (const pago of devolucion.pagos) {
        movimientoIds.push(await this.insertarEgreso(turno.id, nota, pago, instante));
      }
    }

    const trabajoIds = [emitido.nota.trabajoId, emitido.factura?.trabajoId ?? null].filter(
      (t): t is string => t !== null,
    );
    const respuesta: NotaCreditoRespuesta = {
      id,
      nota,
      factura: emitido.factura?.comprobante ?? null,
      devolucion:
        devolucion === null
          ? null
          : {
              total: preparada.total,
              redondeo: devolucion.redondeo,
              pagos: devolucion.pagos.map((p) => ({
                medio: p.medio,
                monto: p.monto,
                operacion: p.operacion,
              })),
              movimientoIds,
            },
      impresion: emitido.nota.impresion,
      trabajoIds,
    };
    const devuelto = sumarMontos((devolucion?.pagos ?? []).map((p) => p.monto));
    await this.guardar(respuesta, huella, preparada.originalId, turno?.id ?? null, normal.tipo, {
      total: preparada.total,
      devuelto,
      instante,
    });

    const autorizacion = this.sesion.autorizacionConsumida();
    await this.auditoria.registrar({
      accion: 'emitir_nota_credito',
      sucursalId,
      entidad: 'comprobante',
      entidadId: nota.id,
      motivo: entrada.motivo,
      autorizadoPorId: autorizacion?.autorizadorId ?? null,
      autorizacionId: autorizacion?.autorizacionId ?? null,
      detalle: {
        notaId: nota.id,
        numero: nota.numero,
        tipoNota: normal.tipo,
        original: { id: preparada.originalId, numero: preparada.originalNumero },
        total: preparada.total,
        lineas: nota.lineas.map((l) => ({
          posicionOrigen: l.posicionOrigen,
          cantidad: l.cantidad,
          neto: l.neto,
        })),
        devolucion:
          devolucion === null
            ? null
            : {
                turnoId: devolucion.turnoId,
                pagos: respuesta.devolucion!.pagos,
                redondeo: devolucion.redondeo,
              },
        factura:
          emitido.factura === null
            ? null
            : { id: emitido.factura.comprobante.id, numero: emitido.factura.comprobante.numero },
      },
    });
    if (turno !== null) this.eventos.turnoCambio(sucursalId, turno.id, turno.caja_id);
    return respuesta;
  }

  /**
   * Los pagos de la devolución contra el total de la nota con `validarPagos` (sin `recibido`) y el redondeo del efectivo
   * (lo que se devuelve en efectivo se trunca a la décima, como en el cobro); a lo más un pago por medio. 422
   * `DEVOLUCION_INVALIDA` si no cuadran.
   */
  private exigirPagosQueCuadran(
    total: string,
    devolucion: NonNullable<EntradaNormalizada['devolucion']>,
  ): void {
    const medios = devolucion.pagos.map((p) => p.medio);
    if (new Set(medios).size !== medios.length) throw devolucionInvalida();
    try {
      const resultado = validarPagos(
        total,
        devolucion.pagos.map((p) => ({ medio: p.medio, monto: p.monto })),
        devolucion.redondeo,
      );
      if (!resultado.valido) throw devolucionInvalida();
    } catch (error) {
      if (error instanceof RangeError) throw devolucionInvalida();
      throw error;
    }
  }

  /** El egreso de un pago de la devolución, en su medio, con la nota como comprobante (criterio 150). */
  private async insertarEgreso(
    turnoId: string,
    nota: NotaCreditoRespuesta['nota'],
    pago: { medio: MedioPago; monto: string; operacion: string | null },
    instante: Date,
  ): Promise<string> {
    const id = randomUUID();
    await this.conexion.query(
      `INSERT INTO movimiento_caja (id, empresa_id, turno_id, tipo, medio, monto, motivo, comprobante_id, operacion,
                                    creado_en, actualizado_en)
       VALUES ($1, $2, $3, 'EGRESO', $4, $5::numeric, $6, $7, $8, $9, $9)`,
      {
        bind: [
          id,
          this.contexto.empresaActual(),
          turnoId,
          pago.medio,
          pago.monto,
          `Devolución NC ${nota.numero}`,
          nota.id,
          pago.operacion,
          instante,
        ],
        type: QueryTypes.INSERT,
      },
    );
    return id;
  }

  /** Guarda la operación con su respuesta original (para la réplica por `id` del criterio 153). */
  private async guardar(
    respuesta: NotaCreditoRespuesta,
    huella: Buffer,
    originalId: string,
    turnoId: string | null,
    tipo: NotaCreditoEntradaValidada['tipo'],
    d: { total: string; devuelto: string; instante: Date },
  ): Promise<void> {
    await this.conexion.query(
      `INSERT INTO nota_credito (id, empresa_id, comprobante_id, factura_id, original_id, turno_id, tipo, total, devuelto,
                                 huella_entrada, respuesta, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11::jsonb, $12, $12)`,
      {
        bind: [
          respuesta.id,
          this.contexto.empresaActual(),
          respuesta.nota.id,
          respuesta.factura?.id ?? null,
          originalId,
          turnoId,
          tipo,
          d.total,
          d.devuelto,
          huella,
          JSON.stringify(respuesta),
          d.instante,
        ],
        type: QueryTypes.INSERT,
      },
    );
  }

  /**
   * La réplica por `id` (criterio 153): la nota ya emitida, sin efectos y aunque el turno ya esté cerrado, o 422 si el mismo
   * `id` es otra petición (otro comprobante, tipo, líneas, devolución o cliente, u otra sucursal). La respuesta guardada
   * trae el comprobante: solo la ve quien puede operar sobre él (un Cajero, solo los de sus turnos, criterio 169).
   */
  private async replica(
    id: string,
    sucursalId: string,
    huella: Buffer,
  ): Promise<NotaCreditoRespuesta | undefined> {
    const filas = await this.conexion.query<FilaReplica>(
      `SELECT n.huella_entrada, n.respuesta, c.sucursal_id
         FROM nota_credito n
         JOIN caja c ON c.id = (n.respuesta -> 'nota' ->> 'cajaId')::uuid AND c.empresa_id = n.empresa_id
        WHERE n.id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    const previa = filas[0];
    if (previa === undefined) return undefined;
    if (previa.sucursal_id !== sucursalId || !previa.huella_entrada.equals(huella)) {
      throw idDeClienteReutilizado();
    }
    const principal = this.sesion.principal();
    if (
      !veTodosLosTurnos(principal) &&
      previa.respuesta.nota.turnoResponsableId !== principal.usuarioId
    ) {
      throw turnoDeOtro();
    }
    return previa.respuesta;
  }
}
