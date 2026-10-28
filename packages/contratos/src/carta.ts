import {
  AFECTACIONES_IGV,
  CANTIDAD_MAXIMA_COMPONENTE,
  CANTIDAD_MAXIMA_LINEA,
  HASTA_AGOTADO,
  MOTIVOS_NO_VENDIBLE,
  ORIGENES_AGOTADO,
  SELECCIONES,
  TIPOS_CONTROL_STOCK,
  TIPOS_PRODUCTO,
} from '@restaurante/dominio';
import { z } from 'zod';
import {
  fechaSchema,
  montoNoNegativoSchema,
  montoSchema,
  textoSchema,
  uuidSchema,
} from './comunes';

/**
 * Contratos de la carta (historia 003): estaciones, familias, productos, ajustes por sucursal, grupos de
 * modificadores, menú del día, agotados, la vista de la sucursal y los eventos en tiempo real. Las
 * entradas son estrictas (un campo desconocido es 400) y ninguna acepta `empresaId`, `creadoPor*` ni
 * `actualizadoPor*`. Los montos viajan como texto decimal con 2 decimales.
 */

const instanteSchema = z.iso.datetime();

/** Enumeraciones del catálogo de `packages/dominio`. */
export const tipoProductoSchema = z.enum(TIPOS_PRODUCTO);
export const tipoControlStockSchema = z.enum(TIPOS_CONTROL_STOCK);
export const afectacionIgvSchema = z.enum(AFECTACIONES_IGV);
export const seleccionSchema = z.enum(SELECCIONES);
export const hastaAgotadoSchema = z.enum(HASTA_AGOTADO);
export const origenAgotadoSchema = z.enum(ORIGENES_AGOTADO);
export const motivoNoVendibleSchema = z.enum(MOTIVOS_NO_VENDIBLE);

/** Máximos de cordura (decisiones del especificador del borrador de 003). */
export const MAXIMO_GRUPOS_POR_PRODUCTO = 10;
export const MAXIMO_COMPONENTES_POR_COMBO = 20;
export const MAXIMO_MODIFICADORES_POR_GRUPO = 50;

type Falla = (campo: string, mensaje: string) => void;

function fallaEn(ctx: z.RefinementCtx): Falla {
  return (campo, mensaje) => ctx.addIssue({ code: 'custom', message: mensaje, path: [campo] });
}

/** Marca como repetido cada elemento que ya apareció antes (la primera aparición no falla). */
function marcarRepetidos<T>(
  elementos: readonly T[] | undefined,
  clave: (elemento: T) => string,
  campo: string,
  mensaje: string,
  ctx: z.RefinementCtx,
): void {
  if (elementos === undefined) return;
  const vistos = new Set<string>();
  elementos.forEach((elemento, indice) => {
    const k = clave(elemento);
    if (vistos.has(k)) {
      ctx.addIssue({
        code: 'custom',
        message: mensaje,
        path: campo === '' ? [indice] : [campo, indice],
      });
    }
    vistos.add(k);
  });
}

// ---------------------------------------------------------------------------------------------------
// Estaciones (criterios 1, 2 y 2b)
// ---------------------------------------------------------------------------------------------------

export const estacionEntradaSchema = z.strictObject({ nombre: textoSchema(50) });

export const estacionModificarEntradaSchema = z
  .strictObject({ nombre: textoSchema(50).optional(), activa: z.boolean().optional() })
  .refine((c) => c.nombre !== undefined || c.activa !== undefined, 'Envía al menos un campo');

export const estacionRespuestaSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  activa: z.boolean(),
  /** Cuántos productos activos la usan. */
  productosActivos: z.number().int().nonnegative(),
  creadoEn: instanteSchema,
  actualizadoEn: instanteSchema,
});

// ---------------------------------------------------------------------------------------------------
// Familias (criterios 3 a 5)
// ---------------------------------------------------------------------------------------------------

export const familiaEntradaSchema = z.strictObject({ nombre: textoSchema(60) });

export const familiaModificarEntradaSchema = z
  .strictObject({ nombre: textoSchema(60).optional(), activa: z.boolean().optional() })
  .refine((c) => c.nombre !== undefined || c.activa !== undefined, 'Envía al menos un campo');

