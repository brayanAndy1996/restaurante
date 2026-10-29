import {
  precuentaRespuestaSchema,
  type OrdenRespuesta,
  type PrecuentaEntrada,
  type PrecuentaRespuesta,
} from '@restaurante/contratos';
import { api } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { estaAbierta } from './ordenes';

/**
 * La pre-cuenta (criterios 50 a 54 y 95 de 004): la llamada a la API y las reglas de presentación, sin React.
 * El total llega calculado por la API con `packages/dominio` (`totalOrden`, IGV incluido, sin desglose); aquí
 * no se suma ni se desglosa nada.
 */

/**
 * `POST /ordenes/:id/precuentas`. `entrada.id` lo genera la PWA; la clave de idempotencia viene de
 * `enviarSinPerder`. Si la cuenta ya está en pre-cuenta y no cambió, la API devuelve la vigente (criterio 52).
 */
export const pedirPrecuenta = (
  ordenId: string,
  entrada: PrecuentaEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.post(`/ordenes/${ordenId}/precuentas`, entrada, {
    esquema: precuentaRespuestaSchema,
    ...extra,
  });

/** "Pedir pre-cuenta" aparece con la cuenta abierta y al menos un ítem con cantidad vigente (criterio 50). */
export const sePuedePedirPrecuenta = (orden: Pick<OrdenRespuesta, 'estado' | 'items'>) =>
  estaAbierta(orden) && orden.items.some((i) => i.estado !== 'ANULADO' && i.cantidadVigente > 0);

/**
 * La pre-cuenta que se mira sigue siendo la vigente de la cuenta (decisión 10). Un envío, una anulación o una
 * unión con ítems la invalidan: la cuenta vuelve a `ABIERTA` o su vigente tiene otro número. Mover no la
 * invalida.
 */
export const esLaVigente = (
  orden: Pick<OrdenRespuesta, 'estado' | 'precuentaVigente'>,
  precuenta: Pick<PrecuentaRespuesta, 'numero'>,
): boolean =>
  orden.estado === 'EN_PRECUENTA' && orden.precuentaVigente?.numero === precuenta.numero;

/**
 * La nota de la API en párrafos: "Precios con IGV incluido. No es un comprobante de pago." junta, y la frase
 * del ICBPER ("El ICBPER se suma al cobrar.", solo si hay un producto con ICBPER) aparte para destacarla.
 */
export function frasesDeLaNota(nota: string): string[] {
  const frases = nota
    .split(/(?<=\.)\s+/)
    .map((f) => f.trim())
    .filter((f) => f !== '');
  const resto = frases.filter((f) => !esFraseDeIcbper(f)).join(' ');
  return [resto, ...frases.filter(esFraseDeIcbper)].filter((f) => f !== '');
}

/** La frase del ICBPER, para destacarla (criterio 51). */
export const esFraseDeIcbper = (frase: string): boolean => /ICBPER/i.test(frase);

export const TEXTO_SIN_IMPRESION = 'La impresión llega con el puente de impresión.';
