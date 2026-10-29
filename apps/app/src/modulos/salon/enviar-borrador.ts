import type { EnvioRespuesta } from '@restaurante/contratos';
import type { QueryClient } from '@tanstack/react-query';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { enviarSinPerder } from '../../lib/envios';
import { ErrorApi, mensajeDeCampo, mensajeDeError } from '../../lib/errores';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import {
  aLineaDeEnvio,
  cambiarBorrador,
  cambiarEstadoDeEnvio,
  borrarBorrador,
  leerBorrador,
  leerEstadoDeEnvio,
  type AvisoDeEnvio,
} from './borrador';
import { enviarComanda } from './ordenes';

/**
 * Envía el borrador de una cuenta (criterios 15, 26 y 92 de 004). Vive fuera de los componentes a propósito:
 * si el mozo sale de la pantalla mientras el envío espera la red, el envío sigue su camino y, al terminar,
 * deja el borrador como corresponde; no depende de que haya una pantalla montada.
 *
 * - El id del envío se genera una vez y se guarda con el borrador antes de mandar nada; "Reintentar el envío"
 *   y la recarga lo reutilizan, así el servidor reconoce el mismo envío y no sale dos veces a cocina.
 * - Va por `enviarSinPerder`, la cola de "Pendiente de envío": una clave de idempotencia por intento lógico y
 *   reintentos con ella si la red no responde.
 * - Solo un rechazo que demuestra que el envío no se guardó libera el id: los 422 por línea o por datos
 *   (`DATOS_INVALIDOS`, `PRODUCTO_NO_VENDIBLE`, `SELECCION_INVALIDA`, `MONTO_FUERA_DE_RANGO`) y el 409 de una
 *   orden que ya no está abierta (`ORDEN_NO_ABIERTA`). Entonces deja las líneas y marca las que no pasaron
 *   con su motivo. Todo lo demás no prueba nada: sin red, error del servidor y también un 403 (`PROHIBIDO`,
 *   `MODULO_NO_INCLUIDO`) o un 409 `SUCURSAL_NO_ELEGIDA`, que la API evalúa antes de reconocer una réplica;
 *   si el primer intento sí se guardó, soltar el id duplicaría la comanda. El id se conserva, se dice el
 *   motivo y la cuenta ofrece "Reintentar el envío".
 */

export type ResultadoDeEnvio =
  | { resultado: 'enviado'; envio: EnvioRespuesta }
  /** La cuenta se unió a otra (criterio 29): el borrador sigue y hay que llevarlo a `ordenId`. */
  | { resultado: 'otra-orden'; ordenId: string }
  /** El servidor rechazó el envío y no guardó nada: el borrador sigue, con lo rechazado marcado. */
  | { resultado: 'rechazado' }
  /** No se sabe si llegó: queda "Reintentar el envío" con el mismo id. */
  | { resultado: 'fallo' }
  /** Ya hay un envío en curso o no hay nada que enviar. */
  | { resultado: 'nada' };

const FRASES_DE_RECHAZO: readonly (readonly [string, string])[] = [
  ['COMPONENTE_NO_DISPONIBLE', 'Falta un componente del producto'],
  ['MODIFICADOR_NO_DISPONIBLE', 'Una opción elegida ya no está disponible'],
  ['MODIFICADOR_DESCONOCIDO', 'Una opción elegida ya no existe'],
  ['MODIFICADOR_REPETIDO', 'Una opción está repetida'],
  ['MENOS_DEL_MINIMO', 'Faltan opciones por elegir'],
  ['MAS_DEL_MAXIMO', 'Elegiste más opciones de las permitidas'],
  ['MENU_SIN_ARMAR', 'El menú de hoy no está armado'],
  ['OPCIONES_INSUFICIENTES', 'Faltan opciones disponibles'],
  ['NO_SE_VENDE_SOLO', 'Este producto no se vende solo'],
  ['MONTO_FUERA_DE_RANGO', 'El monto pasa del máximo permitido'],
  ['REFERENCIA_INVALIDA', 'Este producto ya no está en la carta'],
  ['AGOTADO', 'Agotado'],
  ['INACTIVO', 'Ya no está en la carta'],
  ['NO_DISPONIBLE', 'No disponible en esta sucursal'],
];