export const familiaRespuestaSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  orden: z.number().int(),
  activa: z.boolean(),
  /** Cuántos productos activos tiene. */
  productos: z.number().int().nonnegative(),
  creadoEn: instanteSchema,
  actualizadoEn: instanteSchema,
});

/**
 * Orden manual de familias o de los productos de una familia (criterios 5 y 13): los ids, sin repetir,
 * en el orden nuevo. Que sean exactamente las filas de la empresa o de la familia lo comprueba el servicio.
 */
export const ordenEntradaSchema = z
  .strictObject({ ids: z.array(uuidSchema) })
  .superRefine((orden, ctx) => {
    marcarRepetidos(orden.ids, (id) => id.toLowerCase(), 'ids', 'Id repetido', ctx);
  });

// ---------------------------------------------------------------------------------------------------
// Productos (criterios 6 a 13)
// ---------------------------------------------------------------------------------------------------

/** Componente de un combo: un producto simple con su cantidad (1 a 99). */
export const componenteEntradaSchema = z.strictObject({
  productoId: uuidSchema,
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_COMPONENTE),
});

const gruposModificadoresCampo = z.array(uuidSchema).max(MAXIMO_GRUPOS_POR_PRODUCTO);
const componentesCampo = z.array(componenteEntradaSchema).max(MAXIMO_COMPONENTES_POR_COMBO);

const campoSinRepetidos = (
  producto: { gruposModificadores?: string[]; componentes?: { productoId: string }[] },
  ctx: z.RefinementCtx,
): void => {
  marcarRepetidos(
    producto.gruposModificadores,
    (id) => id.toLowerCase(),
    'gruposModificadores',
    'Grupo repetido',
    ctx,
  );
  marcarRepetidos(
    producto.componentes,
    (c) => c.productoId.toLowerCase(),
    'componentes',
    'Componente repetido',
    ctx,
  );
};

/** `POST /carta/productos` (criterios 6 a 8). Las reglas por tipo del criterio 7 se comprueban aquí. */
export const productoCrearEntradaSchema = z
  .strictObject({
    tipo: tipoProductoSchema,
    nombre: textoSchema(100),
    descripcion: textoSchema(500).nullable().optional(),
    familiaId: uuidSchema,
    /** Precio con IGV, mayor que 0. */
    precio: montoSchema.nullable().optional(),
    seVendeSolo: z.boolean().default(true),
    afectacionIgv: afectacionIgvSchema.default('GRAVADO'),
    aplicaIcbper: z.boolean().default(false),
    /** `null` = ninguna estación; sin enviar, solo vale en combos y menús. */
    estacionId: uuidSchema.nullable().optional(),
    tipoControlStock: tipoControlStockSchema,
    gruposModificadores: gruposModificadoresCampo.optional(),
    componentes: componentesCampo.optional(),
    /** Sucursales donde el producto nace no disponible (criterio 23). */
    noDisponibleEn: z.array(uuidSchema).optional(),
  })
  .superRefine((p, ctx) => {
    const falla = fallaEn(ctx);
    campoSinRepetidos(p, ctx);
    const componentes = p.componentes?.length ?? 0;
    const grupos = p.gruposModificadores?.length ?? 0;
    if (p.tipo === 'SIMPLE') {
      if (p.estacionId === undefined) {
        falla('estacionId', 'Elige la estación o indica que no tiene (null)');
      }
      if (componentes > 0) falla('componentes', 'Un producto simple no lleva componentes');
      if (p.seVendeSolo) {
        if (p.precio === undefined || p.precio === null) {
          falla('precio', 'El precio es obligatorio si el producto se vende solo');
        }
      } else if (p.precio !== undefined && p.precio !== null) {
        falla('precio', 'Un producto que no se vende solo no lleva precio');
      }
      return;
    }
    if (!p.seVendeSolo) falla('seVendeSolo', 'Un combo o un menú del día siempre se vende solo');
    if (p.precio === undefined || p.precio === null) {
      falla('precio', 'El precio es obligatorio en un combo o un menú del día');
    }
    if (p.estacionId !== undefined && p.estacionId !== null) {
      falla('estacionId', 'Un combo o un menú del día no tiene estación propia');
    }
    if (p.tipo === 'COMBO' && componentes + grupos === 0) {
      falla('componentes', 'Un combo necesita al menos un componente o un grupo de opciones');
    }
    if (p.tipo === 'MENU_DEL_DIA' && grupos === 0) {
      falla('gruposModificadores', 'Un menú del día necesita al menos un grupo (un tiempo)');
    }
  });

