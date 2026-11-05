import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { MENSAJE_OPERACION_CONCURRENTE } from '../../nucleo/errores/filtro-global-errores';

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

/**
 * 422 `DATOS_INVALIDOS` con `campos.ordenId` (historia 005, criterio 42): el `ordenId` con el que se quiere abrir la mesa
 * al atender un llamado ya es de una orden que no es la vigente de esa mesa (liberada, unida, de otra mesa o de otra
 * sucursal). El cuerpo es el mismo en todos esos casos.
 */
export const ordenIdYaUsado = (): ErrorAplicacion =>
  new ErrorAplicacion(422, 'DATOS_INVALIDOS', 'Los datos enviados no son válidos', [
    { campo: 'ordenId', mensaje: 'Ese identificador ya se usó. Genera otro para abrir la mesa' },
  ]);

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

/** 409 `ORDEN_SIN_CONSUMO` (criterio 50): la orden no tiene ningún ítem con cantidad vigente que mostrar. */
export const ordenSinConsumo = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'ORDEN_SIN_CONSUMO', 'La orden no tiene ítems vigentes');

/**
 * 409 `CONFLICTO` de una operación que perdió la carrera con otra sobre las mismas órdenes o mesas (criterio 48):
 * el mismo mensaje que la traducción de un abrazo mortal, así la PWA la repite sin distinguirlos.
 */
export const operacionConcurrente = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', MENSAJE_OPERACION_CONCURRENTE);

/**
 * 409 `CONFLICTO` de una lectura o una pre-cuenta cuyos montos no cuadran (un saldo negativo u otro dato que el
 * dominio rechaza con `RangeError`, historia 006, criterio 45a): nunca un 500. El detalle va al log.
 */
export const montosInconsistentes = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CONFLICTO',
    'Los montos de la cuenta no cuadran: avisa al administrador antes de cobrarla',
  );

/** 400 `DATOS_INVALIDOS` (criterio 45): una orden con varias mesas necesita saber cuál se mueve. */
export const mesaOrigenRequerida = (): ErrorAplicacion =>
  new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Indica cuál de las mesas de la orden se mueve', [
    { campo: 'mesaOrigenId', mensaje: 'Obligatoria cuando la orden tiene varias mesas' },
  ]);

/** 422 `REFERENCIA_INVALIDA` (criterio 45): la mesa de origen existe pero no es una de las mesas de la orden. */
export const mesaOrigenInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    [{ campo: 'mesaOrigenId', mensaje: 'No es una mesa de la orden' }],
  );

/** 422 `DATOS_INVALIDOS` (criterio 46): la unión dejaría a la orden con más mesas de las permitidas. */
export const demasiadasMesas = (maximo: number): ErrorAplicacion =>
  new ErrorAplicacion(422, 'DATOS_INVALIDOS', `Una orden admite como máximo ${maximo} mesas`, [
    { campo: 'mesaIds', mensaje: `La orden quedaría con más de ${maximo} mesas` },
  ]);

// ---------------------------------------------------------------------------------------------------
// Descuentos y cortesías (historia 006, criterios 38 a 45a)
// ---------------------------------------------------------------------------------------------------

/** 409 `CONFLICTO` con el motivo en el mensaje (un descuento o una cortesía que la cuenta no admite en ese estado). */
export const conflictoDeCuenta = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', mensaje);

/** 409 `CUENTA_EN_COBRO` (criterio 45): la cuenta ya tiene algún cobro; ya no se tocan sus descuentos ni cortesías. */
export const cuentaEnCobro = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CUENTA_EN_COBRO',
    'La cuenta ya tiene cobros: no se pueden cambiar sus descuentos ni sus cortesías',
  );

/** Los motivos con que `validarDescuento` rechaza un descuento (criterio 14), dichos para una persona. */
const MENSAJE_DE_DESCUENTO: Record<'DESCUENTO_EXCESIVO' | 'DESCUENTO_NULO', string> = {
  DESCUENTO_EXCESIVO: 'El descuento no puede igualar ni superar el importe sobre el que se aplica',
  DESCUENTO_NULO: 'El descuento no descuenta nada',
};

/** 422 `DESCUENTO_INVALIDO` con `campos.valor` y el código de `validarDescuento` en el mensaje (criterio 41). */
export const descuentoInvalido = (
  codigo: 'DESCUENTO_EXCESIVO' | 'DESCUENTO_NULO',
): ErrorAplicacion =>
  new ErrorAplicacion(422, 'DESCUENTO_INVALIDO', `${codigo}: ${MENSAJE_DE_DESCUENTO[codigo]}`, [
    { campo: 'valor', mensaje: MENSAJE_DE_DESCUENTO[codigo] },
  ]);

/**
 * 422 `DESCUENTO_INVALIDO` con `campos.descuento` (criterio 45a, decisión del usuario del 2026-11-04): el cambio dejaría
 * un descuento por monto mayor o igual que su base. No se anula, se une ni se envía nada, no se consume la clave y el
 * descuento nunca se recorta ni se quita solo.
 */
export const descuentoNoAdmitido = (
  verbo: 'anular' | 'unir' | 'dar la cortesía' | 'aplicar otro descuento',
): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'DESCUENTO_INVALIDO',
    `Quita o vuelve a pedir el descuento antes de ${verbo}`,
    [{ campo: 'descuento', mensaje: `Quita o vuelve a pedir el descuento antes de ${verbo}` }],
  );

/** 422 `CORTESIA_INVALIDA` (criterio 43): un ítem con ICBPER no admite cortesía, ni más unidades que las vigentes. */
export const cortesiaInvalida = (mensaje: string, campo = 'itemId'): ErrorAplicacion =>
  new ErrorAplicacion(422, 'CORTESIA_INVALIDA', mensaje, [{ campo, mensaje }]);

/**
 * 409 `CUENTA_COBRADA_EN_PARTE` (historia 006, criterios 20, 86 y 87): enviar o anular dejaría la cuenta de una orden con
 * cobros sin cuadrar con lo ya cobrado. La transacción se revierte entera (también la clave del supervisor).
 */
export const cuentaCobradaEnParte = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CUENTA_COBRADA_EN_PARTE',
    'La cuenta ya tiene cobros y este cambio no cuadraría con lo cobrado: cóbrala como está o corrige con una nota de crédito',
  );

/**
 * 409 `CUENTA_EN_COBRO` al unir o anular una orden que ya tiene cobros (criterio 88): lo cobrado no se mueve a otra
 * cuenta ni se deshace sin una nota de crédito (6b).
 */
export const ordenConCobros = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CUENTA_EN_COBRO',
    'La orden ya tiene cobros: no se puede unir ni anular. Cóbrala o corrige lo cobrado con una nota de crédito',
  );
