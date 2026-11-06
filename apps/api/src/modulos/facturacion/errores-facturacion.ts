import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/** 409 `CONFLICTO` por una serie que ya usa el emisor en otra caja o sucursal (criterio 4). */
export const serieOcupada = (serie: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', `La serie ${serie} ya la usa otra caja de este emisor`, [
    { campo: 'serie', mensaje: 'Ya está en uso por este emisor' },
  ] satisfies CampoError[]);

/** 409 `CONFLICTO` por un `primerNumero` distinto al de una serie que ya existe (criterio 5). */
export const primerNumeroDistinto = (guardado: number): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CONFLICTO',
    `La serie ya existe y empezó en el número ${guardado}: no se puede cambiar`,
    [{ campo: 'primerNumero', mensaje: `La serie empezó en ${guardado}` }] satisfies CampoError[],
  );

/** 409 `SIN_SERIE`: la caja no tiene una serie activa de ese tipo para el emisor de la sucursal (criterios 5 y 70). */
export const sinSerie = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'SIN_SERIE',
    'La caja no tiene una serie activa de este tipo de comprobante: configúrala en Ajustes',
  );

/** 409 `SERIE_AGOTADA`: la serie llegó al correlativo 99999999 (criterio 70). */
export const serieAgotada = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'SERIE_AGOTADA',
    'La serie llegó a su último número: configura una serie nueva para esta caja',
  );

/** 404 de un comprobante de otra sucursal, de otra empresa o inexistente: el mismo cuerpo (criterio 106). */
export const comprobanteNoEncontrado = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El comprobante no existe');

/** 403 `PROHIBIDO`: un Cajero que pide un comprobante de un turno que no es suyo (criterio 100). */
export const comprobanteDeOtro = (): ErrorAplicacion =>
  new ErrorAplicacion(
    403,
    'PROHIBIDO',
    'No tienes permiso para ver los comprobantes del turno de otra persona',
  );

/** 409 `COMPROBANTE_NO_RECHAZADO`: solo un comprobante `RECHAZADO` se reemite (criterio 134). */
export const comprobanteNoRechazado = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'COMPROBANTE_NO_RECHAZADO',
    'Solo se puede emitir otro comprobante en lugar de uno rechazado por SUNAT',
  );

/** 409 `YA_REEMPLAZADO`: el rechazado ya tiene su reemisión; `comprobanteId` es la que lo reemplazó (criterio 134). */
export const yaReemplazado = (comprobanteId: string): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'YA_REEMPLAZADO',
    'Este comprobante ya fue reemplazado por otro',
    undefined,
    undefined,
    { comprobanteId },
  );

/** 422 `COMPROBANTE_NO_PERMITIDO`: el emisor no emite ese tipo, o el tipo no vale para ese comprobante (criterio 51). */
export const comprobanteNoPermitido = (mensaje: string, campo: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'COMPROBANTE_NO_PERMITIDO', mensaje, [{ campo, mensaje }]);

/** 422 `CLIENTE_REQUERIDO`: la factura o la boleta de más de S/ 700 necesita al cliente (criterio 51). */
export const clienteRequerido = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'CLIENTE_REQUERIDO', mensaje, [{ campo: 'cliente', mensaje }]);

// ---------------------------------------------------------------------------------------------------
// Notas de crédito (6b, criterios 143 a 151)
// ---------------------------------------------------------------------------------------------------

/** 409 `COMPROBANTE_NO_ACEPTADO`: solo un comprobante `ACEPTADO` admite nota de crédito (criterio 146). */
export const comprobanteNoAceptado = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'COMPROBANTE_NO_ACEPTADO',
    'Solo se puede emitir una nota de crédito sobre un comprobante aceptado por SUNAT',
  );

/** 409 `COMPROBANTE_ANULADO`: el comprobante ya fue anulado por una nota de crédito (criterio 146). */
export const comprobanteAnulado = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'COMPROBANTE_ANULADO', 'El comprobante ya fue anulado');

/** 422 `NOTA_CREDITO_INVALIDA` con el motivo en el mensaje (criterios 143, 146 y 147). */
export const notaCreditoInvalida = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'NOTA_CREDITO_INVALIDA', mensaje);

/** 422 `NADA_QUE_ACREDITAR`: a la línea pedida ya no le queda nada por acreditar (criterios 147 y 148). */
export const nadaQueAcreditar = (): ErrorAplicacion =>
  new ErrorAplicacion(422, 'NADA_QUE_ACREDITAR', 'A esa línea ya no le queda nada por acreditar');

/** 409 `NOTA_CREDITO_CAMBIO`: el total de la nota que vio la persona no es el que calcula el servidor (criterio 144). */
export const notaCreditoCambio = (totalNuevo: string): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'NOTA_CREDITO_CAMBIO',
    'El total de la nota cambió desde que lo viste: revísalo y vuelve a emitirla',
    [{ campo: 'total', mensaje: `El total ahora es S/ ${totalNuevo}` }] satisfies CampoError[],
  );

/** 409 `SIN_SERIE`: la caja no tiene una serie activa de notas de crédito de ese tipo para el emisor (criterio 149). */
export const sinSerieDeNotas = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'SIN_SERIE',
    'La caja no tiene serie de notas de crédito: configúrala en Ajustes',
  );

// ---------------------------------------------------------------------------------------------------
// PDF y enlace (6b, criterios 159 y 160)
// ---------------------------------------------------------------------------------------------------

/** 409 `PDF_NO_DISPONIBLE`: el PDF se arma cuando SUNAT acepta el comprobante (criterio 159). */
export const pdfNoDisponible = (
  mensaje = 'El PDF estará listo cuando SUNAT acepte el comprobante',
): ErrorAplicacion => new ErrorAplicacion(409, 'PDF_NO_DISPONIBLE', mensaje);

/**
 * 404 de la ruta pública del PDF: un sello alterado, de otra clave, vencido, de un comprobante inexistente o sin PDF
 * responden exactamente igual (criterio 160); nunca dice cuál de los cuatro.
 */
export const enlaceNoValido = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'Este enlace no es válido o ya venció');
