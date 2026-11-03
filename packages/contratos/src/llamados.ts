import {
  CANTIDAD_MAXIMA_LINEA,
  CANTIDAD_MAXIMA_LLAMADO,
  ESTADOS_LLAMADO,
  LARGO_NOTA_LLAMADO,
  MAXIMO_COMENSALES,
  MAXIMO_LINEAS_LLAMADO,
  MAXIMO_MODIFICADORES_LINEA,
  MINIMO_COMENSALES,
  TIPOS_LLAMADO,
} from '@restaurante/dominio';
import { z } from 'zod';
import { textoSchema, uuidSchema } from './comunes';
import { eventoDeSucursal, mesaRefSchema, personaRefSchema } from './salon';

/**
 * Contratos de los llamados desde la mesa (historia 005): lo que el cliente manda y ve por la API pública
 * (criterios 25, 26 y 38) y lo que el mozo ve y hace desde la PWA (criterios 39 a 55), más los eventos en tiempo
 * real. Las entradas son estrictas (un campo desconocido es 400) y ninguna acepta `empresaId`, `sucursalId`, ids
 * de mesa ni de usuario. Las respuestas **públicas** (`llamadoPublico`, `mesaPublica`, `estadoLlamadoPublico`)
 * usan objetos estrictos: una clave de más no pasa la validación (criterio 21). Los montos viajan como texto
 * decimal con 2 decimales; el `id` de un llamado lo genera el navegador del cliente y la API lo devuelve en
 * minúsculas.
 */

const instanteSchema = z.iso.datetime();

/** Código de una mesa (criterio 6): 16 bytes al azar en base64url sin relleno, 22 caracteres. */
export const CODIGO_MESA_REGEX = /^[A-Za-z0-9_-]{22}$/;
export const codigoMesaSchema = z.string().regex(CODIGO_MESA_REGEX);

export const tipoLlamadoSchema = z.enum(TIPOS_LLAMADO);
export const estadoLlamadoSchema = z.enum(ESTADOS_LLAMADO);

function sinRepetir(ids: readonly string[], ctx: z.RefinementCtx): void {
  const vistos = new Set<string>();
  ids.forEach((id, indice) => {
    const clave = id.toLowerCase();
    if (vistos.has(clave)) {
      ctx.addIssue({ code: 'custom', message: 'Id repetido', path: ['modificadorIds', indice] });
    }
    vistos.add(clave);
  });
}

// ---------------------------------------------------------------------------------------------------
// Lo que manda el cliente (criterio 26)
// ---------------------------------------------------------------------------------------------------

/**
 * Una línea del pedido del cliente: `modificadorIds` es obligatorio (lista vacía si no hay), de hasta 30 y sin
 * repetir; `cantidad`, entero de 1 a 20; `observacion`, de 1 a 140 caracteres o ausente.
 */
export const lineaLlamadoEntradaSchema = z
  .strictObject({
    productoId: uuidSchema,
    modificadorIds: z.array(uuidSchema).max(MAXIMO_MODIFICADORES_LINEA),
    cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LLAMADO),
    observacion: textoSchema(LARGO_NOTA_LLAMADO).optional(),
  })
  .superRefine((linea, ctx) => sinRepetir(linea.modificadorIds, ctx));

/**
 * `POST /publico/mesas/:codigo/llamados`: unión por `tipo`. `id` lo genera el navegador al pulsar "Enviar" y se
 * conserva hasta una respuesta final (idempotencia por id, criterio 29). Un `PEDIDO` lleva de 1 a 30 líneas y una
 * nota; los otros dos tipos no llevan nada más.
 */
export const llamadoEntradaSchema = z.discriminatedUnion('tipo', [
  z.strictObject({
    id: uuidSchema,
    tipo: z.literal('PEDIDO'),
    lineas: z.array(lineaLlamadoEntradaSchema).min(1).max(MAXIMO_LINEAS_LLAMADO),
    nota: textoSchema(LARGO_NOTA_LLAMADO).optional(),
  }),
  z.strictObject({ id: uuidSchema, tipo: z.literal('LLAMAR_MOZO') }),
  z.strictObject({ id: uuidSchema, tipo: z.literal('PEDIR_CUENTA') }),
]);

// ---------------------------------------------------------------------------------------------------
// Lo que ve el cliente (criterios 25, 26 y 38). Todo estricto: nada de más sale (criterio 21).
// ---------------------------------------------------------------------------------------------------

/** Una línea del llamado tal como la vio el cliente (criterio 26). */
export const lineaLlamadoPublicaSchema = z.strictObject({
  nombre: z.string(),
  modificadores: z.array(z.string()),
  cantidad: z.number().int(),
  observacion: z.string().nullable(),
  precioUnitario: z.string(),
  total: z.string(),
});

