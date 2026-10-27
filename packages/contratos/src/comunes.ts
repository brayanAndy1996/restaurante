import { REGIMENES_TRIBUTARIOS, validarHorario, validarRuc } from '@restaurante/dominio';
import { z } from 'zod';

/**
 * Identificador UUID. Se usa `guid` (cualquier 8-4-4-4-12 hexadecimal, lo que acepta PostgreSQL)
 * y no `uuid`, que además exige versión y variante RFC 9562.
 */
export const uuidSchema = z.guid();

/** Hora `HH:MM`, de `00:00` a `23:59`. */
export const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Debe tener formato HH:MM');

/** Día de la semana: 1 = lunes … 7 = domingo (ISO). */
export const tramoHorarioSchema = z.object({
  dia: z.number().int().min(1).max(7),
  desde: horaSchema,
  hasta: horaSchema,
});

/** Lista de tramos validada con `validarHorario`; puede estar vacía. */
export const horarioSchema = z.array(tramoHorarioSchema).superRefine((tramos, ctx) => {
  const resultado = validarHorario(tramos);
  if (resultado.valido) return;
  for (const error of resultado.errores) {
    ctx.addIssue({
      code: 'custom',
      message: error.mensaje,
      path: error.indice === undefined ? [] : [error.indice],
    });
  }
});

/** Celular peruano en formato E.164: `+519XXXXXXXX`. */
export const whatsappSchema = z
  .string()
  .regex(/^\+519\d{8}$/, 'Debe ser un celular peruano en formato +519XXXXXXXX');

export const rucSchema = z
  .string()
  .refine(validarRuc, 'RUC inválido (11 dígitos, prefijo 10/15/16/17/20 y dígito verificador)');

export const codigoEstablecimientoSchema = z
  .string()
  .regex(/^\d{4}$/, 'El código de establecimiento debe tener 4 dígitos');

export const regimenTributarioSchema = z.enum(REGIMENES_TRIBUTARIOS);

export const HORA_CORTE_POR_DEFECTO = '05:00';

export type TramoHorario = z.infer<typeof tramoHorarioSchema>;
