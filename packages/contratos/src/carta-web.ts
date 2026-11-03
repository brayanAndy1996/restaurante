import {
  LARGO_MAXIMO_SLUG,
  LARGO_MINIMO_SLUG,
  SLUGS_RESERVADOS,
  esSlugValido,
} from '@restaurante/dominio';
import { z } from 'zod';
import { seleccionSchema, tipoProductoSchema } from './carta';
import { textoSchema, tramoHorarioSchema, uuidSchema } from './comunes';

/**
 * Contratos de la carta web (historia 005): la configuración que hace el Administrador (criterios 1 a 9) y las
 * respuestas públicas de la carta (criterios 18 a 24), que salen por la API sin sesión. Las entradas son
 * estrictas (un campo desconocido es 400). Las respuestas **públicas** (`empresaPublica`, `cartaPublica`,
 * `disponibilidadPublica`) usan objetos estrictos: una clave de más no pasa la validación, así que un dato que no
 * debía salir (criterio 21) es un error del servidor y nunca una fuga. Los montos viajan como texto decimal con 2
 * decimales; los ids, como UUID en minúsculas.
 */

const instanteSchema = z.iso.datetime();

/** Color de la marca cuando la empresa no eligió ninguno (criterio 1). */
export const COLOR_PRINCIPAL_POR_DEFECTO = '#1D4A9E';

// ---------------------------------------------------------------------------------------------------
// Direcciones y color (criterio 2)
// ---------------------------------------------------------------------------------------------------

/**
 * Dirección (slug) de una empresa o de una sucursal al configurarla: de 3 a 40 caracteres
 * `^[a-z0-9]+(-[a-z0-9]+)*$` y fuera de `SLUGS_RESERVADOS`. No se pasa a minúsculas: una mayúscula es un error.
 */
export const slugSchema = z.string().superRefine((slug, ctx) => {
  if (esSlugValido(slug)) return;
  const reservada = (SLUGS_RESERVADOS as readonly string[]).includes(slug);
  ctx.addIssue({
    code: 'custom',
    message: reservada
      ? 'Esa dirección está reservada. Elige otra'
      : `Debe tener de ${LARGO_MINIMO_SLUG} a ${LARGO_MAXIMO_SLUG} caracteres: letras minúsculas, números y guiones entre palabras`,
  });
});

/**
 * Dirección tal como llega en la URL pública (`:empresaSlug`, `:sucursalSlug`): la misma forma, aceptando
 * mayúsculas (la API la pasa a minúsculas antes de buscar). Una dirección fuera de forma responde 404 sin
 * consultar la base (criterio 14).
 */
export const SLUG_DE_RUTA_REGEX = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;
export const slugDeRutaSchema = z
  .string()
  .min(LARGO_MINIMO_SLUG)
  .max(LARGO_MAXIMO_SLUG)
  .regex(SLUG_DE_RUTA_REGEX);

/** Color principal: `#RRGGBB`; se guarda en mayúsculas. */
export const colorPrincipalSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Debe tener el formato #RRGGBB')
  .transform((color) => color.toUpperCase());

// ---------------------------------------------------------------------------------------------------
// Configuración (criterios 1 a 5)
// ---------------------------------------------------------------------------------------------------

/** `PUT /carta-web`: crea o reemplaza la configuración de la empresa (criterio 2). */
export const cartaWebEntradaSchema = z.strictObject({
  nombre: textoSchema(80),
  slug: slugSchema,
  colorPrincipal: colorPrincipalSchema,
});

/** `PUT /carta-web/sucursales/:sucursalId` (criterio 4). */
export const cartaWebSucursalEntradaSchema = z.strictObject({
  slug: slugSchema,
  publicada: z.boolean(),
});

/** Una sucursal en la configuración de la carta web (criterios 1 y 4). */
export const cartaWebSucursalRespuestaSchema = z.object({
  sucursalId: uuidSchema,
  nombre: z.string(),
  slug: z.string().nullable(),
  publicada: z.boolean(),
  /** `CARTA_WEB_URL/<empresa>/<sucursal>`, o `null` si falta una dirección o `CARTA_WEB_URL`. */
  url: z.string().nullable(),
});

/** `GET /carta-web` y respuesta de `PUT /carta-web` (criterios 1 y 2). */
export const cartaWebRespuestaSchema = z.object({
  configurada: z.boolean(),
  nombre: z.string().nullable(),
  slug: z.string().nullable(),
  colorPrincipal: colorPrincipalSchema,
  logoUrl: z.string().nullable(),
  /** `CARTA_WEB_URL/<empresa>`, o `null` si falta la dirección o `CARTA_WEB_URL`. */
  url: z.string().nullable(),
  sucursales: z.array(cartaWebSucursalRespuestaSchema),
});

/** `PUT /carta-web/logo` (criterio 3). */
export const logoCartaWebRespuestaSchema = z.object({ logoUrl: z.string() });

// ---------------------------------------------------------------------------------------------------
// Hoja de QR (criterios 7 a 9)
// ---------------------------------------------------------------------------------------------------

