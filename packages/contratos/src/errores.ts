import { z } from 'zod';
import { seQuitaSchema, usadoEnSchema } from './carta';
import { uuidSchema } from './comunes';

/** Códigos de error que devuelve la API en el cuerpo de las respuestas de error. */
export const CODIGOS_ERROR = [
  'DATOS_INVALIDOS',
  'EMPRESA_NO_RESUELTA',
  'NO_ENCONTRADO',
  'CONFLICTO',
  'EMISOR_INVALIDO',
  'CUERPO_DEMASIADO_GRANDE',
  'NO_AUTENTICADO',
  'PROHIBIDO',
  'METODO_NO_PERMITIDO',
  'TIPO_NO_SOPORTADO',
  'DEMASIADAS_PETICIONES',
  'PETICION_INVALIDA',
  'ERROR_INTERNO',
  // Sección "Plataforma y acceso" (historia 002).
  'CREDENCIALES_INVALIDAS',
  'SESION_EXPIRADA',
  'EQUIPO_NO_RECONOCIDO',
  'BLOQUEO_TEMPORAL',
  'FUERA_DE_HORARIO',
  'CAMBIO_CONTRASENA_REQUERIDO',
  'CLAVE_INVALIDA',
  'CLAVE_REQUERIDA',
  'AUTORIZACION_INVALIDA',
  'CLAVE_INNECESARIA',
  'SUCURSAL_NO_ELEGIDA',
  'SUCURSAL_INVALIDA',
  'SUCURSAL_SUSPENDIDA',
  'MODULO_NO_INCLUIDO',
  'ULTIMO_ADMINISTRADOR',
  'PLAN_INVALIDO',
  'CLAVE_IDEMPOTENCIA_REUTILIZADA',
  // Sección "Carta" (historia 003).
  'REFERENCIA_INVALIDA',
  'EN_USO',
  'CONFIRMACION_REQUERIDA',
  'FOTO_INVALIDA',
  'PRODUCTO_NO_VENDIBLE',
  'SELECCION_INVALIDA',
  // Sección "Salón, Cocina e Impresión" (historia 004, entrega 3a).
  'MESA_OCUPADA',
  'ORDEN_NO_ABIERTA',
  'ORDEN_SIN_CONSUMO',
  'ORDEN_CON_CONSUMO',
  'NADA_QUE_MARCHAR',
  'ITEM_NO_ANULABLE',
  'TRANSICION_INVALIDA',
  'MONTO_FUERA_DE_RANGO',
  // Entrega 3b (impresión): la vinculación del puente y la reimpresión sin impresora.
  'VINCULACION_INVALIDA',
  'SIN_IMPRESORA',
] as const;

export const codigoErrorSchema = z.enum(CODIGOS_ERROR);

/** Un campo con problemas (`DATOS_INVALIDOS`); `campo` usa puntos para anidar: `sucursales.0.ruc`. */
export const campoErrorSchema = z.object({
  campo: z.string(),
  mensaje: z.string(),
});

export const errorRespuestaSchema = z.object({
  codigo: z.string(),
  mensaje: z.string(),
  campos: z.array(campoErrorSchema).optional(),
  /** Solo en `BLOQUEO_TEMPORAL` (429): segundos que faltan; también va en la cabecera `Retry-After`. */
  reintentarEnSegundos: z.number().int().nonnegative().optional(),
  /** Solo en `EN_USO` de un cambio de tipo (criterio 10c de 003): dónde se usa el producto. */
  usadoEn: usadoEnSchema.optional(),
  /** Solo en `CONFIRMACION_REQUERIDA` (criterio 10b de 003): lo que el cambio de tipo quitaría. */
  seQuita: seQuitaSchema.optional(),
  /**
   * Solo en `MESA_OCUPADA` (la orden que ocupa la mesa) y en `ORDEN_NO_ABIERTA` cuando la orden se unió a otra
   * (la orden a la que se unió): para que la PWA lleve a la persona ahí (criterios 11 y 29 de 004).
   */
  ordenId: uuidSchema.optional(),
});

export type CodigoError = z.infer<typeof codigoErrorSchema>;
export type CampoError = z.infer<typeof campoErrorSchema>;
export type ErrorRespuesta = z.infer<typeof errorRespuestaSchema>;