/**
 * `PATCH /carta/productos/:id` (criterios 10 a 11). Todo es opcional, pero al menos un campo distinto de
 * `confirmarPerdida`. Las reglas por tipo se comprueban en el servicio sobre el resultado de mezclar lo
 * guardado con lo enviado (criterio 10).
 */
export const productoModificarEntradaSchema = z
  .strictObject({
    /** Un tipo distinto del guardado es un cambio de tipo (criterio 10b). */
    tipo: tipoProductoSchema.optional(),
    nombre: textoSchema(100).optional(),
    descripcion: textoSchema(500).nullable().optional(),
    familiaId: uuidSchema.optional(),
    precio: montoSchema.nullable().optional(),
    seVendeSolo: z.boolean().optional(),
    afectacionIgv: afectacionIgvSchema.optional(),
    aplicaIcbper: z.boolean().optional(),
    estacionId: uuidSchema.nullable().optional(),
    tipoControlStock: tipoControlStockSchema.optional(),
    gruposModificadores: gruposModificadoresCampo.optional(),
    componentes: componentesCampo.optional(),
    activo: z.boolean().optional(),
    /** Confirma lo que `CONFIRMACION_REQUERIDA` listó en `seQuita` (criterio 10b). */
    confirmarPerdida: z.boolean().optional(),
  })
  .superRefine((cambios, ctx) => {
    const { confirmarPerdida, ...resto } = cambios;
    void confirmarPerdida;
    if (Object.values(resto).every((valor) => valor === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Envía al menos un campo', path: [] });
    }
    campoSinRepetidos(cambios, ctx);
  });

/** Dónde se usa un producto como componente o producto ligado (criterios 10c y 12). */
export const usadoEnSchema = z.object({
  combos: z.array(z.object({ id: uuidSchema, nombre: z.string() })),
  modificadores: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      grupoId: uuidSchema,
      grupoNombre: z.string(),
    }),
  ),
});

/** Lo que un cambio de tipo quitaría (criterio 10b). */
export const seQuitaSchema = z.object({
  estacion: z.object({ id: uuidSchema, nombre: z.string() }).nullable(),
  componentes: z.array(
    z.object({ productoId: uuidSchema, nombre: z.string(), cantidad: z.number().int() }),
  ),
  opcionesDelDia: z.array(
    z.object({
      sucursalId: uuidSchema,
      sucursalNombre: z.string(),
      dia: fechaSchema,
      opciones: z.number().int().nonnegative(),
    }),
  ),
});

export const productoResumenSchema = z.object({
  id: uuidSchema,
  tipo: tipoProductoSchema,
  nombre: z.string(),
  familiaId: uuidSchema,
  precio: z.string().nullable(),
  seVendeSolo: z.boolean(),
  estacionId: uuidSchema.nullable(),
  tipoControlStock: tipoControlStockSchema,
  fotoUrl: z.string().nullable(),
  activo: z.boolean(),
  orden: z.number().int(),
});

export const productoRespuestaSchema = productoResumenSchema.extend({
  descripcion: z.string().nullable(),
  afectacionIgv: afectacionIgvSchema,
  aplicaIcbper: z.boolean(),
  /** Grupos asignados, en orden. */
  grupos: z.array(z.object({ id: uuidSchema, nombre: z.string() })),
  componentes: z.array(
    z.object({ productoId: uuidSchema, nombre: z.string(), cantidad: z.number().int() }),
  ),
  usadoEn: usadoEnSchema,
  creadoEn: instanteSchema,
  actualizadoEn: instanteSchema,
});

