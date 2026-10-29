import { z } from 'zod';
import {
  contrasenaSchema,
  horarioSchema,
  nombreUsuarioSchema,
  pinSchema,
  rolAccesoSchema,
  textoSchema,
  uuidSchema,
} from './comunes';

/**
 * Horario de acceso de un trabajador (criterio 106): los tramos semanales de `horarioSchema` (sin
 * solapes, `desde` distinto de `hasta`) con al menos uno, o `null` para no tener horario. La lista
 * vacía no vale.
 */
export const horarioUsuarioSchema = horarioSchema.min(1, 'Debe tener al menos un tramo').nullable();

/** Acceso de un usuario a una sucursal con su rol en ella (el Administrador no lleva accesos). */
export const accesoSucursalEntradaSchema = z.strictObject({
  sucursalId: uuidSchema,
  rol: rolAccesoSchema,
});

type ReglasAccesos = {
  accesos?: { sucursalId: string }[] | undefined;
};

/** Sucursal repetida en `accesos` (criterio 20). */
function exigirAccesosSinRepetir(datos: ReglasAccesos, ctx: z.RefinementCtx): void {
  const vistas = new Set<string>();
  datos.accesos?.forEach((acceso, i) => {
    const clave = acceso.sucursalId.toLowerCase();
    if (vistas.has(clave)) {
      ctx.addIssue({
        code: 'custom',
        message: 'La sucursal está repetida',
        path: ['accesos', i, 'sucursalId'],
      });
    }
    vistas.add(clave);
  });
}

/** `POST /usuarios` (criterio 18). La contraseña temporal es obligatoria para todos. */
export const usuarioCrearEntradaSchema = z
  .strictObject({
    nombre: textoSchema(100),
    nombreUsuario: nombreUsuarioSchema,
    esAdministrador: z.boolean(),
    accesos: z.array(accesoSucursalEntradaSchema),
    contrasenaTemporal: contrasenaSchema,
    horario: horarioUsuarioSchema.optional(),
  })
  .superRefine((datos, ctx) => {
    exigirAccesosSinRepetir(datos, ctx);
    if (datos.esAdministrador) {
      if (datos.accesos.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Un Administrador no lleva accesos por sucursal',
          path: ['accesos'],
        });
      }
      if (datos.horario !== undefined && datos.horario !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Un Administrador no puede tener horario',
          path: ['horario'],
        });
      }
    } else if (datos.accesos.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Debe tener al menos un acceso a una sucursal',
        path: ['accesos'],
      });
    }
  });

/**
 * `PATCH /usuarios/:id` (criterio 22): reemplaza lo enviado (los accesos, completos); al menos un
 * campo. Las reglas que dependen del usuario guardado (por ejemplo, un horario en alguien que queda
 * Administrador, o dejar la empresa sin Administrador) las comprueba la API.
 */
export const usuarioModificarEntradaSchema = z
  .strictObject({
    nombre: textoSchema(100),
    esAdministrador: z.boolean(),
    accesos: z.array(accesoSucursalEntradaSchema),
    activo: z.boolean(),
    horario: horarioUsuarioSchema,
  })
  .partial()
  .superRefine((datos, ctx) => {
    if (Object.values(datos).every((valor) => valor === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Debe enviar al menos un campo', path: [] });
    }
    exigirAccesosSinRepetir(datos, ctx);
    if (datos.esAdministrador === true) {
      if (datos.accesos !== undefined && datos.accesos.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Un Administrador no lleva accesos por sucursal',
          path: ['accesos'],
        });
      }
      if (datos.horario !== undefined && datos.horario !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Un Administrador no puede tener horario',
          path: ['horario'],
        });
      }
    }
  });

/** `POST /usuarios/:id/contrasena` (criterio 23): `null` o ausente es 400. */
export const restablecerContrasenaEntradaSchema = z.strictObject({
  contrasenaTemporal: contrasenaSchema,
});

/** Usuario tal como lo ve el Administrador (criterio 24): nunca hashes, huellas ni PIN. */
export const usuarioRespuestaSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  nombreUsuario: z.string(),
  esAdministrador: z.boolean(),
  accesos: z.array(z.object({ sucursalId: uuidSchema, rol: rolAccesoSchema })),
  activo: z.boolean(),
  horario: horarioUsuarioSchema,
  largoPin: z.union([z.literal(4), z.literal(6)]),
  contrasenaTemporal: z.boolean(),
  /** Cantidad de equipos recordados activos. */
  equiposRecordados: z.number().int().nonnegative(),
  creadoEn: z.iso.datetime(),
  actualizadoEn: z.iso.datetime(),
});

/** 201 de `POST /usuarios`: el `pin` solo se muestra en esta respuesta. */
export const usuarioCreadoRespuestaSchema = usuarioRespuestaSchema.extend({ pin: pinSchema });

/** 200 de `PATCH /usuarios/:id`: trae `pin` solo si cambió el largo del PIN (criterio 21b). */
export const usuarioModificadoRespuestaSchema = usuarioRespuestaSchema.extend({
  pin: pinSchema.optional(),
});

/** 200 de `POST /usuarios/:id/pin`. */
export const pinRespuestaSchema = z.object({ pin: pinSchema });

const minutosInactividadSchema = z.number().int().min(1).max(120);
/** Cocina/Barra aguanta más tiempo sin uso (historia 004, criterio 63c): de 1 a 720 minutos. */
const minutosInactividadCocinaSchema = z.number().int().min(1).max(720);

/**
 * `PATCH /sucursales/:id/acceso` (criterio 40 de 002; criterio 63c de 004): al menos uno de los dos campos; el
 * que no se envía no cambia.
 */
export const sucursalAccesoEntradaSchema = z
  .strictObject({
    minutosInactividad: minutosInactividadSchema.optional(),
    minutosInactividadCocina: minutosInactividadCocinaSchema.optional(),
  })
  .refine(
    (c) => c.minutosInactividad !== undefined || c.minutosInactividadCocina !== undefined,
    'Envía al menos un campo',
  );

export const sucursalAccesoRespuestaSchema = z.object({
  sucursalId: uuidSchema,
  minutosInactividad: minutosInactividadSchema,
  minutosInactividadCocina: minutosInactividadCocinaSchema,
});

export type HorarioUsuario = z.infer<typeof horarioUsuarioSchema>;
export type UsuarioCrearEntrada = z.input<typeof usuarioCrearEntradaSchema>;
export type UsuarioModificarEntrada = z.input<typeof usuarioModificarEntradaSchema>;
export type RestablecerContrasenaEntrada = z.input<typeof restablecerContrasenaEntradaSchema>;
export type UsuarioRespuesta = z.infer<typeof usuarioRespuestaSchema>;
export type UsuarioCreadoRespuesta = z.infer<typeof usuarioCreadoRespuestaSchema>;
export type UsuarioModificadoRespuesta = z.infer<typeof usuarioModificadoRespuestaSchema>;
export type PinRespuesta = z.infer<typeof pinRespuestaSchema>;
export type SucursalAccesoEntrada = z.input<typeof sucursalAccesoEntradaSchema>;
export type SucursalAccesoRespuesta = z.infer<typeof sucursalAccesoRespuestaSchema>;
