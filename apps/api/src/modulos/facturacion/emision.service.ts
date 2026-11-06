import { Inject, Injectable } from '@nestjs/common';
import type {
  ClienteComprobanteEntrada,
  ComprobanteRespuesta,
  NotaCreditoEntradaValidada,
} from '@restaurante/contratos';
import {
  calcularNotaCredito,
  compararMontos,
  diaOperativo,
  fechaLima,
  MONTO_BOLETA_SIN_DOCUMENTO,
  montoEnLetras,
  preciosUnitarios,
  sumarMontos,
  tiposDeComprobantePermitidos,
  type LineaAcreditada,
  type LineaDeNotaCalculada,
  type RegimenTributario,
  type TotalesCuenta,
  type FormatoComprobante,
  type LineaDeParte,
  type MedioPago,
  type ParteCalculada,
  type TipoComprobante,
  type TipoDocumentoElectronico,
  type TipoNotaCredito,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { conMontosConsistentes } from '../../nucleo/errores/montos-inconsistentes';
import { RELOJ, horaLocal, type Reloj } from '../../nucleo/reloj';
import { documentoDeComprobante } from '../impresion';
import { IMPRESION, type ImpresionPuerto } from '../pedidos/impresion';
import {
  EmisoresService,
  SucursalesConsultaService,
  SuscripcionService,
  type DatosParaComprobante,
} from '../plataforma';
import { SesionActual, exigirObjetivo, normalizarValor } from '../seguridad';
import { veTodosLosTurnos } from './alcance-de-turnos';
import {
  clienteRequerido,
  comprobanteAnulado,
  comprobanteDeOtro,
  comprobanteNoAceptado,
  comprobanteNoPermitido,
  comprobanteNoRechazado,
  comprobanteNoEncontrado,
  nadaQueAcreditar,
  notaCreditoCambio,
  notaCreditoInvalida,
  sinSerieDeNotas,
  yaReemplazado,
} from './errores-facturacion';
import { sinMarcaDeValida } from './facturado';
import { DevolucionDeNotaParaTicket } from './devolucion-de-nota';
import { RegistroImpresoraDeCaja, RegistroPagosDeCobro } from './impresora-de-caja';
import { RegistroDeConectores } from './pse/registro-de-conectores';
import { EnviosService } from './envios/envios.service';
import { leerComprobante, textoDelNumero } from './lectura-comprobante';
import { SeriesService, type NumeroTomado } from './series.service';

/**
 * Emisión de un comprobante (historia 006, criterios 69 a 76 y 90; ruta crítica P4). Se llama dentro de la
 * transacción del cobro: toma el número de la serie de la caja con `UPDATE serie SET ultimo_numero = ultimo_numero + 1
 * … RETURNING` (sin saltos: una reversión deshace el incremento), guarda el comprobante y sus líneas, llama a
 * `SuscripcionService.registrarComprobanteEmitido` una vez y encola el ticket del comprobante (criterios 90 a 92), todo
 * en la misma transacción: si encolar falla, el cobro entero se revierte, el número incluido (criterio 71). Sin
 * impresora de caja ni de la sucursal no hay ticket (`trabajoId` `null`, `impresion` `SIN_IMPRESORA`, criterio 96).
 */

export interface PagoParaTicket {
  medio: MedioPago;
  monto: string;
  recibido: string | null;
  operacion: string | null;
}

/**
 * Todo lo que el comprobante guarda al emitirse; el cobro lo arma con lo que recalculó en el servidor. Lleva lo que
 * facturación no puede leer de otros módulos (no lee `caja`, `turno`, `orden` ni `cobro`): la caja, el turno con su
 * responsable, el cobro, el lugar de la parte en la orden, la orden, la impresora ya resuelta, etc.
 */
export interface DatosDeEmision {
  sucursalId: string;
  cajaId: string;
  turnoId: string;
  /** El responsable del turno al emitir (se copia al comprobante: el alcance del Cajero, criterio 100). */
  turnoResponsableId: string;
  cobroId: string;
  /** El lugar de esta parte entre las de la orden: los `cobros` de la cuenta + 1 (1, 2, 3…). */
  numeroParte: number;
  /** La impresora de la caja ya resuelta (`ImpresionPuerto.impresoraDeLaCaja`); `null` si no hay: sin ticket. */
  impresora: { id: string; gaveta: boolean } | null;
  tipo: TipoComprobante;
  formato: FormatoComprobante;
  cliente: ClienteComprobanteEntrada | null;
  /** La parte que se cobra, calculada por `calcularParte` de `packages/dominio`; se guarda en `comprobante.detalle_parte`. */
  parte: ParteCalculada;
  /** La tasa de IGV vigente en la fecha de emisión; `null` con un emisor Nuevo RUS. */
  tasaIgv: string | null;
  /** La descripción de cada ítem para las líneas detalladas (nombre y modificadores). */
  descripciones: ReadonlyMap<string, string>;
  orden: {
    id: string;
    mesas: string[];
    mozo: string | null;
    numeroLlamado: number | null;
  } | null;
  pagos: readonly PagoParaTicket[];
  redondeo: string;
  vuelto: string;
  /**
   * El emisor y la sucursal ya leídos por quien calculó los parámetros del cobro: el emisor se lee una sola vez por
   * cobro. Sin ellos, la emisión los lee.
   */
  emisorYSucursal?: DatosParaComprobante;
  /**
   * El instante del cobro (define la fecha de emisión de Lima y el día operativo). Sin él, la emisión toma el reloj de
   * la API **después de numerar**, con la serie ya bloqueada: así la fecha de emisión nunca va hacia atrás respecto
   * del correlativo de la serie (criterio 74).
   */
  instante?: Date;
  /**
   * La fecha de Lima con la que se eligieron la tasa de IGV y el ICBPER del cobro. Si el instante de la emisión cae en
   * otra fecha (el cobro cruzó la medianoche), se responde 409 `CONFLICTO` para repetirlo con los parámetros del día.
   */
  fechaDeParametros?: string;
}

export interface ComprobanteEmitido {
  comprobante: ComprobanteRespuesta;
  /** El trabajo `COMPROBANTE` encolado, o `null` sin impresora. */
  trabajoId: string | null;
  impresion: 'EN_COLA' | 'SIN_IMPRESORA';
  /** El instante de la emisión: la fecha del comprobante y la hora del cobro. */
  emitidoEn: Date;
}

// ---------------------------------------------------------------------------------------------------
// Entrega 6b: notas de crédito y reemisión (criterios 134, 143 a 157).
// ---------------------------------------------------------------------------------------------------

/** De una línea del original, lo que la línea de la nota copia tal cual (no se recalcula). */
export interface OrigenDeLineaDeNota {
  itemId: string | null;
  descripcion: string;
  unidad: 'NIU' | 'ZZ';
  /** `valor_unitario` (10 decimales) de la línea del original. */
  valorUnitario: string;
}

/**
 * Una nota de crédito ya validada y calculada, con el original bloqueado (`prepararNotaCredito`). Caja la usa para tomar el
 * turno de la devolución después del original y antes del emisor (plan, "Orden de los cerrojos"); casi todo es opaco para ella.
 */
export interface NotaCreditoPreparada {
  originalId: string;
  originalTipo: 'BOLETA' | 'FACTURA';
  /** `B001-00000124`. */
  originalNumero: string;
  sucursalId: string;
  emisorId: string;
  tipoNota: TipoNotaCredito;
  motivo: string;
  /** El total de la nota que recalculó el servidor (texto con 2 decimales). */
  total: string;
  /** La caja del comprobante original: la de la nota si no hay devolución. */
  cajaDelOriginalId: string;
  /** El responsable del turno del original: el de la nota si no hay devolución (criterio 169). */
  responsableDelOriginalId: string;
  /** El turno del original: el de la factura de un cambio (que no es un cobro, pero conserva su turno). */
  turnoDelOriginalId: string;
  /** Lo que calculó `calcularNotaCredito`: las líneas con su `posicionOrigen` y los totales (criterio 147). */
  calculo: { lineas: LineaDeNotaCalculada[]; totales: TotalesCuenta };
  /** Por `posicion` del original, lo que la línea de la nota copia de la suya. */
  origenes: ReadonlyMap<number, OrigenDeLineaDeNota>;
  /** El cliente de la factura de un cambio; `null` en los demás tipos. */
  clienteDeLaFactura: ClienteComprobanteEntrada | null;
}

/** Lo que caja pone al numerar la nota (`numerarNotaCredito`). */
export interface DatosParaNumerarNota {
  /** La caja de la operación: la del turno de la devolución o, sin devolución, la del original. */
  cajaId: string;
  /** El turno de la devolución y su responsable; `null` sin devolución. */
  turno: { id: string; responsableId: string } | null;
  /** La impresora de la caja ya resuelta (`ImpresionPuerto.impresoraDeLaCaja`); `null` si no hay. */
  impresora: { id: string; gaveta: boolean } | null;
  /** Lo que se devuelve en efectivo abre la gaveta de la impresora con el ticket de la nota (criterio 150). */
  devolucionEnEfectivo: boolean;
  /** Los pagos de la devolución, para el ticket. */
  pagos: readonly PagoParaTicket[];
  redondeo: string;
}

/** La nota emitida y, en un cambio a factura, la factura nueva (criterio 151). */
export interface NotaCreditoEmitida {
  nota: ComprobanteEmitido;
  factura: ComprobanteEmitido | null;
}

/** Lo que pide "Emitir otro" (criterio 134). */
export interface DatosDeReemision {
  tipo: TipoDocumentoElectronico;
  cliente?: ClienteComprobanteEntrada;
}

@Injectable()
export class EmisionService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SeriesService) private readonly series: SeriesService,
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
    @Inject(EnviosService) private readonly envios: EnviosService,
    @Inject(RegistroImpresoraDeCaja) private readonly impresoras: RegistroImpresoraDeCaja,
    @Inject(RegistroPagosDeCobro) private readonly pagosDeCobro: RegistroPagosDeCobro,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RegistroDeConectores) private readonly conectores: RegistroDeConectores,
    @Inject(DevolucionDeNotaParaTicket) private readonly devoluciones: DevolucionDeNotaParaTicket,
  ) {}

  /**
   * Numera, guarda el comprobante con sus líneas y su `ParteCalculada`, y cuenta el comprobante en el consumo del
   * mes de Lima del plan. Todo en la transacción del cobro. 409 `SIN_SERIE` (la caja no tiene serie activa del tipo
   * para el emisor de la sucursal) o `SERIE_AGOTADA`. Nace `POR_ENVIAR`.
   */
  async emitir(datos: DatosDeEmision): Promise<ComprobanteEmitido> {
    const { emisor, sucursal } =
      datos.emisorYSucursal ?? (await this.emisores.datosParaComprobante(datos.sucursalId));
    const horaCorte = await this.sucursales.horaCorte(datos.sucursalId);
    const { serieId, serie, numero } = await this.series.tomarNumero(
      datos.cajaId,
      datos.tipo,
      emisor.id,
    );
    // Con la serie bloqueada: el instante se toma después de numerar, para que la fecha sea monótona con el número.
    const instante = datos.instante ?? this.reloj.ahora();
    if (datos.fechaDeParametros !== undefined && fechaLima(instante) !== datos.fechaDeParametros) {
      throw new ErrorAplicacion(
        409,
        'CONFLICTO',
        'Cambió el día mientras se cobraba; inténtalo de nuevo',
      );
    }
    // 6b: el modo de PSE del emisor en este instante (lectura sin bloqueo), copiado al comprobante (criterio 122).
    const simulado = (await this.emisores.modoPse(emisor.id)) === 'SIMULADO';
    const totales = datos.parte.totales;
    const operaciones = totales.operaciones;
    const cliente = datos.cliente;
    const filas = await this.conexion.query<{ id: string }>(
      `INSERT INTO comprobante (
         empresa_id, sucursal_id, emisor_id, caja_id, turno_id, turno_responsable_id, cobro_id, serie_id, tipo, serie,
         numero, formato, fecha_emision, emitido_en, dia_operativo, emisor, sucursal, cliente_tipo_documento,
         cliente_numero, cliente_nombre, cliente_direccion, tasa_igv, subtotal, descuentos, op_gravadas,
         op_exoneradas, op_inafectas, op_gratuitas, igv, igv_gratuitas, icbper, total, monto_en_letras, orden_id,
         mesas, mozo_nombre, numero_llamado, numero_parte, detalle_parte, estado, simulado, creado_en, actualizado_en)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13::date, $14, $15::date, $16::jsonb, $17::jsonb, $18,
         $19, $20, $21, $22::numeric, $23::numeric, $24::numeric, $25::numeric,
         $26::numeric, $27::numeric, $28::numeric, $29::numeric, $30::numeric, $31::numeric, $32::numeric, $33, $34,
         $35::text[], $36, $37, $38, $39::jsonb, 'POR_ENVIAR', $40, $14, $14)
       RETURNING id`,
      {
        bind: [
          this.contexto.empresaActual(),
          datos.sucursalId,
          emisor.id,
          datos.cajaId,
          datos.turnoId,
          datos.turnoResponsableId,
          datos.cobroId,
          serieId,
          datos.tipo,
          serie,
          numero,
          datos.formato,
          fechaLima(instante),
          instante,
          diaOperativo(instante, horaCorte ?? '00:00'),
          JSON.stringify({
            ruc: emisor.ruc,
            razonSocial: emisor.razonSocial,
            regimen: emisor.regimen,
          }),
          JSON.stringify({
            nombre: sucursal.nombre,
            direccion: sucursal.direccion,
            codigoEstablecimiento: sucursal.codigoEstablecimiento,
          }),
          cliente?.tipoDocumento ?? null,
          cliente?.numero ?? null,
          cliente?.nombre ?? null,
          cliente?.direccion ?? null,
          datos.tasaIgv,
          totales.subtotal,
          totales.descuentos,
          operaciones?.gravadas ?? null,
          operaciones?.exoneradas ?? null,
          operaciones?.inafectas ?? null,
          operaciones?.gratuitas ?? null,
          totales.igv,
          totales.igvGratuitas,
          totales.icbper,
          totales.total,
          montoEnLetras(totales.total),
          datos.orden?.id ?? null,
          datos.orden === null ? null : datos.orden.mesas,
          datos.orden?.mozo ?? null,
          datos.orden?.numeroLlamado ?? null,
          datos.orden === null ? null : datos.numeroParte,
          JSON.stringify(sinMarcaDeValida(datos.parte)),
          simulado,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const comprobanteId = filas[0]!.id;
    await this.insertarLineas(comprobanteId, datos);
    // 6b: el envío se registra en esta transacción y se encola después de confirmarla (criterio 124).
    await this.envios.registrar(comprobanteId, datos.tipo, fechaLima(instante), instante);
    await this.suscripciones.registrarComprobanteEmitido(datos.sucursalId, instante);
    const comprobante = await leerComprobante(this.conexion, comprobanteId);
    if (comprobante === null) throw new Error('El comprobante recién emitido no se puede leer');
    const trabajoId = await this.encolarTicket(comprobante, datos, instante, emisor.id);
    return {
      comprobante,
      trabajoId,
      impresion: trabajoId === null ? 'SIN_IMPRESORA' : 'EN_COLA',
      emitidoEn: instante,
    };
  }

  /**
   * Primera mitad de una nota de crédito (historia 006, 6b, criterios 143 a 148): bloquea el original (`FOR UPDATE`, antes
   * de leer las notas que cuentan: dos notas simultáneas se turnan aquí), valida que se pueda acreditar (404 / 403 /
   * 409 `COMPROBANTE_NO_ACEPTADO` / `COMPROBANTE_ANULADO` / 422 `NOTA_CREDITO_INVALIDA`, `COMPROBANTE_NO_PERMITIDO`,
   * `CLIENTE_REQUERIDO`), lee lo que acreditaron las notas que cuentan (todas salvo las reemplazadas por una reemisión),
   * calcula con `calcularNotaCredito` (422 `NADA_QUE_ACREDITAR` / `NOTA_CREDITO_INVALIDA`), compara el total (409
   * `NOTA_CREDITO_CAMBIO`) y el objetivo de la autorización del Cajero (403 `AUTORIZACION_INVALIDA`).
   */
  async prepararNotaCredito(entrada: NotaCreditoEntradaValidada): Promise<NotaCreditoPreparada> {
    const sucursalId = this.sesion.sucursalActiva();
    const originalId = entrada.comprobanteId.toLowerCase();
    const filas = await this.conexion.query<FilaOriginal>(
      `SELECT id, tipo, estado, serie, numero, emisor_id, caja_id, turno_id, turno_responsable_id,
              afecta_a_id, emisor->>'regimen' AS regimen, tasa_igv::text AS tasa_igv
         FROM comprobante WHERE id = $1 AND sucursal_id = $2 FOR UPDATE`,
      { bind: [originalId, sucursalId], type: QueryTypes.SELECT },
    );
    const original = filas[0];
    if (original === undefined) throw comprobanteNoEncontrado();
    const principal = this.sesion.principal();
    if (!veTodosLosTurnos(principal) && original.turno_responsable_id !== principal.usuarioId) {
      throw comprobanteDeOtro();
    }
    if (original.tipo !== 'BOLETA' && original.tipo !== 'FACTURA') {
      throw notaCreditoInvalida('Una nota de crédito no se puede acreditar con otra nota');
    }
    if (original.estado === 'ANULADO') throw comprobanteAnulado();
    if (original.estado !== 'ACEPTADO') throw comprobanteNoAceptado();

    let clienteDeLaFactura: ClienteComprobanteEntrada | null = null;
    if (entrada.tipo === 'CAMBIO_A_FACTURA') {
      if (original.tipo !== 'BOLETA') {
        throw notaCreditoInvalida('El cambio a factura solo se hace sobre una boleta');
      }
      if (!tiposDeComprobantePermitidos(original.regimen).includes('FACTURA')) {
        throw comprobanteNoPermitido('El emisor solo puede emitir boletas de venta', 'tipo');
      }
      const cliente = entrada.cliente;
      if (
        cliente === undefined ||
        cliente.tipoDocumento !== 'RUC' ||
        cliente.direccion === undefined
      ) {
        throw clienteRequerido(
          'Una factura necesita el cliente con su RUC, su razón social y su dirección',
        );
      }
      clienteDeLaFactura = cliente;
    }

    // Con el original bloqueado: las líneas cobradas y lo que acreditaron las notas que cuentan.
    const lineas = await this.conexion.query<FilaLineaOriginal>(
      `SELECT posicion, item_id, descripcion, cantidad, unidad, precio_unitario::text AS precio_unitario,
              valor_unitario::text AS valor_unitario, afectacion, bruto::text AS bruto, descuento::text AS descuento,
              neto::text AS neto, base::text AS base, igv::text AS igv, bolsas, icbper::text AS icbper, gratuita,
              valor_referencial::text AS valor_referencial, base_referencial::text AS base_referencial,
              igv_referencial::text AS igv_referencial
         FROM comprobante_linea WHERE comprobante_id = $1 ORDER BY posicion`,
      { bind: [originalId], type: QueryTypes.SELECT },
    );
    const acreditadas = await this.acreditadoDe(originalId);
    const resultado = conMontosConsistentes(
      `la nota de crédito del comprobante ${originalId}`,
      () =>
        new ErrorAplicacion(
          409,
          'CONFLICTO',
          'Los montos del comprobante no cuadran: avisa al administrador antes de emitir la nota',
        ),
      () =>
        calcularNotaCredito(
          {
            tasaIgv: original.tasa_igv,
            lineas: lineas.map((l) => ({
              posicion: l.posicion,
              cantidad: l.cantidad,
              precioUnitario: l.precio_unitario,
              afectacion: l.afectacion,
              bruto: l.bruto,
              descuento: l.descuento,
              neto: l.neto,
              base: l.base,
              igv: l.igv,
              bolsas: l.bolsas,
              icbper: l.icbper,
              gratuita: l.gratuita,
              valorReferencial: l.valor_referencial,
              baseReferencial: l.base_referencial,
              igvReferencial: l.igv_referencial,
            })),
          },
          acreditadas,
          entrada.tipo === 'DEVOLUCION'
            ? {
                tipo: 'DEVOLUCION',
                lineas: (entrada.lineas ?? []).map((l) => ({
                  posicion: l.posicion,
                  cantidad: l.cantidad,
                })),
              }
            : { tipo: 'ANULACION' },
        ),
    );
    if (!resultado.valida) {
      if (resultado.codigo === 'NADA_QUE_ACREDITAR') throw nadaQueAcreditar();
      throw notaCreditoInvalida(
        entrada.tipo === 'DEVOLUCION'
          ? 'Una de las líneas no existe, está repetida, es gratuita o pide más unidades de las que faltan'
          : 'El comprobante ya tiene notas de crédito: lo que queda se devuelve con otra devolución',
      );
    }
    const total = resultado.totales.total;
    if (normalizarValor(entrada.total) !== total) throw notaCreditoCambio(total);

    // La clave del supervisor vale solo para esta nota (criterio 145): el total que recalculó el servidor y lo devuelto.
    const devuelto = sumarMontos(
      (entrada.devolucion?.pagos ?? []).map((p) => normalizarValor(p.monto)),
    );
    exigirObjetivo(this.sesion.autorizacionConsumida(), {
      tipo: 'NOTA_CREDITO',
      comprobanteId: originalId,
      tipoNota: entrada.tipo,
      total,
      devuelto,
    });

    return {
      originalId,
      originalTipo: original.tipo,
      originalNumero: textoDelNumero(original.serie, original.numero),
      sucursalId,
      emisorId: original.emisor_id,
      tipoNota: entrada.tipo,
      motivo: entrada.motivo,
      total,
      cajaDelOriginalId: original.caja_id,
      responsableDelOriginalId: original.turno_responsable_id,
      turnoDelOriginalId: original.turno_id!,
      calculo: { lineas: resultado.lineas, totales: resultado.totales },
      origenes: new Map(
        lineas.map((l) => [
          l.posicion,
          {
            itemId: l.item_id,
            descripcion: l.descripcion,
            unidad: l.unidad,
            valorUnitario: l.valor_unitario,
          },
        ]),
      ),
      clienteDeLaFactura,
    };
  }

  /**
   * Lo que ya acreditaron las notas que cuentan de un comprobante, por línea del original (criterio 148): todas las
   * notas cuyo `afecta_a_id` es el original salvo las que reemplazó una reemisión (una nota rechazada sin reemisión sigue
   * contando: su dinero ya se devolvió). Se llama con el original bloqueado.
   */
  async acreditadoDe(originalId: string): Promise<LineaAcreditada[]> {
    const filas = await this.conexion.query<{
      posicion_origen: number;
      cantidad: number;
      neto: string;
      base: string;
      igv: string;
      bolsas: number;
      icbper: string;
    }>(
      `SELECT l.posicion_origen, sum(l.cantidad)::int AS cantidad,
              sum(l.neto)::numeric(14, 2)::text AS neto, sum(l.base)::numeric(14, 2)::text AS base,
              sum(l.igv)::numeric(14, 2)::text AS igv, sum(l.bolsas)::int AS bolsas,
              sum(l.icbper)::numeric(14, 2)::text AS icbper
         FROM comprobante n JOIN comprobante_linea l ON l.comprobante_id = n.id
        WHERE n.afecta_a_id = $1
          AND NOT EXISTS (SELECT 1 FROM comprobante r WHERE r.reemplaza_a_id = n.id)
        GROUP BY l.posicion_origen ORDER BY l.posicion_origen`,
      { bind: [originalId], type: QueryTypes.SELECT },
    );
    return filas.map((f) => ({
      posicionOrigen: f.posicion_origen,
      cantidad: f.cantidad,
      neto: f.neto,
      base: f.base,
      igv: f.igv,
      bolsas: f.bolsas,
      icbper: f.icbper,
    }));
  }

  /**
   * Segunda mitad: toma el emisor `FOR SHARE`, numera con la serie de nota de la caja de la operación (y, en un cambio,
   * después la serie `FACTURA`), inserta la nota (y la factura) con sus líneas, sus envíos, la cuota y los tickets
   * (criterios 149 a 151, 155 y 157). 409 `SIN_SERIE` / `SERIE_AGOTADA`. El original ya está bloqueado y el turno de la
   * devolución, tomado por quien llama.
   */
  async numerarNotaCredito(
    preparada: NotaCreditoPreparada,
    datos: DatosParaNumerarNota,
  ): Promise<NotaCreditoEmitida> {
    await this.emisores.bloquearParaEmitir(preparada.emisorId);
    const tipoNota =
      preparada.originalTipo === 'BOLETA' ? 'NOTA_CREDITO_BOLETA' : 'NOTA_CREDITO_FACTURA';
    const numeroNota = await this.numerarNota(datos.cajaId, tipoNota, preparada.emisorId);
    const esCambio = preparada.tipoNota === 'CAMBIO_A_FACTURA';
    const numeroFactura = esCambio
      ? await this.series.tomarNumero(datos.cajaId, 'FACTURA', preparada.emisorId)
      : null;
    // Con las series bloqueadas: el instante se toma después de numerar, para que la fecha sea monótona con el número.
    const instante = this.reloj.ahora();
    const horaCorte = await this.sucursales.horaCorte(preparada.sucursalId);
    const dia = diaOperativo(instante, horaCorte ?? '00:00');
    const simulado = (await this.emisores.modoPse(preparada.emisorId)) === 'SIMULADO';

    const notaId = await this.insertarNota(preparada, datos, numeroNota, instante, dia, simulado);
    const facturaId =
      numeroFactura === null
        ? null
        : await this.insertarFacturaDeCambio(
            preparada,
            datos,
            numeroFactura,
            instante,
            dia,
            simulado,
          );

    for (const [id, tipo] of [
      [notaId, tipoNota],
      ...(facturaId === null ? [] : [[facturaId, 'FACTURA'] as const]),
    ] as const) {
      await this.envios.registrar(id, tipo, fechaLima(instante), instante);
      await this.suscripciones.registrarComprobanteEmitido(preparada.sucursalId, instante);
    }

    const nota = await leerComprobante(this.conexion, notaId);
    if (nota === null) throw new Error('La nota recién emitida no se puede leer');
    const trabajoNota = await this.encolarTicketDeNota(nota, preparada, datos, instante, true);
    let factura: ComprobanteEmitido | null = null;
    if (facturaId !== null) {
      const emitida = await leerComprobante(this.conexion, facturaId);
      if (emitida === null) throw new Error('La factura recién emitida no se puede leer');
      const trabajoFactura = await this.encolarTicketDeNota(
        emitida,
        preparada,
        datos,
        instante,
        false,
      );
      factura = {
        comprobante: emitida,
        trabajoId: trabajoFactura,
        impresion: trabajoFactura === null ? 'SIN_IMPRESORA' : 'EN_COLA',
        emitidoEn: instante,
      };
    }
    return {
      nota: {
        comprobante: nota,
        trabajoId: trabajoNota,
        impresion: trabajoNota === null ? 'SIN_IMPRESORA' : 'EN_COLA',
        emitidoEn: instante,
      },
      factura,
    };
  }

  /** La serie de notas de la caja; sin ella, 409 `SIN_SERIE` con el mensaje de las notas (criterio 149). */
  private async numerarNota(
    cajaId: string,
    tipo: 'NOTA_CREDITO_BOLETA' | 'NOTA_CREDITO_FACTURA',
    emisorId: string,
  ): Promise<NumeroTomado> {
    try {
      return await this.series.tomarNumero(cajaId, tipo, emisorId);
    } catch (error) {
      if (error instanceof ErrorAplicacion && error.codigo === 'SIN_SERIE') throw sinSerieDeNotas();
      throw error;
    }
  }

  /**
   * La fila de la nota: copia del original su emisor, su sucursal, su cliente, su formato y su tasa de IGV, y guarda los
   * totales y las líneas que calculó `calcularNotaCredito` (con `posicion_origen`). El turno es el de la devolución, si hay.
   */
  private async insertarNota(
    p: NotaCreditoPreparada,
    d: DatosParaNumerarNota,
    numero: NumeroTomado,
    instante: Date,
    dia: string,
    simulado: boolean,
  ): Promise<string> {
    const t = p.calculo.totales;
    const op = t.operaciones;
    const creados = await this.conexion.query<{ id: string }>(
      `INSERT INTO comprobante (
         empresa_id, sucursal_id, emisor_id, caja_id, turno_id, turno_responsable_id, cobro_id, serie_id, tipo, serie,
         numero, formato, fecha_emision, emitido_en, dia_operativo, emisor, sucursal, cliente_tipo_documento,
         cliente_numero, cliente_nombre, cliente_direccion, moneda, tasa_igv, subtotal, descuentos, op_gravadas,
         op_exoneradas, op_inafectas, op_gratuitas, igv, igv_gratuitas, icbper, total, monto_en_letras, estado,
         simulado, afecta_a_id, tipo_nota, motivo_nota, creado_en, actualizado_en)
       SELECT empresa_id, sucursal_id, emisor_id, $2, $3, $4, NULL, $5, $6, $7,
              $8, formato, $9::date, $10, $11::date, emisor, sucursal, cliente_tipo_documento,
              cliente_numero, cliente_nombre, cliente_direccion, moneda, tasa_igv, $12::numeric, $13::numeric,
              $14::numeric, $15::numeric, $16::numeric, $17::numeric, $18::numeric, $19::numeric, $20::numeric,
              $21::numeric, $22, 'POR_ENVIAR', $23, id, $24, $25, $10, $10
         FROM comprobante WHERE id = $1
       RETURNING id`,
      {
        bind: [
          p.originalId,
          d.cajaId,
          d.turno?.id ?? null,
          d.turno?.responsableId ?? p.responsableDelOriginalId,
          numero.serieId,
          p.originalTipo === 'BOLETA' ? 'NOTA_CREDITO_BOLETA' : 'NOTA_CREDITO_FACTURA',
          numero.serie,
          numero.numero,
          fechaLima(instante),
          instante,
          dia,
          t.subtotal,
          t.descuentos,
          op?.gravadas ?? null,
          op?.exoneradas ?? null,
          op?.inafectas ?? null,
          op?.gratuitas ?? null,
          t.igv,
          t.igvGratuitas,
          t.icbper,
          t.total,
          montoEnLetras(t.total),
          simulado,
          p.tipoNota === 'DEVOLUCION' ? 'DEVOLUCION' : 'ANULACION',
          p.motivo,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const id = creados[0]!.id;
    await this.insertarLineasDeNota(id, p);
    return id;
  }

  /** Las líneas de la nota, de una vez: lo calculado por el dominio y, del original, el ítem, la descripción y el valor unitario. */
  private async insertarLineasDeNota(notaId: string, p: NotaCreditoPreparada): Promise<void> {
    const bind: unknown[] = [this.contexto.empresaActual(), notaId, this.reloj.ahora()];
    const filas = p.calculo.lineas.map((l) => {
      const origen = p.origenes.get(l.posicionOrigen);
      if (origen === undefined) throw new Error(`Falta la línea ${l.posicionOrigen} del original`);
      const desde = bind.length;
      bind.push(
        l.posicion,
        origen.itemId,
        origen.descripcion,
        l.cantidad,
        origen.unidad,
        l.precioUnitario,
        origen.valorUnitario,
        l.bruto,
        l.descuento,
        l.neto,
        l.base,
        l.igv,
        l.bolsas,
        l.icbper,
        l.afectacion,
        l.gratuita,
        l.valorReferencial,
        l.baseReferencial,
        l.igvReferencial,
        l.posicionOrigen,
      );
      const q = (n: number) => `$${desde + n}`;
      return `($1, $2, ${q(1)}, ${q(2)}, ${q(3)}, ${q(4)}, ${q(5)}, ${q(6)}::numeric, ${q(7)}::numeric,
               ${q(8)}::numeric, ${q(9)}::numeric, ${q(10)}::numeric, ${q(11)}::numeric, ${q(12)}::numeric, ${q(13)},
               ${q(14)}::numeric, ${q(15)}, ${q(16)}, ${q(17)}::numeric, ${q(18)}::numeric, ${q(19)}::numeric,
               ${q(20)}, $3, $3)`;
    });
    await this.conexion.query(
      `INSERT INTO comprobante_linea (
         empresa_id, comprobante_id, posicion, item_id, descripcion, cantidad, unidad, precio_unitario, valor_unitario,
         bruto, descuento, neto, base, igv, bolsas, icbper, afectacion, gratuita, valor_referencial, base_referencial,
         igv_referencial, posicion_origen, creado_en, actualizado_en)
       VALUES ${filas.join(',\n')}`,
      { bind, type: QueryTypes.INSERT },
    );
  }

  /**
   * La factura de un cambio de boleta por factura (criterio 151): copia de la boleta sus líneas, su formato, sus totales,
   * su tasa de IGV, su caja, su turno (no es un cobro, pero conserva el turno de la boleta) y su emisor; lleva el cliente de
   * la entrada y `reemplaza_a_id` = la boleta. Nada se recalcula.
   */
  private async insertarFacturaDeCambio(
    p: NotaCreditoPreparada,
    d: DatosParaNumerarNota,
    numero: NumeroTomado,
    instante: Date,
    dia: string,
    simulado: boolean,
  ): Promise<string> {
    const cliente = p.clienteDeLaFactura;
    if (cliente === null) throw new Error('El cambio a factura necesita el cliente');
    const creados = await this.conexion.query<{ id: string }>(
      `INSERT INTO comprobante (
         empresa_id, sucursal_id, emisor_id, caja_id, turno_id, turno_responsable_id, cobro_id, serie_id, tipo, serie,
         numero, formato, fecha_emision, emitido_en, dia_operativo, emisor, sucursal, cliente_tipo_documento,
         cliente_numero, cliente_nombre, cliente_direccion, moneda, tasa_igv, subtotal, descuentos, op_gravadas,
         op_exoneradas, op_inafectas, op_gratuitas, igv, igv_gratuitas, icbper, total, monto_en_letras, orden_id, mesas,
         mozo_nombre, numero_llamado, numero_parte, detalle_parte, estado, simulado, reemplaza_a_id, motivo_reemplazo,
         creado_en, actualizado_en)
       SELECT empresa_id, sucursal_id, emisor_id, $2, turno_id, turno_responsable_id, NULL, $3, 'FACTURA', $4,
              $5, formato, $6::date, $7, $8::date, emisor, sucursal, $9, $10, $11, $12, moneda, tasa_igv, subtotal,
              descuentos, op_gravadas, op_exoneradas, op_inafectas, op_gratuitas, igv, igv_gratuitas, icbper, total,
              monto_en_letras, NULL, mesas, mozo_nombre, numero_llamado, NULL, NULL, 'POR_ENVIAR', $13, id,
              'CAMBIO_A_FACTURA', $7, $7
         FROM comprobante WHERE id = $1
       RETURNING id`,
      {
        bind: [
          p.originalId,
          d.cajaId,
          numero.serieId,
          numero.serie,
          numero.numero,
          fechaLima(instante),
          instante,
          dia,
          cliente.tipoDocumento,
          cliente.numero,
          cliente.nombre,
          cliente.direccion ?? null,
          simulado,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const id = creados[0]!.id;
    await this.conexion.query(
      `INSERT INTO comprobante_linea (
         empresa_id, comprobante_id, posicion, item_id, descripcion, cantidad, unidad, precio_unitario, valor_unitario,
         bruto, descuento, neto, base, igv, bolsas, icbper, afectacion, gratuita, valor_referencial, base_referencial,
         igv_referencial, posicion_origen, creado_en, actualizado_en)
       SELECT empresa_id, $2, posicion, item_id, descripcion, cantidad, unidad, precio_unitario, valor_unitario,
              bruto, descuento, neto, base, igv, bolsas, icbper, afectacion, gratuita, valor_referencial,
              base_referencial, igv_referencial, NULL, $3, $3
         FROM comprobante_linea WHERE comprobante_id = $1`,
      { bind: [p.originalId, id, instante], type: QueryTypes.INSERT },
    );
    return id;
  }

  /**
   * El trabajo `COMPROBANTE` de la nota (o de la factura de un cambio) en la impresora de la caja de la operación, o
   * `null` sin impresora. La gaveta se abre solo con el ticket de la nota y solo si se devuelve efectivo (criterio 150).
   */
  private async encolarTicketDeNota(
    comprobante: ComprobanteRespuesta,
    p: NotaCreditoPreparada,
    d: DatosParaNumerarNota,
    instante: Date,
    esLaNota: boolean,
  ): Promise<string | null> {
    const impresora = d.impresora;
    if (impresora === null) return null;
    const urlConsulta = await this.conectores.urlConsulta(p.emisorId);
    const [trabajoId] = await this.impresion.encolar([
      {
        sucursalId: p.sucursalId,
        impresoraId: impresora.id,
        estacionId: null,
        tipo: 'COMPROBANTE',
        comandaId: null,
        precuentaId: null,
        comprobanteId: comprobante.id,
        turnoId: null,
        mesa: null,
        ordenId: null,
        envioNumero: null,
        documento: documentoDeComprobante(comprobante, {
          hora: horaLocal(instante),
          pagos: [],
          vuelto: '0.00',
          redondeo: '0.00',
          abreGaveta: esLaNota && impresora.gaveta && d.devolucionEnEfectivo,
          devolucion:
            esLaNota && d.pagos.length > 0
              ? {
                  pagos: d.pagos.map((pago) => ({ medio: pago.medio, monto: pago.monto })),
                  redondeo: d.redondeo,
                }
              : null,
          urlConsulta,
        }),
      },
    ]);
    return trabajoId ?? null;
  }

  /**
   * "Emitir otro" de un comprobante `RECHAZADO` (criterio 134): toma el rechazado con `FOR UPDATE`, el emisor con
   * `FOR SHARE` y la serie activa del tipo en la caja del rechazado, y guarda uno nuevo con otro número, **las mismas
   * líneas y totales** (copiados con `INSERT … SELECT`, sin recalcular), la misma tasa de IGV, el mismo formato, caja, turno
   * y responsable (también si el turno ya se cerró: no toca su X ni su Z) y el mismo emisor, con `reemplaza_a_id` = el
   * rechazado. Registra su envío, cuenta en la cuota del plan y encola el ticket en la impresora de esa caja, sin el pulso
   * de la gaveta. 409 `COMPROBANTE_NO_RECHAZADO` / `YA_REEMPLAZADO` / `SIN_SERIE` / `SERIE_AGOTADA`; 422
   * `COMPROBANTE_NO_PERMITIDO` / `CLIENTE_REQUERIDO` (las reglas del criterio 51). Una nota de crédito rechazada se
   * reemite con el mismo tipo de nota, sin cliente y con el mismo documento que modifica. Quien llama comprobó el alcance.
   */
  async reemitir(comprobanteId: string, datos: DatosDeReemision): Promise<ComprobanteEmitido> {
    const filas = await this.conexion.query<FilaRechazada>(
      `SELECT id, estado, tipo, emisor_id, caja_id, sucursal_id, cobro_id, total::text AS total,
              emisor->>'regimen' AS regimen, cliente_tipo_documento, cliente_numero, cliente_nombre,
              cliente_direccion
         FROM comprobante WHERE id = $1 FOR UPDATE`,
      { bind: [comprobanteId], type: QueryTypes.SELECT },
    );
    const rechazado = filas[0];
    if (rechazado === undefined) throw comprobanteNoEncontrado();
    if (rechazado.estado !== 'RECHAZADO') throw comprobanteNoRechazado();
    const previas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM comprobante WHERE reemplaza_a_id = $1',
      { bind: [comprobanteId], type: QueryTypes.SELECT },
    );
    if (previas[0] !== undefined) throw yaReemplazado(previas[0].id);

    const cliente = this.clienteDeReemision(rechazado, datos);
    await this.emisores.bloquearParaEmitir(rechazado.emisor_id);
    const { serieId, serie, numero } = await this.series.tomarNumero(
      rechazado.caja_id,
      datos.tipo,
      rechazado.emisor_id,
    );
    const instante = this.reloj.ahora();
    const horaCorte = await this.sucursales.horaCorte(rechazado.sucursal_id);
    const simulado = (await this.emisores.modoPse(rechazado.emisor_id)) === 'SIMULADO';
    const creados = await this.conexion.query<{ id: string }>(
      `INSERT INTO comprobante (
         empresa_id, sucursal_id, emisor_id, caja_id, turno_id, turno_responsable_id, cobro_id, serie_id, tipo, serie,
         numero, formato, fecha_emision, emitido_en, dia_operativo, emisor, sucursal, cliente_tipo_documento,
         cliente_numero, cliente_nombre, cliente_direccion, moneda, tasa_igv, subtotal, descuentos, op_gravadas,
         op_exoneradas, op_inafectas, op_gratuitas, igv, igv_gratuitas, icbper, total, monto_en_letras, orden_id, mesas,
         mozo_nombre, numero_llamado, numero_parte, detalle_parte, estado, simulado, afecta_a_id, tipo_nota,
         motivo_nota, reemplaza_a_id, motivo_reemplazo, creado_en, actualizado_en)
       SELECT empresa_id, sucursal_id, emisor_id, caja_id, turno_id, turno_responsable_id, NULL, $2, $3, $4,
              $5, formato, $6::date, $7, $8::date, emisor, sucursal, $9,
              $10, $11, $12, moneda, tasa_igv, subtotal, descuentos, op_gravadas,
              op_exoneradas, op_inafectas, op_gratuitas, igv, igv_gratuitas, icbper, total, monto_en_letras, NULL, mesas,
              mozo_nombre, numero_llamado, NULL, NULL, 'POR_ENVIAR', $13, afecta_a_id, tipo_nota,
              motivo_nota, id, 'REEMISION', $7, $7
         FROM comprobante WHERE id = $1
       RETURNING id`,
      {
        bind: [
          comprobanteId,
          serieId,
          datos.tipo,
          serie,
          numero,
          fechaLima(instante),
          instante,
          diaOperativo(instante, horaCorte ?? '00:00'),
          cliente?.tipoDocumento ?? null,
          cliente?.numero ?? null,
          cliente?.nombre ?? null,
          cliente?.direccion ?? null,
          simulado,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const nuevoId = creados[0]!.id;
    await this.conexion.query(
      `INSERT INTO comprobante_linea (
         empresa_id, comprobante_id, posicion, item_id, descripcion, cantidad, unidad, precio_unitario, valor_unitario,
         bruto, descuento, neto, base, igv, bolsas, icbper, afectacion, gratuita, valor_referencial, base_referencial,
         igv_referencial, posicion_origen, creado_en, actualizado_en)
       SELECT empresa_id, $2, posicion, item_id, descripcion, cantidad, unidad, precio_unitario, valor_unitario,
              bruto, descuento, neto, base, igv, bolsas, icbper, afectacion, gratuita, valor_referencial,
              base_referencial, igv_referencial, posicion_origen, $3, $3
         FROM comprobante_linea WHERE comprobante_id = $1`,
      { bind: [comprobanteId, nuevoId, instante], type: QueryTypes.INSERT },
    );
    await this.envios.registrar(nuevoId, datos.tipo, fechaLima(instante), instante);
    await this.suscripciones.registrarComprobanteEmitido(rechazado.sucursal_id, instante);
    const comprobante = await leerComprobante(this.conexion, nuevoId);
    if (comprobante === null) throw new Error('El comprobante recién emitido no se puede leer');
    const trabajoId = await this.encolarTicketDeReemision(comprobante, rechazado, instante);
    return {
      comprobante,
      trabajoId,
      impresion: trabajoId === null ? 'SIN_IMPRESORA' : 'EN_COLA',
      emitidoEn: instante,
    };
  }

  /**
   * Las reglas del criterio 51 para el comprobante nuevo antes de numerar nada: el tipo que el emisor puede emitir
   * (`COMPROBANTE_NO_PERMITIDO`) y el cliente (`CLIENTE_REQUERIDO`: la factura exige RUC y dirección; la boleta de más de
   * S/ 700, documento y nombre). Sin `cliente` en la entrada se conserva el del rechazado. Devuelve el cliente que lleva.
   */
  private clienteDeReemision(
    rechazado: FilaRechazada,
    datos: DatosDeReemision,
  ): ClienteComprobanteEntrada | null {
    const esNota =
      rechazado.tipo === 'NOTA_CREDITO_BOLETA' || rechazado.tipo === 'NOTA_CREDITO_FACTURA';
    if (esNota) {
      if (datos.tipo !== rechazado.tipo) {
        throw comprobanteNoPermitido(
          'Una nota de crédito rechazada se emite de nuevo con el mismo tipo de nota',
          'tipo',
        );
      }
      return conservado(rechazado);
    }
    if (datos.tipo !== 'BOLETA' && datos.tipo !== 'FACTURA') {
      throw comprobanteNoPermitido('Elige boleta o factura', 'tipo');
    }
    if (!tiposDeComprobantePermitidos(rechazado.regimen).includes(datos.tipo)) {
      throw comprobanteNoPermitido('El emisor solo puede emitir boletas de venta', 'tipo');
    }
    const cliente = datos.cliente ?? conservado(rechazado);
    if (datos.tipo === 'FACTURA') {
      if (cliente === null || cliente.tipoDocumento !== 'RUC' || cliente.direccion === undefined) {
        throw clienteRequerido(
          'Una factura necesita el cliente con su RUC, su razón social y su dirección',
        );
      }
    } else if (
      cliente === null &&
      compararMontos(rechazado.total, MONTO_BOLETA_SIN_DOCUMENTO) > 0
    ) {
      throw clienteRequerido(
        `Una boleta de más de S/ ${MONTO_BOLETA_SIN_DOCUMENTO} necesita el documento y el nombre del cliente`,
      );
    }
    return cliente;
  }

  /** El ticket de la reemisión en la impresora de la caja del rechazado, sin el pulso de la gaveta (criterio 134). */
  private async encolarTicketDeReemision(
    comprobante: ComprobanteRespuesta,
    rechazado: FilaRechazada,
    instante: Date,
  ): Promise<string | null> {
    const impresora = await this.impresoras.deLaCaja(rechazado.caja_id);
    if (impresora === null) return null;
    const cobro =
      rechazado.cobro_id === null ? null : await this.pagosDeCobro.deCobro(rechazado.cobro_id);
    const urlConsulta = await this.conectores.urlConsulta(rechazado.emisor_id);
    // Una nota que reemplaza a otra rechazada lleva la devolución de la rechazada (la que se hizo en caja, criterio 157).
    const devolucion =
      comprobante.afectaA === undefined || comprobante.afectaA === null
        ? null
        : await this.devoluciones.de(rechazado.id);
    const orden = comprobante.orden;
    const [trabajoId] = await this.impresion.encolar([
      {
        sucursalId: rechazado.sucursal_id,
        impresoraId: impresora.id,
        estacionId: null,
        tipo: 'COMPROBANTE',
        comandaId: null,
        precuentaId: null,
        comprobanteId: comprobante.id,
        turnoId: null,
        mesa:
          orden === null
            ? null
            : orden.numeroLlamado !== null
              ? `Llamado ${orden.numeroLlamado}`
              : orden.mesas.join(', '),
        ordenId: orden?.id ?? null,
        envioNumero: null,
        documento: documentoDeComprobante(comprobante, {
          hora: horaLocal(instante),
          pagos: cobro?.pagos ?? [],
          vuelto: cobro?.vuelto ?? '0.00',
          redondeo: cobro?.redondeo ?? '0.00',
          abreGaveta: false,
          urlConsulta,
          devolucion,
        }),
      },
    ]);
    return trabajoId ?? null;
  }

  /**
   * El trabajo `COMPROBANTE` en la impresora de la caja, o `null` si no hay. El ticket empieza con el pulso de la
   * gaveta si algún pago es en efectivo y la impresora tiene gaveta (criterio 92); si el cobro es una cuenta toda en
   * cortesía (sin pagos), no hay pulso.
   */
  private async encolarTicket(
    comprobante: ComprobanteRespuesta,
    datos: DatosDeEmision,
    instante: Date,
    emisorId: string,
  ): Promise<string | null> {
    const impresora = datos.impresora;
    if (impresora === null) return null;
    const urlConsulta = await this.conectores.urlConsulta(emisorId);
    const hayEfectivo = datos.pagos.some((p) => p.medio === 'EFECTIVO' && p.monto !== '0.00');
    const orden = datos.orden;
    const [trabajoId] = await this.impresion.encolar([
      {
        sucursalId: datos.sucursalId,
        impresoraId: impresora.id,
        estacionId: null,
        tipo: 'COMPROBANTE',
        comandaId: null,
        precuentaId: null,
        comprobanteId: comprobante.id,
        turnoId: null,
        mesa:
          orden === null
            ? null
            : orden.numeroLlamado !== null
              ? `Llamado ${orden.numeroLlamado}`
              : orden.mesas.join(', '),
        ordenId: orden?.id ?? null,
        envioNumero: null,
        documento: documentoDeComprobante(comprobante, {
          hora: horaLocal(instante),
          pagos: datos.pagos.map((p) => ({ medio: p.medio, monto: p.monto, recibido: p.recibido })),
          vuelto: datos.vuelto,
          redondeo: datos.redondeo,
          abreGaveta: impresora.gaveta && hayEfectivo,
          urlConsulta,
        }),
      },
    ]);
    return trabajoId ?? null;
  }

  /**
   * Las líneas del comprobante (criterio 69), de una vez. El precio unitario y el valor unitario sin IGV (10
   * decimales, la mitad hacia arriba) los calcula `preciosUnitarios` de `packages/dominio`; aquí solo se guardan.
   */
  private async insertarLineas(comprobanteId: string, datos: DatosDeEmision): Promise<void> {
    const lineas = datos.parte.lineas;
    if (lineas.length === 0) throw new Error('Un comprobante necesita al menos una línea');
    const bind: unknown[] = [this.contexto.empresaActual(), comprobanteId, this.reloj.ahora()];
    const filas = lineas.map((linea, indice) => {
      const desde = bind.length;
      bind.push(...valoresDeLinea(linea, indice + 1, datos));
      const p = (n: number) => `$${desde + n}`;
      return `($1, $2, ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(18)}::numeric, ${p(19)}::numeric, ${p(6)},
               ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)}, ${p(14)}, ${p(15)}, ${p(16)}, ${p(17)},
               $3, $3)`;
    });
    await this.conexion.query(
      `INSERT INTO comprobante_linea (
         empresa_id, comprobante_id, posicion, item_id, descripcion, cantidad, unidad, precio_unitario, valor_unitario,
         bruto, descuento, neto, base, igv, bolsas, icbper, afectacion, gratuita, valor_referencial, base_referencial,
         igv_referencial, creado_en, actualizado_en)
       VALUES ${filas.join(',\n')}`,
      { bind, type: QueryTypes.INSERT },
    );
  }
}

/** El largo máximo de la descripción de una línea (CHECK de `comprobante_linea.descripcion`, criterio 90). */
export const LARGO_MAXIMO_DESCRIPCION = 250;

/**
 * Recorta la descripción de una línea a 250 caracteres con «…» al final (nombre con modificadores puede pasar del
 * límite de la columna). No parte un par sustituto ni deja espacios antes de los puntos suspensivos; el resultado
 * mide a lo más 250 unidades tanto para JavaScript como para `char_length`. Lo que ya cabe no se toca.
 */
export function recortarDescripcion(descripcion: string): string {
  if (descripcion.length <= LARGO_MAXIMO_DESCRIPCION) return descripcion;
  let corte = LARGO_MAXIMO_DESCRIPCION - 1;
  const ultima = descripcion.charCodeAt(corte - 1);
  if (ultima >= 0xd800 && ultima <= 0xdbff) corte -= 1; // la mitad alta de un par sustituto
  const recortada = descripcion.slice(0, corte).trimEnd();
  return `${recortada === '' ? descripcion.slice(0, 1) : recortada}…`;
}

/**
 * Los 19 valores de una línea, en el orden de sus parámetros: del 1 al 17 las columnas desde `posicion` (sin el
 * precio ni el valor unitario) y el 18 y el 19, el precio y el valor unitario que calcula el dominio. Un ítem sin descripción es
 * un error de quien arma los datos: el comprobante no se inventa un nombre.
 */
function valoresDeLinea(linea: LineaDeParte, posicion: number, datos: DatosDeEmision): unknown[] {
  const gratuita = linea.gratuita;
  const completa = linea.itemId === null ? 'Por consumo' : datos.descripciones.get(linea.itemId);
  if (completa === undefined) {
    throw new Error(`Falta la descripción del ítem ${linea.itemId} para el comprobante`);
  }
  const descripcion = recortarDescripcion(completa);
  const cantidad = gratuita?.cantidad ?? linea.cantidad;
  const { precioUnitario, valorUnitario } = preciosUnitarios({
    base: gratuita === null ? linea.bruto : gratuita.valorReferencial,
    cantidad,
    afectacion: linea.afectacion,
    tasaIgv: datos.tasaIgv,
  });
  return [
    posicion,
    linea.itemId,
    descripcion,
    cantidad,
    linea.itemId === null ? 'ZZ' : 'NIU',
    linea.bruto,
    linea.descuento,
    linea.neto,
    linea.base,
    linea.igv,
    linea.bolsas,
    linea.icbper,
    linea.afectacion,
    gratuita !== null,
    gratuita?.valorReferencial ?? null,
    gratuita?.base ?? null,
    gratuita?.igv ?? null,
    precioUnitario,
    valorUnitario,
  ];
}

/** Lo que la nota de crédito necesita del comprobante original (bloqueado). */
interface FilaOriginal {
  id: string;
  tipo: TipoDocumentoElectronico;
  estado: ComprobanteRespuesta['estado'];
  serie: string;
  numero: number;
  emisor_id: string;
  caja_id: string;
  turno_id: string | null;
  turno_responsable_id: string;
  afecta_a_id: string | null;
  regimen: RegimenTributario;
  tasa_igv: string | null;
}

/** Una línea del original, tal como se guardó. */
interface FilaLineaOriginal {
  posicion: number;
  item_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad: 'NIU' | 'ZZ';
  precio_unitario: string;
  valor_unitario: string;
  afectacion: 'GRAVADO' | 'EXONERADO' | 'INAFECTO';
  bruto: string;
  descuento: string;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
  gratuita: boolean;
  valor_referencial: string | null;
  base_referencial: string | null;
  igv_referencial: string | null;
}

/** Lo que la reemisión necesita del comprobante rechazado. */
interface FilaRechazada {
  id: string;
  estado: ComprobanteRespuesta['estado'];
  tipo: TipoDocumentoElectronico;
  emisor_id: string;
  caja_id: string;
  sucursal_id: string;
  cobro_id: string | null;
  total: string;
  regimen: RegimenTributario;
  cliente_tipo_documento: ClienteComprobanteEntrada['tipoDocumento'] | null;
  cliente_numero: string | null;
  cliente_nombre: string | null;
  cliente_direccion: string | null;
}

/** El cliente que ya tenía el comprobante rechazado, o `null`. */
function conservado(fila: FilaRechazada): ClienteComprobanteEntrada | null {
  if (fila.cliente_tipo_documento === null) return null;
  return {
    tipoDocumento: fila.cliente_tipo_documento,
    numero: fila.cliente_numero!,
    nombre: fila.cliente_nombre!,
    ...(fila.cliente_direccion === null ? {} : { direccion: fila.cliente_direccion }),
  };
}
