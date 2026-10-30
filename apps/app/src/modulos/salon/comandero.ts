import type { CartaSucursalRespuesta, ProductoDeVenta } from '@restaurante/contratos';
import {
  calcularLinea,
  LARGO_OBSERVACION,
  type ErrorLinea,
  type GrupoDeSeleccion,
  type ResultadoLinea,
} from '@restaurante/dominio';
import { paraBuscar } from '../../lib/formato';
import { montoEnSoles, montoEsCero } from '../../lib/monto';

/**
 * Lógica del comandero (criterio 91 de 004), sin React: qué productos se ofrecen, cómo se dice por qué uno
 * no se puede vender, la regla de cada grupo de modificadores en palabras y el precio de la línea. El precio
 * lo calcula `calcularLinea` de `packages/dominio`, la misma regla que usa la API al enviar; aquí no se suma
 * ningún monto. No hay cantidades de stock: "quedan N" llega con la sección 6 (decisión 2).
 */

export type FamiliaDeVenta = CartaSucursalRespuesta['familias'][number];
export type GrupoDeProducto = ProductoDeVenta['grupos'][number];

/** Lo elegido en cada grupo: ids de modificador por id de grupo. */
export type SeleccionPorGrupo = Record<string, string[]>;

export { LARGO_OBSERVACION };

// --- Qué se ofrece ----------------------------------------------------------------------------------

/** Los productos de una familia que se venden solos (los que solo son componente u opción no se ofrecen). */
export const productosParaVender = (familia: FamiliaDeVenta): ProductoDeVenta[] =>
  familia.productos.filter((p) => p.seVendeSolo);

/** Las familias con al menos un producto que se vende solo, en el orden de la carta. */
export function familiasParaVender(familias: readonly FamiliaDeVenta[]): FamiliaDeVenta[] {
  return familias
    .map((f) => ({ ...f, productos: productosParaVender(f) }))
    .filter((f) => f.productos.length > 0);
}

/** Los productos de toda la carta cuyo nombre contiene el texto, sin importar tildes ni mayúsculas. */
export function buscarProductos(
  familias: readonly FamiliaDeVenta[],
  texto: string,
): ProductoDeVenta[] {
  const buscado = paraBuscar(texto.trim());
  if (buscado === '') return [];
  return familias.flatMap((f) => f.productos.filter((p) => paraBuscar(p.nombre).includes(buscado)));
}

/**
 * Por qué una baldosa está apagada, en pocas palabras (cabe bajo el nombre en una baldosa de 150 px).
 * `null` si el producto se puede vender.
 */
export function motivoCorto(producto: ProductoDeVenta): string | null {
  if (producto.vendible) return null;
  if (producto.agotado) return producto.agotado.origen === 'SIN_STOCK' ? 'Sin stock' : 'Agotado';
  switch (producto.motivo) {
    case 'AGOTADO':
      return 'Agotado';
    case 'COMPONENTE_NO_DISPONIBLE': {
      const falta = producto.componentes.filter((c) => !c.disponible).map((c) => c.nombre);
      return falta.length === 1 ? `Sin ${falta[0]}` : 'Falta un componente';
    }
    case 'MENU_SIN_ARMAR':
      return 'Menú sin armar';
    case 'OPCIONES_INSUFICIENTES':
      return 'Faltan opciones';
    case 'INACTIVO':
    case 'NO_DISPONIBLE':
      return 'No disponible';
    default:
      return 'No disponible';
  }
}

// --- Grupos de modificadores -------------------------------------------------------------------------

/** La regla de un grupo en palabras: "Obligatorio: elige 1", "Opcional: hasta 2", "Elige de 1 a 3". */
export function reglaDelGrupo(grupo: Pick<GrupoDeProducto, 'minimo' | 'maximo'>): string {
  const { minimo, maximo } = grupo;
  if (maximo === 1) return minimo >= 1 ? 'Obligatorio: elige 1' : 'Opcional: elige 1 o ninguno';
  if (minimo === 0) return `Opcional: hasta ${maximo}`;
  if (minimo === maximo) return `Obligatorio: elige ${minimo}`;
  return `Elige de ${minimo} a ${maximo}`;
}

