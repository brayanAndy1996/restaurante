import { DESTINOS_COMANDA, TIPOS_COMANDA } from '@restaurante/dominio';
import { z } from 'zod';
import {
  MENSAJE_NUL,
  MENSAJE_SUSTITUTO_SUELTO,
  sinNul,
  sinSustitutosSueltos,
  textoSchema,
  uuidSchema,
} from './comunes';

/**
 * Contratos de la impresión (historia 004, entrega 3b): impresoras, destino de cada estación, impresora de caja,
 * vinculación y lista de puentes, estado de la impresión, trabajos y el documento lógico del ticket. El protocolo
 * del puente (lo que implementan el simulador y la app Android) está en `puente.ts`.
 *
 * Las entradas son estrictas (un campo desconocido es 400) y ninguna acepta `empresaId` ni `sucursalId`. La API
 * devuelve todos los ids en minúsculas y los instantes en ISO 8601.
 */

const instanteSchema = z.iso.datetime();

// ---------------------------------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------------------------------

/** Juegos de caracteres de una impresora (criterios 103 y 123); `SIN_TILDES` transliteración a ASCII. */
export const JUEGOS_CARACTERES = ['PC850', 'PC858', 'WPC1252', 'PC437', 'SIN_TILDES'] as const;
export type JuegoCaracteres = (typeof JUEGOS_CARACTERES)[number];
export const JUEGO_CARACTERES_POR_DEFECTO: JuegoCaracteres = 'PC850';

/** Anchos de papel en milímetros y sus columnas con la fuente A (criterio 123). */
export const ANCHOS_PAPEL_MM = [58, 80] as const;
export type AnchoPapelMm = (typeof ANCHOS_PAPEL_MM)[number];
export const COLUMNAS_POR_ANCHO: Readonly<Record<AnchoPapelMm, number>> = { 58: 32, 80: 48 };

/** Cómo se conecta una impresora. En 3b solo `RED` imprime; `BLUETOOTH` se guarda (decisión 12). */
export const TIPOS_CONEXION = ['RED', 'BLUETOOTH'] as const;
export type TipoConexion = (typeof TIPOS_CONEXION)[number];

/** Puerto por defecto de una impresora de red (ESC/POS crudo). */
export const PUERTO_IMPRESORA_POR_DEFECTO = 9100;

/** Adónde sale la comanda de una estación (el mismo catálogo de `packages/dominio`). */
export const destinoEstacionSchema = z.enum(DESTINOS_COMANDA);

/** Lo que se imprime: una comanda de estación, una pre-cuenta o la página de prueba (criterios 114 y 127). */
export const TIPOS_TRABAJO = [...TIPOS_COMANDA, 'PRECUENTA', 'PRUEBA'] as const;
export type TipoTrabajo = (typeof TIPOS_TRABAJO)[number];
export const tipoTrabajoSchema = z.enum(TIPOS_TRABAJO);

/** Estado de un trabajo: `VENCIDO` se calcula al leer, cuando pasó el día operativo (criterio 117). */
export const ESTADOS_TRABAJO = ['PENDIENTE', 'IMPRESO', 'VENCIDO'] as const;
export type EstadoTrabajo = (typeof ESTADOS_TRABAJO)[number];
export const estadoTrabajoSchema = z.enum(ESTADOS_TRABAJO);

/** Estado de una impresora que ve la app (criterio 121). */
export const ESTADOS_IMPRESORA = ['LISTA', 'NO_RESPONDE', 'DESCONOCIDO'] as const;
export type EstadoImpresora = (typeof ESTADOS_IMPRESORA)[number];
export const estadoImpresoraSchema = z.enum(ESTADOS_IMPRESORA);

/** Lo que el puente puede reportar de una impresora en el latido (criterio 120). */
export const ESTADOS_REPORTADOS_IMPRESORA = ['LISTA', 'NO_RESPONDE'] as const;

/** Máximo de impresoras por sucursal que el puente reporta en un latido. */
export const MAXIMO_IMPRESORAS_LATIDO = 50;

// ---------------------------------------------------------------------------------------------------
// Impresoras (criterios 103 a 105)
// ---------------------------------------------------------------------------------------------------

const ETIQUETA_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** `true` si es una dirección IPv4 válida (`192.168.1.50`), sin ceros a la izquierda. */
export const esIpv4 = (texto: string): boolean => IPV4.test(texto);

/**
 * Nombre de un equipo de la red: una IPv4 o un nombre de hasta 253 caracteres de etiquetas separadas por punto
 * (letras, números y guiones, sin empezar ni terminar en guion, hasta 63 por etiqueta). Un texto de solo
 * números y puntos que no es una IPv4 válida (`999.1.1.1`) se rechaza.
 */
