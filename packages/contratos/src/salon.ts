import {
  CAPACIDAD_MAXIMA_MESA,
  CANALES_ORDEN,
  COLUMNAS_MAXIMAS_ZONA,
  COLUMNAS_MINIMAS_ZONA,
  DESTINOS_COMANDA,
  DESTINOS_STOCK,
  ESTADOS_ITEM,
  ESTADOS_LINEA_ELEGIBLES,
  ESTADOS_LINEA_KDS,
  ESTADOS_MESA,
  ESTADOS_ORDEN,
  FILAS_MAXIMAS_ZONA,
  FILAS_MINIMAS_ZONA,
  FORMAS_MESA,
  LARGO_OBSERVACION,
  MAXIMO_COMENSALES,
  MAXIMO_LINEAS_ENVIO,
  MAXIMO_MESAS_ORDEN,
  MAXIMO_MODIFICADORES_LINEA,
  MINIMO_COMENSALES,
  CANTIDAD_MAXIMA_LINEA,
  ROLES_PARTE,
  TIPOS_COMANDA,
  TIPOS_ORDEN,
} from '@restaurante/dominio';
import { z } from 'zod';
import { tipoProductoSchema } from './carta';
import { montoNoNegativoSchema, motivoSchema, textoSchema, uuidSchema } from './comunes';

/**
 * Contratos de Salón y Cocina (historia 004, entrega 3a): zonas y mesas, el mapa con estados, órdenes,
 * envíos, marchas, anulaciones, mover y unir, pre-cuentas, la pantalla de cocina, el stock del comandero y los
 * eventos en tiempo real. Las entradas son estrictas (un campo desconocido es 400) y ninguna acepta
 * `empresaId`, `sucursalId` de la sesión, `creadoPor*` ni `actualizadoPor*`. Los montos viajan como texto
 * decimal con 2 decimales. Los ids que genera la PWA (`id` de orden, envío, marcha, anulación y pre-cuenta) son
 * UUID; la API devuelve todos los ids en minúsculas.
 */

const instanteSchema = z.iso.datetime();

/** Enumeraciones del catálogo de `packages/dominio`. */
export const estadoOrdenSchema = z.enum(ESTADOS_ORDEN);
export const tipoOrdenSchema = z.enum(TIPOS_ORDEN);
export const canalOrdenSchema = z.enum(CANALES_ORDEN);
export const estadoMesaSchema = z.enum(ESTADOS_MESA);
export const formaMesaSchema = z.enum(FORMAS_MESA);
export const estadoItemSchema = z.enum(ESTADOS_ITEM);
export const tiempoServicioSchema = z.union([z.literal(1), z.literal(2)]);
export const tipoComandaSchema = z.enum(TIPOS_COMANDA);
export const destinoComandaSchema = z.enum(DESTINOS_COMANDA);
export const rolParteSchema = z.enum(ROLES_PARTE);
export const estadoLineaKdsSchema = z.enum(ESTADOS_LINEA_KDS);
export const destinoStockSchema = z.enum(DESTINOS_STOCK);

/** Referencia a una persona o a una mesa dentro de una respuesta. */
export const personaRefSchema = z.object({ id: uuidSchema, nombre: z.string() });
export const mesaRefSchema = z.object({ id: uuidSchema, nombre: z.string() });

/** Marca como repetido cada id que ya apareció antes (sin distinguir mayúsculas). */
function sinRepetir(ids: readonly string[] | undefined, campo: string, ctx: z.RefinementCtx): void {
  if (ids === undefined) return;
  const vistos = new Set<string>();
  ids.forEach((id, indice) => {
    const clave = id.toLowerCase();
    if (vistos.has(clave)) {
      ctx.addIssue({ code: 'custom', message: 'Id repetido', path: [campo, indice] });
    }
    vistos.add(clave);
  });
}

/**
 * Lista de ids en un parámetro de la URL (`?productoIds=a,b` o `?productoIds=a&productoIds=b`): acepta el texto
 * separado por comas o una lista de textos, y entrega la lista de UUID. Cada id se valida como `uuidSchema`.
 */
export function listaDeIdsEnUrlSchema(maximo: number) {
  return z.preprocess((valor) => {
    const textos = Array.isArray(valor) ? valor : valor === undefined ? [] : [valor];
    return textos.flatMap((t) =>
      typeof t === 'string' ? t.split(',').filter((parte) => parte !== '') : [t],
    );
  }, z.array(uuidSchema).max(maximo));
}

