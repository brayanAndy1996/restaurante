import { z } from 'zod';
import {
  accionSchema,
  contrasenaIngresoSchema,
  contrasenaSchema,
  fechaSchema,
  moduloSchema,
  nombreUsuarioIngresoSchema,
  pinSchema,
  requisitoPermisoSchema,
  rolSchema,
  uuidSchema,
} from './comunes';

/** Tipo de sesión de empresa. `PRUEBA` es el principal del modo de prueba (solo `NODE_ENV=test`). */
export const tipoSesionSchema = z.enum(['CONTRASENA', 'PIN', 'SOPORTE', 'PRUEBA']);

/** `POST /sesiones/contrasena`. El nombre se compara sin distinguir mayúsculas ASCII. */
export const ingresoContrasenaEntradaSchema = z.strictObject({
  usuario: nombreUsuarioIngresoSchema,
  contrasena: contrasenaIngresoSchema,
});

/** `POST /sesiones/pin` (con la cabecera `X-Equipo`): la persona se elige, no se busca por el PIN. */
export const ingresoPinEntradaSchema = z.strictObject({
  usuarioId: uuidSchema,
  pin: pinSchema,
});

/** `PUT /sesion/contrasena`. */
export const cambiarContrasenaEntradaSchema = z.strictObject({
  actual: contrasenaIngresoSchema,
  nueva: contrasenaSchema,
});

/** `PUT /sesion/sucursal`. */
export const elegirSucursalEntradaSchema = z.strictObject({ sucursalId: uuidSchema });

const sucursalDeSesionSchema = z.object({ id: uuidSchema, nombre: z.string() });

/** Una sucursal que la persona puede elegir, con su rol en ella (`ADMINISTRADOR` en todas si lo es). */
export const sucursalElegibleSchema = sucursalDeSesionSchema.extend({ rol: rolSchema });

/** Sucursal de la empresa en gracia o suspendida (aviso para el Administrador, criterio 80). */
export const avisoSucursalSuscripcionSchema = z.object({
  sucursalId: uuidSchema,
  nombre: z.string(),
  estado: z.enum(['EN_GRACIA', 'SUSPENDIDA']),
  vencimiento: fechaSchema,
  suspensionDesde: fechaSchema,
  diasRestantesGracia: z.number().int().nonnegative().nullable(),
});

export const avisoSuscripcionSchema = z.object({
  sucursales: z.array(avisoSucursalSuscripcionSchema),
});

/**
 * Sesión actual (`GET /sesion`, criterio 42). `usuario` es `null` en soporte y en el principal de
 * prueba; `superadministrador` solo en soporte. `permisos` (una entrada por acción de la matriz) es
 * `null` cuando todavía no hay rol (sin sucursal elegida y sin ser Administrador). `modulos` son los
 * del plan de la sucursal activa (vacío sin sucursal). `expiraPorInactividadEn` es `null` en el
 * principal de prueba.
 */
export const sesionRespuestaSchema = z.object({
  tipo: tipoSesionSchema,
  empresaId: uuidSchema,
  usuario: z.object({ id: uuidSchema, nombre: z.string(), nombreUsuario: z.string() }).nullable(),
  superadministrador: z.object({ id: uuidSchema, nombre: z.string() }).nullable(),
  rol: rolSchema.nullable(),
  esAdministrador: z.boolean(),
  sucursal: sucursalDeSesionSchema.nullable(),
  sucursales: z.array(sucursalElegibleSchema),
  equipo: z
    .object({ id: uuidSchema, nombre: z.string(), equipoRecordadoId: uuidSchema })
    .nullable(),
  permisos: z.record(accionSchema, requisitoPermisoSchema).nullable(),
  modulos: z.array(moduloSchema),
  avisoSuscripcion: avisoSuscripcionSchema.nullable(),
  debeCambiarContrasena: z.boolean(),
  expiraPorInactividadEn: z.iso.datetime().nullable(),
});

/** 201 de los ingresos (contraseña, PIN y soporte): el token solo se muestra en esta respuesta. */
export const ingresoRespuestaSchema = z.object({
  token: z.string(),
  sesion: sesionRespuestaSchema,
});

/** `POST /plataforma/sesiones`. */
export const ingresoSuperadministradorEntradaSchema = z.strictObject({
  usuario: nombreUsuarioIngresoSchema,
  contrasena: contrasenaIngresoSchema,
});

export const ingresoSuperadministradorRespuestaSchema = z.object({
  token: z.string(),
  superadministrador: z.object({ id: uuidSchema, nombre: z.string() }),
});

export type TipoSesion = z.infer<typeof tipoSesionSchema>;
export type IngresoContrasenaEntrada = z.input<typeof ingresoContrasenaEntradaSchema>;
export type IngresoPinEntrada = z.input<typeof ingresoPinEntradaSchema>;
export type CambiarContrasenaEntrada = z.input<typeof cambiarContrasenaEntradaSchema>;
export type ElegirSucursalEntrada = z.input<typeof elegirSucursalEntradaSchema>;
export type SesionRespuesta = z.infer<typeof sesionRespuestaSchema>;
export type IngresoRespuesta = z.infer<typeof ingresoRespuestaSchema>;
export type AvisoSuscripcion = z.infer<typeof avisoSuscripcionSchema>;
export type IngresoSuperadministradorEntrada = z.input<
  typeof ingresoSuperadministradorEntradaSchema
>;
export type IngresoSuperadministradorRespuesta = z.infer<
  typeof ingresoSuperadministradorRespuestaSchema
>;
