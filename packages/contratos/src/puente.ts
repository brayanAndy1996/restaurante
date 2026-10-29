import { z } from 'zod';
import { textoSchema, uuidSchema } from './comunes';
import {
  ESTADOS_REPORTADOS_IMPRESORA,
  MAXIMO_IMPRESORAS_LATIDO,
  anchoPapelSchema,
  conexionImpresoraSchema,
  juegoCaracteresSchema,
  tipoTrabajoSchema,
} from './impresion';

/**
 * Protocolo del puente de impresión, versión 1 (historia 004, entrega 3b). Es lo que implementan el simulador
 * de las pruebas (`SimuladorPuente`) y la app Android (entrega 3c), y lo que la API le sirve a ambos:
 *
 * 1. **Vincular.** La PWA muestra un QR con `restaurante-puente://vincular?api=<URL>&t=<token vi.…>`. El puente
 *    llama `POST /puente/vinculacion` con `Authorization: Bearer vi.…` y guarda el `token` `pu.…` de la respuesta.
 * 2. **Conectar.** Abre Socket.IO en `/tiempo-real`, espacio `/puente`, con `auth: { token: 'pu.…' }`. Recibe
 *    `trabajo.nuevo` y `puente.configuracion`.
 * 3. **Imprimir.** `GET /puente/trabajos` al conectarse, al recibir `trabajo.nuevo` y cada 30 segundos; manda los
 *    `bytes` (base64) por TCP a la impresora de cada trabajo, en el orden recibido, y reporta con
 *    `POST /puente/trabajos/:id/resultado`. La entrega es "al menos una vez": el puente recuerda los últimos 500
 *    ids impresos para no imprimir dos veces un trabajo repetido.
 * 4. **Latido.** `POST /puente/latido` cada 20 segundos y al cambiar algo.
 *
 * Toda petición lleva la cabecera `X-Puente-Protocolo: 1`. Todas las rutas salvo la vinculación llevan
 * `Authorization: Bearer pu.…`.
 */

/** Versión del protocolo; viaja en la cabecera `X-Puente-Protocolo`. */
export const VERSION_PROTOCOLO_PUENTE = 1;
export const CABECERA_PROTOCOLO_PUENTE = 'X-Puente-Protocolo';

/** Espacio de Socket.IO del puente (la ruta del servidor es `/tiempo-real`, la de la PWA es el espacio `/`). */
export const ESPACIO_PUENTE = '/puente';

/** Cada cuánto el puente pide trabajos aunque no reciba aviso y cada cuánto manda el latido (milisegundos). */
export const INTERVALO_PEDIR_TRABAJOS_MS = 30_000;
export const INTERVALO_LATIDO_MS = 20_000;

/** Trabajos que entrega `GET /puente/trabajos` de una vez y ids impresos que el puente recuerda. */
export const MAXIMO_TRABAJOS_ENTREGA = 50;
export const IDS_IMPRESOS_RECORDADOS = 500;

/** Cuánto tarda en darse por desconectado un puente sin señal (criterio 121) y cuánto dura una vinculación. */
export const SEGUNDOS_PUENTE_CONECTADO = 60;
export const MINUTOS_VIGENCIA_VINCULACION = 10;

/** Esquema del texto del QR de vinculación (criterio 106). */
export const ESQUEMA_QR_PUENTE = 'restaurante-puente:';

const tokenPuenteTextoSchema = z.string().min(1).max(300);

// ---------------------------------------------------------------------------------------------------
// El texto del QR
// ---------------------------------------------------------------------------------------------------

/** Arma el texto del QR: `restaurante-puente://vincular?api=<URL de la API>&t=<token de vinculación>`. */
export function armarQrPuente(api: string, token: string): string {
  return `${ESQUEMA_QR_PUENTE}//vincular?api=${encodeURIComponent(api)}&t=${encodeURIComponent(token)}`;
}

export interface QrPuente {
  /** URL base de la API, sin barra final. */
  api: string;
  /** Token `vi.…` de vinculación. */
  token: string;
}

/**
 * Lee el texto de un QR de vinculación. Devuelve `null` si no es uno (otro esquema, otra acción, falta la API o
 * el token, o la API no es una URL `http` o `https`). Es lo que hace el puente al escanear.
 */
export function leerQrPuente(texto: string): QrPuente | null {
  const recortado = texto.trim();
  if (!recortado.startsWith(`${ESQUEMA_QR_PUENTE}//vincular?`)) return null;
  const consulta = recortado.slice(recortado.indexOf('?') + 1);
  const parametros = new URLSearchParams(consulta);
  const api = parametros.get('api');
  const token = parametros.get('t');
  if (api === null || token === null || api === '' || token === '') return null;
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return { api: api.replace(/\/+$/, ''), token };
}

// ---------------------------------------------------------------------------------------------------
// Vincular y configuración (criterios 107 y 110)
// ---------------------------------------------------------------------------------------------------