// ---------------------------------------------------------------------------------------------------
// Zonas y mesas (criterios 1 a 6)
// ---------------------------------------------------------------------------------------------------

const columnasZonaSchema = z.number().int().min(COLUMNAS_MINIMAS_ZONA).max(COLUMNAS_MAXIMAS_ZONA);
const filasZonaSchema = z.number().int().min(FILAS_MINIMAS_ZONA).max(FILAS_MAXIMAS_ZONA);

export const zonaEntradaSchema = z.strictObject({
  nombre: textoSchema(40),
  columnas: columnasZonaSchema,
  filas: filasZonaSchema,
});

export const zonaModificarEntradaSchema = z
  .strictObject({
    nombre: textoSchema(40).optional(),
    columnas: columnasZonaSchema.optional(),
    filas: filasZonaSchema.optional(),
    activa: z.boolean().optional(),
  })
  .refine(
    (c) =>
      c.nombre !== undefined ||
      c.columnas !== undefined ||
      c.filas !== undefined ||
      c.activa !== undefined,
    'Envía al menos un campo',
  );

/**
 * Celda de la cuadrícula: la columna y la fila cuentan desde 1 (la primera celda es columna 1, fila 1) y deben
 * caer dentro de las `columnas` y `filas` de la zona, lo que comprueba el servicio.
 */
const columnaMesaSchema = z.number().int().min(1).max(COLUMNAS_MAXIMAS_ZONA);
const filaMesaSchema = z.number().int().min(1).max(FILAS_MAXIMAS_ZONA);
const capacidadMesaSchema = z.number().int().min(1).max(CAPACIDAD_MAXIMA_MESA);

export const mesaEntradaSchema = z.strictObject({
  nombre: textoSchema(20),
  capacidad: capacidadMesaSchema,
  forma: formaMesaSchema,
  columna: columnaMesaSchema,
  fila: filaMesaSchema,
});

export const mesaModificarEntradaSchema = z
  .strictObject({
    nombre: textoSchema(20).optional(),
    capacidad: capacidadMesaSchema.optional(),
    forma: formaMesaSchema.optional(),
    zonaId: uuidSchema.optional(),
    columna: columnaMesaSchema.optional(),
    fila: filaMesaSchema.optional(),
    activa: z.boolean().optional(),
  })
  .refine(
    (c) =>
      c.nombre !== undefined ||
      c.capacidad !== undefined ||
      c.forma !== undefined ||
      c.zonaId !== undefined ||
      c.columna !== undefined ||
      c.fila !== undefined ||
      c.activa !== undefined,
    'Envía al menos un campo',
  );

export const mesaRespuestaSchema = z.object({
  id: uuidSchema,
  zonaId: uuidSchema,
  nombre: z.string(),
  capacidad: z.number().int(),
  forma: formaMesaSchema,
  columna: z.number().int(),
  fila: z.number().int(),
  activa: z.boolean(),
});

export const zonaRespuestaSchema = z.object({
  id: uuidSchema,
  sucursalId: uuidSchema,
  nombre: z.string(),
  orden: z.number().int(),
  columnas: z.number().int(),
  filas: z.number().int(),
  activa: z.boolean(),
  mesas: z.array(mesaRespuestaSchema),
});

// ---------------------------------------------------------------------------------------------------
// El mapa con estados y el stock del comandero (criterios 7, 8 y 73)
// ---------------------------------------------------------------------------------------------------

/** La orden abierta de una mesa en el mapa; `mesas` son todas las mesas de la cuenta (mesas unidas). */
export const ordenDeMesaSchema = z.object({
  id: uuidSchema,
  mozo: personaRefSchema,
  comensales: z.number().int(),
  abiertaEn: instanteSchema,
  total: z.string(),
  mesas: z.array(mesaRefSchema),
});

export const mesaDelSalonSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  capacidad: z.number().int(),
  forma: formaMesaSchema,
  columna: z.number().int(),
  fila: z.number().int(),
  estado: estadoMesaSchema,
  orden: ordenDeMesaSchema.nullable(),
});

