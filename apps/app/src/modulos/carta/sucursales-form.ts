import type { AjusteSucursalEntrada, AjusteSucursalRespuesta } from '@restaurante/contratos';
import { ErrorApi, erroresPorCampo, mensajeDeError } from '../../lib/errores';
import { comoDecimal, montoComoTexto } from '../../lib/monto';

/** Lo que se está escribiendo en una fila de sucursal. */
export interface BorradorDeSucursal {
  /** Precio propio tal como se escribe ("27.5"); vacío = usa el de la empresa. */
  precio: string;
  disponible: boolean;
}

/** El borrador de una fila tal como está guardada. */
export function borradorDeSucursal(fila: AjusteSucursalRespuesta): BorradorDeSucursal {
  return { precio: fila.precio ?? '', disponible: fila.disponible };
}

export const MENSAJE_PRECIO_PROPIO =
  'Escribe un precio mayor que 0, o déjalo vacío para usar el de la empresa.';

/**
 * Valida el precio propio escrito: vacío es `null` (usa el de la empresa); si no, un monto mayor que 0
 * con hasta 2 decimales ("27.5" → "27.50").
 */
export function precioPropioDe(
  texto: string,
): { valor: string | null; error?: undefined } | { valor?: undefined; error: string } {
  if (texto.trim() === '') return { valor: null };
  const monto = montoComoTexto(texto);
  return monto === null ? { error: MENSAJE_PRECIO_PROPIO } : { valor: monto };
}

/** Lo que se envía a la API, o el error del campo de precio. */
export function ajusteDeBorrador(
  borrador: BorradorDeSucursal,
  seVendeSolo: boolean,
): { entrada: AjusteSucursalEntrada; error?: undefined } | { entrada?: undefined; error: string } {
  // Un producto que no se vende solo no lleva precio (criterio 19): nunca se envía uno.
  if (!seVendeSolo) return { entrada: { precio: null, disponible: borrador.disponible } };
  const precio = precioPropioDe(borrador.precio);
  if (precio.error !== undefined) return { error: precio.error };
  return { entrada: { precio: precio.valor, disponible: borrador.disponible } };
}

/** Si el borrador difiere de lo guardado (compara montos como decimales, no como texto). */
export function hayCambiosDeSucursal(
  fila: AjusteSucursalRespuesta,
  borrador: BorradorDeSucursal,
): boolean {
  if (borrador.disponible !== fila.disponible) return true;
  const escrito = borrador.precio.trim() === '' ? null : comoDecimal(borrador.precio);
  const guardado = fila.precio === null ? null : comoDecimal(fila.precio);
  if (escrito === null || guardado === null) return escrito !== guardado;
  return !escrito.equals(guardado);
}

export interface FalloDeAjuste {
  /** Lo que se le dice a la persona: el problema y la salida. */
  mensaje: string;
  /** Error del campo de precio, si el servidor lo rechazó por ese dato. */
  precio?: string;
  /** Conviene volver a leer las filas: el rol o la sucursal cambiaron. */
  releer: boolean;
}

/** Traduce el error de guardar una fila a un mensaje en español, sin códigos ni jerga. */
export function falloDeAjuste(error: unknown): FalloDeAjuste {
  const e = error instanceof ErrorApi ? error : null;
  switch (e?.codigo) {
    case 'PROHIBIDO':
      return {
        mensaje:
          'Solo puedes cambiar el precio y la disponibilidad en las sucursales donde eres Cajero. Si te cambiaron el rol hace poco, actualizamos la lista para que lo veas.',
        releer: true,
      };
    case 'NO_ENCONTRADO':
      return {
        mensaje:
          'Esta sucursal o este producto ya no existe. Actualizamos la lista; si el producto no aparece, vuelve a la carta.',
        releer: true,
      };
    case 'DATOS_INVALIDOS': {
      const campos = erroresPorCampo(e);
      return {
        mensaje: mensajeDeError(e),
        ...('precio' in campos ? { precio: MENSAJE_PRECIO_PROPIO } : {}),
        releer: false,
      };
    }
    case 'SIN_CONEXION':
      return {
        mensaje:
          'No hay conexión con el servidor. Lo que escribiste sigue aquí: toca "Guardar" cuando vuelva tu internet.',
        releer: false,
      };
    default:
      return { mensaje: mensajeDeError(error), releer: false };
  }
}