/** `PUT /carta/productos/:id/foto` responde con la URL pública de la foto (criterio 14). */
export const fotoRespuestaSchema = z.object({ fotoUrl: z.string() });

// ---------------------------------------------------------------------------------------------------
// Ajuste por sucursal (criterios 18 a 23)
// ---------------------------------------------------------------------------------------------------

/** `PUT /carta/productos/:id/sucursales/:sucursalId`: `precio` `null` usa el de la empresa. */
export const ajusteSucursalEntradaSchema = z.strictObject({
  precio: montoSchema.nullable(),
  disponible: z.boolean(),
});

export const ajusteSucursalRespuestaSchema = z.object({
  sucursalId: uuidSchema,
  nombre: z.string(),
  precio: z.string().nullable(),
  precioEfectivo: z.string().nullable(),
  disponible: z.boolean(),
  agotado: z.boolean(),
  /** Si quien consulta puede ajustar esa sucursal (criterio 19b). */
  editable: z.boolean(),
});

// ---------------------------------------------------------------------------------------------------
// Grupos de modificadores (criterios 24 a 29)
// ---------------------------------------------------------------------------------------------------

/** Modificador de un grupo, en el orden en que se envía; `id` actualiza uno existente del mismo grupo. */
export const modificadorEntradaSchema = z.strictObject({
  id: uuidSchema.optional(),
  nombre: textoSchema(60),
  precioExtra: montoNoNegativoSchema.default('0.00'),
  /** Producto ligado (simple y activo) o `null`. */
  productoId: uuidSchema.nullable().default(null),
});

const modificadoresCampo = z
  .array(modificadorEntradaSchema)
  .min(1)
  .max(MAXIMO_MODIFICADORES_POR_GRUPO)
  .superRefine((modificadores, ctx) => {
    marcarRepetidos(
      modificadores,
      (m) => m.nombre.toLowerCase(),
      '',
      'Nombre repetido dentro del grupo',
      ctx,
    );
    marcarRepetidos(
      modificadores.filter((m) => m.id !== undefined),
      (m) => (m.id ?? '').toLowerCase(),
      '',
      'Modificador repetido',
      ctx,
    );
  });

const grupoUnicaSchema = z.strictObject({
  nombre: textoSchema(60),
  seleccion: z.literal('UNICA'),
  obligatorio: z.boolean(),
  modificadores: modificadoresCampo,
});

const grupoMultipleSchema = z
  .strictObject({
    nombre: textoSchema(60),
    seleccion: z.literal('MULTIPLE'),
    minimo: z.number().int().min(0).max(MAXIMO_MODIFICADORES_POR_GRUPO),
    maximo: z.number().int().min(1).max(MAXIMO_MODIFICADORES_POR_GRUPO),
    modificadores: modificadoresCampo,
  })
  .superRefine((grupo, ctx) => {
    const falla = fallaEn(ctx);
    if (grupo.minimo > grupo.maximo) falla('minimo', 'El mínimo no puede ser mayor que el máximo');
    if (grupo.minimo > grupo.modificadores.length) {
      falla('minimo', 'El mínimo no puede ser mayor que la cantidad de modificadores');
    }
  });

/** `POST /carta/grupos-modificadores`: unión discriminada por `seleccion` (criterios 24 y 25). */
export const grupoEntradaSchema = z.discriminatedUnion('seleccion', [
  grupoUnicaSchema,
  grupoMultipleSchema,
]);

/**
 * `PATCH /carta/grupos-modificadores/:id` (criterio 27): todo opcional, al menos un campo. Con
 * `seleccion` se envían sus campos (`UNICA`: `obligatorio`; `MULTIPLE`: `minimo` y `maximo`); sin ella, el
 * servicio los compara con la selección guardada.
 */
