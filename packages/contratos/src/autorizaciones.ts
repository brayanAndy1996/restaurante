import { z } from 'zod';
import { CANTIDAD_MAXIMA_LINEA, TIPOS_DESCUENTO, TIPOS_NOTA_CREDITO } from '@restaurante/dominio';
import {
  accionSchema,
  montoNoNegativoSchema,
  montoSchema,
  motivoSchema,
  pinAutorizacionSchema,
  uuidSchema,
} from './comunes';

/**
 * Lo que autoriza una clave de supervisor (historia 006, criterio 40, pregunta 9): la acción y su objetivo exacto.
 * `DESCUENTO`: la orden, el ítem (`null` = la cuenta) y el descuento (tipo y valor); `CORTESIA`: la orden, el ítem y
 * la cantidad; `NOTA_CREDITO` (6b): el comprobante, el tipo de nota, el total y lo devuelto. La clave solo sirve para eso. El servidor normaliza el objetivo (ids en minúsculas y `valor` con 2
 * decimales) al guardarlo y lo compara con el cuerpo de la acción.
 */
export const objetivoAutorizacionSchema = z.discriminatedUnion('tipo', [
  z.strictObject({
    tipo: z.literal('DESCUENTO'),
    ordenId: uuidSchema,
    itemId: uuidSchema.nullable(),
    descuento: z.strictObject({ tipo: z.enum(TIPOS_DESCUENTO), valor: montoSchema }),
  }),
  z.strictObject({
    tipo: z.literal('CORTESIA'),
    ordenId: uuidSchema,
    itemId: uuidSchema,
    cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
  }),
  // 6b (criterio 145): una nota de crédito. `total` es el de la nota y `devuelto` la suma de lo devuelto por medio.
  z.strictObject({
    tipo: z.literal('NOTA_CREDITO'),
    comprobanteId: uuidSchema,
    tipoNota: z.enum(TIPOS_NOTA_CREDITO),
    total: montoNoNegativoSchema,
    devuelto: montoNoNegativoSchema,
  }),
]);

/**
 * `POST /autorizaciones` (criterio 44). Las validaciones previas (acción desconocida, PIN que no
 * tiene exactamente 6 dígitos, motivo vacío o inválido) responden 400 sin contar fallo (criterio 46).
 */
export const autorizacionEntradaSchema = z.strictObject({
  accion: accionSchema,
  motivo: motivoSchema,
  pin: pinAutorizacionSchema,
  /** Opcional: lo que se autoriza (descuentos y cortesías de la historia 006). Sin él, la clave vale para la acción. */
  objetivo: objetivoAutorizacionSchema.optional(),
});

export const autorizacionRespuestaSchema = z.object({
  autorizacionId: uuidSchema,
  accion: accionSchema,
  autorizadoPor: z.object({ id: uuidSchema, nombre: z.string() }),
  expiraEn: z.iso.datetime(),
  /** El objetivo que se pidió al crearla, si lo hubo (historia 006). */
  objetivo: objetivoAutorizacionSchema.nullable().optional(),
});

export type AutorizacionEntrada = z.input<typeof autorizacionEntradaSchema>;
export type ObjetivoAutorizacion = z.infer<typeof objetivoAutorizacionSchema>;
export type AutorizacionRespuesta = z.infer<typeof autorizacionRespuestaSchema>;
