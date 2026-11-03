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

/** `true` si la URL de la petición es de una ruta pública (con o sin query). */
export function esRutaPublica(url: string | undefined): boolean {
  if (url === undefined) return false;
  const ruta = url.split('?', 1)[0] ?? '';
  return ruta.startsWith(PREFIJO_PUBLICO);
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
 * Después del analizador de cuerpos: un `POST` público sin `Content-Length` (cuerpo por partes, que el analizador
 * deja pasar hasta 100 KB) con más de 16 KB leídos también responde 413.
 */
export function limitarCuerpoPublicoLeido() {
  return (peticion: Request, _respuesta: Response, siguiente: NextFunction): void => {
    if (esPostPublico(peticion) && peticion.body !== undefined && peticion.body !== null) {
      const leido = Buffer.byteLength(JSON.stringify(peticion.body), 'utf8');
      if (leido > LIMITE_CUERPO_PUBLICO_BYTES) {
        siguiente(demasiadoGrande());
        return;
      }
    }
    siguiente();
  };
}