/** `POST /puente/vinculacion` con `Authorization: Bearer vi.…`. */
export const vincularPuenteEntradaSchema = z.strictObject({
  nombreEquipo: textoSchema(60).optional(),
  modelo: textoSchema(60).optional(),
  versionApp: textoSchema(30),
});

/** Una impresora tal como la ve el puente: lo necesario para conectarse. */
export const impresoraDelPuenteSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  conexion: conexionImpresoraSchema,
  anchoMm: anchoPapelSchema,
  juegoCaracteres: juegoCaracteresSchema,
  gaveta: z.boolean(),
});

/** `GET /puente/configuracion`: las impresoras activas de la sucursal del puente. */
export const configuracionPuenteSchema = z.object({
  puente: z.object({ id: uuidSchema, nombre: z.string() }),
  sucursal: z.object({ id: uuidSchema, nombre: z.string() }),
  impresoras: z.array(impresoraDelPuenteSchema),
});

export const vincularPuenteRespuestaSchema = z.object({
  /** `pu.<empresaId>.<puenteId>.<secreto>`: el puente lo guarda y lo manda en cada petición. */
  token: tokenPuenteTextoSchema,
  puente: z.object({ id: uuidSchema, nombre: z.string() }),
  sucursal: z.object({ id: uuidSchema, nombre: z.string() }),
  configuracion: configuracionPuenteSchema,
});

// ---------------------------------------------------------------------------------------------------
// Trabajos, resultado y latido (criterios 113, 115 y 120)
// ---------------------------------------------------------------------------------------------------

/** Base64 estándar con relleno (lo que producen `Buffer.toString('base64')` y `Base64.NO_WRAP`). */
const base64Schema = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Debe ser base64');

/** Un trabajo de `GET /puente/trabajos`: los `bytes` ESC/POS ya vienen armados para esa impresora. */
export const trabajoParaImprimirSchema = z.object({
  id: uuidSchema,
  impresoraId: uuidSchema,
  tipo: tipoTrabajoSchema,
  creadoEn: z.iso.datetime(),
  bytes: base64Schema,
});

/**
 * `POST /puente/trabajos/:id/resultado`: `IMPRESO`, o `NO_IMPRESO` con el motivo (hasta 200 caracteres); en el
 * segundo caso el trabajo sigue pendiente y el puente reintenta.
 */
export const resultadoTrabajoEntradaSchema = z.discriminatedUnion('resultado', [
  z.strictObject({ resultado: z.literal('IMPRESO') }),
  z.strictObject({ resultado: z.literal('NO_IMPRESO'), error: textoSchema(200) }),
]);

/** `POST /puente/latido`: la versión de la app y el estado de cada impresora que el puente conoce. */
export const latidoEntradaSchema = z.strictObject({
  versionApp: textoSchema(30),
  impresoras: z
    .array(
      z.strictObject({
        id: uuidSchema,
        estado: z.enum(ESTADOS_REPORTADOS_IMPRESORA),
        error: textoSchema(200).optional(),
      }),
    )
    .max(MAXIMO_IMPRESORAS_LATIDO),
});

// ---------------------------------------------------------------------------------------------------
// Eventos del espacio `/puente` (criterios 110 y 112). Van a la sala del puente y llevan solo ids.
// ---------------------------------------------------------------------------------------------------

const salaDePuenteDeEventoSchema = z.object({ tipo: z.literal('puente'), puenteId: uuidSchema });

export const eventoTrabajoNuevoDatosSchema = z.object({ trabajoId: uuidSchema });
export const eventoPuenteConfiguracionDatosSchema = z.object({});

export const eventoTrabajoNuevoSchema = z.object({
  empresaId: uuidSchema,
  sala: salaDePuenteDeEventoSchema,
  nombre: z.literal('trabajo.nuevo'),
  datos: eventoTrabajoNuevoDatosSchema,
});

export const eventoPuenteConfiguracionSchema = z.object({
  empresaId: uuidSchema,
  sala: salaDePuenteDeEventoSchema,
  nombre: z.literal('puente.configuracion'),
  datos: eventoPuenteConfiguracionDatosSchema,
});

export type VincularPuenteEntrada = z.input<typeof vincularPuenteEntradaSchema>;
export type VincularPuenteRespuesta = z.infer<typeof vincularPuenteRespuestaSchema>;
export type ImpresoraDelPuente = z.infer<typeof impresoraDelPuenteSchema>;
export type ConfiguracionPuente = z.infer<typeof configuracionPuenteSchema>;
export type TrabajoParaImprimir = z.infer<typeof trabajoParaImprimirSchema>;
export type ResultadoTrabajoEntrada = z.input<typeof resultadoTrabajoEntradaSchema>;
export type LatidoEntrada = z.input<typeof latidoEntradaSchema>;
export type EventoTrabajoNuevo = z.infer<typeof eventoTrabajoNuevoSchema>;
export type EventoPuenteConfiguracion = z.infer<typeof eventoPuenteConfiguracionSchema>;