/** `GET /salon`: las zonas activas de la sucursal activa con sus mesas activas y su estado. */
export const salonRespuestaSchema = z.object({
  sucursalId: uuidSchema,
  /** Hora de la API (para que la PWA calcule "hace 25 min" sin fiarse del reloj del equipo). */
  ahora: instanteSchema,
  /**
   * Las personas que pueden ser el mozo responsable al abrir una mesa (criterio 10, decisión 8): usuarios activos
   * que atienden mesas en la sucursal activa, los mismos que `POST /ordenes` acepta como `mozoId`, por nombre.
   */
  mozos: z.array(personaRefSchema),
  zonas: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      columnas: z.number().int(),
      filas: z.number().int(),
      mesas: z.array(mesaDelSalonSchema),
    }),
  ),
});

/** `GET /salon/stock?productoIds=…` (criterio 73). */
export const stockSalonConsultaSchema = z.strictObject({
  productoIds: listaDeIdsEnUrlSchema(200),
});

export const stockSalonRespuestaSchema = z.object({
  productos: z.array(z.object({ productoId: uuidSchema, disponible: z.number().nonnegative() })),
});

// ---------------------------------------------------------------------------------------------------
// Órdenes (criterios 9, 13 y 55)
// ---------------------------------------------------------------------------------------------------

const comensalesSchema = z.number().int().min(MINIMO_COMENSALES).max(MAXIMO_COMENSALES);

/** `POST /ordenes`: `id` lo genera la PWA; `mozoId` es la persona responsable si no es quien abre (criterio 10). */
export const abrirOrdenEntradaSchema = z.strictObject({
  id: uuidSchema,
  mesaId: uuidSchema,
  comensales: comensalesSchema,
  mozoId: uuidSchema.optional(),
});

/** `PATCH /ordenes/:id` (criterio 13). */
export const ordenModificarEntradaSchema = z.strictObject({ comensales: comensalesSchema });

/** Cuántas líneas de comanda de un ítem están en cada estado de cocina. */
export const cocinaDeItemSchema = z.object({
  enviado: z.number().int().nonnegative(),
  enPreparacion: z.number().int().nonnegative(),
  listo: z.number().int().nonnegative(),
  anulado: z.number().int().nonnegative(),
});

export const itemRespuestaSchema = z.object({
  id: uuidSchema,
  envioNumero: z.number().int(),
  esAdicion: z.boolean(),
  productoId: uuidSchema,
  nombre: z.string(),
  tipo: tipoProductoSchema,
  cantidad: z.number().int(),
  cantidadAnulada: z.number().int(),
  cantidadVigente: z.number().int(),
  precioUnitario: z.string(),
  totalVigente: z.string(),
  modificadores: z.array(z.object({ nombre: z.string(), precioExtra: z.string() })),
  componentes: z.array(z.object({ nombre: z.string(), cantidad: z.number().int() })),
  observacion: z.string().nullable(),
  tiempo: tiempoServicioSchema,
  paraLlevar: z.boolean(),
  marchadoEn: instanteSchema.nullable(),
  estado: estadoItemSchema,
  cocina: cocinaDeItemSchema,
  /** Quién lo envió; `null` si lo envió una sesión de soporte (que no es una persona de la empresa). */
  comandadoPor: personaRefSchema.nullable(),
  enviadoEn: instanteSchema,
});

export const precuentaVigenteSchema = z.object({
  id: uuidSchema,
  numero: z.number().int(),
  total: z.string(),
  emitidaEn: instanteSchema,
});

