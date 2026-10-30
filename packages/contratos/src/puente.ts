import { z } from 'zod';
import { textoSchema, uuidSchema } from './comunes';
import {
  ESTADOS_REPORTADOS_IMPRESORA,
  MAXIMO_IMPRESORAS_LATIDO,
  anchoPapelSchema,
  conexionImpresoraSchema,
  juegoCaracteresSchema,
  MAXIMO_BYTES_TICKET,
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
 * 3. **Imprimir.** `GET /puente/trabajos` al conectarse, al recibir `trabajo.nuevo` y cada 30 segundos (hasta
 *    `MAXIMO_TRABAJOS_POR_IMPRESORA` por impresora y `MAXIMO_BYTES_RESPUESTA_TRABAJOS` en total; un ticket pesa
 *    como máximo `MAXIMO_BYTES_TICKET`); manda los `bytes` (base64) por TCP a la impresora de cada trabajo, en el
 *    orden recibido, y reporta con `POST /puente/trabajos/:id/resultado`. La entrega es "al menos una vez": el puente
 *    recuerda los últimos 500 ids impresos para no imprimir dos veces un trabajo repetido.
 *
 *    **Regla de "Hay más".** Con un lote lleno (alguna impresora recibió `MAXIMO_TRABAJOS_POR_IMPRESORA`) o con la
 *    cabecera `X-Puente-Hay-Mas: 1`, el puente vuelve a pedir enseguida **solo si el lote anterior avanzó**, es decir,
 *    si terminó algún trabajo: lo imprimió, o confirmó con `IMPRESO` que ya estaba impreso. Si no avanzó (impresora
 *    apagada o en espera, Bluetooth, impresora desconocida) no repite: espera el intervalo normal de 30 segundos (o el
 *    aviso `trabajo.nuevo`). Así un lote que no puede salir nunca hace un ciclo de peticiones sin pausa.
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

/**
 * Trabajos que entrega `GET /puente/trabajos` de una vez **por impresora** (en orden de creación dentro de cada una;
 * una impresora con muchos trabajos sin imprimir no frena a las demás) y ids impresos que el puente recuerda. Si el
 * puente recibe esa cantidad para alguna impresora, vuelve a pedir en cuanto termine el lote. No se entregan
 * trabajos de impresoras inactivas ni Bluetooth (en 3b) ni los que no se pudieron armar.
 */
export const MAXIMO_TRABAJOS_POR_IMPRESORA = 20;

/**
 * Tope de bytes ESC/POS (ya decodificados) de una respuesta de `GET /puente/trabajos`, sumados los de todos los
 * trabajos. Siempre sale al menos un trabajo de cada impresora que tenga pendientes aunque por sí solo lo pase
 * (un ticket largo no se queda sin entregar); los trabajos de una impresora salen en orden, así que lo que no
 * entra sale en la siguiente llamada. Cuando quedó algo sin entrar por este tope, la respuesta lleva la cabecera
 * `X-Puente-Hay-Mas: 1`, y el puente vuelve a pedir enseguida si el lote avanzó (ver "Regla de Hay más" arriba).
 * Como ningún ticket pasa de `MAXIMO_BYTES_TICKET` (256 KB), una respuesta pesa a lo más este tope más un ticket
 * (alrededor de 1,25 MB de bytes, 1,7 MB en base64).
 */
export const MAXIMO_BYTES_RESPUESTA_TRABAJOS = 1_000_000;
export const CABECERA_HAY_MAS_TRABAJOS = 'X-Puente-Hay-Mas';
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

/** Largo máximo del texto de un QR de vinculación que `leerQrPuente` acepta leer. */
export const MAXIMO_LARGO_QR_PUENTE = 4096;

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
  // El texto de un QR de vinculación mide unos cientos de caracteres; uno enorme no es un QR de vinculación.
  if (texto.length > MAXIMO_LARGO_QR_PUENTE) return null;
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

/** Largo máximo del base64 de un ticket: `MAXIMO_BYTES_TICKET` bytes, a 4 caracteres por cada 3 bytes. */
export const MAXIMO_LARGO_BASE64_TICKET = Math.ceil(MAXIMO_BYTES_TICKET / 3) * 4;

/**
 * `true` si el texto es base64 estándar con relleno (lo que producen `Buffer.toString('base64')` y
 * `Base64.NO_WRAP`). Es una comprobación lineal y sin recursión: una expresión regular con un grupo repetido
 * (`(?:[A-Za-z0-9+/]{4})*`) desborda la pila de V8 con textos de unos 3 MB (ronda 3 del ataque de 3b).
 */
export function esBase64(texto: string): boolean {
  const largo = texto.length;
  if (largo % 4 !== 0) return false;
  let fin = largo;
  if (fin > 0 && texto.charCodeAt(fin - 1) === 61) {
    fin -= 1;
    if (texto.charCodeAt(fin - 1) === 61) fin -= 1;
  }
  for (let i = 0; i < fin; i += 1) {
    const c = texto.charCodeAt(i);
    const valido =
      (c >= 65 && c <= 90) || // A-Z
      (c >= 97 && c <= 122) || // a-z
      (c >= 48 && c <= 57) || // 0-9
      c === 43 || // +
      c === 47; // /
    if (!valido) return false;
  }
  return true;
}

/** Base64 de los bytes de un ticket: hasta `MAXIMO_LARGO_BASE64_TICKET` caracteres, validado sin recursión. */
const base64Schema = z
  .string()
  .max(MAXIMO_LARGO_BASE64_TICKET, 'El ticket pesa más que MAXIMO_BYTES_TICKET')
  // Con más de `max` el largo ya se rechazó arriba: no se recorre un texto enorme una segunda vez.
  .refine(
    (texto) => texto.length > MAXIMO_LARGO_BASE64_TICKET || esBase64(texto),
    'Debe ser base64',
  );

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