/** "Sin recargo" o "+ S/ 2.50": lo que cuesta elegir una opción. */
export function recargoDeOpcion(precioExtra: string): string {
  const monto = montoEnSoles(precioExtra);
  return monto === null || montoEsCero(precioExtra) ? 'Sin recargo' : `+ ${monto}`;
}

/** El producto como lo recibe `calcularLinea`: precio efectivo y grupos con sus opciones. */
function productoParaLinea(producto: ProductoDeVenta): {
  precio: string | null;
  grupos: GrupoDeSeleccion[];
} {
  return {
    precio: producto.precio,
    grupos: producto.grupos.map((g) => ({
      id: g.id,
      minimo: g.minimo,
      maximo: g.maximo,
      modificadores: g.modificadores.map((m) => ({
        id: m.id,
        precioExtra: m.precioExtra,
        disponible: m.disponible,
      })),
    })),
  };
}

/** Los ids elegidos, en el orden de los grupos del producto (el orden con que se arma la línea). */
export function elegidosEnOrden(producto: ProductoDeVenta, seleccion: SeleccionPorGrupo): string[] {
  return producto.grupos.flatMap((g) => seleccion[g.id] ?? []);
}

/** Precio de la línea con la selección dada (`calcularLinea`): el unitario con extras y el total. */
export function calcularDeProducto(
  producto: ProductoDeVenta,
  seleccion: SeleccionPorGrupo,
  cantidad: number,
): ResultadoLinea {
  return calcularLinea(productoParaLinea(producto), elegidosEnOrden(producto, seleccion), cantidad);
}

/** Un error de la selección dicho en palabras ("Elige 1 en «Término»"); `null` si no se sabe decirlo. */
export function fraseDeError(error: ErrorLinea, producto: ProductoDeVenta): string | null {
  if (error.codigo === 'MENOS_DEL_MINIMO') {
    const nombre = producto.grupos.find((g) => g.id === error.grupoId)?.nombre ?? 'este grupo';
    return error.minimo === 1
      ? `Elige 1 en «${nombre}»`
      : `Elige al menos ${error.minimo} en «${nombre}»`;
  }
  if (error.codigo === 'MAS_DEL_MAXIMO') {
    const nombre = producto.grupos.find((g) => g.id === error.grupoId)?.nombre ?? 'este grupo';
    return error.maximo === 1
      ? `Elige solo 1 en «${nombre}»`
      : `Elige como máximo ${error.maximo} en «${nombre}»`;
  }
  if (error.codigo === 'MODIFICADOR_NO_DISPONIBLE') {
    return 'Una de las opciones elegidas ya no está disponible';
  }
  if (error.codigo === 'PRODUCTO_SIN_PRECIO') return 'Este producto no se vende solo';
  return null;
}

/** El mensaje de cada grupo que no cumple su regla, por id de grupo (para marcarlo en la hoja). */
export function erroresPorGrupo(
  producto: ProductoDeVenta,
  resultado: ResultadoLinea,
): Record<string, string> {
  if (resultado.valido) return {};
  const mapa: Record<string, string> = {};
  for (const error of resultado.errores) {
    if (error.codigo !== 'MENOS_DEL_MINIMO' && error.codigo !== 'MAS_DEL_MAXIMO') continue;
    const frase = fraseDeError(error, producto);
    if (frase) mapa[error.grupoId] = frase;
  }
  return mapa;
}

/** "Incluye Hamburguesa clásica" / "Incluye 2 × Alitas, Papas": lo que trae un combo o un menú. */
export function incluyeDelProducto(producto: ProductoDeVenta): string | null {
  if (producto.componentes.length === 0) return null;
  const partes = producto.componentes.map((c) =>
    c.cantidad === 1 ? c.nombre : `${c.cantidad} × ${c.nombre}`,
  );
  return `Incluye ${partes.join(', ')}`;
}
