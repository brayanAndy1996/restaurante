import { ErrorApi } from '../../lib/errores';
import { montoEnSoles } from '../../lib/monto';

/**
 * Los errores de descuentos y cortesías dichos en palabras (criterios 40 a 45a de 006). Es un módulo liviano a propósito:
 * lo usan también las anulaciones y las uniones de la cuenta de la mesa, que no deben bajar el cálculo de la cuenta.
 */

/** Lo que dice el campo del valor cuando el descuento no es válido (criterio 41). */
export function textoDeDescuentoRechazado(
  codigo: 'DESCUENTO_EXCESIVO' | 'DESCUENTO_NULO',
  tipo: 'PORCENTAJE' | 'MONTO',
  baseDelItem?: string,
): string {
  if (codigo === 'DESCUENTO_NULO') {
    return tipo === 'PORCENTAJE'
      ? 'Ese porcentaje no descuenta ni un céntimo. Escribe uno mayor.'
      : 'Escribe un monto mayor que cero.';
  }
  if (tipo === 'PORCENTAJE') {
    return 'El porcentaje no puede pasar de 99.99 %. Para no cobrar nada, usa «Cortesía».';
  }
  const tope = baseDelItem ? montoEnSoles(baseDelItem) : null;
  return tope
    ? `El monto debe ser menor que ${tope}, lo que se cobra de este ítem. Para no cobrar nada, usa «Cortesía».`
    : 'El monto debe ser menor que lo que se cobra. Para no cobrar nada, usa «Cortesía».';
}

export interface FalloDeCuenta {
  /** Qué pasó, para el aviso. */
  texto: string;
  /** Va en el campo del valor del descuento, no en un aviso aparte. */
  enElValor?: boolean;
  /** La cuenta pasó a otra (unida) o ya no está abierta: se vuelve a leer y no hay nada más que hacer aquí. */
  cuentaCerrada?: boolean;
  /** La cuenta principal a la que se unió, si la API la dijo. */
  ordenPrincipalId?: string;
  /** Hay que volver a pedir la clave del supervisor. */
  pedirClave?: boolean;
}

const MENSAJE_CONCURRENTE = /^Otra operación se estaba aplicando/;

/**
 * Un error de aplicar, quitar, anular o unir con descuentos y cortesías, en palabras (criterios 40 a 45a). La API
 * trae el motivo en español en `mensaje` y en `campos`; aquí se elige qué decir y qué hacer.
 */
export function falloDeCuenta(
  error: unknown,
  {
    tipo = 'PORCENTAJE',
    baseDelItem,
  }: { tipo?: 'PORCENTAJE' | 'MONTO'; baseDelItem?: string } = {},
): FalloDeCuenta | null {
  if (!(error instanceof ErrorApi)) return null;
  const campo = (nombre: string) => error.campos.find((c) => c.campo === nombre)?.mensaje;
  switch (error.codigo) {
    case 'AUTORIZACION_INVALIDA':
    case 'CLAVE_REQUERIDA':
      return {
        texto:
          'La clave del supervisor no valió: venció, ya se usó o era para otra cosa. Pídela otra vez; lo que escribiste sigue aquí.',
        pedirClave: true,
      };
    case 'DESCUENTO_INVALIDO': {
      const sinBase = campo('descuento');
      if (sinBase !== undefined) {
        return {
          texto: `${sinBase.replace(/\.?$/, '.')} Lo encuentras en «Descuentos y cortesías», en la cuenta de la mesa.`,
        };
      }
      const codigo = /DESCUENTO_NULO/.test(error.message)
        ? 'DESCUENTO_NULO'
        : /DESCUENTO_EXCESIVO/.test(error.message)
          ? 'DESCUENTO_EXCESIVO'
          : null;
      return {
        texto: codigo
          ? textoDeDescuentoRechazado(codigo, tipo, baseDelItem)
          : (campo('valor') ?? 'El descuento no es válido para esta cuenta.'),
        enElValor: true,
      };
    }
    case 'CORTESIA_INVALIDA':
      return {
        texto: `${(campo('itemId') ?? campo('cantidad') ?? error.message).replace(/\.?$/, '.')} Revisa la cantidad o elige otro ítem.`,
      };
    case 'CUENTA_COBRADA_EN_PARTE':
      return {
        texto:
          'Esta cuenta ya tiene cobros y este cambio no cuadra con lo cobrado, así que no se hizo. Lo ya cobrado solo se corrige con una nota de crédito.',
      };
    case 'CUENTA_EN_COBRO':
      return {
        texto:
          'Esta cuenta ya tiene cobros: los descuentos y las cortesías ya no se pueden cambiar.',
        cuentaCerrada: true,
      };
    case 'ORDEN_NO_ABIERTA':
      return {
        texto: error.ordenId
          ? 'Esta cuenta se unió a otra. Sus descuentos y cortesías se ven en la cuenta principal.'
          : 'Esta cuenta ya no está abierta. Actualizamos la pantalla.',
        cuentaCerrada: true,
        ...(error.ordenId ? { ordenPrincipalId: error.ordenId } : {}),
      };
    case 'CONFLICTO':
      return {
        texto: MENSAJE_CONCURRENTE.test(error.message)
          ? 'Otra persona está cambiando esta cuenta a la vez. Actualizamos la pantalla; vuelve a intentarlo.'
          : `${error.message.replace(/\.?$/, '.')} Actualizamos la pantalla.`,
      };
    case 'NO_ENCONTRADO':
      return { texto: 'Esto ya no está en la cuenta. Actualizamos la pantalla.' };
    case 'PROHIBIDO':
      return { texto: 'Tu rol no puede hacer esto.' };
    default:
      return null;
  }
}