export const grupoModificarEntradaSchema = z
  .strictObject({
    nombre: textoSchema(60).optional(),
    seleccion: seleccionSchema.optional(),
    obligatorio: z.boolean().optional(),
    minimo: z.number().int().min(0).max(MAXIMO_MODIFICADORES_POR_GRUPO).optional(),
    maximo: z.number().int().min(1).max(MAXIMO_MODIFICADORES_POR_GRUPO).optional(),
    modificadores: modificadoresCampo.optional(),
    activo: z.boolean().optional(),
  })
  .superRefine((cambios, ctx) => {
    const falla = fallaEn(ctx);
    if (Object.values(cambios).every((valor) => valor === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Envía al menos un campo', path: [] });
    }
    if (cambios.seleccion === 'UNICA') {
      if (cambios.obligatorio === undefined) {
        falla('obligatorio', 'Indica si el grupo es obligatorio');
      }
      if (cambios.minimo !== undefined) falla('minimo', 'Una selección única no lleva mínimo');
      if (cambios.maximo !== undefined) falla('maximo', 'Una selección única no lleva máximo');
    }
    if (cambios.seleccion === 'MULTIPLE') {
      if (cambios.minimo === undefined) falla('minimo', 'Indica el mínimo');
      if (cambios.maximo === undefined) falla('maximo', 'Indica el máximo');
      if (cambios.obligatorio !== undefined) {
        falla('obligatorio', 'Una selección múltiple se obliga con el mínimo');
      }
    }
    if (
      cambios.minimo !== undefined &&
      cambios.maximo !== undefined &&
      cambios.minimo > cambios.maximo
    ) {
      falla('minimo', 'El mínimo no puede ser mayor que el máximo');
    }
    if (
      cambios.minimo !== undefined &&
      cambios.modificadores !== undefined &&
      cambios.minimo > cambios.modificadores.length
    ) {
      falla('minimo', 'El mínimo no puede ser mayor que la cantidad de modificadores');
    }
  });

export const grupoRespuestaSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  seleccion: seleccionSchema,
  minimo: z.number().int(),
  maximo: z.number().int(),
  /** `minimo` ≥ 1. */
  obligatorio: z.boolean(),
  activo: z.boolean(),
  /** Los modificadores activos, en su orden. */
  modificadores: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      precioExtra: z.string(),
      producto: z.object({ id: uuidSchema, nombre: z.string() }).nullable(),
      orden: z.number().int(),
    }),
  ),
  /** Los productos que usan el grupo. */
  productos: z.array(z.object({ id: uuidSchema, nombre: z.string() })),
});

// ---------------------------------------------------------------------------------------------------
// Vista de la sucursal y línea preparada (criterios 47 a 52)
// ---------------------------------------------------------------------------------------------------

export const agotadoDeVistaSchema = z.object({
  desde: instanteSchema,
  hasta: hastaAgotadoSchema,
  origen: origenAgotadoSchema,
});

export const productoDeVentaSchema = z.object({
  id: uuidSchema,
  tipo: tipoProductoSchema,
  nombre: z.string(),
  descripcion: z.string().nullable(),
  fotoUrl: z.string().nullable(),
  /** Precio efectivo en la sucursal; `null` si el producto no se vende solo. */
  precio: z.string().nullable(),
  seVendeSolo: z.boolean(),
  afectacionIgv: afectacionIgvSchema,
  aplicaIcbper: z.boolean(),
  estacionId: uuidSchema.nullable(),
  tipoControlStock: tipoControlStockSchema,
  agotado: agotadoDeVistaSchema.nullable(),
  vendible: z.boolean(),
  motivo: motivoNoVendibleSchema.nullable(),
  grupos: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      seleccion: seleccionSchema,
      minimo: z.number().int(),
      maximo: z.number().int(),
      obligatorio: z.boolean(),
      modificadores: z.array(
        z.object({
          id: uuidSchema,
          nombre: z.string(),
          precioExtra: z.string(),
          productoId: uuidSchema.nullable(),
          disponible: z.boolean(),
        }),
      ),
    }),
  ),
  componentes: z.array(
    z.object({
      productoId: uuidSchema,
      nombre: z.string(),
      cantidad: z.number().int(),
      estacionId: uuidSchema.nullable(),
      disponible: z.boolean(),
    }),
  ),
});

