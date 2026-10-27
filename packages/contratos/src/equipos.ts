import { z } from 'zod';
import { textoSchema, uuidSchema } from './comunes';

/** Nombre de un equipo cuando la PWA no manda uno. */
export const NOMBRE_EQUIPO_POR_DEFECTO = 'Equipo sin nombre';

/** `POST /sesion/equipo` (criterio 27). */
export const recordarEquipoEntradaSchema = z.strictObject({
  nombre: textoSchema(60).optional(),
});

export const equipoRespuestaSchema = z.object({ id: uuidSchema, nombre: z.string() });

/** 201 con `tokenEquipo` (equipo nuevo: solo se muestra aquí) o 200 sin él (equipo ya conocido). */
export const recordarEquipoRespuestaSchema = z.object({
  equipo: equipoRespuestaSchema,
  tokenEquipo: z.string().optional(),
});

/** `GET /equipo` (criterio 28): personas activas que el equipo recuerda, la usada hace menos primero. */
export const equipoActualRespuestaSchema = z.object({
  equipo: equipoRespuestaSchema,
  personas: z.array(
    z.object({
      usuarioId: uuidSchema,
      nombre: z.string(),
      largoPin: z.union([z.literal(4), z.literal(6)]),
      bloqueadoHastaEn: z.iso.datetime().nullable(),
    }),
  ),
});

/** Equipo recordado activo de una persona (criterios 30 y 31); `actual` solo en `GET /sesion/equipos`. */
export const equipoRecordadoRespuestaSchema = z.object({
  id: uuidSchema,
  equipo: equipoRespuestaSchema,
  recordadoEn: z.iso.datetime(),
  ultimoUsoEn: z.iso.datetime(),
  actual: z.boolean().optional(),
});

export type RecordarEquipoEntrada = z.input<typeof recordarEquipoEntradaSchema>;
export type EquipoRespuesta = z.infer<typeof equipoRespuestaSchema>;
export type RecordarEquipoRespuesta = z.infer<typeof recordarEquipoRespuestaSchema>;
export type EquipoActualRespuesta = z.infer<typeof equipoActualRespuestaSchema>;
export type EquipoRecordadoRespuesta = z.infer<typeof equipoRecordadoRespuestaSchema>;