/** `GET /ordenes/:id` y respuesta de apertura, anulación y liberación (criterio 55). */
export const ordenRespuestaSchema = z.object({
  id: uuidSchema,
  sucursalId: uuidSchema,
  tipo: tipoOrdenSchema,
  canal: canalOrdenSchema,
  estado: estadoOrdenSchema,
  mesas: z.array(mesaRefSchema),
  mozo: personaRefSchema,
  comensales: z.number().int(),
  abiertaEn: instanteSchema,
  anuladaEn: instanteSchema.nullable(),
  sinConsumo: z.boolean(),
  /** La orden a la que se unió, si esta quedó `UNIDA`. */
  unidaA: uuidSchema.nullable(),
  items: z.array(itemRespuestaSchema),
  total: z.string(),
  precuentaVigente: precuentaVigenteSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Enviar la comanda y marchar (criterios 15 a 33)
// ---------------------------------------------------------------------------------------------------

/**
 * Una línea del envío (criterio 15). `modificadorIds` es obligatorio (lista vacía si no hay), de hasta 30 y sin
 * repetir; `cantidad`, entero de 1 a 999; `observacion`, de 1 a 140 caracteres o ausente; `tiempo`, 1 por
 * defecto; `paraLlevar`, `false` por defecto.
 */
export const lineaEnvioEntradaSchema = z
  .strictObject({
    productoId: uuidSchema,
    modificadorIds: z.array(uuidSchema).max(MAXIMO_MODIFICADORES_LINEA),
    cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
    observacion: textoSchema(LARGO_OBSERVACION).optional(),
    tiempo: tiempoServicioSchema.default(1),
    paraLlevar: z.boolean().default(false),
  })
  .superRefine((linea, ctx) => sinRepetir(linea.modificadorIds, 'modificadorIds', ctx));

/** `POST /ordenes/:id/envios`: `id` lo genera la PWA y se conserva hasta que el envío termina. */
export const envioEntradaSchema = z.strictObject({
  id: uuidSchema,
  lineas: z.array(lineaEnvioEntradaSchema).min(1).max(MAXIMO_LINEAS_ENVIO),
});

/** Resumen de una comanda de estación creada por un envío, una marcha o una anulación. */
export const comandaResumenSchema = z.object({
  id: uuidSchema,
  estacionId: uuidSchema,
  estacionNombre: z.string(),
  tipo: tipoComandaSchema,
  destino: destinoComandaSchema,
  /** El motivo de la anulación en las comandas `ANULACION` (criterio 38); `null` en las demás. */
  motivo: z.string().nullable(),
});

export const envioRespuestaSchema = z.object({
  id: uuidSchema,
  ordenId: uuidSchema,
  numero: z.number().int(),
  esAdicion: z.boolean(),
  items: z.array(itemRespuestaSchema),
  comandas: z.array(comandaResumenSchema),
});

/** `POST /ordenes/:id/marchas`: sin `itemIds`, se marchan todos los ítems de segundo tiempo por marchar. */
export const marchaEntradaSchema = z
  .strictObject({
    id: uuidSchema,
    itemIds: z.array(uuidSchema).min(1).max(500).optional(),
  })
  .superRefine((marcha, ctx) => sinRepetir(marcha.itemIds, 'itemIds', ctx));

export const marchaRespuestaSchema = z.object({
  id: uuidSchema,
  comandas: z.array(comandaResumenSchema),
});

// ---------------------------------------------------------------------------------------------------
// Anular un ítem o la orden y liberar la mesa (criterios 35 a 44)
// ---------------------------------------------------------------------------------------------------

/** `POST /ordenes/:id/items/:itemId/anulaciones`: la cantidad no puede pasar de la vigente (lo comprueba el servicio). */
export const anularItemEntradaSchema = z.strictObject({
  id: uuidSchema,
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
  motivo: motivoSchema,
  destinoStock: destinoStockSchema,
});

export const anulacionRespuestaSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  cantidad: z.number().int(),
  motivo: z.string(),
  destinoStock: destinoStockSchema,
  /** El supervisor que dio la clave; `null` si quien anuló no la necesitaba. */
  autorizadoPor: personaRefSchema.nullable(),
  item: itemRespuestaSchema,
  comandas: z.array(comandaResumenSchema),
});

/** `POST /ordenes/:id/anulacion`. */
export const anularOrdenEntradaSchema = z.strictObject({
  motivo: motivoSchema,
  destinoStock: destinoStockSchema,
});

// ---------------------------------------------------------------------------------------------------
// Mover y unir mesas (criterios 45 a 49)
// ---------------------------------------------------------------------------------------------------

/** `POST /ordenes/:id/movimiento`: `mesaOrigenId` es obligatoria si la orden tiene varias mesas (lo comprueba el servicio). */
export const moverEntradaSchema = z.strictObject({
  mesaOrigenId: uuidSchema.optional(),
  mesaDestinoId: uuidSchema,
});

/** `POST /ordenes/:id/union`: de 1 a 19 mesas (la orden puede tener hasta 20). */
export const unirEntradaSchema = z
  .strictObject({
    mesaIds: z
      .array(uuidSchema)
      .min(1)
      .max(MAXIMO_MESAS_ORDEN - 1),
  })
  .superRefine((union, ctx) => sinRepetir(union.mesaIds, 'mesaIds', ctx));

// ---------------------------------------------------------------------------------------------------
// Pre-cuenta (criterios 50 a 54)
// ---------------------------------------------------------------------------------------------------