export function esHostValido(texto: string): boolean {
  if (texto.length === 0 || texto.length > 253) return false;
  if (esIpv4(texto)) return true;
  const etiquetas = texto.split('.');
  if (!etiquetas.every((e) => ETIQUETA_HOST.test(e))) return false;
  // La última etiqueta no puede ser solo números: sería una IP mal escrita.
  return !/^\d+$/.test(etiquetas[etiquetas.length - 1]!);
}

export const hostImpresoraSchema = z
  .string()
  .refine(
    esHostValido,
    'Debe ser una IPv4 (192.168.1.50) o un nombre de equipo de hasta 253 caracteres',
  );

export const puertoImpresoraSchema = z.number().int().min(1).max(65535);

/** Dirección Bluetooth `AA:BB:CC:DD:EE:FF`; acepta minúsculas y la guarda en mayúsculas. */
export const macBluetoothSchema = z
  .string()
  .regex(/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, 'Debe tener el formato AA:BB:CC:DD:EE:FF')
  .transform((mac) => mac.toUpperCase());

export const conexionImpresoraEntradaSchema = z.discriminatedUnion('tipo', [
  z.strictObject({
    tipo: z.literal('RED'),
    host: hostImpresoraSchema,
    puerto: puertoImpresoraSchema.default(PUERTO_IMPRESORA_POR_DEFECTO),
  }),
  z.strictObject({ tipo: z.literal('BLUETOOTH'), mac: macBluetoothSchema }),
]);

/** La conexión tal como la devuelve la API (siempre con el puerto y la dirección normalizada). */
export const conexionImpresoraSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('RED'), host: z.string(), puerto: z.number().int() }),
  z.object({ tipo: z.literal('BLUETOOTH'), mac: z.string() }),
]);

export const anchoPapelSchema = z.union([z.literal(58), z.literal(80)]);
export const juegoCaracteresSchema = z.enum(JUEGOS_CARACTERES);

/** `POST /sucursales/:sucursalId/impresoras`. */
export const impresoraEntradaSchema = z.strictObject({
  nombre: textoSchema(40),
  conexion: conexionImpresoraEntradaSchema,
  anchoMm: anchoPapelSchema,
  juegoCaracteres: juegoCaracteresSchema.default(JUEGO_CARACTERES_POR_DEFECTO),
  gaveta: z.boolean().default(false),
});

/** `PATCH /sucursales/:sucursalId/impresoras/:id`: al menos un campo; `conexion` se reemplaza entera. */
export const impresoraModificarEntradaSchema = z
  .strictObject({
    nombre: textoSchema(40).optional(),
    conexion: conexionImpresoraEntradaSchema.optional(),
    anchoMm: anchoPapelSchema.optional(),
    juegoCaracteres: juegoCaracteresSchema.optional(),
    gaveta: z.boolean().optional(),
    activa: z.boolean().optional(),
  })
  .refine(
    (c) =>
      c.nombre !== undefined ||
      c.conexion !== undefined ||
      c.anchoMm !== undefined ||
      c.juegoCaracteres !== undefined ||
      c.gaveta !== undefined ||
      c.activa !== undefined,
    'Envía al menos un campo',
  );