/**
 * El motivo de una línea rechazada, en palabras. La API lo manda como código ("AGOTADO",
 * "COMPONENTE_NO_DISPONIBLE: …"); si llega otra cosa, se muestra tal cual salvo que sea un mensaje genérico en
 * inglés, que se reemplaza por uno neutro.
 */
export function textoDeRechazo(mensaje: string): string {
  for (const [codigo, frase] of FRASES_DE_RECHAZO) {
    if (new RegExp(`(?<![A-Z_])${codigo}(?![A-Z_])`).test(mensaje)) return frase;
  }
  return mensajeDeCampo(mensaje);
}

const MENSAJES = {
  ORDEN_NO_ABIERTA: 'Esta cuenta ya no está abierta, así que no se puede enviar nada.',
  NO_ENCONTRADO: 'Esta cuenta ya no existe.',
  PRODUCTO_NO_VENDIBLE: 'Algunos productos ya no se pueden vender.',
  SELECCION_INVALIDA: 'Algunas opciones elegidas ya no son válidas.',
  MONTO_FUERA_DE_RANGO: 'El total de la cuenta pasaría del máximo permitido.',
  CLAVE_IDEMPOTENCIA_REUTILIZADA:
    'Este envío ya se había hecho con otros datos. Mira la cuenta antes de volver a enviar.',
  CONFLICTO: 'Otra persona estaba enviando a la misma cuenta. Vuelve a intentarlo.',
  MODULO_NO_INCLUIDO: 'El salón no está incluido en tu plan.',
  PROHIBIDO: 'Tu usuario ya no puede enviar pedidos.',
  SUCURSAL_NO_ELEGIDA: 'Elige una sucursal para poder enviar el pedido.',
} as const;

/** Los 422 con los que la API rechaza el contenido del envío antes de guardar nada. */
const CODIGOS_DE_RECHAZO_DEL_CONTENIDO: ReadonlySet<string> = new Set([
  'DATOS_INVALIDOS',
  'PRODUCTO_NO_VENDIBLE',
  'SELECCION_INVALIDA',
  'MONTO_FUERA_DE_RANGO',
]);

/**
 * ¿La respuesta demuestra que el envío no se guardó? Solo entonces es seguro soltar el id. Un 403 o un 409 de
 * sucursal no lo demuestran: la API los decide antes de mirar si el id ya existía.
 */
export function demuestraQueNoSeGuardo(error: ErrorApi): boolean {
  if (error.estado === 422) return CODIGOS_DE_RECHAZO_DEL_CONTENIDO.has(error.codigo);
  if (error.estado === 409) return error.codigo === 'ORDEN_NO_ABIERTA';
  return false;
}

/** Las líneas rechazadas (`lineas.<i>`) con su motivo, por posición en lo que se envió. */
function rechazosPorLinea(error: ErrorApi): Map<number, string> {
  const mapa = new Map<number, string>();
  for (const campo of error.campos) {
    const m = /^lineas\.(\d+)/.exec(campo.campo);
    if (m && !mapa.has(Number(m[1]))) mapa.set(Number(m[1]), textoDeRechazo(campo.mensaje));
  }
  return mapa;
}

/** Libera el id del envío: el servidor no guardó nada, el próximo "Enviar" genera otro. */
function liberarEnvio(clave: string): void {
  cambiarBorrador(clave, (b) => ({ ...b, envioId: null }));
}

function aviso(tipo: AvisoDeEnvio['tipo'], titulo: string, detalle: string): AvisoDeEnvio {
  return { tipo, titulo, detalle };
}