/** `POST /ordenes/:id/precuentas`: `id` lo genera la PWA. */
export const precuentaEntradaSchema = z.strictObject({ id: uuidSchema });

export const precuentaRespuestaSchema = z.object({
  id: uuidSchema,
  numero: z.number().int(),
  emitidaEn: instanteSchema,
  orden: z.object({
    id: uuidSchema,
    mesas: z.array(mesaRefSchema),
    mozo: personaRefSchema,
    comensales: z.number().int(),
  }),
  lineas: z.array(
    z.object({
      itemId: uuidSchema,
      nombre: z.string(),
      /** Nombres de los modificadores elegidos (su precio extra ya está en `precioUnitario`). */
      modificadores: z.array(z.string()),
      cantidad: z.number().int(),
      precioUnitario: montoNoNegativoSchema,
      total: z.string(),
    }),
  ),
  total: z.string(),
  /** "Precios con IGV incluido. No es un comprobante de pago." y, con ICBPER, "El ICBPER se suma al cobrar.". */
  nota: z.string(),
});

// ---------------------------------------------------------------------------------------------------
// Cocina: pantalla KDS (criterios 56 a 63)
// ---------------------------------------------------------------------------------------------------

/** `GET /cocina/comandas?estacionIds=…`: sin `estacionIds`, todas las estaciones activas. */
export const cocinaConsultaSchema = z.strictObject({
  estacionIds: listaDeIdsEnUrlSchema(100),
});

/** `PUT /cocina/lineas/:id/estado`: `ANULADO` no se elige desde la pantalla. */
export const estadoLineaEntradaSchema = z.strictObject({ estado: z.enum(ESTADOS_LINEA_ELEGIBLES) });

export const lineaKdsSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  rol: rolParteSchema,
  nombre: z.string(),
  /** El combo o el producto del que sale la parte. */
  contexto: z.string().nullable(),
  /** Cantidad vigente de la parte. */
  cantidad: z.number().int(),
  /** Nombres de los modificadores. */
  modificadores: z.array(z.string()),
  observacion: z.string().nullable(),
  tiempo: tiempoServicioSchema,
  esperar: z.boolean(),
  paraLlevar: z.boolean(),
  estado: estadoLineaKdsSchema,
});

export const comandaKdsSchema = z.object({
  id: uuidSchema,
  tipo: tipoComandaSchema,
  creadaEn: instanteSchema,
  vistaEn: instanteSchema.nullable(),
  /** El motivo de la anulación en las comandas `ANULACION` (criterio 38); `null` en las demás. */
  motivo: z.string().nullable(),
  estacion: z.object({ id: uuidSchema, nombre: z.string() }),
  orden: z.object({
    id: uuidSchema,
    mesas: z.array(mesaRefSchema),
    mozo: personaRefSchema,
    comensales: z.number().int(),
  }),
  lineas: z.array(lineaKdsSchema),
});

export const cocinaRespuestaSchema = z.object({
  ahora: instanteSchema,
  pendientes: z.array(comandaKdsSchema),
  recientes: z.array(comandaKdsSchema),
});

// ---------------------------------------------------------------------------------------------------
// Eventos en tiempo real (criterios 14, 31, 32, 38, 58 y 60). Todos van a la sala de la sucursal y llevan
// solo ids, estados y los nombres que necesita el aviso (criterio 69).
// ---------------------------------------------------------------------------------------------------

const salaDeSucursalDeEventoSchema = z.object({
  tipo: z.literal('sucursal'),
  sucursalId: uuidSchema,
});

function eventoDeSucursal<N extends string, D extends z.ZodType>(nombre: N, datos: D) {
  return z.object({
    empresaId: uuidSchema,
    sala: salaDeSucursalDeEventoSchema,
    nombre: z.literal(nombre),
    datos,
  });
}

export const eventoSalonCambioDatosSchema = z.object({
  mesaIds: z.array(uuidSchema),
  ordenId: uuidSchema,
});
export const eventoOrdenCambioDatosSchema = z.object({ ordenId: uuidSchema });
export const eventoCocinaComandaDatosSchema = z.object({
  comandaId: uuidSchema,
  estacionId: uuidSchema,
  tipo: tipoComandaSchema,
});
export const eventoCocinaLineaDatosSchema = z.object({
  comandaId: uuidSchema,
  lineaId: uuidSchema,
  estado: estadoLineaKdsSchema,
});
export const eventoCocinaListoDatosSchema = z.object({
  ordenId: uuidSchema,
  itemId: uuidSchema,
  lineaId: uuidSchema,
  mesas: z.array(mesaRefSchema),
  nombre: z.string(),
  cantidad: z.number().int(),
  /** El mozo responsable de la orden y quien comandó el ítem, sin repetir. */
  destinatarios: z.array(uuidSchema),
});