export const impresoraRespuestaSchema = z.object({
  id: uuidSchema,
  sucursalId: uuidSchema,
  nombre: z.string(),
  conexion: conexionImpresoraSchema,
  anchoMm: anchoPapelSchema,
  juegoCaracteres: juegoCaracteresSchema,
  gaveta: z.boolean(),
  activa: z.boolean(),
  estado: estadoImpresoraSchema,
  /** Desde cuándo está en ese estado; `null` si nunca se reportó. */
  estadoDesde: instanteSchema.nullable(),
  /** Trabajos `PENDIENTE` en cola para esta impresora (criterio 105). */
  pendientes: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------------------------------
// Destino de cada estación e impresora de caja (criterios 99 a 102)
// ---------------------------------------------------------------------------------------------------

/** `PUT /sucursales/:sucursalId/estaciones-destino/:estacionId`. */
export const estacionDestinoEntradaSchema = z.discriminatedUnion('destino', [
  z.strictObject({ destino: z.literal('KDS') }),
  z.strictObject({ destino: z.literal('IMPRESORA'), impresoraId: uuidSchema }),
]);

export const estacionDestinoRespuestaSchema = z.object({
  estacionId: uuidSchema,
  nombre: z.string(),
  destino: destinoEstacionSchema,
  impresora: z.object({ id: uuidSchema, nombre: z.string() }).nullable(),
});

/** `PUT /sucursales/:sucursalId/impresion`: la impresora de la pre-cuenta, o `null` para ninguna. */
export const impresionSucursalEntradaSchema = z.strictObject({
  impresoraCajaId: uuidSchema.nullable(),
});

/** `GET` y `PUT /sucursales/:sucursalId/impresion`. */
export const impresionSucursalRespuestaSchema = z.object({
  impresoraCajaId: uuidSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Vincular el puente y sus puentes (criterios 106 a 108)
// ---------------------------------------------------------------------------------------------------

/** `POST /sucursales/:sucursalId/vinculaciones-puente`. */
export const vinculacionRespuestaSchema = z.object({
  /** `vi.<empresaId>.<vinculacionId>.<secreto>`, de un solo uso. */
  token: z.string(),
  /** El texto que la PWA dibuja como QR: `restaurante-puente://vincular?api=<URL>&t=<token>`. */
  qr: z.string(),
  expiraEn: instanteSchema,
});

export const puenteRespuestaSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  /** `false` si lo reemplazó otra vinculación o lo revocó el Administrador. */
  activo: z.boolean(),
  modelo: z.string().nullable(),
  versionApp: z.string().nullable(),
  vinculadoEn: instanteSchema,
  revocadoEn: instanteSchema.nullable(),
  ultimaSenalEn: instanteSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Estado de la impresión y trabajos (criterios 105, 121 y 128)
// ---------------------------------------------------------------------------------------------------

/** `GET /impresion/estado` (criterio 121). */
export const estadoImpresionRespuestaSchema = z.object({
  /** Hora de la API, para que la PWA calcule "sin señal hace 2 min" sin fiarse de su reloj. */
  ahora: instanteSchema,
  puente: z
    .object({
      id: uuidSchema,
      nombre: z.string(),
      ultimaSenalEn: instanteSchema.nullable(),
      /** Hubo señal en los últimos 60 segundos. */
      conectado: z.boolean(),
    })
    .nullable(),
  impresoras: z.array(
    z.object({
      id: uuidSchema,
      nombre: z.string(),
      estado: estadoImpresoraSchema,
      estadoDesde: instanteSchema.nullable(),
      pendientes: z.number().int().nonnegative(),
    }),
  ),
});

/** `GET /impresion/trabajos?desde=&estado=` (criterio 128): los trabajos del día operativo de la sucursal activa. */
export const trabajosConsultaSchema = z.strictObject({
  desde: instanteSchema.optional(),
  estado: estadoTrabajoSchema.optional(),
});

export const trabajoResumenSchema = z.object({
  id: uuidSchema,
  tipo: tipoTrabajoSchema,
  impresora: z.object({ id: uuidSchema, nombre: z.string() }),
  /** Nombres de las mesas de la cuenta separados por coma; `null` en la página de prueba. */
  mesa: z.string().nullable(),
  estado: estadoTrabajoSchema,
  intentos: z.number().int().nonnegative(),
  creadoEn: instanteSchema,
  impresoEn: instanteSchema.nullable(),
  /** El trabajo del que es reimpresión, si lo es. */
  reimpresionDe: uuidSchema.nullable(),
});

/** Respuesta de la página de prueba y de la reimpresión (criterios 127 y 128). */
export const trabajoCreadoRespuestaSchema = z.object({ trabajoId: uuidSchema });

// ---------------------------------------------------------------------------------------------------
// Documento lógico del ticket (criterio 126)
// ---------------------------------------------------------------------------------------------------

/** Versión del formato del documento; el renderizador rechaza una que no conozca. */
export const VERSION_DOCUMENTO_TICKET = 1;

/** Bloques que puede llevar un documento y largo de cada texto. */
export const MAXIMO_BLOQUES_TICKET = 600;
export const LARGO_TEXTO_TICKET = 200;
export const SANGRIA_MAXIMA_TICKET = 8;
export const LINEAS_MAXIMAS_ESPACIO_TICKET = 10;

/** Texto de un ticket: puede ser vacío (línea en blanco), sin NUL ni sustitutos sueltos ni saltos de línea. */
const textoDeTicketSchema = z
  .string()
  .max(LARGO_TEXTO_TICKET)
  .refine(sinNul, MENSAJE_NUL)
  .refine(sinSustitutosSueltos, MENSAJE_SUSTITUTO_SUELTO)
  .refine((t) => !/[\r\n]/.test(t), 'No puede contener saltos de línea');

const alineacionTicketSchema = z.enum(['izquierda', 'centro', 'derecha']);

/**
 * Un bloque del documento:
 * - `titulo`: texto en negrita y doble alto (por defecto centrado).
 * - `linea`: un texto que se ajusta al ancho sin partir palabras, con `sangria` columnas a la izquierda.
 * - `columnas`: `izquierda` y `derecha` en la misma línea (la derecha alineada al borde; si no caben, la
 *   izquierda continúa en las líneas siguientes).
 * - `marca`: un aviso destacado y centrado entre guiones ("PARA LLEVAR", "ESPERAR", "REIMPRESIÓN").
 * - `regla`: una línea de `-` o `=` de todo el ancho.
 * - `espacio`: líneas en blanco.
 */
export const bloqueTicketSchema = z.discriminatedUnion('tipo', [
  z.strictObject({
    tipo: z.literal('titulo'),
    texto: textoDeTicketSchema,
    alinear: alineacionTicketSchema.optional(),
  }),
  z.strictObject({
    tipo: z.literal('linea'),
    texto: textoDeTicketSchema,
    negrita: z.boolean().optional(),
    dobleAlto: z.boolean().optional(),
    alinear: alineacionTicketSchema.optional(),
    sangria: z.number().int().min(0).max(SANGRIA_MAXIMA_TICKET).optional(),
  }),
  z.strictObject({
    tipo: z.literal('columnas'),
    izquierda: textoDeTicketSchema,
    derecha: textoDeTicketSchema,
    negrita: z.boolean().optional(),
    dobleAlto: z.boolean().optional(),
  }),
  z.strictObject({ tipo: z.literal('marca'), texto: textoDeTicketSchema }),
  z.strictObject({ tipo: z.literal('regla'), caracter: z.enum(['-', '=']).optional() }),
  z.strictObject({
    tipo: z.literal('espacio'),
    lineas: z.number().int().min(1).max(LINEAS_MAXIMAS_ESPACIO_TICKET).optional(),
  }),
]);

/**
 * El documento lógico que guarda cada trabajo (criterio 126): no son bytes. El renderizador de la API lo
 * convierte en ESC/POS al entregarlo, con el ancho y el juego de caracteres vigentes de la impresora.
 */
export const documentoTicketSchema = z.strictObject({
  version: z.literal(VERSION_DOCUMENTO_TICKET),
  tipo: tipoTrabajoSchema,
  bloques: z.array(bloqueTicketSchema).min(1).max(MAXIMO_BLOQUES_TICKET),
});

// ---------------------------------------------------------------------------------------------------
// Eventos en tiempo real (criterios 110, 112 y 120). Llevan solo ids (criterio 69).
// ---------------------------------------------------------------------------------------------------

export const eventoImpresionEstadoDatosSchema = z.object({ sucursalId: uuidSchema });

export const eventoImpresionEstadoSchema = z.object({
  empresaId: uuidSchema,
  sala: z.object({ tipo: z.literal('sucursal'), sucursalId: uuidSchema }),
  nombre: z.literal('impresion.estado'),
  datos: eventoImpresionEstadoDatosSchema,
});

export type ConexionImpresoraEntrada = z.input<typeof conexionImpresoraEntradaSchema>;
export type ConexionImpresora = z.infer<typeof conexionImpresoraSchema>;
export type ImpresoraEntrada = z.input<typeof impresoraEntradaSchema>;
export type ImpresoraEntradaValidada = z.output<typeof impresoraEntradaSchema>;
export type ImpresoraModificarEntrada = z.input<typeof impresoraModificarEntradaSchema>;
export type ImpresoraModificarEntradaValidada = z.output<typeof impresoraModificarEntradaSchema>;
export type ImpresoraRespuesta = z.infer<typeof impresoraRespuestaSchema>;
export type EstacionDestinoEntrada = z.input<typeof estacionDestinoEntradaSchema>;
export type EstacionDestinoRespuesta = z.infer<typeof estacionDestinoRespuestaSchema>;
export type ImpresionSucursalEntrada = z.input<typeof impresionSucursalEntradaSchema>;
export type ImpresionSucursalRespuesta = z.infer<typeof impresionSucursalRespuestaSchema>;
export type VinculacionRespuesta = z.infer<typeof vinculacionRespuestaSchema>;
export type PuenteRespuesta = z.infer<typeof puenteRespuestaSchema>;
export type EstadoImpresionRespuesta = z.infer<typeof estadoImpresionRespuestaSchema>;
export type TrabajosConsulta = z.input<typeof trabajosConsultaSchema>;
export type TrabajoResumen = z.infer<typeof trabajoResumenSchema>;
export type TrabajoCreadoRespuesta = z.infer<typeof trabajoCreadoRespuestaSchema>;
export type BloqueTicket = z.infer<typeof bloqueTicketSchema>;
export type DocumentoTicket = z.infer<typeof documentoTicketSchema>;
export type EventoImpresionEstado = z.infer<typeof eventoImpresionEstadoSchema>;
