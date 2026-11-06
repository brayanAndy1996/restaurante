import {
  ESTADOS_COMPROBANTE,
  FORMATOS_COMPROBANTE,
  MONEDA_COMPROBANTE,
  TIPOS_COMPROBANTE,
  TIPOS_DOCUMENTO_CLIENTE,
  TIPOS_DOCUMENTO_ELECTRONICO,
  validarRuc,
} from '@restaurante/dominio';
import { z } from 'zod';
import { afectacionIgvSchema } from './carta';
import { regimenTributarioSchema, textoSchema, uuidSchema } from './comunes';

/**
 * Contratos de los comprobantes (historia 006, entrega 6a): lo que guarda cada boleta o factura al emitirse
 * (criterio 69), su consulta (criterio 77), el cliente que se escribe al cobrar (criterio 51) y la impresión del
 * ticket (criterio 90). Las entradas son estrictas (un campo desconocido es 400) y ninguna acepta `empresaId`,
 * `creadoPor*` ni `actualizadoPor*`. Los montos viajan como texto decimal con 2 decimales; `numero` es el texto
 * "serie-correlativo de 8 cifras" (`B001-00000124`).
 */

const instanteSchema = z.iso.datetime();

/** Lo que se elige al cobrar: solo boleta o factura (las notas de crédito no se cobran, 6b criterio 143). */
export const tipoComprobanteSchema = z.enum(TIPOS_COMPROBANTE);
/** Todo documento electrónico que numera el sistema: boleta, factura y las dos notas de crédito (6b). */
export const tipoDocumentoElectronicoSchema = z.enum(TIPOS_DOCUMENTO_ELECTRONICO);
export const formatoComprobanteSchema = z.enum(FORMATOS_COMPROBANTE);
export const estadoComprobanteSchema = z.enum(ESTADOS_COMPROBANTE);
export const tipoDocumentoClienteSchema = z.enum(TIPOS_DOCUMENTO_CLIENTE);

// ---------------------------------------------------------------------------------------------------
// Cliente (criterio 51, pregunta 15)
// ---------------------------------------------------------------------------------------------------

/**
 * El cliente de un comprobante: DNI de 8 dígitos, CE y pasaporte de 6 a 12 caracteres alfanuméricos, RUC válido
 * (`validarRuc`); `nombre` de 1 a 200 y `direccion` de 1 a 300. Si la factura exige RUC y dirección o la boleta de
 * más de S/ 700 exige documento y nombre, lo decide el cobro (422 `CLIENTE_REQUERIDO`), no este esquema.
 */
export const clienteComprobanteEntradaSchema = z
  .strictObject({
    tipoDocumento: tipoDocumentoClienteSchema,
    numero: z.string(),
    nombre: textoSchema(200),
    direccion: textoSchema(300).optional(),
  })
  .superRefine((cliente, ctx) => {
    const ok =
      cliente.tipoDocumento === 'DNI'
        ? /^\d{8}$/.test(cliente.numero)
        : cliente.tipoDocumento === 'RUC'
          ? validarRuc(cliente.numero)
          : /^[A-Za-z0-9]{6,12}$/.test(cliente.numero);
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['numero'],
        message:
          cliente.tipoDocumento === 'DNI'
            ? 'El DNI debe tener 8 dígitos'
            : cliente.tipoDocumento === 'RUC'
              ? 'RUC inválido (11 dígitos, prefijo 10/15/16/17/20 y dígito verificador)'
              : 'Debe tener de 6 a 12 caracteres alfanuméricos',
      });
    }
  });

export const clienteComprobanteRespuestaSchema = z.object({
  tipoDocumento: tipoDocumentoClienteSchema,
  numero: z.string(),
  nombre: z.string(),
  direccion: z.string().nullable(),
});

/** El comprobante que se pide al cobrar (criterio 51): tipo y formato; el cliente es opcional. */
export const comprobanteEntradaSchema = z.strictObject({
  tipo: tipoComprobanteSchema,
  formato: formatoComprobanteSchema,
  cliente: clienteComprobanteEntradaSchema.optional(),
});

// ---------------------------------------------------------------------------------------------------
// Lo que guarda (criterio 69) y su consulta (criterio 77)
// ---------------------------------------------------------------------------------------------------

