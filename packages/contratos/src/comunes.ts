import {
  ACCIONES,
  MODULOS,
  REGIMENES_TRIBUTARIOS,
  ROLES,
  ROLES_DE_ACCESO,
  validarHorario,
  validarRuc,
} from '@restaurante/dominio';
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
export const tramoHorarioSchema = z.strictObject({
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

/** Rol de una persona en una sucursal; `ADMINISTRADOR` es de toda la empresa. */
export const rolSchema = z.enum(ROLES);

/** Rol que se puede asignar en el acceso a una sucursal (no incluye `ADMINISTRADOR`). */
export const rolAccesoSchema = z.enum(ROLES_DE_ACCESO);

/** Código de una acción de la matriz de permisos. */
export const accionSchema = z.enum(ACCIONES);

/** Requisito de una acción para un rol. */
export const requisitoPermisoSchema = z.enum(['permitido', 'clave', 'prohibido']);

/** Módulo del catálogo que activa un plan. */
export const moduloSchema = z.enum(MODULOS);

/** Clave de idempotencia (cabecera `Idempotency-Key`). */
export const claveIdempotenciaSchema = uuidSchema;

/** Pasa a minúsculas solo `A-Z` (sin plegado Unicode: la `K` del Kelvin no se convierte en `k`). */
export function minusculasAscii(texto: string): string {
  return texto.replace(/[A-Z]/g, (letra) => letra.toLowerCase());
}

/**
 * Nombre de usuario (criterio 19): de 3 a 50 caracteres `a-z`, `0-9`, `.`, `_` o `-`. Se acepta con
 * mayúsculas ASCII y se guarda en minúsculas; cualquier otro carácter (incluidos espacios) es inválido.
 */
export const nombreUsuarioSchema = z
  .string()
  .transform(minusculasAscii)
  .pipe(
    z
      .string()
      .regex(
        /^[a-z0-9._-]{3,50}$/,
        'Debe tener de 3 a 50 caracteres: letras minúsculas, números, punto, guion bajo o guion',
      ),
  );

/**
 * Nombre de usuario escrito al ingresar: sin el formato estricto del alta (un nombre con formato
 * inválido es solo un usuario inexistente: 401 `CREDENCIALES_INVALIDAS`, no 400, criterio 11), pero
 * con máximo, sin NUL y sin sustitutos sueltos. Se compara en minúsculas ASCII.
 */
export const nombreUsuarioIngresoSchema = z
  .string()
  .min(1)
  .max(50)
  .refine(sinNul, MENSAJE_NUL)
  .refine(sinSustitutosSueltos, MENSAJE_SUSTITUTO_SUELTO)
  .transform(minusculasAscii);

/** Cantidad de caracteres (puntos de código, no unidades UTF-16). */
function largoEnCaracteres(texto: string): number {
  return Array.from(texto).length;
}

/**
 * Contraseña nueva (criterio 13): de 8 a 128 caracteres, sin NUL ni sustitutos UTF-16 sueltos. No se
 * recorta: los espacios cuentan.
 */
export const contrasenaSchema = z
  .string()
  .refine((t) => largoEnCaracteres(t) >= 8, 'Debe tener al menos 8 caracteres')
  .refine((t) => largoEnCaracteres(t) <= 128, 'Debe tener como máximo 128 caracteres')
  .refine(sinNul, MENSAJE_NUL)
  .refine(sinSustitutosSueltos, MENSAJE_SUSTITUTO_SUELTO);

/**
 * Contraseña que se escribe para ingresar o como la `actual` al cambiarla: no exige el mínimo de 8,
 * porque un PIN u otro texto corto usado como contraseña es solo una contraseña incorrecta (401), no un
 * error de datos (criterio 34). Mantiene el máximo, NUL y los sustitutos sueltos.
 */
export const contrasenaIngresoSchema = z
  .string()
  .refine((t) => largoEnCaracteres(t) >= 1, 'No puede estar vacía')
  .refine((t) => largoEnCaracteres(t) <= 128, 'Debe tener como máximo 128 caracteres')
  .refine(sinNul, MENSAJE_NUL)
  .refine(sinSustitutosSueltos, MENSAJE_SUSTITUTO_SUELTO);

/** PIN de una persona: 4 dígitos (Mozo, Cocina/Barra) o 6 (Cajero, Supervisor, Administrador). */
export const pinSchema = z.string().regex(/^(\d{4}|\d{6})$/, 'El PIN debe tener 4 o 6 dígitos');

/** PIN de supervisor en la ventana de clave (criterio 46): exactamente 6 dígitos. */
export const pinAutorizacionSchema = z
  .string()
  .regex(/^\d{6}$/, 'El PIN de supervisor debe tener 6 dígitos');

/** Fecha `AAAA-MM-DD` que existe en el calendario. */
export const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe tener formato AAAA-MM-DD')
  .refine((texto) => {
    const [anio, mes, dia] = texto.split('-').map(Number) as [number, number, number];
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    return (
      fecha.getUTCFullYear() === anio &&
      fecha.getUTCMonth() === mes - 1 &&
      fecha.getUTCDate() === dia
    );
  }, 'La fecha no existe');

/** Monto en soles como texto decimal (criterio 73): hasta 8 enteros y 2 decimales, mayor que 0. */
export const montoSchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Debe ser un monto con hasta 2 decimales')
  .refine((texto) => /[1-9]/.test(texto), 'Debe ser mayor que 0');

/** Motivo de una acción sensible: de 1 a 300 caracteres, sin NUL ni sustitutos sueltos. */
export const motivoSchema = textoSchema(300);

export type TramoHorario = z.infer<typeof tramoHorarioSchema>;