/** `POST /publico/mesas/:codigo/llamados` (criterio 26): siempre `PENDIENTE`, también en una réplica. */
export const llamadoPublicoSchema = z.strictObject({
  id: uuidSchema,
  tipo: tipoLlamadoSchema,
  estado: z.literal('PENDIENTE'),
  creadoEn: instanteSchema,
  venceEn: instanteSchema,
  /** Vacía en `LLAMAR_MOZO` y `PEDIR_CUENTA`. */
  lineas: z.array(lineaLlamadoPublicaSchema),
  /** `null` en los dos tipos sin pedido. */
  total: z.string().nullable(),
});

/** `GET /publico/mesas/:codigo` (criterio 25): sin el estado de la mesa, el mozo ni lo consumido. */
export const mesaPublicaSchema = z.strictObject({
  mesa: z.strictObject({ nombre: z.string() }),
  carta: z.strictObject({ empresaSlug: z.string(), sucursalSlug: z.string() }),
  aceptaLlamados: z.boolean(),
  motivoNoAcepta: z.literal('FUERA_DE_HORARIO').nullable(),
  llamadoPendiente: z.strictObject({ tipo: tipoLlamadoSchema, venceEn: instanteSchema }).nullable(),
});

/** `GET /publico/mesas/:codigo/llamados/:id` (criterio 38): el estado vigente, sin nombres de personas. */
export const estadoLlamadoPublicoSchema = z.strictObject({
  id: uuidSchema,
  tipo: tipoLlamadoSchema,
  estado: estadoLlamadoSchema,
  venceEn: instanteSchema,
});

// ---------------------------------------------------------------------------------------------------
// Lo que ve el mozo (criterios 39 y 40)
// ---------------------------------------------------------------------------------------------------

export const llamadoResumenSchema = z.object({
  id: uuidSchema,
  tipo: tipoLlamadoSchema,
  estado: estadoLlamadoSchema,
  mesa: mesaRefSchema,
  creadoEn: instanteSchema,
  venceEn: instanteSchema,
  /** Suma de las cantidades de las líneas (0 sin pedido). */
  unidades: z.number().int(),
  total: z.string().nullable(),
  nota: z.string().nullable(),
  /** A quién se avisó: el mozo responsable de la mesa, o `null` si estaba libre (todos los que atienden). */
  destinatarios: z.array(uuidSchema).nullable(),
  atendidoPor: personaRefSchema.nullable(),
  atendidoEn: instanteSchema.nullable(),
  cerradoPor: personaRefSchema.nullable(),
  cerradoEn: instanteSchema.nullable(),
  ordenId: uuidSchema.nullable(),
});

/** `GET /llamados` (criterio 39). `ahora` es la hora de la API, para calcular "vence en" sin fiarse del equipo. */
export const llamadosRespuestaSchema = z.object({
  ahora: instanteSchema,
  llamados: z.array(llamadoResumenSchema),
});

/**
 * Cómo está hoy una línea del llamado (criterio 40): disponible, con el precio del sistema; o no disponible, con
 * el código y el motivo en palabras.
 */
export const revisionLineaSchema = z.discriminatedUnion('disponible', [
  z.object({ disponible: z.literal(true), precioUnitario: z.string(), total: z.string() }),
  z.object({ disponible: z.literal(false), codigo: z.string(), motivo: z.string() }),
]);

const modificadorDeLineaSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  precioExtra: z.string(),
});

/** Una línea del llamado en el detalle del mozo. `posicion` cuenta desde 0, en el orden en que llegó. */
export const lineaDeLlamadoSchema = z.object({
  posicion: z.number().int().min(0),
  productoId: uuidSchema,
  nombre: z.string(),
  modificadores: z.array(modificadorDeLineaSchema),
  cantidad: z.number().int(),
  observacion: z.string().nullable(),
  /** El precio unitario que vio el cliente al enviar. */
  precioCliente: z.string(),
  revision: revisionLineaSchema,
});