export const qrMesaDeListaSchema = z.object({
  mesaId: uuidSchema,
  zona: z.object({ id: uuidSchema, nombre: z.string() }),
  nombre: z.string(),
  /** `null` en una mesa que aún no tiene código (criterio 8). */
  codigo: z.string().nullable(),
  url: z.string().nullable(),
  generadoEn: instanteSchema.nullable(),
});

/** `GET` y `POST /sucursales/:sucursalId/qr-mesas` (criterios 7 y 8). */
export const qrMesasRespuestaSchema = z.object({
  sucursal: z.object({ id: uuidSchema, nombre: z.string() }),
  cartaPublicada: z.boolean(),
  mesas: z.array(qrMesaDeListaSchema),
});

/** `POST /sucursales/:sucursalId/mesas/:mesaId/qr` (criterio 9). */
export const qrMesaRespuestaSchema = z.object({
  mesaId: uuidSchema,
  codigo: z.string(),
  url: z.string(),
  generadoEn: instanteSchema,
});

// ---------------------------------------------------------------------------------------------------
// Carta pública (criterios 18 a 23). Todo estricto: nada de más sale (criterio 21).
// ---------------------------------------------------------------------------------------------------

/** La marca de la empresa tal como la ve el cliente. */
export const datosEmpresaPublicaSchema = z.strictObject({
  nombre: z.string(),
  logoUrl: z.string().nullable(),
  colorPrincipal: colorPrincipalSchema,
});

/** `GET /publico/cartas/:empresaSlug` (criterio 18). */
export const empresaPublicaSchema = z.strictObject({
  empresa: datosEmpresaPublicaSchema,
  sucursales: z.array(
    z.strictObject({ nombre: z.string(), slug: z.string(), direccion: z.string() }),
  ),
});

/** Una opción de un grupo de modificadores, sin el producto ligado ni la disponibilidad (criterio 19). */
export const modificadorPublicoSchema = z.strictObject({
  id: uuidSchema,
  nombre: z.string(),
  precioExtra: z.string(),
});

export const grupoPublicoSchema = z.strictObject({
  id: uuidSchema,
  nombre: z.string(),
  seleccion: seleccionSchema,
  minimo: z.number().int(),
  maximo: z.number().int(),
  obligatorio: z.boolean(),
  modificadores: z.array(modificadorPublicoSchema),
});

/** Un producto que se puede pedir ahora (criterios 19 y 20). */
export const productoPublicoSchema = z.strictObject({
  id: uuidSchema,
  tipo: tipoProductoSchema,
  nombre: z.string(),
  descripcion: z.string().nullable(),
  fotoUrl: z.string().nullable(),
  precio: z.string(),
  grupos: z.array(grupoPublicoSchema),
  componentes: z.array(z.strictObject({ nombre: z.string(), cantidad: z.number().int() })),
});

/** `GET /publico/cartas/:empresaSlug/:sucursalSlug` (criterio 19). */
export const cartaPublicaSchema = z.strictObject({
  empresa: datosEmpresaPublicaSchema,
  sucursal: z.strictObject({
    nombre: z.string(),
    slug: z.string(),
    direccion: z.string(),
    horario: z.array(tramoHorarioSchema),
    /** `null` si la sucursal no tiene horario cargado. */
    abiertaAhora: z.boolean().nullable(),
  }),
  familias: z.array(
    z.strictObject({
      id: uuidSchema,
      nombre: z.string(),
      productos: z.array(productoPublicoSchema),
    }),
  ),
});

/** `GET /publico/cartas/:empresaSlug/:sucursalSlug/disponibilidad` (criterio 23). */
export const disponibilidadPublicaSchema = z.strictObject({
  vendibles: z.array(
    z.strictObject({
      id: uuidSchema,
      /** Los modificadores de sus grupos que no están disponibles ahora. */
      modificadoresNoDisponibles: z.array(uuidSchema),
    }),
  ),
});

export type CartaWebEntrada = z.input<typeof cartaWebEntradaSchema>;
export type CartaWebSucursalEntrada = z.input<typeof cartaWebSucursalEntradaSchema>;
export type CartaWebSucursalRespuesta = z.infer<typeof cartaWebSucursalRespuestaSchema>;
export type CartaWebRespuesta = z.infer<typeof cartaWebRespuestaSchema>;
export type LogoCartaWebRespuesta = z.infer<typeof logoCartaWebRespuestaSchema>;
export type QrMesaDeLista = z.infer<typeof qrMesaDeListaSchema>;
export type QrMesasRespuesta = z.infer<typeof qrMesasRespuestaSchema>;
export type QrMesaRespuesta = z.infer<typeof qrMesaRespuestaSchema>;
export type DatosEmpresaPublica = z.infer<typeof datosEmpresaPublicaSchema>;
export type EmpresaPublica = z.infer<typeof empresaPublicaSchema>;
export type ProductoPublico = z.infer<typeof productoPublicoSchema>;
export type CartaPublica = z.infer<typeof cartaPublicaSchema>;
export type DisponibilidadPublica = z.infer<typeof disponibilidadPublicaSchema>;
