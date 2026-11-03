import { Buffer } from 'node:buffer';
import type { NextFunction, Request, Response } from 'express';
import { ErrorAplicacion } from '../errores/error-aplicacion';

/**
 * Las rutas públicas de la carta web y del modo mesa (historia 005, criterios 16 y 17): todo lo que cuelga de
 * `/publico/`. Aquí viven las dos reglas que `crearAplicacion` aplica solo a ellas: el CORS del origen de la carta
 * web y el tope de 16 KB de los `POST`.
 */

/** Prefijo de las rutas públicas. */
export const PREFIJO_PUBLICO = '/publico/';

/** Tamaño máximo del cuerpo de un `POST` público (criterio 17): un pedido grande cabe con holgura en 16 KB. */
export const LIMITE_CUERPO_PUBLICO_BYTES = 16 * 1024;

/**
 * La ruta (sin query ni fragmento) de la URL de una petición. Acepta también la forma absoluta de la línea de
 * petición (`POST http://host/publico/…`), que Express enruta igual que la relativa.
 */
function rutaDe(url: string): string {
  const sinQuery = url.split(/[?#]/, 1)[0] ?? '';
  if (sinQuery.startsWith('/')) return sinQuery;
  try {
    return new URL(url).pathname;
  } catch {
    return sinQuery;
  }
}

/**
 * `true` si la URL de la petición es de una ruta pública (con o sin query). **No distingue mayúsculas**: el
 * enrutador de Express tampoco (`/PUBLICO/mesas/…` llega al mismo controlador que `/publico/mesas/…`), así que el
 * tope de 16 KB y el CORS de la carta web tienen que tratarlas igual.
 */
export function esRutaPublica(url: string | undefined): boolean {
  if (url === undefined) return false;
  return rutaDe(url).toLowerCase().startsWith(PREFIJO_PUBLICO);
}

/** El origen (`esquema://host:puerto`) de una URL, o `undefined` si no hay URL o no es válida. */
export function origenDe(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

const demasiadoGrande = () =>
  new ErrorAplicacion(
    413,
    'CUERPO_DEMASIADO_GRANDE',
    `El cuerpo de la petición supera el límite de ${LIMITE_CUERPO_PUBLICO_BYTES / 1024} KB`,
  );

const esPostPublico = (peticion: Request): boolean =>
  peticion.method === 'POST' && esRutaPublica(peticion.originalUrl ?? peticion.url);

/**
 * Antes del analizador de cuerpos: un `POST` público que declara más de 16 KB (`Content-Length`) responde 413 sin
 * leer el cuerpo y sin tocar la base.
 */
export function limitarCuerpoPublico() {
  return (peticion: Request, _respuesta: Response, siguiente: NextFunction): void => {
    if (esPostPublico(peticion)) {
      const declarado = Number(peticion.headers['content-length']);
      if (Number.isFinite(declarado) && declarado > LIMITE_CUERPO_PUBLICO_BYTES) {
        siguiente(demasiadoGrande());
        return;
      }
    }
    siguiente();
  };
}

/**
 * `verify` de los analizadores de cuerpo (`json` y `urlencoded`): recibe los **bytes** que llegaron (también cuando
 * el cuerpo viene por partes, sin `Content-Length`, y ya descomprimidos si traía `Content-Encoding`) y rechaza con
 * 413 un `POST` público de más de 16 KB. Mide lo recibido, no el JSON ya analizado: un cuerpo con escapes `\u`
 * (6 bytes por carácter) pesa mucho más en el cable que su resultado. Las demás rutas no se miden aquí (su límite
 * es el de 100 KB del analizador).
 */
export function verificarCuerpoPublico(
  peticion: Request,
  _respuesta: Response,
  cuerpo: Buffer,
): void {
  if (esPostPublico(peticion) && cuerpo.length > LIMITE_CUERPO_PUBLICO_BYTES) {
    throw demasiadoGrande();
  }
}
