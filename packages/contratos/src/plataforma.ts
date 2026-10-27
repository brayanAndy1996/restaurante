import { z } from 'zod';
import {
  HORA_CORTE_POR_DEFECTO,
  codigoEstablecimientoSchema,
  contrasenaSchema,
  horaSchema,
  horarioSchema,
  motivoSchema,
  nombreUsuarioSchema,
  pinSchema,
  regimenTributarioSchema,
  rucSchema,
  textoSchema,
  uuidSchema,
  whatsappSchema,
} from './comunes';
import {
  estadoSuscripcionSchema,
  suscripcionAltaEntradaSchema,
  suscripcionRespuestaSchema,
} from './suscripciones';

export const emisorEntradaSchema = z.object({
  ruc: rucSchema,
  razonSocial: textoSchema(200),
  regimen: regimenTributarioSchema,
});

export const sucursalEntradaSchema = z.object({
  rucEmisor: rucSchema,
  nombre: textoSchema(100),
  codigoEstablecimiento: codigoEstablecimientoSchema,
  direccion: textoSchema(300),
  horario: horarioSchema.default([]),
  whatsapp: whatsappSchema.optional(),
  horaCorte: horaSchema.default(HORA_CORTE_POR_DEFECTO),
  /** Solo en las altas por la vía de plataforma (criterio 69); el Administrador no la envía. */
  suscripcion: suscripcionAltaEntradaSchema.optional(),
});

/** Coherencia de un alta de empresa: RUC y nombres no repetidos y sucursales con emisor de la entrada. */
function validarCoherenciaDeEmpresa(
  datos: {
    emisores: { ruc: string }[];
    sucursales: { rucEmisor: string; codigoEstablecimiento: string; nombre: string }[];
  },
  ctx: z.RefinementCtx,
): void {
  const rucs = new Set<string>();
  datos.emisores.forEach((emisor, i) => {
    if (rucs.has(emisor.ruc)) {
      ctx.addIssue({
        code: 'custom',
        message: 'RUC repetido en la entrada',
        path: ['emisores', i, 'ruc'],
      });
    }
    rucs.add(emisor.ruc);
  });

  const codigos = new Set<string>();
  const nombres = new Set<string>();
  datos.sucursales.forEach((sucursal, i) => {
    if (!rucs.has(sucursal.rucEmisor)) {
      ctx.addIssue({
        code: 'custom',
        message: 'El RUC no corresponde a ningún emisor de la entrada',
        path: ['sucursales', i, 'rucEmisor'],
      });
    }
    const claveCodigo = `${sucursal.rucEmisor}/${sucursal.codigoEstablecimiento}`;
    if (codigos.has(claveCodigo)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Código de establecimiento repetido para el mismo emisor',
        path: ['sucursales', i, 'codigoEstablecimiento'],
      });
    }
    codigos.add(claveCodigo);
    const claveNombre = sucursal.nombre.toLowerCase();
    if (nombres.has(claveNombre)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Nombre de sucursal repetido en la entrada',
        path: ['sucursales', i, 'nombre'],
      });
    }
    nombres.add(claveNombre);
  });
}

export const registrarEmpresaEntradaSchema = z
  .object({
    nombre: textoSchema(150),
    emisores: z.array(emisorEntradaSchema).min(1),
    sucursales: z.array(sucursalEntradaSchema).min(1),
  })
  .superRefine(validarCoherenciaDeEmpresa);

/**
 * Cambios parciales de una sucursal. Asigna valores absolutos: al menos un campo, `whatsapp` en
 * `null` lo quita y `horaCorte` no tiene valor por defecto (si no viene, no cambia).
 */
export const sucursalConfigurarEntradaSchema = z
  .object({
    emisorId: uuidSchema,
    nombre: textoSchema(100),
    codigoEstablecimiento: codigoEstablecimientoSchema,
    direccion: textoSchema(300),
    horario: horarioSchema,
    whatsapp: whatsappSchema.nullable(),
    horaCorte: horaSchema,
  })
  .partial()
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), {
    message: 'Debe enviar al menos un campo',
  });

export const sucursalRespuestaSchema = z.object({
  id: uuidSchema,
  empresaId: uuidSchema,
  emisorId: uuidSchema,
  nombre: z.string(),
  codigoEstablecimiento: codigoEstablecimientoSchema,
  direccion: z.string(),
  horario: horarioSchema,
  whatsapp: whatsappSchema.nullable(),
  horaCorte: horaSchema,
  creadoEn: z.iso.datetime(),
  actualizadoEn: z.iso.datetime(),
});

// Tipos de entrada (antes de aplicar valores por defecto) y de salida (ya validados).
export type EmisorEntrada = z.input<typeof emisorEntradaSchema>;
export type SucursalEntrada = z.input<typeof sucursalEntradaSchema>;
export type RegistrarEmpresaEntrada = z.input<typeof registrarEmpresaEntradaSchema>;
export type SucursalConfigurarEntrada = z.infer<typeof sucursalConfigurarEntradaSchema>;
export type SucursalRespuesta = z.infer<typeof sucursalRespuestaSchema>;
export type EmisorEntradaValidada = z.output<typeof emisorEntradaSchema>;
export type SucursalEntradaValidada = z.output<typeof sucursalEntradaSchema>;
export type RegistrarEmpresaEntradaValidada = z.output<typeof registrarEmpresaEntradaSchema>;

