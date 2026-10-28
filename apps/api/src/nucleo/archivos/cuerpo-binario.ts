import type { NextFunction, Request, Response } from 'express';
import { ErrorAplicacion } from '../errores/error-aplicacion';
import { TIPOS_DE_IMAGEN } from './leer-imagen';

/** Tamaño máximo de una foto (criterio 14): 1 MB = 1 048 576 bytes. */
export const LIMITE_FOTO_BYTES = 1_048_576;

/** `PUT /carta/productos/:id/foto`: la única ruta de la API con cuerpo binario. */
const RUTA_DE_LA_FOTO = /^\/carta\/productos\/[^/]+\/foto\/?$/;

/** `true` si la petición es la subida de una foto. */
export function esSubidaDeFoto(metodo: string, ruta: string): boolean {
  return metodo === 'PUT' && RUTA_DE_LA_FOTO.test(ruta);
}

/** Una foto leída de la petición: sus bytes y el tipo (`image/jpeg`, `image/png` o `image/webp`). */
export interface CuerpoDeFoto {
  datos: Buffer;
  tipo: string;
}

const demasiado = () =>
  new ErrorAplicacion(413, 'CUERPO_DEMASIADO_GRANDE', 'La foto supera el límite de 1 MB');

/**
 * Middleware global que no lee el cuerpo: solo se asegura de que, cuando la respuesta de la subida de una foto
 * termina sin que nadie haya leído el cuerpo (401, 403, 400 de la ruta…), lo que falte por llegar se descarte
 * en lugar de dejarlo pendiente en la conexión. Así el cliente recibe su 401/403 y no un `ECONNRESET`, y la API
 * nunca acumula nada de un cuerpo que nadie autorizó a leer.
 */
export function descartarCuerpoDeFotoAlResponder() {
  return (req: Request, res: Response, siguiente: NextFunction): void => {
    if (esSubidaDeFoto(req.method, req.path)) res.once('finish', () => req.resume());
    siguiente();
  };
}

/**
 * Lee el cuerpo binario de `PUT /carta/productos/:id/foto` con su propio límite de 1 MB (el resto de la API
 * sigue con el de 100 KB de 001). **Lo llama el controlador**, es decir, después del guard de autenticación y
 * del `PermisoInterceptor`: quien no tiene sesión (401) o permiso (403) recibe esa respuesta sin que la API
 * lea ni un byte del cuerpo, aunque pase de 1 MB (criterio 61).
 *
 * - `Content-Type` que no es JPEG, PNG ni WebP: 415 `TIPO_NO_SOPORTADO`.
 * - `Content-Encoding` distinto de `identity`: 415.
 * - Más de 1 MB (por `Content-Length` o contando lo que llega): 413 `CUERPO_DEMASIADO_GRANDE`, sin acumularlo en
 *   memoria; lo que falte se descarta para que el cliente reciba el 413.
 *
 * No valida que sea una imagen: eso lo hace `leerImagen` en el servicio.
 */
export function leerCuerpoDeFoto(req: Request): Promise<CuerpoDeFoto> {
  const tipo = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(TIPOS_DE_IMAGEN as readonly string[]).includes(tipo)) {
    req.resume();
    return Promise.reject(
      new ErrorAplicacion(
        415,
        'TIPO_NO_SOPORTADO',
        'La foto debe enviarse como image/jpeg, image/png o image/webp',
      ),
    );
  }
  const codificacion = req.headers['content-encoding'];
  if (codificacion !== undefined && codificacion.trim().toLowerCase() !== 'identity') {
    req.resume();
    return Promise.reject(
      new ErrorAplicacion(415, 'TIPO_NO_SOPORTADO', 'La foto no puede venir comprimida'),
    );
  }
  const declarado = Number(req.headers['content-length']);
  if (Number.isFinite(declarado) && declarado > LIMITE_FOTO_BYTES) {
    req.resume(); // se descarta lo que falta sin guardarlo
    return Promise.reject(demasiado());
  }

  return new Promise<CuerpoDeFoto>((resolver, rechazar) => {
    const trozos: Buffer[] = [];
    let total = 0;
    let terminado = false;
    const terminar = (error: unknown): void => {
      if (terminado) return;
      terminado = true;
      trozos.length = 0;
      req.off('data', alTrozo);
      req.resume(); // lo que falte llega y se descarta
      rechazar(error);
    };
    const alTrozo = (trozo: Buffer): void => {
      total += trozo.length;
      if (total > LIMITE_FOTO_BYTES) return terminar(demasiado());
      trozos.push(trozo);
    };
    req.on('data', alTrozo);
    req.once('end', () => {
      if (terminado) return;
      terminado = true;
      resolver({ datos: Buffer.concat(trozos, total), tipo });
    });
    req.once('error', terminar);
    // El cliente cortó antes de terminar de enviar: no hay cuerpo completo que devolver.
    req.once('close', () => terminar(new Error('La petición se cerró antes de recibir todo el cuerpo')));
  });
}
