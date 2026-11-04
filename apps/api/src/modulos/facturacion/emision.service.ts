import { Inject, Injectable } from '@nestjs/common';
import type { ClienteComprobanteEntrada, ComprobanteRespuesta } from '@restaurante/contratos';
import {
  diaOperativo,
  fechaLima,
  montoEnLetras,
  type FormatoComprobante,
  type LineaDeParte,
  type MedioPago,
  type ParteCalculada,
  type TipoComprobante,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { EmisoresService, SucursalesConsultaService, SuscripcionService } from '../plataforma';
import { leerComprobante } from './lectura-comprobante';
import { SeriesService } from './series.service';

/**
 * Emisión de un comprobante (historia 006, criterios 69 a 76 y 90; ruta crítica P4). Se llama dentro de la
 * transacción del cobro: toma el número de la serie de la caja con `UPDATE serie SET ultimo_numero = ultimo_numero + 1
 * … RETURNING` (sin saltos: una reversión deshace el incremento), guarda el comprobante y sus líneas, llama a
 * `SuscripcionService.registrarComprobanteEmitido` una vez y encola el ticket (el ticket llega con la tarea T21:
 * hasta entonces `trabajoId` es `null`).
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
  /** El instante del cobro, del reloj de la API (define la fecha de emisión de Lima y el día operativo). */
  instante: Date;
}

export interface ComprobanteEmitido {
  comprobante: ComprobanteRespuesta;
  /** El trabajo `COMPROBANTE` encolado, o `null` sin impresora. */
  trabajoId: string | null;
  impresion: 'EN_COLA' | 'SIN_IMPRESORA';
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
  ) {}

  /**
   * Numera, guarda el comprobante con sus líneas y su `ParteCalculada`, y cuenta el comprobante en el consumo del
   * mes de Lima del plan. Todo en la transacción del cobro. 409 `SIN_SERIE` (la caja no tiene serie activa del tipo
   * para el emisor de la sucursal) o `SERIE_AGOTADA`. Nace `POR_ENVIAR`.
   */
  async emitir(datos: DatosDeEmision): Promise<ComprobanteEmitido> {
    const { emisor, sucursal } = await this.emisores.datosParaComprobante(datos.sucursalId);
    const horaCorte = await this.sucursales.horaCorte(datos.sucursalId);
    const { serieId, serie, numero } = await this.series.tomarNumero(
      datos.cajaId,
      datos.tipo,
      emisor.id,
    );
    const instante = datos.instante;
    const totales = datos.parte.totales;
    const operaciones = totales.operaciones;
    const cliente = datos.cliente;
    const filas = await this.conexion.query<{ id: string }>(
      `INSERT INTO comprobante (
         empresa_id, sucursal_id, emisor_id, caja_id, turno_id, turno_responsable_id, cobro_id, serie_id, tipo, serie,
         numero, formato, fecha_emision, emitido_en, dia_operativo, emisor, sucursal, cliente_tipo_documento,
         cliente_numero, cliente_nombre, cliente_direccion, tasa_igv, subtotal, descuentos, op_gravadas,
         op_exoneradas, op_inafectas, op_gratuitas, igv, igv_gratuitas, icbper, total, monto_en_letras, orden_id,
         mesas, mozo_nombre, numero_llamado, numero_parte, detalle_parte, estado, creado_en, actualizado_en)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13::date, $14, $15::date, $16::jsonb, $17::jsonb, $18,
         $19, $20, $21, $22::numeric, $23::numeric, $24::numeric, $25::numeric,
         $26::numeric, $27::numeric, $28::numeric, $29::numeric, $30::numeric, $31::numeric, $32::numeric, $33, $34,
         $35::text[], $36, $37, $38, $39::jsonb, 'POR_ENVIAR', $14, $14)
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
          JSON.stringify(datos.parte),
        ],
        type: QueryTypes.SELECT,
      },
    );
    const comprobanteId = filas[0]!.id;
    await this.insertarLineas(comprobanteId, datos);
    await this.suscripciones.registrarComprobanteEmitido(datos.sucursalId, instante);
    const comprobante = await leerComprobante(this.conexion, comprobanteId);
    if (comprobante === null) throw new Error('El comprobante recién emitido no se puede leer');
    return { comprobante, trabajoId: null, impresion: 'SIN_IMPRESORA' };
  }

  /**
   * Las líneas del comprobante (criterio 69), de una vez. El precio unitario es el bruto entre la cantidad (exacto:
   * el bruto es precio × cantidad); en una gratuita, el valor referencial entre la cantidad. El valor unitario sin IGV
   * se calcula con `NUMERIC` en la base, con 10 decimales y redondeo de la mitad hacia arriba, a partir de ese precio.
   */
  private async insertarLineas(comprobanteId: string, datos: DatosDeEmision): Promise<void> {
    const lineas = datos.parte.lineas;
    if (lineas.length === 0) throw new Error('Un comprobante necesita al menos una línea');
    const bind: unknown[] = [
      this.contexto.empresaActual(),
      comprobanteId,
      datos.tasaIgv,
      this.reloj.ahora(),
    ];
    const filas = lineas.map((linea, indice) => {
      const desde = bind.length;
      bind.push(...valoresDeLinea(linea, indice + 1, datos));
      const p = (n: number) => `$${desde + n}`;
      const precio = `round(${p(18)}::numeric / ${p(19)}::numeric, 2)`;
      const tieneIgv = linea.afectacion === 'GRAVADO' && datos.tasaIgv !== null;
      const valorUnitario = `round(${precio} / (1 + COALESCE($3::numeric, 0) / 100 * ${tieneIgv ? 1 : 0}), 10)`;
      return `($1, $2, ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${precio}, ${valorUnitario}, ${p(6)}, ${p(7)},
               ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)}, ${p(14)}, ${p(15)}, ${p(16)}, ${p(17)},
               $4, $4)`;
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

/**
 * Los 19 valores de una línea, en el orden de sus parámetros: del 1 al 17 las columnas desde `posicion` (sin el
 * precio ni el valor unitario, que salen del 18 y el 19: lo que se divide y la cantidad). Un ítem sin descripción es
 * un error de quien arma los datos: el comprobante no se inventa un nombre.
 */
function valoresDeLinea(linea: LineaDeParte, posicion: number, datos: DatosDeEmision): unknown[] {
  const gratuita = linea.gratuita;
  const descripcion = linea.itemId === null ? 'Por consumo' : datos.descripciones.get(linea.itemId);
  if (descripcion === undefined) {
    throw new Error(`Falta la descripción del ítem ${linea.itemId} para el comprobante`);
  }
  const cantidad = gratuita?.cantidad ?? linea.cantidad;
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
    gratuita === null ? linea.bruto : gratuita.valorReferencial,
    cantidad,
  ];
}
