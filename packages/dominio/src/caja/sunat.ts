/**
 * Códigos de SUNAT que usa el documento que se manda al PSE (historia 006, criterio 120). Son datos puros, sin
 * lógica: el catálogo de tipos de comprobante (01), de documento de identidad (06), de afectación del IGV (07),
 * de unidad de medida, de tributos (05) y de tipos de nota de crédito (09).
 */
import type { AfectacionIgv } from '../carta/catalogos';
import type { TipoDocumentoCliente, TipoDocumentoElectronico, TipoNotaCredito } from './catalogos';

/** Tipo de documento electrónico: `01` factura, `03` boleta, `07` nota de crédito. */
export const TIPO_SUNAT_DE_DOCUMENTO: Readonly<
  Record<TipoDocumentoElectronico, '01' | '03' | '07'>
> = {
  BOLETA: '03',
  FACTURA: '01',
  NOTA_CREDITO_BOLETA: '07',
  NOTA_CREDITO_FACTURA: '07',
};

/** Documento del cliente: `1` DNI, `4` carnet de extranjería, `6` RUC, `7` pasaporte. */
export const DOCUMENTO_SUNAT_DE_CLIENTE: Readonly<
  Record<TipoDocumentoCliente, '1' | '4' | '6' | '7'>
> = {
  DNI: '1',
  CE: '4',
  RUC: '6',
  PASAPORTE: '7',
};

/** Código del documento de un cliente sin documento (boletas de hasta S/ 700). */
export const DOCUMENTO_SUNAT_SIN_DOCUMENTO = '0';

/** Afectación del IGV de una línea cobrada: `10` gravado, `20` exonerado, `30` inafecto. */
export const AFECTACION_SUNAT: Readonly<Record<AfectacionIgv, '10' | '20' | '30'>> = {
  GRAVADO: '10',
  EXONERADO: '20',
  INAFECTO: '30',
};

/**
 * Afectación de una línea gratuita (cortesía; pregunta 38, provisional hasta que el contador la confirme): `15`
 * gravado (bonificaciones), `21` exonerado (transferencia gratuita) y `31` inafecto (retiro por bonificación).
 */
export const AFECTACION_SUNAT_GRATUITA: Readonly<Record<AfectacionIgv, '15' | '21' | '31'>> = {
  GRAVADO: '15',
  EXONERADO: '21',
  INAFECTO: '31',
};

/** Unidad de medida: `NIU` para un producto, `ZZ` para un servicio. */
export const UNIDAD_SUNAT = ['NIU', 'ZZ'] as const;
export type UnidadSunat = (typeof UNIDAD_SUNAT)[number];

/** Tributo del impuesto a las bolsas plásticas (catálogo 05). */
export const TRIBUTO_SUNAT_ICBPER = { codigo: '7152', nombre: 'ICBPER', tipo: 'OTH' } as const;
/** Tributo del IGV (catálogo 05). */
export const TRIBUTO_SUNAT_IGV = { codigo: '1000', nombre: 'IGV', tipo: 'VAT' } as const;

/** Tipo de nota de crédito: `01` anulación de la operación, `07` devolución por ítem. */
export const TIPO_NOTA_SUNAT: Readonly<
  Record<Exclude<TipoNotaCredito, 'CAMBIO_A_FACTURA'>, '01' | '07'>
> = {
  ANULACION: '01',
  DEVOLUCION: '07',
};

/** Moneda de todo documento. */
export const MONEDA_SUNAT = 'PEN';
