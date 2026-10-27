import { z } from 'zod';
import {
  fechaSchema,
  moduloSchema,
  montoSchema,
  motivoSchema,
  textoSchema,
  uuidSchema,
} from './comunes';

/** Medios de pago de una suscripción (criterio 73). */
export const MEDIOS_DE_PAGO = [
  'EFECTIVO',
  'TRANSFERENCIA',
  'YAPE',
  'PLIN',
  'TARJETA',
  'OTRO',
] as const;
export const medioDePagoSchema = z.enum(MEDIOS_DE_PAGO);

/** Estado calculado de la suscripción de una sucursal (nunca se guarda). */
export const estadoSuscripcionSchema = z.enum(['ACTIVA', 'EN_GRACIA', 'SUSPENDIDA']);

/**
 * `suscripcion` opcional de cada sucursal en las altas por la vía de plataforma (criterio 69): sin
 * plan se usa el plan por defecto; sin vencimiento, `sumarMeses(hoy, 1)`.
 */
export const suscripcionAltaEntradaSchema = z.strictObject({
  planId: uuidSchema.optional(),
  vencimiento: fechaSchema.optional(),
});

/** Precio mensual: soles con hasta 2 decimales (se guarda en `NUMERIC(10,2)`). */
const precioMensualSchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Debe ser un monto con hasta 2 decimales');

/** Precio por comprobante excedente: soles con hasta 4 decimales (`NUMERIC(10,4)`). */
const precioExcedenteSchema = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,4})?$/, 'Debe ser un monto con hasta 4 decimales');

/** Plan (criterio 75): precios y cuota pueden quedar sin definir (`null`). */
export const planEntradaSchema = z.strictObject({
  codigo: textoSchema(30),
  nombre: textoSchema(100),
  precioMensual: precioMensualSchema.nullable().optional(),
  cuotaComprobantesMes: z.number().int().nonnegative().nullable().optional(),
  precioExcedente: precioExcedenteSchema.nullable().optional(),
  diasGracia: z.number().int().min(0).max(60),
  modulos: z.array(moduloSchema),
  porDefecto: z.boolean(),
  activo: z.boolean(),
});

/** `POST /plataforma/planes`: el plan y el motivo de la auditoría. */
export const planCrearEntradaSchema = planEntradaSchema.extend({ motivo: motivoSchema });

/** `PATCH /plataforma/planes/:id`: cualquier subconjunto del plan, con motivo obligatorio. */
export const planModificarEntradaSchema = planEntradaSchema
  .partial()
  .extend({ motivo: motivoSchema });

export const planRespuestaSchema = z.object({
  id: uuidSchema,
  codigo: z.string(),
  nombre: z.string(),
  precioMensual: z.string().nullable(),
  cuotaComprobantesMes: z.number().int().nullable(),
  precioExcedente: z.string().nullable(),
  diasGracia: z.number().int(),
  modulos: z.array(moduloSchema),
  porDefecto: z.boolean(),
  activo: z.boolean(),
  creadoEn: z.iso.datetime(),
  actualizadoEn: z.iso.datetime(),
});

const planResumenSchema = z.object({ id: uuidSchema, codigo: z.string(), nombre: z.string() });

/** Suscripción de una sucursal con su estado calculado con el reloj de la API. */
export const suscripcionRespuestaSchema = z.object({
  id: uuidSchema,
  empresaId: uuidSchema,
  sucursalId: uuidSchema,
  plan: planResumenSchema,
  vencimiento: fechaSchema,
  estado: estadoSuscripcionSchema,
  suspensionDesde: fechaSchema,
  diasRestantesGracia: z.number().int().nonnegative().nullable(),
});

/** Consumo de comprobantes de un periodo `AAAA-MM`; `cuota` es `null` si el plan no la define. */
export const consumoPeriodoSchema = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  emitidos: z.number().int().nonnegative(),
  cuota: z.number().int().nonnegative().nullable(),
  excedente: z.number().int().nonnegative(),
});

/** Fila de `GET /plataforma/suscripciones` (criterio 76). */
export const suscripcionResumenSchema = suscripcionRespuestaSchema.extend({
  empresaNombre: z.string(),
  sucursalNombre: z.string(),
  consumoMesActual: consumoPeriodoSchema,
  consumoMesAnterior: consumoPeriodoSchema,
});

/** `GET /plataforma/suscripciones?estado=`. */
export const suscripcionesConsultaSchema = z.strictObject({
  estado: estadoSuscripcionSchema.optional(),
});

/** `PATCH /plataforma/suscripciones/:id` (criterio 74): cambia el plan o fija el vencimiento. */
export const suscripcionModificarEntradaSchema = z
  .strictObject({
    planId: uuidSchema.optional(),
    vencimiento: fechaSchema.optional(),
    motivo: motivoSchema,
  })
  .refine((datos) => datos.planId !== undefined || datos.vencimiento !== undefined, {
    message: 'Debe enviar planId o vencimiento',
  });

/**
 * `POST /plataforma/suscripciones/:id/pagos` (criterio 73). Que `fechaPago` no sea posterior a hoy y
 * que `vencimientoNuevo` sea posterior al vencimiento actual lo comprueba la API (necesita el reloj
 * y la suscripción).
 */
export const pagoEntradaSchema = z.strictObject({
  monto: montoSchema,
  fechaPago: fechaSchema,
  medio: medioDePagoSchema,
  referencia: textoSchema(100).optional(),
  vencimientoNuevo: fechaSchema,
  motivo: motivoSchema,
});

export const pagoRespuestaSchema = z.object({
  id: uuidSchema,
  suscripcionId: uuidSchema,
  monto: z.string(),
  fechaPago: fechaSchema,
  medio: medioDePagoSchema,
  referencia: z.string().nullable(),
  vencimientoAnterior: fechaSchema,
  vencimientoNuevo: fechaSchema,
  creadoEn: z.iso.datetime(),
});

export const pagoRegistradoRespuestaSchema = z.object({
  pago: pagoRespuestaSchema,
  suscripcion: suscripcionRespuestaSchema,
});

export type MedioDePago = z.infer<typeof medioDePagoSchema>;
export type EstadoSuscripcionRespuesta = z.infer<typeof estadoSuscripcionSchema>;
export type SuscripcionAltaEntrada = z.input<typeof suscripcionAltaEntradaSchema>;
export type PlanEntrada = z.input<typeof planEntradaSchema>;
export type PlanCrearEntrada = z.input<typeof planCrearEntradaSchema>;
export type PlanModificarEntrada = z.input<typeof planModificarEntradaSchema>;
export type PlanRespuesta = z.infer<typeof planRespuestaSchema>;
export type SuscripcionRespuesta = z.infer<typeof suscripcionRespuestaSchema>;
export type ConsumoPeriodo = z.infer<typeof consumoPeriodoSchema>;
export type SuscripcionResumen = z.infer<typeof suscripcionResumenSchema>;
export type SuscripcionModificarEntrada = z.input<typeof suscripcionModificarEntradaSchema>;
export type PagoEntrada = z.input<typeof pagoEntradaSchema>;
export type PagoRespuesta = z.infer<typeof pagoRespuestaSchema>;
export type PagoRegistradoRespuesta = z.infer<typeof pagoRegistradoRespuestaSchema>;
