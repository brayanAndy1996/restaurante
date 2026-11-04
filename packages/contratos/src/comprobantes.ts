import {
  ESTADOS_COMPROBANTE,
  FORMATOS_COMPROBANTE,
  MONEDA_COMPROBANTE,
  TIPOS_COMPROBANTE,
  TIPOS_DOCUMENTO_CLIENTE,
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

export const tipoComprobanteSchema = z.enum(TIPOS_COMPROBANTE);
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

export const comprobanteRespuestaSchema = z.object({
  id: uuidSchema,
  tipo: tipoComprobanteSchema,
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
  turnoId: uuidSchema,
  cobroId: uuidSchema,
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
});

export const comprobanteResumenSchema = z.object({
  id: uuidSchema,
  tipo: tipoComprobanteSchema,
  numero: z.string(),
  estado: estadoComprobanteSchema,
  total: z.string(),
  emitidoEn: instanteSchema,
  cliente: z.string().nullable(),
  cajaId: uuidSchema,
  turnoId: uuidSchema,
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
export type ComprobanteResumen = z.infer<typeof comprobanteResumenSchema>;
export type ComprobantesConsulta = z.input<typeof comprobantesConsultaSchema>;
export type ImpresionDeCajaRespuesta = z.infer<typeof impresionDeCajaRespuestaSchema>;
