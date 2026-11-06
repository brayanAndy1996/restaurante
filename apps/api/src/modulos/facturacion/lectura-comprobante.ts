import type { ComprobanteRespuesta } from '@restaurante/contratos';
import type {
  RegimenTributario,
  TipoDocumentoCliente,
  TipoDocumentoElectronico,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';

/**
 * Lee un comprobante de la tabla y lo arma con la forma de `comprobanteRespuesta` (historia 006, criterios 69 y 77, y
 * los campos de 6b de los criterios 122, 127, 134, 143 y 159). Corre en la transacción de la empresa del contexto: la
 * RLS hace que uno de otra empresa sea indistinguible de uno inexistente (devuelve `null`). Dos consultas fijas, sin
 * importar cuántas líneas tenga. `notasCredito` y `acreditado` (criterio 148) los agrega quien emite notas de crédito
 * (T39/T40); aquí quedan sin definir.
 */

interface FilaComprobante {
  id: string;
  tipo: TipoDocumentoElectronico;
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
  turno_id: string | null;
  turno_responsable_id: string;
  cobro_id: string | null;
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
  // 6b
  simulado: boolean;
  tipo_nota: 'ANULACION' | 'DEVOLUCION' | null;
  motivo_nota: string | null;
  motivo_reemplazo: 'REEMISION' | 'CAMBIO_A_FACTURA' | null;
  cambio_a_factura: boolean;
  afecta_a_id: string | null;
  afecta_a_tipo: TipoDocumentoElectronico | null;
  afecta_a_serie: string | null;
  afecta_a_numero: number | null;
  reemplaza_a_id: string | null;
  reemplaza_a_serie: string | null;
  reemplaza_a_numero: number | null;
  reemplazado_por_id: string | null;
  reemplazado_por_serie: string | null;
  reemplazado_por_numero: number | null;
  enviado_en: Date | null;
  aceptado_en: Date | null;
  rechazado_en: Date | null;
  anulado_en: Date | null;
  sunat_codigo: string | null;
  sunat_mensaje: string | null;
  sunat_observaciones: Array<{ codigo: string; mensaje: string }> | null;
  hash: string | null;
  tiene_pdf: boolean;
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
  posicion_origen: number | null;
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
       c.total::text AS total, c.monto_en_letras, c.orden_id, c.mesas, c.mozo_nombre, c.numero_llamado,
       c.simulado, c.tipo_nota, c.motivo_nota, c.motivo_reemplazo,
       (c.afecta_a_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM comprobante f
           WHERE f.reemplaza_a_id = c.afecta_a_id AND f.motivo_reemplazo = 'CAMBIO_A_FACTURA')) AS cambio_a_factura,
       a.id AS afecta_a_id, a.tipo AS afecta_a_tipo, a.serie AS afecta_a_serie, a.numero AS afecta_a_numero,
       r.id AS reemplaza_a_id, r.serie AS reemplaza_a_serie, r.numero AS reemplaza_a_numero,
       p.id AS reemplazado_por_id, p.serie AS reemplazado_por_serie, p.numero AS reemplazado_por_numero,
       c.enviado_en, c.aceptado_en, c.rechazado_en, c.anulado_en, c.sunat_codigo, c.sunat_mensaje,
       c.sunat_observaciones, c.hash, (c.pdf_clave IS NOT NULL) AS tiene_pdf`;

const UNIONES = `FROM comprobante c
       LEFT JOIN comprobante a ON a.id = c.afecta_a_id
       LEFT JOIN comprobante r ON r.id = c.reemplaza_a_id
       LEFT JOIN comprobante p ON p.reemplaza_a_id = c.id`;

export async function leerComprobante(
  conexion: Sequelize,
  id: string,
): Promise<ComprobanteRespuesta | null> {
  const filas = await conexion.query<FilaComprobante>(
    `SELECT ${COLUMNAS} ${UNIONES} WHERE c.id = $1`,
    { bind: [id], type: QueryTypes.SELECT },
  );
  const c = filas[0];
  if (c === undefined) return null;
  const lineas = await conexion.query<FilaLinea>(
    `SELECT posicion, item_id, descripcion, cantidad, unidad, precio_unitario::text AS precio_unitario,
            valor_unitario::text AS valor_unitario, bruto::text AS bruto, descuento::text AS descuento,
            neto::text AS neto, base::text AS base, igv::text AS igv, bolsas, icbper::text AS icbper,
            afectacion, gratuita, valor_referencial::text AS valor_referencial, posicion_origen
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
      posicionOrigen: l.posicion_origen,
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
    origen:
      c.cobro_id !== null
        ? 'COBRO'
        : c.afecta_a_id !== null
          ? 'NOTA_CREDITO'
          : c.motivo_reemplazo === 'CAMBIO_A_FACTURA'
            ? 'CAMBIO_A_FACTURA'
            : 'REEMISION',
    simulado: c.simulado,
    afectaA:
      c.afecta_a_id === null
        ? null
        : {
            id: c.afecta_a_id,
            tipo: c.afecta_a_tipo!,
            numero: textoDelNumero(c.afecta_a_serie!, c.afecta_a_numero!),
          },
    nota:
      c.tipo_nota === null
        ? null
        : { tipo: c.tipo_nota, motivo: c.motivo_nota!, cambioAFactura: c.cambio_a_factura },
    reemplazaA:
      c.reemplaza_a_id === null
        ? null
        : {
            id: c.reemplaza_a_id,
            numero: textoDelNumero(c.reemplaza_a_serie!, c.reemplaza_a_numero!),
          },
    reemplazadoPor:
      c.reemplazado_por_id === null
        ? null
        : {
            id: c.reemplazado_por_id,
            numero: textoDelNumero(c.reemplazado_por_serie!, c.reemplazado_por_numero!),
          },
    sunat:
      c.sunat_codigo === null && c.sunat_mensaje === null
        ? null
        : {
            codigo: c.sunat_codigo,
            mensaje: c.sunat_mensaje,
            observaciones: c.sunat_observaciones ?? [],
            hash: c.hash,
          },
    marcas: {
      enviadoEn: c.enviado_en?.toISOString() ?? null,
      aceptadoEn: c.aceptado_en?.toISOString() ?? null,
      rechazadoEn: c.rechazado_en?.toISOString() ?? null,
      anuladoEn: c.anulado_en?.toISOString() ?? null,
    },
    pdfDisponible: c.tiene_pdf,
  };
}

/** El texto de la serie y el número de 8 cifras: `B001-00000124` (criterio 70). */
export function textoDelNumero(serie: string, numero: number): string {
  return `${serie}-${String(numero).padStart(8, '0')}`;
}
