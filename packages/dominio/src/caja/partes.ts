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

/**
 * Lo que una parte toma de un ítem de la cuenta (criterio 17): las unidades cobrables, el neto y las bolsas. Hace falta
 * aparte de `lineas` porque en el formato `CONSUMO` las líneas agrupadas no dicen el ítem.
 */
export interface ItemDeParte {
  itemId: string;
  cantidad: number;
  neto: string;
  bolsas: number;
}

/**
 * Una parte válida: `lineas` es el detalle del comprobante, `porItem` lo que la parte toma de cada ítem (en
 * `IGUALES`, solo las líneas de ICBPER), `totales` los de la parte y `cierraLaCuenta` si con ella no falta nada.
 * Facturación la guarda en `comprobante.detalle_parte` (criterio 69) y es la `partesAnteriores` de las siguientes.
 */
export interface ParteCalculada {
  tipo: TipoParte;
  formato: FormatoComprobante;
  lineas: LineaDeParte[];
  porItem: ItemDeParte[];
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