/** `GET /carta/sucursal` (criterio 47). */
export const cartaSucursalRespuestaSchema = z.object({
  sucursalId: uuidSchema,
  diaOperativo: fechaSchema,
  estaciones: z.array(z.object({ id: uuidSchema, nombre: z.string() })),
  familias: z.array(
    z.object({ id: uuidSchema, nombre: z.string(), productos: z.array(productoDeVentaSchema) }),
  ),
});

/** Lo que `CartaVentaService.prepararLinea` devuelve y la venta guarda "como era" (criterio 52). */
export const lineaPreparadaSchema = z.object({
  productoId: uuidSchema,
  nombre: z.string(),
  tipo: tipoProductoSchema,
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
  precioUnitario: z.string(),
  total: z.string(),
  afectacionIgv: afectacionIgvSchema,
  aplicaIcbper: z.boolean(),
  estacionId: uuidSchema.nullable(),
  tipoControlStock: tipoControlStockSchema,
  modificadores: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      grupoId: uuidSchema,
      grupoNombre: z.string(),
      precioExtra: z.string(),
      productoLigado: z
        .object({
          id: uuidSchema,
          nombre: z.string(),
          estacionId: uuidSchema.nullable(),
          tipoControlStock: tipoControlStockSchema,
        })
        .nullable(),
    }),
  ),
  componentes: z.array(
    z.object({
      productoId: uuidSchema,
      nombre: z.string(),
      cantidad: z.number().int(),
      estacionId: uuidSchema.nullable(),
      tipoControlStock: tipoControlStockSchema,
    }),
  ),
});

// ---------------------------------------------------------------------------------------------------
// Menú del día (criterios 34 a 38)
// ---------------------------------------------------------------------------------------------------

/** `GET /carta/sucursal/menu-del-dia?dia=AAAA-MM-DD`. */
export const menuDelDiaConsultaSchema = z.strictObject({ dia: fechaSchema.optional() });

/** `PUT /carta/sucursal/menu-del-dia/:productoId`: reemplaza las opciones de un día. */
export const menuDelDiaEntradaSchema = z
  .strictObject({ dia: fechaSchema.optional(), opciones: z.array(uuidSchema) })
  .superRefine((menu, ctx) => {
    marcarRepetidos(menu.opciones, (id) => id.toLowerCase(), 'opciones', 'Opción repetida', ctx);
  });

export const menuDelDiaRespuestaSchema = z.object({
  productoId: uuidSchema,
  nombre: z.string(),
  /** Precio efectivo en la sucursal. */
  precio: z.string().nullable(),
  dia: fechaSchema,
  grupos: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      minimo: z.number().int(),
      maximo: z.number().int(),
      opciones: z.array(
        z.object({
          modificadorId: uuidSchema,
          nombre: z.string(),
          precioExtra: z.string(),
          producto: z.object({ id: uuidSchema, nombre: z.string() }).nullable(),
          elegida: z.boolean(),
          disponible: z.boolean(),
        }),
      ),
    }),
  ),
});

// ---------------------------------------------------------------------------------------------------
// Agotados (criterios 39 a 44)
// ---------------------------------------------------------------------------------------------------

/** `PUT /carta/sucursal/agotados/:productoId`: `hasta` por defecto `FIN_DEL_DIA`. */
export const agotadoEntradaSchema = z.strictObject({
  hasta: hastaAgotadoSchema.default('FIN_DEL_DIA'),
});

export const agotadoRespuestaSchema = z.object({
  productoId: uuidSchema,
  sucursalId: uuidSchema,
  desde: instanteSchema,
  hasta: hastaAgotadoSchema,
  diaOperativo: fechaSchema,
  origen: origenAgotadoSchema,
});

// ---------------------------------------------------------------------------------------------------
// Eventos en tiempo real (criterios 46 y 54)
// ---------------------------------------------------------------------------------------------------

/** Datos de `carta.disponibilidad`; `hasta` y `origen` son `null` al reactivar. */
export const eventoDisponibilidadDatosSchema = z.object({
  sucursalId: uuidSchema,
  productoId: uuidSchema,
  agotado: z.boolean(),
  hasta: hastaAgotadoSchema.nullable(),
  origen: origenAgotadoSchema.nullable(),
});