/** `GET /llamados/:id` (criterio 40) y la forma de `llamado` en las respuestas de atender, pasar y descartar. */
export const llamadoDetalleSchema = llamadoResumenSchema.extend({
  lineas: z.array(lineaDeLlamadoSchema),
  totalCliente: z.string().nullable(),
  /** Suma de las líneas disponibles con los precios de hoy, calculada con `totalOrden`. */
  totalActual: z.string().nullable(),
  motivoDescarte: z.string().nullable(),
  /** Posición y cantidad de lo que el mozo pasó a la cuenta; `null` mientras no se pasó. */
  lineasPasadas: z
    .array(z.object({ posicion: z.number().int().min(0), cantidad: z.number().int().min(1) }))
    .nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Atender, pasar a la cuenta y descartar (criterios 41 a 55)
// ---------------------------------------------------------------------------------------------------

/**
 * `POST /llamados/:id/atencion` (criterio 42): `ordenId` (UUID que genera la PWA) y `comensales` (1 a 99) solo se
 * usan si la mesa está libre y hay que abrirla.
 */
export const atencionEntradaSchema = z.strictObject({
  ordenId: uuidSchema.optional(),
  comensales: z.number().int().min(MINIMO_COMENSALES).max(MAXIMO_COMENSALES).optional(),
});

export const atencionRespuestaSchema = z.object({
  llamado: llamadoDetalleSchema,
  /** La orden abierta de la mesa; `null` si no hay (un `PEDIR_CUENTA` sobre una mesa libre no la abre). */
  ordenId: uuidSchema.nullable(),
  mesaAbierta: z.boolean(),
});

/**
 * Una línea que el mozo pasa a la cuenta (criterio 46): `posicion` es la de una línea del llamado y `cantidad`,
 * de 1 a 999. Que la posición exista y no se repita lo comprueba el servicio (422 `DATOS_INVALIDOS` con `campos`),
 * porque depende del llamado. El producto, los modificadores y la observación salen del llamado: no se aceptan.
 */
export const lineaPasoACuentaEntradaSchema = z.strictObject({
  posicion: z.number().int().min(0),
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
});

/** `POST /llamados/:id/paso-a-cuenta`: de 1 a 30 líneas (las que faltan son las que el mozo quitó). */
export const pasoACuentaEntradaSchema = z.strictObject({
  lineas: z.array(lineaPasoACuentaEntradaSchema).min(1).max(MAXIMO_LINEAS_LLAMADO),
});

/** Una línea con los precios del sistema, lista para el borrador de la cuenta de la PWA (criterio 46). */
export const lineaParaBorradorSchema = z.object({
  posicion: z.number().int().min(0),
  productoId: uuidSchema,
  nombre: z.string(),
  modificadores: z.array(modificadorDeLineaSchema),
  cantidad: z.number().int(),
  observacion: z.string().nullable(),
  precioUnitario: z.string(),
  total: z.string(),
});

export const pasoACuentaRespuestaSchema = z.object({
  llamado: llamadoDetalleSchema,
  ordenId: uuidSchema,
  lineas: z.array(lineaParaBorradorSchema),
});

/** `POST /llamados/:id/descarte` (criterio 53): el motivo, de 1 a 140 caracteres, es opcional. */
export const descarteEntradaSchema = z.strictObject({
  motivo: textoSchema(LARGO_NOTA_LLAMADO).optional(),
});

// ---------------------------------------------------------------------------------------------------
// Eventos en tiempo real (criterios 36, 45, 52, 53 y 57). Van a la sala de la sucursal de la mesa y llevan solo
// ids, el tipo, el estado, el nombre de la mesa y los destinatarios.
// ---------------------------------------------------------------------------------------------------

export const eventoLlamadoNuevoDatosSchema = z.object({
  llamadoId: uuidSchema,
  tipo: tipoLlamadoSchema,
  mesaId: uuidSchema,
  mesaNombre: z.string(),
  /** El mozo responsable de la orden abierta de la mesa, o `null` si está libre (todos los que atienden). */
  destinatarios: z.array(uuidSchema).nullable(),
});

export const eventoLlamadoCambioDatosSchema = z.object({
  llamadoId: uuidSchema,
  mesaId: uuidSchema,
  estado: estadoLlamadoSchema,
});

export const eventoLlamadoNuevoSchema = eventoDeSucursal(
  'llamado.nuevo',
  eventoLlamadoNuevoDatosSchema,
);
export const eventoLlamadoCambioSchema = eventoDeSucursal(
  'llamado.cambio',
  eventoLlamadoCambioDatosSchema,
);

export type LlamadoEntrada = z.input<typeof llamadoEntradaSchema>;
export type LlamadoEntradaValidada = z.output<typeof llamadoEntradaSchema>;
export type LineaLlamadoEntrada = z.input<typeof lineaLlamadoEntradaSchema>;
export type LlamadoPublico = z.infer<typeof llamadoPublicoSchema>;
export type MesaPublica = z.infer<typeof mesaPublicaSchema>;
export type EstadoLlamadoPublico = z.infer<typeof estadoLlamadoPublicoSchema>;
export type LlamadoResumen = z.infer<typeof llamadoResumenSchema>;
export type LlamadosRespuesta = z.infer<typeof llamadosRespuestaSchema>;
export type RevisionLinea = z.infer<typeof revisionLineaSchema>;
export type LineaDeLlamado = z.infer<typeof lineaDeLlamadoSchema>;
export type LlamadoDetalle = z.infer<typeof llamadoDetalleSchema>;
export type AtencionEntrada = z.input<typeof atencionEntradaSchema>;
export type AtencionRespuesta = z.infer<typeof atencionRespuestaSchema>;
export type PasoACuentaEntrada = z.input<typeof pasoACuentaEntradaSchema>;
export type LineaParaBorrador = z.infer<typeof lineaParaBorradorSchema>;
export type PasoACuentaRespuesta = z.infer<typeof pasoACuentaRespuestaSchema>;
export type DescarteEntrada = z.input<typeof descarteEntradaSchema>;
export type EventoLlamadoNuevo = z.infer<typeof eventoLlamadoNuevoSchema>;
export type EventoLlamadoCambio = z.infer<typeof eventoLlamadoCambioSchema>;
