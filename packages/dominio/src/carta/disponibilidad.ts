/**
 * Disponibilidad de los productos de la carta (historia 003, criterio 59; no es ruta crítica).
 *
 * Fase A: solo las firmas y los tipos. Cada función lanza `Error('No implementado')` hasta la tarea T23.
 */
import type { HastaAgotado, MotivoNoVendible, TipoProducto } from './catalogos';

/** Agotado guardado de un producto en una sucursal: el día operativo en que se marcó y hasta cuándo dura. */
export interface AgotadoGuardado {
  diaOperativo: string;
  hasta: HastaAgotado;
}

/**
 * `true` si el agotado sigue vigente: `REACTIVAR` siempre; `FIN_DEL_DIA` mientras `diaOperativoActual`
 * sea el día en que se marcó (criterio 59).
 */
export function agotadoVigente(agotado: AgotadoGuardado, diaOperativoActual: string): boolean {
  void agotado;
  void diaOperativoActual;
  throw new Error('No implementado');
}

/** Lo que `vendibilidad` necesita de un producto, ya resuelto para una sucursal (criterio 59). */
export interface ProductoParaVendibilidad {
  activo: boolean;
  disponibleEnSucursal: boolean;
  /** Agotado vigente (ya calculado con `agotadoVigente`). */
  agotado: boolean;
  tipo: TipoProducto;
  precio: string | null;
  componentes: readonly { disponible: boolean }[];
  grupos: readonly {
    minimo: number;
    modificadores: readonly { disponible: boolean }[];
  }[];
  /** Cantidad de opciones del día armadas para el día operativo actual (solo cuenta en `MENU_DEL_DIA`). */
  opcionesDelDia: number;
}

export interface ResultadoVendibilidad {
  vendible: boolean;
  /** El primer motivo que aplica, en el orden de `MOTIVOS_NO_VENDIBLE`; `null` si es vendible. */
  motivo: MotivoNoVendible | null;
}

/** Si el producto se puede comandar ahora en la sucursal, y si no, por qué (criterio 59). */
export function vendibilidad(producto: ProductoParaVendibilidad): ResultadoVendibilidad {
  void producto;
  throw new Error('No implementado');
}
