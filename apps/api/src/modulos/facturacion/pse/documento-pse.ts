import type { ComprobanteRespuesta } from '@restaurante/contratos';
import {
  AFECTACION_SUNAT,
  AFECTACION_SUNAT_GRATUITA,
  DOCUMENTO_SUNAT_DE_CLIENTE,
  TIPO_NOTA_SUNAT,
  TIPO_SUNAT_DE_DOCUMENTO,
} from '@restaurante/dominio';
import type { DocumentoPse, IdDocumentoPse, LineaDocumentoPse } from './conector-pse';

/**
 * Arma el documento que se manda al PSE solo con lo guardado en el comprobante (historia 006, criterio 120): mismo
 * comprobante, mismo documento, byte a byte. Pura: no lee el reloj ni la base, y no tiene ningún dato fuera de
 * `comprobante` y sus líneas (criterio 69). Los códigos son los de SUNAT de `packages/dominio/src/caja/sunat.ts`.
 *
 * El identificador ante el PSE (`id`) es el mismo en todos los intentos de un comprobante (criterio 128). En una nota de
 * crédito, `nota.documentoReferencia` es el identificador del documento que modifica (mismo RUC del emisor).
 */
export function armarDocumentoPse(comprobante: ComprobanteRespuesta): DocumentoPse {
  const id: IdDocumentoPse = {
    rucEmisor: comprobante.emisor.ruc,
    tipoSunat: TIPO_SUNAT_DE_DOCUMENTO[comprobante.tipo],
    serie: comprobante.serie,
    numero: comprobante.correlativo,
  };
  const operaciones = comprobante.totales.operaciones;
  return {
    id,
    fechaEmision: comprobante.fechaEmision,
    moneda: 'PEN',
    emisor: {
      ruc: comprobante.emisor.ruc,
      razonSocial: comprobante.emisor.razonSocial,
      codigoEstablecimiento: comprobante.sucursal.codigoEstablecimiento,
      direccion: comprobante.sucursal.direccion,
    },
    cliente:
      comprobante.cliente === null
        ? null
        : {
            tipoDocumentoSunat: DOCUMENTO_SUNAT_DE_CLIENTE[comprobante.cliente.tipoDocumento],
            numero: comprobante.cliente.numero,
            nombre: comprobante.cliente.nombre,
            direccion: comprobante.cliente.direccion,
          },
    tasaIgv: comprobante.tasaIgv,
    lineas: comprobante.lineas.map((linea): LineaDocumentoPse => ({
      posicion: linea.posicion,
      unidad: linea.unidad,
      cantidad: linea.cantidad,
      descripcion: linea.descripcion,
      precioUnitario: linea.precioUnitario,
      valorUnitario: linea.valorUnitario,
      bruto: linea.bruto,
      descuento: linea.descuento,
      neto: linea.neto,
      base: linea.base,
      igv: linea.igv,
      afectacionSunat: linea.gratuita
        ? AFECTACION_SUNAT_GRATUITA[linea.afectacion]
        : AFECTACION_SUNAT[linea.afectacion],
      bolsas: linea.bolsas,
      icbper: linea.icbper,
      gratuita: linea.gratuita,
      valorReferencial: linea.valorReferencial,
      posicionOrigen: linea.posicionOrigen ?? null,
    })),
    totales: {
      subtotal: comprobante.totales.subtotal,
      descuentos: comprobante.totales.descuentos,
      gravadas: operaciones?.gravadas ?? null,
      exoneradas: operaciones?.exoneradas ?? null,
      inafectas: operaciones?.inafectas ?? null,
      gratuitas: operaciones?.gratuitas ?? null,
      igv: comprobante.totales.igv,
      icbper: comprobante.totales.icbper,
      total: comprobante.totales.total,
    },
    montoEnLetras: comprobante.montoEnLetras,
    nota: notaDe(comprobante, id),
  };
}

/** El documento que modifica una nota de crédito, con su tipo de nota y motivo; `null` si no es una nota. */
function notaDe(comprobante: ComprobanteRespuesta, id: IdDocumentoPse): DocumentoPse['nota'] {
  const nota = comprobante.nota;
  const afectado = comprobante.afectaA;
  if (nota === null || nota === undefined || afectado === null || afectado === undefined) {
    return null;
  }
  const { serie, numero } = separarNumero(afectado.numero);
  return {
    tipoNotaSunat: TIPO_NOTA_SUNAT[nota.tipo],
    motivo: nota.motivo,
    documentoReferencia: {
      rucEmisor: id.rucEmisor,
      tipoSunat: TIPO_SUNAT_DE_DOCUMENTO[afectado.tipo],
      serie,
      numero,
    },
  };
}

/** `B001-00000124` → `{ serie: 'B001', numero: 124 }`. */
function separarNumero(texto: string): { serie: string; numero: number } {
  const corte = texto.lastIndexOf('-');
  return { serie: texto.slice(0, corte), numero: Number(texto.slice(corte + 1)) };
}
