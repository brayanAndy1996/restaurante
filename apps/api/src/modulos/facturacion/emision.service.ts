import { Inject, Injectable } from '@nestjs/common';
import type {
  ClienteComprobanteEntrada,
  ComprobanteRespuesta,
  NotaCreditoEntradaValidada,
} from '@restaurante/contratos';
import {
  diaOperativo,
  fechaLima,
  montoEnLetras,
  preciosUnitarios,
  type FormatoComprobante,
  type LineaDeParte,
  type MedioPago,
  type ParteCalculada,
  type TipoComprobante,
  type TipoDocumentoElectronico,
  type TipoNotaCredito,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, horaLocal, type Reloj } from '../../nucleo/reloj';
import { documentoDeComprobante } from '../impresion';
import { IMPRESION, type ImpresionPuerto } from '../pedidos/impresion';
import {
  EmisoresService,
  SucursalesConsultaService,
  SuscripcionService,
  type DatosParaComprobante,
} from '../plataforma';
import { sinMarcaDeValida } from './facturado';
import { EnviosService } from './envios/envios.service';
import { leerComprobante } from './lectura-comprobante';
import { SeriesService } from './series.service';

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
// Entrega 6b: notas de crédito y reemisión (criterios 134, 143 a 157). Tipos provisionales de la fase A: T40 y T32 los
// ajustan al implementar.
// ---------------------------------------------------------------------------------------------------

/**
 * Una nota de crédito ya validada y calculada, con el original bloqueado (`prepararNotaCredito`). Caja la usa para tomar el
 * turno de la devolución después del original y antes del emisor (plan, "Orden de los cerrojos"); es opaca para ella.
 */
export interface NotaCreditoPreparada {
  originalId: string;
  tipoNota: TipoNotaCredito;
  motivo: string;
  /** El total de la nota que recalculó el servidor (texto con 2 decimales). */
  total: string;
  /** La caja del comprobante original: la de la nota si no hay devolución. */
  cajaDelOriginalId: string;
  /** El responsable del turno del original: el de la nota si no hay devolución (criterio 169). */
  responsableDelOriginalId: string;
}

/** Lo que caja pone al numerar la nota (`numerarNotaCredito`). */
export interface DatosParaNumerarNota {
  /** La caja de la operación: la del turno de la devolución o, sin devolución, la del original. */
  cajaId: string;
  /** El turno de la devolución y su responsable; `null` sin devolución. */
  turno: { id: string; responsableId: string } | null;
  /** La impresora de la caja ya resuelta (`ImpresionPuerto.impresoraDeLaCaja`); `null` si no hay. */
  impresora: { id: string; gaveta: boolean } | null;
  /** Lo que se devuelve en efectivo abre la gaveta con el ticket de la nota (criterio 150). */
  devolucionEnEfectivo: boolean;
  /** Los pagos de la devolución, para el ticket. */
  pagos: readonly PagoParaTicket[];
  redondeo: string;
  cliente: ClienteComprobanteEntrada | null;
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
    const trabajoId = await this.encolarTicket(comprobante, datos, instante);
    return {
      comprobante,
      trabajoId,
      impresion: trabajoId === null ? 'SIN_IMPRESORA' : 'EN_COLA',
      emitidoEn: instante,
    };
  }

  /**
   * Primera mitad de una nota de crédito (historia 006, 6b, criterios 143 a 148): bloquea el original (`FOR UPDATE`),
   * valida que se pueda acreditar (404 / 403 / 409 `COMPROBANTE_NO_ACEPTADO` / `COMPROBANTE_ANULADO` / 422
   * `NOTA_CREDITO_INVALIDA`), lee las notas que cuentan, calcula con `calcularNotaCredito` y compara el total (409
   * `NOTA_CREDITO_CAMBIO`). Fase A: lanza `Error('No implementado')` hasta T40.
   */
  prepararNotaCredito(entrada: NotaCreditoEntradaValidada): Promise<NotaCreditoPreparada> {
    void entrada;
    return Promise.reject(noImplementado());
  }

  /**
   * Segunda mitad: toma el emisor `FOR SHARE`, numera con la serie de nota de la caja de la operación (y, en un cambio,
   * después la serie `FACTURA`), inserta la nota (y la factura) con sus líneas, sus envíos, la cuota y los tickets
   * (criterios 149 a 151, 155 y 157). Fase A: lanza `Error('No implementado')` hasta T40.
   */
  numerarNotaCredito(
    preparada: NotaCreditoPreparada,
    datos: DatosParaNumerarNota,
  ): Promise<NotaCreditoEmitida> {
    void preparada;
    void datos;
    return Promise.reject(noImplementado());
  }

  /**
   * "Emitir otro" de un comprobante `RECHAZADO` (criterio 134): copia sus líneas y totales con otro número y registra su
   * envío. 409 `COMPROBANTE_NO_RECHAZADO` / `YA_REEMPLAZADO` / `SIN_SERIE`. Fase A: lanza `Error('No implementado')` hasta
   * T32.
   */
  reemitir(comprobanteId: string, datos: DatosDeReemision): Promise<ComprobanteEmitido> {
    void comprobanteId;
    void datos;
    return Promise.reject(noImplementado());
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
  ): Promise<string | null> {
    const impresora = datos.impresora;
    if (impresora === null) return null;
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
