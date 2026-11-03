import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/** 404 con un mensaje fijo por entidad: el mismo cuerpo para un id de otra empresa y uno inexistente. */
export const noEncontrado = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', `${que} no existe`);

/** 409 por una dirección que ya usa otro restaurante (o otra sucursal): sin decir de quién (criterios 2 y 4). */
export const direccionRepetida = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', mensaje, [{ campo: 'slug', mensaje }]);

/** 409 por una escritura que chocó con otra simultánea de la misma empresa. */
export const conflicto = (mensaje: string, campos: CampoError[] = []): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', mensaje, campos);

/** 409 al configurar el logo o una sucursal antes de crear la carta web de la empresa (criterios 3 y 4). */
export const cartaWebSinConfigurar = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CARTA_WEB_SIN_CONFIGURAR',
    'Primero configura el nombre, la dirección y el color de tu carta web',
  );

/** 422 del logo (criterio 3), con las mismas reglas de forma que la foto de un producto. */
export const logoInvalido = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'FOTO_INVALIDA', mensaje);

/** Mensaje del 404 de todo lo que la carta pública no muestra (criterio 14). */
export const MENSAJE_CARTA_NO_DISPONIBLE = 'La carta no está disponible';

/**
 * 404 de las rutas públicas (criterio 14): el mismo cuerpo para un código o una dirección desconocidos, una mesa
 * inactiva o con el código reemplazado, una sucursal sin publicar o sin `PEDIDOS_WEB` y un llamado de otra mesa. Así
 * nadie puede distinguir qué existe y qué no.
 */
export const cartaNoDisponible = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', MENSAJE_CARTA_NO_DISPONIBLE);
