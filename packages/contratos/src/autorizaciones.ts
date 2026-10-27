import { z } from 'zod';
import { accionSchema, motivoSchema, pinAutorizacionSchema, uuidSchema } from './comunes';

/**
 * `POST /autorizaciones` (criterio 44). Las validaciones previas (acción desconocida, PIN que no
 * tiene exactamente 6 dígitos, motivo vacío o inválido) responden 400 sin contar fallo (criterio 46).
 */
export const autorizacionEntradaSchema = z.strictObject({
  accion: accionSchema,
  motivo: motivoSchema,
  pin: pinAutorizacionSchema,
});

export const autorizacionRespuestaSchema = z.object({
  autorizacionId: uuidSchema,
  accion: accionSchema,
  autorizadoPor: z.object({ id: uuidSchema, nombre: z.string() }),
  expiraEn: z.iso.datetime(),
});

export type AutorizacionEntrada = z.input<typeof autorizacionEntradaSchema>;
export type AutorizacionRespuesta = z.infer<typeof autorizacionRespuestaSchema>;
