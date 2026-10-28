/**
 * Reglas puras de montos de la carta (historia 003, criterios 55 a 57; ruta crítica). Todas reciben y
 * devuelven montos como texto decimal (`"28.00"`), calculan con `decimal.js` (nunca con números de coma
 * flotante) y devuelven siempre 2 decimales. Un monto de entrada que no cumple `^\d{1,8}(\.\d{1,2})?$`
 * lanza `RangeError`: ni números de JavaScript, ni negativos, ni exponentes, ni espacios.
 */
import Decimal from 'decimal.js';
import { CANTIDAD_MAXIMA_LINEA, type CodigoErrorSeleccion } from './catalogos';

/**
 * Copia propia de `Decimal`: la configuración (precisión y redondeo) no depende de la que otro código
 * haya fijado en el `Decimal` global. Con 2 decimales en las entradas y una cantidad entera, todo cálculo
 * es exacto; la precisión sobra (8 enteros por 999 caben en 12 dígitos).
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const FORMATO_MONTO = /^\d{1,8}(\.\d{1,2})?$/;

/** Convierte un monto de entrada a `Decimal` o lanza `RangeError` (criterios 55 a 57). */
function aDecimal(monto: unknown, nombre: string): Decimal {
  if (typeof monto !== 'string' || !FORMATO_MONTO.test(monto)) {
    throw new RangeError(
      `${nombre} no es un monto válido: se esperaba un texto decimal con hasta 8 enteros y 2 decimales`,
    );
  }
  return new D(monto);
}

const dosDecimales = (valor: Decimal): string => valor.toFixed(2);

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
  // Los dos se validan siempre, aunque el de la sucursal tape al de la empresa: un dato corrupto no pasa.
  const empresa = precioEmpresa === null ? null : aDecimal(precioEmpresa, 'precioEmpresa');
  const sucursal = precioSucursal === null ? null : aDecimal(precioSucursal, 'precioSucursal');
  const efectivo = sucursal ?? empresa;
  return efectivo === null ? null : dosDecimales(efectivo);
}

/**
 * Valida la selección de modificadores contra los grupos (criterio 56). Los errores salen primero por
 * cada elegido en el orden recibido y luego por cada grupo en el orden de `grupos`.
 */
export function validarSeleccion(
  grupos: readonly GrupoDeSeleccion[],
  elegidos: readonly string[],
): ResultadoSeleccion {
  // Cada modificador pertenece a un solo grupo dentro de un producto (un grupo se asigna una vez por
  // producto): si un id apareciera en dos, vale el primero.
  const grupoDe = new Map<string, { grupoId: string; disponible: boolean }>();
  for (const grupo of grupos) {
    for (const modificador of grupo.modificadores) {
      if (!grupoDe.has(modificador.id)) {
        grupoDe.set(modificador.id, { grupoId: grupo.id, disponible: modificador.disponible });
      }
    }
  }

  const errores: ErrorSeleccion[] = [];
  const vistos = new Set<string>();
  const repetidosInformados = new Set<string>();
  const distintosPorGrupo = new Map<string, number>();

  // Primero los errores de cada elegido, en el orden recibido.
  for (const modificadorId of elegidos) {
    if (vistos.has(modificadorId)) {
      // Una sola vez por modificador, aunque se repita más de dos veces.
      if (!repetidosInformados.has(modificadorId)) {
        repetidosInformados.add(modificadorId);
        errores.push({ codigo: 'MODIFICADOR_REPETIDO', modificadorId });
      }
      continue;
    }
    vistos.add(modificadorId);
    const pertenece = grupoDe.get(modificadorId);
    if (pertenece === undefined) {
      errores.push({ codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId });
      continue;
    }
    // Un repetido cuenta una sola vez para los mínimos y los máximos.
    distintosPorGrupo.set(pertenece.grupoId, (distintosPorGrupo.get(pertenece.grupoId) ?? 0) + 1);
    if (!pertenece.disponible) errores.push({ codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId });
  }

  // Luego los de cada grupo, en el orden de `grupos`.
  for (const grupo of grupos) {
    const cantidad = distintosPorGrupo.get(grupo.id) ?? 0;
    if (cantidad < grupo.minimo) {
      errores.push({
        codigo: 'MENOS_DEL_MINIMO',
        grupoId: grupo.id,
        minimo: grupo.minimo,
        elegidos: cantidad,
      });
    } else if (cantidad > grupo.maximo) {
      errores.push({
        codigo: 'MAS_DEL_MAXIMO',
        grupoId: grupo.id,
        maximo: grupo.maximo,
        elegidos: cantidad,
      });
    }
  }

  return errores.length === 0 ? { valido: true } : { valido: false, errores };
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
  if (
    typeof cantidad !== 'number' ||
    !Number.isInteger(cantidad) ||
    cantidad < 1 ||
    cantidad > CANTIDAD_MAXIMA_LINEA
  ) {
    throw new RangeError(`La cantidad debe ser un entero de 1 a ${CANTIDAD_MAXIMA_LINEA}`);
  }
  // Los montos se validan antes que la selección: un dato corrupto es un error de programación, no una
  // selección inválida del cliente.
  const precio = producto.precio === null ? null : aDecimal(producto.precio, 'precio');
  const extras = new Map<string, Decimal>();
  for (const grupo of producto.grupos) {
    for (const modificador of grupo.modificadores) {
      if (!extras.has(modificador.id)) {
        extras.set(modificador.id, aDecimal(modificador.precioExtra, 'precioExtra'));
      }
    }
  }

  if (precio === null) return { valido: false, errores: [{ codigo: 'PRODUCTO_SIN_PRECIO' }] };
  const seleccion = validarSeleccion(producto.grupos, elegidos);
  if (!seleccion.valido) return { valido: false, errores: seleccion.errores };

  // La selección es válida: cada elegido existe, no se repite y su precio extra está en `extras`.
  let precioUnitario = precio;
  const modificadores = elegidos.map((id) => {
    const extra = extras.get(id)!;
    precioUnitario = precioUnitario.plus(extra);
    return { id, precioExtra: dosDecimales(extra) };
  });
  return {
    valido: true,
    precioUnitario: dosDecimales(precioUnitario),
    total: dosDecimales(precioUnitario.times(cantidad)),
    modificadores,
  };
}
