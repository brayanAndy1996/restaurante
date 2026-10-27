import { REGIMENES_TRIBUTARIOS, validarHorario, validarRuc } from '@restaurante/dominio';
import { z } from 'zod';

/**
 * Identificador UUID. Se usa `guid` (cualquier 8-4-4-4-12 hexadecimal, lo que acepta PostgreSQL)
 * y no `uuid`, que además exige versión y variante RFC 9562.
 */
export const uuidSchema = z.guid();

/** Carácter NUL (U+0000): PostgreSQL no lo admite en `text` y nunca es parte de un texto legítimo. */
const NUL = '\u0000';

/** Refinamiento común de los textos: sin el carácter NUL. Pensado para `.refine(sinNul, mensaje)`. */
export const MENSAJE_NUL = 'No puede contener el carácter NUL (U+0000)';
export const sinNul = (texto: string): boolean => !texto.includes(NUL);

/**
 * Sustituto UTF-16 alto sin un bajo detrás, o bajo sin un alto delante. Un par válido (por ejemplo un
 * emoji) no coincide. Se usa una expresión regular y no `String.prototype.isWellFormed` para que el
 * mismo código valga en navegadores antiguos (la PWA usa este paquete); tampoco usa lookbehind, que
 * Safari no admite antes de la 16.4.
 */
const SUSTITUTO_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Refinamiento común de los textos: sin sustitutos UTF-16 sueltos (criterio 40c). Un sustituto suelto
 * no se puede codificar en UTF-8: PostgreSQL lo rechazaría o el servidor lo guardaría alterado
 * (U+FFFD). Pensado para `.refine(sinSustitutosSueltos, mensaje)`.
 */
export const MENSAJE_SUSTITUTO_SUELTO = 'No puede contener sustitutos UTF-16 sin pareja';
export const sinSustitutosSueltos = (texto: string): boolean => !SUSTITUTO_SUELTO.test(texto);

/**
 * Texto libre de entrada: sin espacios en los extremos, de 1 a `max` caracteres, sin NUL y sin
 * sustitutos UTF-16 sueltos. Es la base de todos los textos que escribe una persona; úsalo en vez de
 * `z.string()` suelto para que estos rechazos valgan igual en la API y en la PWA.
 */
export function textoSchema(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(sinNul, MENSAJE_NUL)
    .refine(sinSustitutosSueltos, MENSAJE_SUSTITUTO_SUELTO);
}

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
