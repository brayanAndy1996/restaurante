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
