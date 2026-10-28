/**
 * Disponibilidad de los productos de la carta (historia 003, criterio 59; no es ruta crítica): si un
 * agotado sigue vigente y si un producto se puede comandar ahora en una sucursal, con su motivo. Reglas
 * puras: no leen reloj ni base de datos; quien las usa resuelve antes el día operativo y la disponibilidad
 * de cada componente y de cada opción.
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
  if (agotado.hasta === 'REACTIVAR') return true;
  return agotado.hasta === 'FIN_DEL_DIA' && agotado.diaOperativo === diaOperativoActual;
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

/**
 * Si el producto se puede comandar ahora en la sucursal, y si no, por qué (criterio 59). El motivo es el
 * primero que aplica, en el orden de `MOTIVOS_NO_VENDIBLE`:
 *
 * 1. `INACTIVO`: el producto está desactivado.
 * 2. `NO_DISPONIBLE`: no se ofrece en la sucursal.
 * 3. `AGOTADO`: tiene un agotado vigente.
 * 4. `COMPONENTE_NO_DISPONIBLE`: algún componente fijo no está disponible.
 * 5. `MENU_SIN_ARMAR`: es un menú del día sin opciones para el día operativo actual.
 * 6. `OPCIONES_INSUFICIENTES`: algún grupo tiene menos opciones disponibles que su mínimo.
 *
 * `precio` no interviene: un producto que no se vende solo también puede estar agotado o no vendible
 * (Cocina lo marca); quien lo filtra para vender es `seVendeSolo`.
 */
export function vendibilidad(producto: ProductoParaVendibilidad): ResultadoVendibilidad {
  const motivo = motivoNoVendible(producto);
  return { vendible: motivo === null, motivo };
}

function motivoNoVendible(producto: ProductoParaVendibilidad): MotivoNoVendible | null {
  if (!producto.activo) return 'INACTIVO';
  if (!producto.disponibleEnSucursal) return 'NO_DISPONIBLE';
  if (producto.agotado) return 'AGOTADO';
  if (producto.componentes.some((componente) => !componente.disponible)) {
    return 'COMPONENTE_NO_DISPONIBLE';
  }
  if (producto.tipo === 'MENU_DEL_DIA' && producto.opcionesDelDia <= 0) return 'MENU_SIN_ARMAR';
  const insuficiente = producto.grupos.some(
    (grupo) =>
      grupo.modificadores.filter((modificador) => modificador.disponible).length < grupo.minimo,
  );
  return insuficiente ? 'OPCIONES_INSUFICIENTES' : null;
}
