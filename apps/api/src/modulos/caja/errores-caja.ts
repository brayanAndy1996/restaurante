import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * 404 con un mensaje fijo por entidad. Un id de otra empresa, de otra sucursal y uno inexistente dan exactamente el
 * mismo cuerpo (criterio 106): el mensaje nunca lleva el id.
 */
export const noEncontrado = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', `${que} no existe`);

/** 409 `CONFLICTO` por un nombre de caja repetido en la sucursal, sin distinguir mayúsculas (criterio 1). */
export const nombreDeCajaRepetido = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', 'Ya existe una caja con ese nombre en la sucursal', [
    { campo: 'nombre', mensaje: 'Ya existe una caja con ese nombre' },
  ] satisfies CampoError[]);

/** 409 `CONFLICTO` por pasar del máximo de cajas activas de una sucursal (criterio 1). */
export const limiteDeCajas = (maximo: number): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CONFLICTO',
    `La sucursal ya tiene ${maximo} cajas activas, que es el máximo. Desactiva una que no uses antes de agregar otra`,
  );

/** 409 `EN_USO` al desactivar una caja que tiene un turno abierto (criterio 1). */
export const cajaConTurnoAbierto = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'EN_USO',
    'La caja tiene un turno abierto: ciérralo antes de desactivarla',
  );

/**
 * 422 por una impresora que no existe en la sucursal o no está activa (criterio 2). Igual para una de otra empresa, una
 * de otra sucursal, una inactiva y una inexistente.
 */
export const impresoraDeCajaInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    [{ campo: 'impresoraId', mensaje: 'Debe ser una impresora activa de esta sucursal' }],
  );

/** 403 `PROHIBIDO`: un Cajero que pide el turno, el reporte o los comprobantes de otro turno (criterio 100). */
export const turnoDeOtro = (): ErrorAplicacion =>
  new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para ver el turno de otra persona');

/** 409 `TURNO_YA_ABIERTO` con el turno que ya está abierto: en la caja o de la misma persona (criterio 26). */
export const turnoYaAbierto = (turnoId: string | null, mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'TURNO_YA_ABIERTO',
    mensaje,
    undefined,
    undefined,
    turnoId === null ? undefined : { turnoId },
  );

/** 409 `TURNO_CERRADO`: la Z es definitiva, el turno no acepta cobros, movimientos ni otro cierre (criterio 34). */
export const turnoCerrado = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'TURNO_CERRADO', 'El turno ya está cerrado');

/** 409 `TURNO_AJENO`: quien no es el responsable ni un Supervisor o Administrador (criterios 28 y 35). */
export const turnoAjeno = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'TURNO_AJENO',
    'Este turno es de otra persona: solo su responsable, un Supervisor o el Administrador pueden hacerlo',
  );

/** 409 `CONFLICTO`: la caja está desactivada (criterio 24). */
export const cajaInactiva = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', 'La caja está desactivada');

/** 409 `CIERRE_BLOQUEADO` con cuántas órdenes siguen abiertas (criterio 33). */
export const cierreBloqueado = (ordenes: number): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CIERRE_BLOQUEADO',
    ordenes === 1
      ? 'No se puede cerrar la caja: hay 1 mesa o pedido abierto. Cóbralo o anúlalo primero'
      : `No se puede cerrar la caja: hay ${ordenes} mesas o pedidos abiertos. Cóbralos o anúlalos primero`,
    undefined,
    undefined,
    { ordenes },
  );

/** 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`: el mismo id de cliente con otra caja, otro fondo, otro tipo u otro monto. */
export const idDeClienteReutilizado = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    'Ese identificador ya se usó en otra petición distinta',
  );

/** 422 `REFERENCIA_INVALIDA`: un turno es de una persona, no de una sesión de soporte (criterios 24 y 35). */
export const turnoSoloDePersonas = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una sesión de soporte no abre ni cierra turnos: son de una persona de la empresa',
  );

// ---------------------------------------------------------------------------------------------------
// Cobro (criterios 47 a 63)
// ---------------------------------------------------------------------------------------------------

/**
 * 409 `CUENTA_CAMBIO` (criterio 49): la cuenta cambió desde que la persona la vio (otra versión u otro total). Lleva la
 * `version` actual para que la PWA recargue la cuenta sin perder los pagos que ya escribió.
 */
export const cuentaCambio = (version: number): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CUENTA_CAMBIO',
    'La cuenta cambió desde que la viste: revísala y vuelve a cobrar',
    undefined,
    undefined,
    { version },
  );

/** 409 `NADA_QUE_COBRAR` (criterio 61): no queda nada por cobrar en la orden. */
export const nadaQueCobrar = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'NADA_QUE_COBRAR', 'La orden no tiene nada que cobrar');

/** 422 `PARTE_INVALIDA` (criterios 49 y 64 a 66): la parte pedida no se puede cobrar de lo que falta. */
export const parteInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'PARTE_INVALIDA',
    'Esa parte no se puede cobrar con lo que falta de la cuenta',
    [{ campo: 'parte', mensaje: 'No se puede cobrar con lo que falta de la cuenta' }],
  );

/** 422 `PAGOS_NO_CUADRAN` (criterio 50): los pagos, el redondeo o el vuelto no suman el total. */
export const pagosNoCuadran = (): ErrorAplicacion =>
  new ErrorAplicacion(422, 'PAGOS_NO_CUADRAN', 'Los pagos no cuadran con el total a cobrar', [
    { campo: 'pagos', mensaje: 'Los pagos y el redondeo deben sumar exactamente el total' },
  ]);

/** 422 `COMPROBANTE_NO_PERMITIDO` (criterio 51): el emisor no emite ese tipo, o el formato no vale para esa parte. */
export const comprobanteNoPermitido = (mensaje: string, campo: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'COMPROBANTE_NO_PERMITIDO', mensaje, [{ campo, mensaje }]);

/** 422 `CLIENTE_REQUERIDO` (criterio 51): la factura o la boleta de más de S/ 700 necesita al cliente. */
export const clienteRequerido = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'CLIENTE_REQUERIDO', mensaje, [
    { campo: 'comprobante.cliente', mensaje },
  ]);

/** 409 `TASA_IGV_NO_CONFIGURADA` (criterio 51): el emisor no tiene tasa de IGV vigente; nunca se inventa una. */
export const tasaIgvNoConfigurada = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'TASA_IGV_NO_CONFIGURADA',
    'El emisor no tiene una tasa de IGV vigente: configúrala en Ajustes antes de cobrar',
  );

/** 422 `MONTO_FUERA_DE_RANGO` (criterio 62): un total, un pago o un recibido pasa de 99999999.99. */
export const montoFueraDeRango = (campo: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'MONTO_FUERA_DE_RANGO', 'El monto supera el máximo permitido', [
    { campo, mensaje: 'El monto supera el máximo permitido' },
  ]);

/**
 * 409 `CUENTA_CAMBIO` de la venta de mostrador (historia 006, criterio 84): el total que vio el cajero no es el que da la
 * carta vigente. `campos.total` lleva el total nuevo; no hay `version` porque la orden todavía no existía.
 */
export const ventaCambio = (totalNuevo: string): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CUENTA_CAMBIO',
    'Los precios cambiaron desde que armaste la venta: revísala y vuelve a cobrar',
    [{ campo: 'total', mensaje: `El total ahora es S/ ${totalNuevo}` }] satisfies CampoError[],
  );