// ---------------------------------------------------------------------------------------------
// Historia 002: entradas y respuestas por HTTP (Administrador y superadministrador).
// ---------------------------------------------------------------------------------------------

/** `POST /emisores` (Administrador): como `emisorEntrada`, sin campos desconocidos. */
export const emisorCrearEntradaSchema = emisorEntradaSchema.strict();

/**
 * `POST /sucursales` (Administrador): como `sucursalEntrada` pero sin `suscripcion` (nace en el plan
 * por defecto con vencimiento el día del alta, criterio 70) y sin campos desconocidos.
 */
export const sucursalCrearEntradaSchema = sucursalEntradaSchema
  .omit({ suscripcion: true })
  .strict();

/** `POST /plataforma/empresas/:id/emisores`: el emisor y el motivo de la auditoría. */
export const emisorPlataformaEntradaSchema = emisorEntradaSchema
  .extend({ motivo: motivoSchema })
  .strict();

/** `POST /plataforma/empresas/:id/sucursales`: la sucursal (con `suscripcion` opcional) y el motivo. */
export const sucursalPlataformaEntradaSchema = sucursalEntradaSchema
  .extend({ motivo: motivoSchema })
  .strict();

/** Primer Administrador de una empresa nueva; su PIN (6 dígitos) se muestra una sola vez. */
export const administradorInicialEntradaSchema = z.strictObject({
  nombre: textoSchema(100),
  nombreUsuario: nombreUsuarioSchema,
  contrasenaTemporal: contrasenaSchema,
});

/** `POST /plataforma/empresas` (criterio 63): el alta de 001, más `administrador` y `motivo`. */
export const altaEmpresaEntradaSchema = z
  .strictObject({
    nombre: textoSchema(150),
    emisores: z.array(emisorEntradaSchema.strict()).min(1),
    sucursales: z.array(sucursalEntradaSchema.strict()).min(1),
    administrador: administradorInicialEntradaSchema,
    motivo: motivoSchema,
  })
  .superRefine(validarCoherenciaDeEmpresa);

const sucursalCreadaSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  suscripcion: suscripcionRespuestaSchema,
});

export const altaEmpresaRespuestaSchema = z.object({
  empresaId: uuidSchema,
  emisores: z.array(z.object({ id: uuidSchema, ruc: z.string() })),
  sucursales: z.array(sucursalCreadaSchema),
  administrador: z.object({ id: uuidSchema, pin: pinSchema }),
});

/** 201 de `POST /plataforma/empresas/:id/sucursales`. */
export const sucursalPlataformaRespuestaSchema = sucursalCreadaSchema;

/** `GET /emisores`, `POST /emisores` y el alta de emisores. */
export const emisorRespuestaSchema = z.object({
  id: uuidSchema,
  empresaId: uuidSchema,
  ruc: rucSchema,
  razonSocial: z.string(),
  regimen: regimenTributarioSchema,
  creadoEn: z.iso.datetime(),
  actualizadoEn: z.iso.datetime(),
});

/** `POST /plataforma/empresas/:id/soporte` (criterio 66). */
export const soporteEntradaSchema = z.strictObject({
  motivo: motivoSchema,
  sucursalId: uuidSchema.optional(),
});

/** Fila de `GET /plataforma/empresas`: la empresa con sus sucursales y el estado de cada suscripción. */
export const empresaPlataformaResumenSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  creadoEn: z.iso.datetime(),
  sucursales: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      estadoSuscripcion: estadoSuscripcionSchema.nullable(),
    }),
  ),
});

/** `GET /plataforma/empresas/:id`: emisores, sucursales, suscripciones y administradores. */
export const empresaPlataformaDetalleSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  creadoEn: z.iso.datetime(),
  emisores: z.array(emisorRespuestaSchema),
  sucursales: z.array(sucursalRespuestaSchema),
  suscripciones: z.array(suscripcionRespuestaSchema),
  administradores: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      nombreUsuario: z.string(),
      activo: z.boolean(),
    }),
  ),
});

export type EmisorCrearEntrada = z.input<typeof emisorCrearEntradaSchema>;
export type SucursalCrearEntrada = z.input<typeof sucursalCrearEntradaSchema>;
export type EmisorPlataformaEntrada = z.input<typeof emisorPlataformaEntradaSchema>;
export type SucursalPlataformaEntrada = z.input<typeof sucursalPlataformaEntradaSchema>;
export type AdministradorInicialEntrada = z.input<typeof administradorInicialEntradaSchema>;
export type AltaEmpresaEntrada = z.input<typeof altaEmpresaEntradaSchema>;
export type AltaEmpresaRespuesta = z.infer<typeof altaEmpresaRespuestaSchema>;
export type SucursalPlataformaRespuesta = z.infer<typeof sucursalPlataformaRespuestaSchema>;
export type EmisorRespuesta = z.infer<typeof emisorRespuestaSchema>;
export type SoporteEntrada = z.input<typeof soporteEntradaSchema>;
export type EmpresaPlataformaResumen = z.infer<typeof empresaPlataformaResumenSchema>;
export type EmpresaPlataformaDetalle = z.infer<typeof empresaPlataformaDetalleSchema>;