/** Datos de `carta.actualizada`; `sucursalId` `null` = todas las sucursales de la empresa. */
export const eventoCartaActualizadaDatosSchema = z.object({ sucursalId: uuidSchema.nullable() });

export const salaDeEmpresaSchema = z.object({ tipo: z.literal('empresa') });
export const salaDeSucursalSchema = z.object({
  tipo: z.literal('sucursal'),
  sucursalId: uuidSchema,
});

/** Evento `carta.disponibilidad`: sala de la sucursal. */
export const eventoDisponibilidadSchema = z.object({
  empresaId: uuidSchema,
  sala: salaDeSucursalSchema,
  nombre: z.literal('carta.disponibilidad'),
  datos: eventoDisponibilidadDatosSchema,
});

/** Evento `carta.actualizada`: sala de la empresa o de una sucursal. */
export const eventoCartaActualizadaSchema = z.object({
  empresaId: uuidSchema,
  sala: z.union([salaDeEmpresaSchema, salaDeSucursalSchema]),
  nombre: z.literal('carta.actualizada'),
  datos: eventoCartaActualizadaDatosSchema,
});

export type EstacionEntrada = z.input<typeof estacionEntradaSchema>;
export type EstacionModificarEntrada = z.input<typeof estacionModificarEntradaSchema>;
export type EstacionRespuesta = z.infer<typeof estacionRespuestaSchema>;
export type FamiliaEntrada = z.input<typeof familiaEntradaSchema>;
export type FamiliaModificarEntrada = z.input<typeof familiaModificarEntradaSchema>;
export type FamiliaRespuesta = z.infer<typeof familiaRespuestaSchema>;
export type OrdenEntrada = z.input<typeof ordenEntradaSchema>;
export type ComponenteEntrada = z.input<typeof componenteEntradaSchema>;
export type ProductoCrearEntrada = z.input<typeof productoCrearEntradaSchema>;
export type ProductoCrearEntradaValidada = z.output<typeof productoCrearEntradaSchema>;
export type ProductoModificarEntrada = z.input<typeof productoModificarEntradaSchema>;
export type UsadoEn = z.infer<typeof usadoEnSchema>;
export type SeQuita = z.infer<typeof seQuitaSchema>;
export type ProductoResumen = z.infer<typeof productoResumenSchema>;
export type ProductoRespuesta = z.infer<typeof productoRespuestaSchema>;
export type FotoRespuesta = z.infer<typeof fotoRespuestaSchema>;
export type AjusteSucursalEntrada = z.input<typeof ajusteSucursalEntradaSchema>;
export type AjusteSucursalRespuesta = z.infer<typeof ajusteSucursalRespuestaSchema>;
export type ModificadorEntrada = z.input<typeof modificadorEntradaSchema>;
export type GrupoEntrada = z.input<typeof grupoEntradaSchema>;
export type GrupoEntradaValidada = z.output<typeof grupoEntradaSchema>;
export type GrupoModificarEntrada = z.input<typeof grupoModificarEntradaSchema>;
export type GrupoModificarEntradaValidada = z.output<typeof grupoModificarEntradaSchema>;
export type GrupoRespuesta = z.infer<typeof grupoRespuestaSchema>;
export type ProductoDeVenta = z.infer<typeof productoDeVentaSchema>;
export type CartaSucursalRespuesta = z.infer<typeof cartaSucursalRespuestaSchema>;
export type LineaPreparada = z.infer<typeof lineaPreparadaSchema>;
export type MenuDelDiaEntrada = z.input<typeof menuDelDiaEntradaSchema>;
export type MenuDelDiaRespuesta = z.infer<typeof menuDelDiaRespuestaSchema>;
export type AgotadoEntrada = z.input<typeof agotadoEntradaSchema>;
export type AgotadoEntradaValidada = z.output<typeof agotadoEntradaSchema>;
export type AgotadoRespuesta = z.infer<typeof agotadoRespuestaSchema>;
export type EventoDisponibilidad = z.infer<typeof eventoDisponibilidadSchema>;
export type EventoCartaActualizada = z.infer<typeof eventoCartaActualizadaSchema>;
