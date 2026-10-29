import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * Errores del módulo de pedidos (historia 004). Un id de otra empresa, de otra sucursal y uno inexistente dan
 * exactamente el mismo cuerpo (criterio 85): el mensaje nunca lleva el id.
 */

/** 404 de una orden de otra sucursal, de otra empresa o inexistente. */
export const ordenNoEncontrada = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La orden no existe');

/** 409 `MESA_OCUPADA` con la orden que ocupa la mesa, para que la PWA lleve a la persona ahí (criterio 11). */
export const mesaOcupada = (ordenId: string): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'MESA_OCUPADA',
    'La mesa ya tiene una orden abierta',
    undefined,
    undefined,
    {
      ordenId,
    },
  );

/**
 * 409 `ORDEN_NO_ABIERTA`. Si la orden se unió a otra (`UNIDA`), lleva `ordenId` de la orden a la que se unió
 * (criterio 29), para que la PWA lleve al mozo ahí.
 */
export const ordenNoAbierta = (unidaA: string | null = null): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'ORDEN_NO_ABIERTA',
    'La orden ya no está abierta',
    undefined,
    undefined,
    unidaA === null ? undefined : { ordenId: unidaA },
  );

/** 409 `CONFLICTO` por una mesa que no se puede usar (inactiva). */
export const mesaInactiva = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', 'La mesa está inactiva', [
    { campo: 'mesaId', mensaje: 'La mesa está inactiva' },
  ]);

/** 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`: el mismo id de cliente con otra mesa, otro cuerpo u otra orden. */
export const idDeClienteReutilizado = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    'El identificador ya se usó con otra petición',
  );

/** 422 `REFERENCIA_INVALIDA` por una persona que no atiende mesas; igual para una de B y una inexistente. */
export const mozoInvalido = (mensaje: string): ErrorAplicacion => {
  const campos: CampoError[] = [{ campo: 'mozoId', mensaje }];
  return new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    campos,
  );
};

/**
 * 422 de un envío con líneas que no se pueden vender (criterios 17 y 18): una entrada de `campos` por cada línea
 * rechazada (`lineas.<i>`, con el motivo o los errores de selección como mensaje); el código y el mensaje son los
 * de la primera. Nada se guarda.
 */
export const lineasRechazadas = (
  primera: Pick<ErrorAplicacion, 'codigo'> & { message: string },
  campos: CampoError[],
): ErrorAplicacion => new ErrorAplicacion(422, primera.codigo, primera.message, campos);

/** 422 `MONTO_FUERA_DE_RANGO` (criterio 21): `lineas.<i>` por línea que pasa del tope o `lineas` por el total. */
export const montoFueraDeRango = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(422, 'MONTO_FUERA_DE_RANGO', 'El monto supera el máximo permitido', campos);

/** 409 `NADA_QUE_MARCHAR` (criterio 32): no hay ítems de segundo tiempo por marchar. */
export const nadaQueMarchar = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'NADA_QUE_MARCHAR', 'No hay ítems de segundo tiempo por marchar');

/**
 * 422 `DATOS_INVALIDOS` de una marcha con `itemIds` que no se pueden marchar (criterio 32): de primer tiempo, ya
 * marchados, anulados, de otra orden, de otra empresa o inexistentes. Todos dan el mismo cuerpo: el mensaje nunca
 * lleva el id.
 */
export const itemsNoMarchables = (indices: readonly number[]): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'DATOS_INVALIDOS',
    'Algún ítem no se puede marchar',
    indices.map((i) => ({
      campo: `itemIds.${i}`,
      mensaje: 'No es un ítem de segundo tiempo por marchar de esta orden',
    })),
  );

/** 404 de una línea de comanda de otra sucursal, de otra empresa, de una estación con impresora o inexistente. */
export const lineaDeComandaNoEncontrada = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La línea no existe');

/** 404 de una comanda de otra sucursal, de otra empresa, de una estación con impresora o inexistente. */
export const comandaNoEncontrada = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La comanda no existe');

/** 409 `TRANSICION_INVALIDA` (criterios 58 y 59): la línea o la comanda no admite ese cambio. */
export const transicionInvalida = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'TRANSICION_INVALIDA', mensaje);

/** 409 `ITEM_NO_ANULABLE` (criterio 35): el ítem ya está anulado del todo, no queda nada vigente que anular. */
export const itemNoAnulable = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'ITEM_NO_ANULABLE', 'El ítem ya está anulado');

/** 422 `DATOS_INVALIDOS` (criterio 35): se pidió anular más de la cantidad vigente del ítem. */
export const cantidadMayorQueLaVigente = (vigente: number): ErrorAplicacion =>
  new ErrorAplicacion(422, 'DATOS_INVALIDOS', 'La cantidad supera la cantidad vigente del ítem', [
    { campo: 'cantidad', mensaje: `Como máximo ${vigente}` },
  ]);

/**
 * 404 de un ítem de otra orden, de otra sucursal, de otra empresa o inexistente (criterio 35): el mismo cuerpo
 * que el de una orden inexistente, así quien llama no distingue cuál de los dos faltaba.
 */
export const itemNoEncontrado = (): ErrorAplicacion => ordenNoEncontrada();

/** 409 `ORDEN_CON_CONSUMO` (criterio 44): la orden tuvo algún envío, se anula con clave en lugar de liberarse. */
export const ordenConConsumo = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'ORDEN_CON_CONSUMO',
    'La orden tiene consumo: anúlala con la clave de un supervisor',
  );
