import type { ObjetivoAutorizacion } from '@restaurante/contratos';
import { autorizacionInvalida, type AutorizacionConsumida } from './autorizacion.service';

/**
 * Un monto escrito como el esquema lo admite (`^\d{1,8}(\.\d{1,2})?$`) con exactamente 2 decimales y sin ceros a la
 * izquierda: `"10"` y `"010.0"` son `"10.00"`.
 */
export function normalizarValor(valor: string): string {
  const [entera = '0', decimales = ''] = valor.split('.');
  const sinCeros = entera.replace(/^0+(?=\d)/, '');
  return `${sinCeros}.${decimales.padEnd(2, '0')}`;
}

/**
 * La forma normalizada del objetivo de una autorización (historia 006, criterio 40): ids en minúsculas y `valor` con
 * 2 decimales, con las claves siempre en el mismo orden. Es la que guarda `POST /autorizaciones` y con la que
 * `exigirObjetivo` compara.
 */
export function normalizarObjetivo(objetivo: ObjetivoAutorizacion): ObjetivoAutorizacion {
  if (objetivo.tipo === 'DESCUENTO') {
    return {
      tipo: 'DESCUENTO',
      ordenId: objetivo.ordenId.toLowerCase(),
      itemId: objetivo.itemId === null ? null : objetivo.itemId.toLowerCase(),
      descuento: {
        tipo: objetivo.descuento.tipo,
        valor: normalizarValor(objetivo.descuento.valor),
      },
    };
  }
  return {
    tipo: 'CORTESIA',
    ordenId: objetivo.ordenId.toLowerCase(),
    itemId: objetivo.itemId.toLowerCase(),
    cantidad: objetivo.cantidad,
  };
}

/** Las dos formas normalizadas dicen exactamente lo mismo. */
function mismoObjetivo(a: ObjetivoAutorizacion, b: ObjetivoAutorizacion): boolean {
  if (a.tipo === 'DESCUENTO' && b.tipo === 'DESCUENTO') {
    return (
      a.ordenId === b.ordenId &&
      a.itemId === b.itemId &&
      a.descuento.tipo === b.descuento.tipo &&
      a.descuento.valor === b.descuento.valor
    );
  }
  if (a.tipo === 'CORTESIA' && b.tipo === 'CORTESIA') {
    return a.ordenId === b.ordenId && a.itemId === b.itemId && a.cantidad === b.cantidad;
  }
  return false;
}

/**
 * Compara el objetivo de la autorización que `@Permiso` consumió con el objetivo que se está ejecutando (historia 006,
 * criterio 40, pregunta 9): los descuentos y las cortesías de Mozo y Cajero solo valen con una clave atada a
 * exactamente esa cuenta, ese ítem y ese descuento o esa cantidad. Distinto, de otra acción o ausente: 403
 * `AUTORIZACION_INVALIDA` (la reversión de la transacción devuelve la autorización). Quien aplica sin clave
 * (`consumida` `undefined`: Supervisor y Administrador) pasa.
 */
export function exigirObjetivo(
  consumida: AutorizacionConsumida | undefined,
  esperado: ObjetivoAutorizacion,
): void {
  if (consumida === undefined) return;
  if (consumida.objetivo === null || consumida.objetivo === undefined) throw autorizacionInvalida();
  if (!mismoObjetivo(normalizarObjetivo(consumida.objetivo), normalizarObjetivo(esperado))) {
    throw autorizacionInvalida();
  }
}
