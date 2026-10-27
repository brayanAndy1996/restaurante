import { z } from 'zod';

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
});

export type CodigoError = z.infer<typeof codigoErrorSchema>;
export type CampoError = z.infer<typeof campoErrorSchema>;
export type ErrorRespuesta = z.infer<typeof errorRespuestaSchema>;
