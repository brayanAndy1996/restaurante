/**
 * Partes de comanda y partes de stock de una línea enviada (historia 004, criterios 74 y 75; ruta crítica P2).
 * Reglas puras: no conocen la base ni los paquetes de contratos. La línea se describe con la forma mínima que
 * necesitan; la `LineaPreparada` de `packages/contratos` (la que guarda cada ítem) la cumple tal cual. (Este
 * paquete no puede importar los contratos, que ya dependen de él.)
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

/** Cantidad entera de 1 a 999 (la de una línea). */
const esCantidadValida = (cantidad: number, maximo: number): boolean =>
  Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= maximo;

/**
 * Partes de comanda de una línea, en el orden y con las reglas del criterio 74. Una parte sin estación no va a
 * ninguna: no aparece.
 *
 * - `SIMPLE` con estación E: la parte `PRODUCTO` en E con todos los modificadores elegidos y, después, una
 *   parte `LIGADO` por cada modificador cuyo producto ligado tiene otra estación (no nula).
 * - `SIMPLE` sin estación: solo las partes `LIGADO` de sus productos ligados con estación.
 * - `COMBO` y `MENU_DEL_DIA`: una parte `COMPONENTE` por componente con estación (cantidad del componente ×
 *   la de la línea, con los modificadores sin producto ligado) y después una parte `LIGADO` por producto ligado
 *   con estación. Sin partes `COMPONENTE`, los modificadores sin ligado van en cada parte `LIGADO`.
 */
export function partesDeComanda(
  linea: LineaParaPartes,
  opciones: OpcionesDeComanda,
): ParteDeComanda[] {
  const observacion = opciones.observacion ?? null;
  const comunes = { observacion, tiempo: opciones.tiempo, paraLlevar: opciones.paraLlevar };
  const ligados = linea.modificadores.flatMap((m) =>
    m.productoLigado === null ? [] : [m.productoLigado],
  );
  const parteLigada = (
    ligado: NonNullable<ModificadorDeLinea['productoLigado']>,
    estacionId: string,
    modificadores: string[],
  ): ParteDeComanda => ({
    estacionId,
    rol: 'LIGADO',
    productoId: ligado.id,
    nombre: ligado.nombre,
    cantidad: linea.cantidad,
    modificadores,
    contexto: linea.nombre,
    ...comunes,
  });
  const partes: ParteDeComanda[] = [];

  if (linea.tipo === 'SIMPLE') {
    if (linea.estacionId !== null) {
      partes.push({
        estacionId: linea.estacionId,
        rol: 'PRODUCTO',
        productoId: linea.productoId,
        nombre: linea.nombre,
        cantidad: linea.cantidad,
        modificadores: linea.modificadores.map((m) => m.nombre),
        contexto: null,
        ...comunes,
      });
    }
    for (const ligado of ligados) {
      if (ligado.estacionId !== null && ligado.estacionId !== linea.estacionId) {
        partes.push(parteLigada(ligado, ligado.estacionId, []));
      }
    }
    return partes;
  }

  // COMBO y MENU_DEL_DIA.
  const sinLigado = linea.modificadores
    .filter((m) => m.productoLigado === null)
    .map((m) => m.nombre);
  const componentes = linea.componentes.filter((c) => c.estacionId !== null);
  for (const c of componentes) {
    partes.push({
      estacionId: c.estacionId as string,
      rol: 'COMPONENTE',
      productoId: c.productoId,
      nombre: c.nombre,
      cantidad: c.cantidad * linea.cantidad,
      modificadores: [...sinLigado],
      contexto: linea.nombre,
      ...comunes,
    });
  }
  for (const ligado of ligados) {
    if (ligado.estacionId === null) continue;
    partes.push(
      parteLigada(ligado, ligado.estacionId, componentes.length === 0 ? [...sinLigado] : []),
    );
  }
  return partes;
}

/** Suma por producto, en el orden en que cada producto aparece por primera vez. */
function sumarPorProducto(partes: readonly ParteDeStock[]): ParteDeStock[] {
  const porProducto = new Map<string, ParteDeStock>();
  for (const parte of partes) {
    const actual = porProducto.get(parte.productoId);
    if (actual === undefined) porProducto.set(parte.productoId, { ...parte });
    else actual.cantidad += parte.cantidad;
  }
  return [...porProducto.values()];
}

/**
 * Partes de stock de una línea (criterio 75): el producto, sus componentes y sus productos ligados, sin los
 * `SIN_CONTROL` y sumando por producto. `cantidad` reemplaza la de la línea (anulaciones parciales); 0,
 * negativa, decimal o mayor que la de la línea lanza `RangeError`.
 */
export function partesDeStock(linea: LineaParaPartes, cantidad?: number): ParteDeStock[] {
  if (!esCantidadValida(linea.cantidad, Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('La cantidad de la línea debe ser un entero positivo');
  }
  const consumida = cantidad ?? linea.cantidad;
  if (!esCantidadValida(consumida, linea.cantidad)) {
    throw new RangeError(
      `La cantidad debe ser un entero de 1 a la cantidad de la línea (${linea.cantidad})`,
    );
  }
  const partes: ParteDeStock[] = [];
  const agregar = (
    productoId: string,
    nombre: string,
    cantidadParte: number,
    tipoControlStock: ParteDeStock['tipoControlStock'] | 'SIN_CONTROL',
  ): void => {
    if (tipoControlStock === 'SIN_CONTROL') return;
    partes.push({ productoId, nombre, cantidad: cantidadParte, tipoControlStock });
  };
  agregar(linea.productoId, linea.nombre, consumida, linea.tipoControlStock);
  for (const c of linea.componentes) {
    agregar(c.productoId, c.nombre, c.cantidad * consumida, c.tipoControlStock);
  }
  for (const m of linea.modificadores) {
    if (m.productoLigado === null) continue;
    agregar(
      m.productoLigado.id,
      m.productoLigado.nombre,
      consumida,
      m.productoLigado.tipoControlStock,
    );
  }
  return sumarPorProducto(partes);
}

/** Suma por producto las partes de stock de varias líneas de un mismo envío (criterio 75). */
export function partesDeStockDeEnvio(lineas: readonly LineaParaPartes[]): ParteDeStock[] {
  return sumarPorProducto(lineas.flatMap((linea) => partesDeStock(linea)));
}
