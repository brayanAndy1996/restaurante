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

/**
 * Analizador de cuerpo binario solo para la ruta de la foto, con su propio límite de 1 MB (el resto de la API
 * sigue con el de 100 KB de 001). Con un `Content-Type` de imagen (JPEG, PNG o WebP) deja el cuerpo en
 * `req.body` como `Buffer`; con otro tipo no lo toca y el controlador responde 415. Un cuerpo de más de 1 MB
 * responde 413 `CUERPO_DEMASIADO_GRANDE` sin acumularlo en memoria. No valida que sea una imagen: eso lo hace
 * `leerImagen` en el servicio.
 */
export function analizadorBinarioDeFoto() {
  return (req: Request, _res: Response, siguiente: NextFunction): void => {
    if (!esSubidaDeFoto(req.method, req.path)) return siguiente();
    const tipo = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(TIPOS_DE_IMAGEN as readonly string[]).includes(tipo)) return siguiente();

    const demasiado = () =>
      new ErrorAplicacion(413, 'CUERPO_DEMASIADO_GRANDE', 'La foto supera el límite de 1 MB');
    const codificacion = req.headers['content-encoding'];
    if (codificacion !== undefined && codificacion.trim().toLowerCase() !== 'identity') {
      return siguiente(
        new ErrorAplicacion(415, 'TIPO_NO_SOPORTADO', 'La foto no puede venir comprimida'),
      );
    }
    const declarado = Number(req.headers['content-length']);
    if (Number.isFinite(declarado) && declarado > LIMITE_FOTO_BYTES) {
      req.resume(); // se descarta lo que falta sin guardarlo
      return siguiente(demasiado());
    }

    const trozos: Buffer[] = [];
    let total = 0;
    let terminado = false;
    req.on('data', (trozo: Buffer) => {
      if (terminado) return;
      total += trozo.length;
      if (total > LIMITE_FOTO_BYTES) {
        terminado = true;
        trozos.length = 0;
        siguiente(demasiado());
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => {
      if (terminado) return;
      terminado = true;
      req.body = Buffer.concat(trozos, total);
      siguiente();
    });
    req.on('error', (error) => {
      if (terminado) return;
      terminado = true;
      siguiente(error);
    });
  };
}
