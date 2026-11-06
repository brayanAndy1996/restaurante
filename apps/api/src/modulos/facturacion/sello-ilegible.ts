import type { NextFunction, Request, Response } from 'express';
import { enlaceNoValido } from './errores-facturacion';

/**
 * Un sello que ni siquiera se puede decodificar de la dirección (un `%` suelto, por ejemplo) hace que Express responda 400
 * antes de que la ruta lo vea. En `/publico/comprobantes/…` todo sello inservible es el mismo 404 (criterio 160): este
 * middleware se monta en ese prefijo y, si el segmento no se decodifica, responde con el cuerpo de `enlaceNoValido` sin
 * llegar a la ruta ni a la base.
 */
export function rechazarSelloIlegible() {
  return (peticion: Request, respuesta: Response, siguiente: NextFunction): void => {
    const segmento = (peticion.url ?? '').split('?')[0]!.split('/').filter(Boolean)[0];
    if (segmento !== undefined) {
      try {
        decodeURIComponent(segmento);
      } catch {
        const error = enlaceNoValido();
        respuesta.status(error.getStatus()).json({ codigo: error.codigo, mensaje: error.message });
        return;
      }
    }
    siguiente();
  };
}
