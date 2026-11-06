import type { ModoPse } from '@restaurante/dominio';

/**
 * El conector del PSE (historia 006, entrega 6b, criterio 120): la única vía hacia un proveedor de servicios
 * electrónicos. No conoce a ningún proveedor; cada adaptador (T34) y el `SimuladorPse` lo implementan. Un adaptador
 * nunca lanza por un resultado esperado: toda excepción se trata como `ERROR_TRANSPORTE`.
 */

/** Token de Nest del conector que `crearAplicacion({ pse })` reemplaza (para todos los modos de los emisores). */
export const CONECTOR_PSE = Symbol('CONECTOR_PSE');

/** Tipo de documento electrónico ante SUNAT: `01` factura, `03` boleta, `07` nota de crédito. */
export type TipoSunat = '01' | '03' | '07';

/**
 * El identificador de un documento ante el PSE (criterio 128): el mismo en todos los intentos de un comprobante.
 * `numero` es el correlativo (1 a 99999999).
 */
export interface IdDocumentoPse {
  rucEmisor: string;
  tipoSunat: TipoSunat;
  serie: string;
  numero: number;
}

/** La credencial del PSE ya descifrada: de 1 a 5 pares `nombre: valor`. Solo existe en memoria durante una llamada. */
export type CredencialPse = Readonly<Record<string, string>>;

export interface LineaDocumentoPse {
  posicion: number;
  /** `NIU` o `ZZ`. */
  unidad: string;
  cantidad: number;
  descripcion: string;
  /** Con IGV. */
  precioUnitario: string;
  /** Sin IGV, con 10 decimales. */
  valorUnitario: string;
  bruto: string;
  descuento: string;
  neto: string;
  base: string;
  igv: string;
  /** Código de afectación del IGV de SUNAT (`10`, `20`, `30` y, en las gratuitas, `15`, `21`, `31`). */
  afectacionSunat: string;
  bolsas: number;
  icbper: string;
  gratuita: boolean;
  valorReferencial: string | null;
  /** En una nota de crédito, la posición de la línea del original que acredita. */
  posicionOrigen: number | null;
}

/**
 * Lo que se manda al PSE. Lo arma `armarDocumentoPse` solo con lo guardado en el comprobante (criterio 69), así todos
 * los intentos mandan exactamente el mismo documento. Nada de él se guarda aparte ni va a los registros.
 */
export interface DocumentoPse {
  id: IdDocumentoPse;
  /** `AAAA-MM-DD`. */
  fechaEmision: string;
  moneda: 'PEN';
  emisor: { ruc: string; razonSocial: string; codigoEstablecimiento: string; direccion: string };
  /** `tipoDocumentoSunat`: `1` DNI, `4` CE, `6` RUC, `7` pasaporte, `0` sin documento. */
  cliente: {
    tipoDocumentoSunat: '0' | '1' | '4' | '6' | '7';
    numero: string;
    nombre: string;
    direccion: string | null;
  } | null;
  /** `null` con un emisor Nuevo RUS. */
  tasaIgv: string | null;
  lineas: LineaDocumentoPse[];
  totales: {
    subtotal: string;
    descuentos: string;
    gravadas: string | null;
    exoneradas: string | null;
    inafectas: string | null;
    gratuitas: string | null;
    igv: string;
    icbper: string;
    total: string;
  };
  montoEnLetras: string;
  /** Solo en una nota de crédito: el tipo de nota (`01` anulación, `07` devolución), el motivo y el documento que modifica. */
  nota: { tipoNotaSunat: '01' | '07'; motivo: string; documentoReferencia: IdDocumentoPse } | null;
}

export interface ObservacionSunat {
  codigo: string;
  mensaje: string;
}

/** Lo que responde un intento (criterio 120): una unión cerrada. */
export type ResultadoPse =
  | {
      tipo: 'ACEPTADO';
      codigoSunat: string;
      mensaje: string;
      observaciones: ObservacionSunat[];
      hash: string | null;
      xml: Buffer | null;
      cdr: Buffer | null;
      referenciaPse: string | null;
    }
  | { tipo: 'RECHAZADO'; origen: 'SUNAT' | 'PSE'; codigo: string; mensaje: string }
  /** El PSE lo recibió y la respuesta final llega después. */
  | { tipo: 'PENDIENTE'; referenciaPse: string | null }
  /** No se sabe si el PSE lo recibió: tiempo agotado, conexión cortada, 5xx. */
  | { tipo: 'ERROR_TRANSPORTE'; detalle: string }
  /** Credenciales ausentes o inválidas, RUC no dado de alta en el PSE. */
  | { tipo: 'ERROR_CONFIGURACION'; detalle: string };

export type ResultadoConsultaPse = ResultadoPse | { tipo: 'NO_EXISTE' };

export interface ConectorPse {
  /** Envía una boleta, una factura o una nota de crédito. Si el PSE ya lo tiene, consulta y devuelve ese resultado. */
  emitir(documento: DocumentoPse, credencial: CredencialPse | null): Promise<ResultadoPse>;
  /** Pregunta por un documento ya enviado (criterio 128). */
  consultar(id: IdDocumentoPse, credencial: CredencialPse | null): Promise<ResultadoConsultaPse>;
  /** La dirección donde el cliente consulta el comprobante (leyenda del ticket y del PDF, criterio 162). */
  urlConsulta(): string | null;
}

/**
 * El conector de un emisor según su modo (`RegistroDeConectores.para`, criterio 122). Con `conector` `null` el envío no
 * llama a nadie y el intento termina en `ERROR_CONFIGURACION` con `detalle` (sin credenciales ni datos de clientes).
 */
export interface ConectorDeEmisor {
  /** `null` si el emisor no tiene configuración: sus envíos terminan en `ERROR_CONFIGURACION`. */
  modo: ModoPse | null;
  /** `null` si no se puede llamar a nadie: sin configuración o con una credencial que no se pudo abrir. */
  conector: ConectorPse | null;
  credencial: CredencialPse | null;
  /** Por qué no hay conector (para `intento_pse.mensaje` y `envio_pse.ultimo_error`); `null` si lo hay. */
  detalle: string | null;
}

/** La clave de un documento para guardarlo y compararlo: `RUC-tipo-serie-número`. */
export function claveDeDocumentoPse(id: IdDocumentoPse): string {
  return `${id.rucEmisor}-${id.tipoSunat}-${id.serie}-${id.numero}`;
}
