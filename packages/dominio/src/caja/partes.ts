/**
 * División de la cuenta (historia 006, criterios 17 a 20; ruta crítica P1). `cuenta` es la entrada de
 * `calcularCuenta` (las funciones la calculan por dentro) y `partesAnteriores` son las partes ya cobradas tal como
 * las devolvió `calcularParte`: la API las guarda en `cobro.detalle_parte`. FIRMAS de la fase A.
 */
import type { AfectacionIgv } from '../carta';
import type { FormatoComprobante, TipoParte } from './catalogos';
import type { CuentaEntrada, Gratuita, TotalesCuenta } from './montos';

/** Qué se cobra ahora. `items`: de 1 a 200, `cantidad` de 1 a 999; `partesRestantes`: de 1 a 50. */
export type ParteEntrada =
  | { tipo: 'TOTAL' }
  | { tipo: 'ITEMS'; items: readonly { itemId: string; cantidad: number }[] }
  | { tipo: 'IGUALES'; partesRestantes: number };

/** Una línea del comprobante de una parte. En el formato `CONSUMO`, las líneas agrupadas no tienen `itemId`. */
export interface LineaDeParte {
  /** `null` en las líneas "Por consumo" (una por afectación). */
  itemId: string | null;
  /** Unidades que cubre la línea; en las líneas por consumo, `1`. */
  cantidad: number;
  afectacion: AfectacionIgv;
  bruto: string;
  descuento: string;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
  gratuita: Gratuita | null;
}

/** Una parte válida: el detalle del comprobante, sus totales y si con ella no falta nada. */
export interface ParteCalculada {
  tipo: TipoParte;
  formato: FormatoComprobante;
  lineas: LineaDeParte[];
  totales: TotalesCuenta;
  cierraLaCuenta: boolean;
}

export type ResultadoParte =
  | ({ valida: true } & ParteCalculada)
  | { valida: false; codigo: 'PARTE_INVALIDA' | 'NADA_QUE_COBRAR' };

export type ResultadoCambioDeCuenta =
  { permitido: true } | { permitido: false; codigo: 'CUENTA_COBRADA_EN_PARTE' };

/** Calcula lo que se cobra ahora de la cuenta, descontando lo que ya tomaron las partes anteriores. */
export function calcularParte(
  _cuenta: CuentaEntrada,
  _partesAnteriores: readonly ParteCalculada[],
  _parte: ParteEntrada,
  _formato: FormatoComprobante,
): ResultadoParte {
  throw new Error('No implementado');
}

/** Si la cuenta nueva (después de enviar, anular o unir) sigue cuadrando con lo ya cobrado (criterio 20). */
export function cambioDeCuentaPermitido(
  _cuentaNueva: CuentaEntrada,
  _partesAnteriores: readonly ParteCalculada[],
): ResultadoCambioDeCuenta {
  throw new Error('No implementado');
}
