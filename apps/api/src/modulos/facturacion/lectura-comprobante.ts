import type { ComprobanteRespuesta } from '@restaurante/contratos';
import type {
  RegimenTributario,
  TipoComprobante,
  TipoDocumentoCliente,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';

/**
 * Lee un comprobante de la tabla y lo arma con la forma de `comprobanteRespuesta` (historia 006, criterios 69 y 77).
 * Corre en la transacción de la empresa del contexto: la RLS hace que uno de otra empresa sea indistinguible de uno
 * inexistente (devuelve `null`). Dos consultas fijas, sin importar cuántas líneas tenga.
 */

interface FilaComprobante {
  id: string;
  tipo: TipoComprobante;
  serie: string;
  numero: number;
  formato: 'DETALLADO' | 'CONSUMO';
  estado: ComprobanteRespuesta['estado'];
  fecha_emision: string;
  emitido_en: Date;
  dia_operativo: string;
  emisor: { ruc: string; razonSocial: string; regimen: RegimenTributario };
  sucursal: { nombre: string; direccion: string; codigoEstablecimiento: string };
  caja_id: string;
  turno_id: string;
  turno_responsable_id: string;
  cobro_id: string;
  numero_parte: number | null;
  cliente_tipo_documento: TipoDocumentoCliente | null;
  cliente_numero: string | null;
  cliente_nombre: string | null;
  cliente_direccion: string | null;
  tasa_igv: string | null;
  subtotal: string;
  descuentos: string;
  op_gravadas: string | null;
  op_exoneradas: string | null;
  op_inafectas: string | null;
  op_gratuitas: string | null;
  igv: string;
  igv_gratuitas: string;
  icbper: string;
  total: string;
  monto_en_letras: string;
  orden_id: string | null;
  mesas: string[] | null;
  mozo_nombre: string | null;
  numero_llamado: number | null;
}

interface FilaLinea {
  posicion: number;
  item_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad: 'NIU' | 'ZZ';
  precio_unitario: string;
  valor_unitario: string;
  bruto: string;
  descuento: string;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
  afectacion: 'GRAVADO' | 'EXONERADO' | 'INAFECTO';
  gratuita: boolean;
  valor_referencial: string | null;
}

const COLUMNAS = `c.id, c.tipo, c.serie, c.numero, c.formato, c.estado,
       to_char(c.fecha_emision, 'YYYY-MM-DD') AS fecha_emision, c.emitido_en,
       to_char(c.dia_operativo, 'YYYY-MM-DD') AS dia_operativo, c.emisor, c.sucursal,
       c.caja_id, c.turno_id, c.turno_responsable_id, c.cobro_id, c.numero_parte,
       c.cliente_tipo_documento, c.cliente_numero, c.cliente_nombre, c.cliente_direccion,
       c.tasa_igv::text AS tasa_igv, c.subtotal::text AS subtotal, c.descuentos::text AS descuentos,
       c.op_gravadas::text AS op_gravadas, c.op_exoneradas::text AS op_exoneradas,
       c.op_inafectas::text AS op_inafectas, c.op_gratuitas::text AS op_gratuitas,
       c.igv::text AS igv, c.igv_gratuitas::text AS igv_gratuitas, c.icbper::text AS icbper,
       c.total::text AS total, c.monto_en_letras, c.orden_id, c.mesas, c.mozo_nombre, c.numero_llamado`;

export async function leerComprobante(
  conexion: Sequelize,
  id: string,
): Promise<ComprobanteRespuesta | null> {
  const filas = await conexion.query<FilaComprobante>(
    `SELECT ${COLUMNAS} FROM comprobante c WHERE c.id = $1`,
    { bind: [id], type: QueryTypes.SELECT },
  );
  const c = filas[0];
  if (c === undefined) return null;
  const lineas = await conexion.query<FilaLinea>(
    `SELECT posicion, item_id, descripcion, cantidad, unidad, precio_unitario::text AS precio_unitario,
            valor_unitario::text AS valor_unitario, bruto::text AS bruto, descuento::text AS descuento,
            neto::text AS neto, base::text AS base, igv::text AS igv, bolsas, icbper::text AS icbper,
            afectacion, gratuita, valor_referencial::text AS valor_referencial
       FROM comprobante_linea WHERE comprobante_id = $1 ORDER BY posicion`,
    { bind: [id], type: QueryTypes.SELECT },
  );
  const tieneOperaciones = c.op_gravadas !== null;
  return {
    id: c.id,
    tipo: c.tipo,
    serie: c.serie,
    correlativo: c.numero,
    numero: textoDelNumero(c.serie, c.numero),
    formato: c.formato,
    estado: c.estado,
    fechaEmision: c.fecha_emision,
    emitidoEn: c.emitido_en.toISOString(),
    diaOperativo: c.dia_operativo,
    emisor: c.emisor,
    sucursal: c.sucursal,
    cajaId: c.caja_id,
    turnoId: c.turno_id,
    turnoResponsableId: c.turno_responsable_id,
    cobroId: c.cobro_id,
    numeroParte: c.numero_parte,
    cliente:
      c.cliente_tipo_documento === null
        ? null
        : {
            tipoDocumento: c.cliente_tipo_documento,
            numero: c.cliente_numero!,
            nombre: c.cliente_nombre!,
            direccion: c.cliente_direccion,
          },
    moneda: 'PEN',
    tasaIgv: c.tasa_igv,
    lineas: lineas.map((l) => ({
      posicion: l.posicion,
      itemId: l.item_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      unidad: l.unidad,
      precioUnitario: l.precio_unitario,
      valorUnitario: l.valor_unitario,
      bruto: l.bruto,
      descuento: l.descuento,
      neto: l.neto,
      base: l.base,
      igv: l.igv,
      bolsas: l.bolsas,
      icbper: l.icbper,
      afectacion: l.afectacion,
      gratuita: l.gratuita,
      valorReferencial: l.valor_referencial,
    })),
    totales: {
      subtotal: c.subtotal,
      descuentos: c.descuentos,
      operaciones: tieneOperaciones
        ? {
            gravadas: c.op_gravadas!,
            exoneradas: c.op_exoneradas!,
            inafectas: c.op_inafectas!,
            gratuitas: c.op_gratuitas!,
          }
        : null,
      igv: c.igv,
      igvGratuitas: c.igv_gratuitas,
      icbper: c.icbper,
      total: c.total,
    },
    montoEnLetras: c.monto_en_letras,
    orden:
      c.orden_id === null
        ? null
        : {
            id: c.orden_id,
            mesas: c.mesas ?? [],
            mozo: c.mozo_nombre,
            numeroLlamado: c.numero_llamado,
          },
  };
}

/** El texto de la serie y el número de 8 cifras: `B001-00000124` (criterio 70). */
export function textoDelNumero(serie: string, numero: number): string {
  return `${serie}-${String(numero).padStart(8, '0')}`;
}