export const comprobanteLineaRespuestaSchema = z.object({
  posicion: z.number().int().min(1),
  itemId: uuidSchema.nullable(),
  descripcion: z.string(),
  cantidad: z.number().int(),
  /** `NIU` para un producto, `ZZ` para un servicio o la línea "Por consumo". */
  unidad: z.enum(['NIU', 'ZZ']),
  /** Precio unitario con IGV. */
  precioUnitario: z.string(),
  /** Valor unitario sin IGV, con 10 decimales. */
  valorUnitario: z.string(),
  bruto: z.string(),
  descuento: z.string(),
  neto: z.string(),
  base: z.string(),
  igv: z.string(),
  bolsas: z.number().int(),
  icbper: z.string(),
  afectacion: afectacionIgvSchema,
  gratuita: z.boolean(),
  valorReferencial: z.string().nullable(),
  /**
   * 6b: en una línea de nota de crédito, la `posicion` de la línea del original que acredita; `null` en las demás.
   * Opcional hasta que la API de 6b la emita (T30).
   */
  posicionOrigen: z.number().int().min(1).nullable().optional(),
});

export const operacionesComprobanteSchema = z.object({
  gravadas: z.string(),
  exoneradas: z.string(),
  inafectas: z.string(),
  gratuitas: z.string(),
});

/** Los totales con la forma de `calcularCuenta` de `packages/dominio` (criterio 11). */
export const totalesCuentaSchema = z.object({
  subtotal: z.string(),
  descuentos: z.string(),
  /** `null` con un emisor Nuevo RUS. */
  operaciones: operacionesComprobanteSchema.nullable(),
  igv: z.string(),
  igvGratuitas: z.string(),
  icbper: z.string(),
  total: z.string(),
});

/** De dónde nace un comprobante (6b, criterio 134 y 143): un cobro, una nota, una reemisión o la factura de un cambio. */
export const origenComprobanteSchema = z.enum([
  'COBRO',
  'NOTA_CREDITO',
  'REEMISION',
  'CAMBIO_A_FACTURA',
]);

/** Una referencia corta a otro comprobante (6b): `afectaA`, `reemplazaA` y `reemplazadoPor`. */
export const referenciaComprobanteSchema = z.object({ id: uuidSchema, numero: z.string() });

/**
 * Lo ya acreditado de un comprobante por sus notas de crédito (6b, criterio 148): por posición de la línea cobrada, las
 * unidades, el neto, la base, el IGV, las bolsas y el ICBPER que ya cubren las notas que cuentan (`base` e `igv` hacen
 * falta para cerrar exactamente la última devolución, criterio 147).
 */
export const acreditadoLineaSchema = z.object({
  posicion: z.number().int().min(1),
  cantidad: z.number().int().min(0),
  neto: z.string(),
  base: z.string(),
  igv: z.string(),
  bolsas: z.number().int().min(0),
  icbper: z.string(),
});

/** Las notas de crédito de un comprobante (6b, criterio 148). */
export const notaDeComprobanteSchema = z.object({
  id: uuidSchema,
  tipo: z.enum(['ANULACION', 'DEVOLUCION']),
  numero: z.string(),
  estado: estadoComprobanteSchema,
  total: z.string(),
});

/** La respuesta del PSE guardada en el comprobante (6b, criterios 127 y 131). */
export const sunatComprobanteSchema = z.object({
  codigo: z.string().nullable(),
  mensaje: z.string().nullable(),
  observaciones: z.array(z.object({ codigo: z.string(), mensaje: z.string() })),
  hash: z.string().nullable(),
});

/** Las marcas de tiempo del comprobante ante SUNAT; cada una se fija una sola vez (6b, criterio 127). */
export const marcasComprobanteSchema = z.object({
  enviadoEn: instanteSchema.nullable(),
  aceptadoEn: instanteSchema.nullable(),
  rechazadoEn: instanteSchema.nullable(),
  anuladoEn: instanteSchema.nullable(),
});