export const eventoSalonCambioSchema = eventoDeSucursal(
  'salon.cambio',
  eventoSalonCambioDatosSchema,
);
export const eventoOrdenCambioSchema = eventoDeSucursal(
  'orden.cambio',
  eventoOrdenCambioDatosSchema,
);
export const eventoCocinaComandaSchema = eventoDeSucursal(
  'cocina.comanda',
  eventoCocinaComandaDatosSchema,
);
export const eventoCocinaLineaSchema = eventoDeSucursal(
  'cocina.linea',
  eventoCocinaLineaDatosSchema,
);
export const eventoCocinaListoSchema = eventoDeSucursal(
  'cocina.listo',
  eventoCocinaListoDatosSchema,
);

export type ZonaEntrada = z.input<typeof zonaEntradaSchema>;
export type ZonaModificarEntrada = z.input<typeof zonaModificarEntradaSchema>;
export type ZonaRespuesta = z.infer<typeof zonaRespuestaSchema>;
export type MesaEntrada = z.input<typeof mesaEntradaSchema>;
export type MesaModificarEntrada = z.input<typeof mesaModificarEntradaSchema>;
export type MesaRespuesta = z.infer<typeof mesaRespuestaSchema>;
export type SalonRespuesta = z.infer<typeof salonRespuestaSchema>;
export type MesaDelSalon = z.infer<typeof mesaDelSalonSchema>;
export type StockSalonConsulta = z.input<typeof stockSalonConsultaSchema>;
export type StockSalonRespuesta = z.infer<typeof stockSalonRespuestaSchema>;
export type AbrirOrdenEntrada = z.input<typeof abrirOrdenEntradaSchema>;
export type OrdenModificarEntrada = z.input<typeof ordenModificarEntradaSchema>;
export type ItemRespuesta = z.infer<typeof itemRespuestaSchema>;
export type OrdenRespuesta = z.infer<typeof ordenRespuestaSchema>;
export type LineaEnvioEntrada = z.input<typeof lineaEnvioEntradaSchema>;
export type LineaEnvioEntradaValidada = z.output<typeof lineaEnvioEntradaSchema>;
export type EnvioEntrada = z.input<typeof envioEntradaSchema>;
export type EnvioEntradaValidada = z.output<typeof envioEntradaSchema>;
export type ComandaResumen = z.infer<typeof comandaResumenSchema>;
export type EnvioRespuesta = z.infer<typeof envioRespuestaSchema>;
export type MarchaEntrada = z.input<typeof marchaEntradaSchema>;
export type MarchaRespuesta = z.infer<typeof marchaRespuestaSchema>;
export type AnularItemEntrada = z.input<typeof anularItemEntradaSchema>;
export type AnulacionRespuesta = z.infer<typeof anulacionRespuestaSchema>;
export type AnularOrdenEntrada = z.input<typeof anularOrdenEntradaSchema>;
export type MoverEntrada = z.input<typeof moverEntradaSchema>;
export type UnirEntrada = z.input<typeof unirEntradaSchema>;
export type PrecuentaEntrada = z.input<typeof precuentaEntradaSchema>;
export type PrecuentaRespuesta = z.infer<typeof precuentaRespuestaSchema>;
export type CocinaConsulta = z.input<typeof cocinaConsultaSchema>;
export type EstadoLineaEntrada = z.input<typeof estadoLineaEntradaSchema>;
export type LineaKds = z.infer<typeof lineaKdsSchema>;
export type ComandaKds = z.infer<typeof comandaKdsSchema>;
export type CocinaRespuesta = z.infer<typeof cocinaRespuestaSchema>;
export type EventoSalonCambio = z.infer<typeof eventoSalonCambioSchema>;
export type EventoOrdenCambio = z.infer<typeof eventoOrdenCambioSchema>;
export type EventoCocinaComanda = z.infer<typeof eventoCocinaComandaSchema>;
export type EventoCocinaLinea = z.infer<typeof eventoCocinaLineaSchema>;
export type EventoCocinaListo = z.infer<typeof eventoCocinaListoSchema>;
