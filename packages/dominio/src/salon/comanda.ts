/**
 * Partes de comanda y partes de stock de una línea enviada (historia 004, criterios 74 y 75; ruta crítica P2).
 * Reglas puras: no conocen la base ni los paquetes de contratos. La línea se describe con la forma mínima que
 * necesitan; la `LineaPreparada` de `packages/contratos` (la que guarda cada ítem) la cumple tal cual. (Este
 * paquete no puede importar los contratos, que ya dependen de él.)
 *
 * Fase A: solo las firmas; cada función lanza `Error('No implementado')` hasta la tarea T13.
 */
import type { TipoControlStock, TipoProducto } from '../carta/catalogos';
import type { RolParte, TiempoServicio } from './catalogos';

/** Un modificador elegido en una línea, con el producto al que va ligado, si lo tiene. */
export interface ModificadorDeLinea {
  nombre: string;
  productoLigado: {
    id: string;
    nombre: string;
    estacionId: string | null;
    tipoControlStock: TipoControlStock;
  } | null;
}

/** Un componente de un combo o un menú del día, con su cantidad por unidad de la línea. */
export interface ComponenteDeLinea {
  productoId: string;
  nombre: string;
  cantidad: number;
  estacionId: string | null;
  tipoControlStock: TipoControlStock;
}

/** Lo que `partesDeComanda` y `partesDeStock` necesitan de una `LineaPreparada` (003, criterio 52). */
export interface LineaParaPartes {
  productoId: string;
  nombre: string;
  tipo: TipoProducto;
  /** Cantidad de la línea, entera de 1 a 999. */
  cantidad: number;
  estacionId: string | null;
  tipoControlStock: TipoControlStock;
  modificadores: readonly ModificadorDeLinea[];
  componentes: readonly ComponenteDeLinea[];
}

/** Lo que el mozo eligió para la línea además del producto (criterio 74). */
export interface OpcionesDeComanda {
  observacion?: string | null;
  tiempo: TiempoServicio;
  paraLlevar: boolean;
}

/** Lo que va a una estación por un ítem (criterio 74). */
export interface ParteDeComanda {
  estacionId: string;
  rol: RolParte;
  productoId: string;
  nombre: string;
  cantidad: number;
  /** Nombres de los modificadores que se le muestran a la estación, en el orden elegido. */
  modificadores: string[];
  /** El combo o el producto del que sale la parte; `null` en la parte `PRODUCTO` de un producto simple. */
  contexto: string | null;
  observacion: string | null;
  tiempo: TiempoServicio;
  paraLlevar: boolean;
}

/** Lo que una línea consume de un producto con control de stock (criterio 75). */
export interface ParteDeStock {
  productoId: string;
  nombre: string;
  cantidad: number;
  tipoControlStock: Exclude<TipoControlStock, 'SIN_CONTROL'>;
}

/**
 * Partes de comanda de una línea, en el orden y con las reglas del criterio 74. Una parte sin estación no va a
 * ninguna: no aparece.
 */
export function partesDeComanda(
  linea: LineaParaPartes,
  opciones: OpcionesDeComanda,
): ParteDeComanda[] {
  void linea;
  void opciones;
  throw new Error('No implementado');
}

/**
 * Partes de stock de una línea (criterio 75): el producto, sus componentes y sus productos ligados, sin los
 * `SIN_CONTROL` y sumando por producto. `cantidad` reemplaza la de la línea (anulaciones parciales); 0,
 * negativa, decimal o mayor que la de la línea lanza `RangeError`.
 */
export function partesDeStock(linea: LineaParaPartes, cantidad?: number): ParteDeStock[] {
  void linea;
  void cantidad;
  throw new Error('No implementado');
}

/** Suma por producto las partes de stock de varias líneas de un mismo envío (criterio 75). */
export function partesDeStockDeEnvio(lineas: readonly LineaParaPartes[]): ParteDeStock[] {
  void lineas;
  throw new Error('No implementado');
}