export const comprobanteRespuestaSchema = z.object({
  id: uuidSchema,
  /** Boleta, factura o nota de crédito (6b ensancha `tipoComprobanteSchema`). */
  tipo: tipoDocumentoElectronicoSchema,
  serie: z.string(),
  correlativo: z.number().int().min(1),
  /** La serie y el número de 8 cifras: `B001-00000124`. */
  numero: z.string(),
  formato: formatoComprobanteSchema,
  estado: estadoComprobanteSchema,
  /** Fecha de Lima del instante del cobro (SUNAT). */
  fechaEmision: z.string(),
  emitidoEn: instanteSchema,
  diaOperativo: z.string(),
  emisor: z.object({ ruc: z.string(), razonSocial: z.string(), regimen: regimenTributarioSchema }),
  sucursal: z.object({
    nombre: z.string(),
    direccion: z.string(),
    codigoEstablecimiento: z.string(),
  }),
  cajaId: uuidSchema,
  /** `null` en una nota de crédito sin devolución (6b, criterio 149). */
  turnoId: uuidSchema.nullable(),
  /** El responsable del turno al emitir (se copia al comprobante, criterios 69 y 100). */
  turnoResponsableId: uuidSchema,
  /** `null` en las notas de crédito, las reemisiones y las facturas de cambio (6b: no nacen de un cobro). */
  cobroId: uuidSchema.nullable(),
  /** Su lugar entre las partes de la orden (1, 2, 3…); `null` si no viene de una orden. */
  numeroParte: z.number().int().min(1).nullable(),
  cliente: clienteComprobanteRespuestaSchema.nullable(),
  moneda: z.literal(MONEDA_COMPROBANTE),
  /** La tasa de IGV con la que se emitió; `null` con un emisor Nuevo RUS. */
  tasaIgv: z.string().nullable(),
  lineas: z.array(comprobanteLineaRespuestaSchema),
  totales: totalesCuentaSchema,
  montoEnLetras: z.string(),
  orden: z
    .object({
      id: uuidSchema,
      mesas: z.array(z.string()),
      mozo: z.string().nullable(),
      numeroLlamado: z.number().int().nullable(),
    })
    .nullable(),
  // Campos de 6b (criterios 127, 134, 143 a 148, 159). Opcionales mientras la API de 6a no los emita (T30).
  origen: origenComprobanteSchema.optional(),
  /** Copiado del modo del emisor al emitir: un comprobante simulado no tiene valor tributario (criterio 122). */
  simulado: z.boolean().optional(),
  /** El documento que modifica esta nota de crédito. */
  afectaA: z
    .object({ id: uuidSchema, tipo: tipoDocumentoElectronicoSchema, numero: z.string() })
    .nullable()
    .optional(),
  nota: z
    .object({
      tipo: z.enum(['ANULACION', 'DEVOLUCION']),
      motivo: z.string(),
      cambioAFactura: z.boolean(),
    })
    .nullable()
    .optional(),
  reemplazaA: referenciaComprobanteSchema.nullable().optional(),
  reemplazadoPor: referenciaComprobanteSchema.nullable().optional(),
  notasCredito: z.array(notaDeComprobanteSchema).optional(),
  acreditado: z.array(acreditadoLineaSchema).optional(),
  sunat: sunatComprobanteSchema.nullable().optional(),
  marcas: marcasComprobanteSchema.optional(),
  pdfDisponible: z.boolean().optional(),
});

export const comprobanteResumenSchema = z.object({
  id: uuidSchema,
  tipo: tipoDocumentoElectronicoSchema,
  numero: z.string(),
  estado: estadoComprobanteSchema,
  total: z.string(),
  emitidoEn: instanteSchema,
  cliente: z.string().nullable(),
  cajaId: uuidSchema,
  turnoId: uuidSchema.nullable(),
  ordenId: uuidSchema.nullable(),
});

/** `GET /comprobantes?turnoId=&ordenId=` (criterio 77): hasta 200, del más nuevo al más antiguo. */
export const comprobantesConsultaSchema = z.strictObject({
  turnoId: uuidSchema.optional(),
  ordenId: uuidSchema.optional(),
});

/** `POST /comprobantes/:id/impresiones` y `POST /turnos/:id/reporte-x/impresiones` (criterios 30 y 90). */
export const impresionDeCajaRespuestaSchema = z.object({
  trabajoId: uuidSchema.nullable(),
  impresion: z.enum(['EN_COLA', 'SIN_IMPRESORA']),
});

export type ClienteComprobanteEntrada = z.input<typeof clienteComprobanteEntradaSchema>;
export type ClienteComprobanteRespuesta = z.infer<typeof clienteComprobanteRespuestaSchema>;
export type ComprobanteEntrada = z.input<typeof comprobanteEntradaSchema>;
export type ComprobanteEntradaValidada = z.output<typeof comprobanteEntradaSchema>;
export type ComprobanteLineaRespuesta = z.infer<typeof comprobanteLineaRespuestaSchema>;
export type TotalesCuentaRespuesta = z.infer<typeof totalesCuentaSchema>;
export type ComprobanteRespuesta = z.infer<typeof comprobanteRespuestaSchema>;
export type OrigenComprobante = z.infer<typeof origenComprobanteSchema>;
export type AcreditadoLinea = z.infer<typeof acreditadoLineaSchema>;
export type ComprobanteResumen = z.infer<typeof comprobanteResumenSchema>;
export type ComprobantesConsulta = z.input<typeof comprobantesConsultaSchema>;
export type ImpresionDeCajaRespuesta = z.infer<typeof impresionDeCajaRespuestaSchema>;
