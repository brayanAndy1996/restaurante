import { z } from 'zod';
import {
  HORA_CORTE_POR_DEFECTO,
  codigoEstablecimientoSchema,
  horaSchema,
  horarioSchema,
  regimenTributarioSchema,
  rucSchema,
  uuidSchema,
  whatsappSchema,
} from './comunes';

export const emisorEntradaSchema = z.object({
  ruc: rucSchema,
  razonSocial: z.string().trim().min(1).max(200),
  regimen: regimenTributarioSchema,
});

export const sucursalEntradaSchema = z.object({
  rucEmisor: rucSchema,
  nombre: z.string().trim().min(1).max(100),
  codigoEstablecimiento: codigoEstablecimientoSchema,
  direccion: z.string().trim().min(1).max(300),
  horario: horarioSchema.default([]),
  whatsapp: whatsappSchema.optional(),
  horaCorte: horaSchema.default(HORA_CORTE_POR_DEFECTO),
});

export const registrarEmpresaEntradaSchema = z
  .object({
    nombre: z.string().trim().min(1).max(150),
    emisores: z.array(emisorEntradaSchema).min(1),
    sucursales: z.array(sucursalEntradaSchema).min(1),
  })
  .superRefine((datos, ctx) => {
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
  });

/**
 * Cambios parciales de una sucursal. Asigna valores absolutos: al menos un campo, `whatsapp` en
 * `null` lo quita y `horaCorte` no tiene valor por defecto (si no viene, no cambia).
 */
export const sucursalConfigurarEntradaSchema = z
  .object({
    emisorId: uuidSchema,
    nombre: z.string().trim().min(1).max(100),
    codigoEstablecimiento: codigoEstablecimientoSchema,
    direccion: z.string().trim().min(1).max(300),
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
