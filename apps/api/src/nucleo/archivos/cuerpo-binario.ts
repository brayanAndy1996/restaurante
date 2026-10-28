import { Logger } from '@nestjs/common';
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
 * 400 `PETICION_INVALIDA` cuando el cliente cortó la subida a la mitad (o la conexión se cayó). No es una falla de
 * la API: casi siempre nadie leerá esta respuesta y se registra como aviso, no como error.
 */
const subidaCortada = () =>
  new ErrorAplicacion(400, 'PETICION_INVALIDA', 'La subida se interrumpió antes de terminar');

const logger = new Logger('FotoProducto');

/**
 * Middleware global que no lee el cuerpo. Cuando la subida de una foto se rechaza (401, 403, 413, 415, 400 de la
 * ruta…) sin que el cuerpo haya llegado entero, la API **no** lo lee ni lo descarta: Node, al terminar la
 * respuesta, consumiría y tiraría todo lo que siga llegando (más de 1 GB en unos segundos) hasta el
 * `requestTimeout` de 300 s, y quien no tiene sesión ocuparía un socket y ancho de banda todo ese tiempo. En su
 * lugar la respuesta lleva `Connection: close` y el socket se cierra en cuanto la respuesta salió completa
 * (`finish`): el cliente recibe su 401/403/413/415 y la conexión se corta sin leer nada más.
 *
 * Si el cuerpo ya llegó entero (`req.complete`) no hay nada que cortar y la conexión sigue como siempre.
 */
export function descartarCuerpoDeFotoAlResponder() {
  return (req: Request, res: Response, siguiente: NextFunction): void => {
    if (!esSubidaDeFoto(req.method, req.path)) {
      siguiente();
      return;
    }
    let cerrarAlTerminar = false;
    const escribirCabecera = res.writeHead.bind(res) as (...argumentos: unknown[]) => Response;
    // Se decide al escribir la cabecera, que es el último momento en que aún se puede añadir `Connection: close`.
    res.writeHead = ((...argumentos: unknown[]): Response => {
      const estado = typeof argumentos[0] === 'number' ? argumentos[0] : res.statusCode;
      if (estado >= 400 && !req.complete && !res.headersSent) {
        cerrarAlTerminar = true;
        res.setHeader('Connection', 'close');
      }
      return escribirCabecera(...argumentos);
    }) as typeof res.writeHead;
    res.once('finish', () => {
      if (!cerrarAlTerminar) return;
      // Ya no se lee nada de este socket: lo que el cliente siga enviando se pierde con la conexión.
      req.socket.destroy();
    });
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
 *   memoria. Tampoco se lee lo que falte: el middleware `descartarCuerpoDeFotoAlResponder` cierra la conexión
 *   cuando el 413 ya salió.
 * - El cliente corta la subida a la mitad (cierra la conexión o se cae): 400 `PETICION_INVALIDA` y un aviso en
 *   el registro (no un error).
 *
 * No valida que sea una imagen: eso lo hace `leerImagen` en el servicio.
 */
export function leerCuerpoDeFoto(req: Request): Promise<CuerpoDeFoto> {
  const tipo = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(TIPOS_DE_IMAGEN as readonly string[]).includes(tipo)) {
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
    return Promise.reject(
      new ErrorAplicacion(415, 'TIPO_NO_SOPORTADO', 'La foto no puede venir comprimida'),
    );
  }
  const declarado = Number(req.headers['content-length']);
  if (Number.isFinite(declarado) && declarado > LIMITE_FOTO_BYTES) {
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
      req.pause(); // no se lee nada más: el middleware cierra la conexión al responder
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
    // El cliente cortó antes de terminar de enviar (o la conexión se cayó): no hay cuerpo completo que devolver.
    const alCortarse = (): void => {
      if (terminado) return;
      logger.warn('El cliente cortó la subida de una foto antes de terminar de enviarla');
      terminar(subidaCortada());
    };
    req.once('error', alCortarse);
    req.once('close', alCortarse);
  });
}