/** Qué hacer con un envío que falló: ajusta el borrador y dice qué pasó. */
function alFallar(clave: string, error: unknown): ResultadoDeEnvio {
  if (!(error instanceof ErrorApi)) {
    cambiarEstadoDeEnvio(clave, {
      aviso: aviso(
        'alerta',
        'No sabemos si el pedido salió',
        'Reintenta el envío: no se duplicará.',
      ),
    });
    return { resultado: 'fallo' };
  }

  if (!demuestraQueNoSeGuardo(error)) {
    const sinRed = error.sinConexion;
    // Un 4xx que no prueba nada (permiso, plan, sucursal): se dice el motivo y se conserva el id.
    const rechazoSinPrueba = error.estado >= 400 && error.estado < 500;
    cambiarEstadoDeEnvio(clave, {
      aviso: rechazoSinPrueba
        ? aviso(
            'alerta',
            'No pudimos confirmar el envío',
            `${mensajeDeError(error, MENSAJES)} Reintenta el envío: si el pedido ya había llegado, no se duplicará.`,
          )
        : error.codigo === 'ENVIO_CANCELADO'
          ? aviso(
              'alerta',
              'El pedido no salió',
              `${error.message} Reintenta el envío: no se duplicará.`,
            )
          : aviso(
              'alerta',
              sinRed ? 'No hay conexión' : 'No sabemos si el pedido salió',
              'Reintenta el envío: si ya había llegado, no se duplicará.',
            ),
    });
    return { resultado: 'fallo' };
  }

  if (error.codigo === 'ORDEN_NO_ABIERTA' && error.ordenId) {
    liberarEnvio(clave);
    return { resultado: 'otra-orden', ordenId: error.ordenId };
  }

  liberarEnvio(clave);
  const rechazos = rechazosPorLinea(error);
  if (rechazos.size > 0) {
    cambiarBorrador(clave, (b) => ({
      ...b,
      lineas: b.lineas.map((l, i) => {
        const { rechazo: _previo, ...resto } = l;
        const motivo = rechazos.get(i);
        return motivo ? { ...resto, rechazo: motivo } : resto;
      }),
    }));
    const n = rechazos.size;
    cambiarEstadoDeEnvio(clave, {
      aviso: aviso(
        'error',
        'No se envió nada a cocina',
        n === 1
          ? 'Una línea no pasó. Corrígela o quítala, y vuelve a enviar.'
          : `${n} líneas no pasaron. Corrígelas o quítalas, y vuelve a enviar.`,
      ),
    });
    return { resultado: 'rechazado' };
  }

  cambiarEstadoDeEnvio(clave, {
    aviso: aviso('error', 'No se envió nada a cocina', mensajeDeError(error, MENSAJES)),
  });
  return { resultado: 'rechazado' };
}

/**
 * Manda el borrador de `clave` a la cuenta `ordenId`. Con el borrador vacío o con otro envío en curso no hace
 * nada. Nunca lanza: el resultado dice qué pasó y el borrador y el aviso quedan en `useBorrador`.
 */
export async function enviarBorrador({
  clave,
  ordenId,
  clientes,
}: {
  clave: string;
  ordenId: string;
  clientes: QueryClient;
}): Promise<ResultadoDeEnvio> {
  // Un envío en vuelo (o esperando la red) tiene su fase; no se manda otro encima.
  if (leerEstadoDeEnvio(clave).fase !== null) return { resultado: 'nada' };
  const actual = leerBorrador(clave);
  if (actual.lineas.length === 0) return { resultado: 'nada' };

  // El id se guarda antes de mandar nada: si la página se recarga, el reintento lo reutiliza.
  const envioId = actual.envioId ?? nuevaClaveDeIdempotencia();
  cambiarBorrador(clave, (b) => ({
    envioId,
    lineas: b.lineas.map(({ rechazo: _quitado, ...l }) => l),
  }));
  cambiarEstadoDeEnvio(clave, { fase: 'enviando', aviso: null });
  const entrada = { id: envioId, lineas: actual.lineas.map(aLineaDeEnvio) };

  try {
    const envio = await enviarSinPerder((extra) => enviarComanda(ordenId, entrada, extra), {
      alCambiar: (pendiente) =>
        cambiarEstadoDeEnvio(clave, { fase: pendiente ? 'esperando-red' : 'enviando' }),
    });
    borrarBorrador(clave);
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
    return { resultado: 'enviado', envio };
  } catch (error) {
    void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
    return alFallar(clave, error);
  } finally {
    cambiarEstadoDeEnvio(clave, { fase: null });
  }
}
