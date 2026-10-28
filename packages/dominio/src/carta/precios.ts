/**
 * Reglas puras de montos de la carta (historia 003, criterios 55 a 57; ruta crítica). Todas reciben y
 * devuelven montos como texto decimal (`"28.00"`) y calcularán con `decimal.js`.
 *
 * Fase A: solo las firmas y los tipos. Cada función lanza `Error('No implementado')` hasta la tarea T6.
 */
import type { CodigoErrorSeleccion } from './catalogos';

/** Un modificador tal como lo necesita la validación y el cálculo. `precioExtra` es un monto de 0 o más. */
export interface ModificadorDeSeleccion {
  id: string;
  precioExtra: string;
  disponible: boolean;
}

/** Un grupo de modificadores de un producto, con su regla de mínimo y máximo. */
export interface GrupoDeSeleccion {
  id: string;
  minimo: number;
  maximo: number;
  modificadores: readonly ModificadorDeSeleccion[];
}

/** Error de `validarSeleccion`; `codigo` es uno de `ERRORES_SELECCION` y el resto, sus datos (criterio 56). */
export type ErrorSeleccion =
  | { codigo: Extract<CodigoErrorSeleccion, 'MODIFICADOR_DESCONOCIDO'>; modificadorId: string }
  | { codigo: Extract<CodigoErrorSeleccion, 'MODIFICADOR_REPETIDO'>; modificadorId: string }
  | { codigo: Extract<CodigoErrorSeleccion, 'MODIFICADOR_NO_DISPONIBLE'>; modificadorId: string }
  | {
      codigo: Extract<CodigoErrorSeleccion, 'MENOS_DEL_MINIMO'>;
      grupoId: string;
      minimo: number;
      elegidos: number;
    }
  | {
      codigo: Extract<CodigoErrorSeleccion, 'MAS_DEL_MAXIMO'>;
      grupoId: string;
      maximo: number;
      elegidos: number;
    };

export type ResultadoSeleccion = { valido: true } | { valido: false; errores: ErrorSeleccion[] };

/** Error de `calcularLinea`: los de la selección o `PRODUCTO_SIN_PRECIO` (producto que no se vende solo). */
export type ErrorLinea = ErrorSeleccion | { codigo: 'PRODUCTO_SIN_PRECIO' };

/** Producto para `calcularLinea`: su precio efectivo (`null` si no se vende solo) y sus grupos. */
export interface ProductoParaLinea {
  precio: string | null;
  grupos: readonly GrupoDeSeleccion[];
}

export type ResultadoLinea =
  | {
      valido: true;
      precioUnitario: string;
      total: string;
      modificadores: { id: string; precioExtra: string }[];
    }
  | { valido: false; errores: ErrorLinea[] };

/**
 * Precio efectivo (criterio 55): el de la sucursal si existe; si no, el de la empresa. Devuelve 2
 * decimales; `null` si ambos son `null`. Lanza `RangeError` con un monto que no cumple
 * `^\d{1,8}(\.\d{1,2})?$`.
 */
export function precioEfectivo(
  precioEmpresa: string | null,
  precioSucursal: string | null,
): string | null {
  void precioEmpresa;
  void precioSucursal;
  throw new Error('No implementado');
}

/**
 * Valida la selección de modificadores contra los grupos (criterio 56). Los errores salen primero por
 * cada elegido en el orden recibido y luego por cada grupo en el orden de `grupos`.
 */
export function validarSeleccion(
  grupos: readonly GrupoDeSeleccion[],
  elegidos: readonly string[],
): ResultadoSeleccion {
  void grupos;
  void elegidos;
  throw new Error('No implementado');
}

/**
 * Precio de una línea (criterio 57): `precioUnitario` = precio + suma de los precios extra elegidos y
 * `total` = `precioUnitario` × `cantidad`. `cantidad` es un entero de 1 a 999 (`CANTIDAD_MAXIMA_LINEA`);
 * otra lanza `RangeError`.
 */
export function calcularLinea(
  producto: ProductoParaLinea,
  elegidos: readonly string[],
  cantidad: number,
): ResultadoLinea {
  void producto;
  void elegidos;
  void cantidad;
  throw new Error('No implementado');
}
