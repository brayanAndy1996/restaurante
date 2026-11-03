import {
  CANTIDAD_MAXIMA_LLAMADO,
  MAXIMO_LINEAS_LLAMADO,
  calcularLinea,
  totalOrden,
  type ProductoParaLinea,
} from '@restaurante/dominio';
import {
  nuevoId,
  quitarClave,
  type LineaPedido,
  type PedidoGuardado,
  type ProductoMesa,
} from './pedido';

/**
 * Las reglas del pedido que usan `packages/dominio` (`calcularLinea`, `totalOrden`, `validarSeleccion`): los montos
 * y la validez de cada línea. Es el único lugar del modo mesa que arrastra `decimal.js` (unos 13 kB), así que se
 * carga bajo demanda, junto con las hojas, y no pesa en la primera vista (criterio 88).
 */

/** El producto como lo entiende `calcularLinea`: todo lo que la carta muestra está disponible. */
export function paraLinea(producto: ProductoMesa): ProductoParaLinea {
  return {
    precio: producto.precio,
    grupos: producto.grupos.map((g) => ({
      id: g.id,
      minimo: g.minimo,
      maximo: g.maximo,
      modificadores: g.modificadores.map((m) => ({
        id: m.id,
        precioExtra: m.precioExtra,
        disponible: true,
      })),
    })),
  };
}

export interface PrecioDeLinea {
  precioUnitario: string;
  total: string;
}

/** Precio de la línea con `calcularLinea`, o `null` si ya no es una selección válida de ese producto. */
export function precioDeLinea(
  producto: ProductoMesa,
  elegidos: readonly string[],
  cantidad: number,
): PrecioDeLinea | null {
  const resultado = calcularLinea(paraLinea(producto), elegidos, cantidad);
  return resultado.valido
    ? { precioUnitario: resultado.precioUnitario, total: resultado.total }
    : null;
}

/** Total del pedido con `totalOrden`, sumando solo las líneas que se pueden enviar. */
export function totalDelPedido(
  lineas: readonly LineaPedido[],
  productos: ReadonlyMap<string, ProductoMesa>,
  conProblema: (linea: LineaPedido) => boolean,
): string {
  const items = [];
  for (const linea of lineas) {
    const producto = productos.get(linea.productoId);
    if (!producto || conProblema(linea)) continue;
    const precio = precioDeLinea(producto, linea.modificadorIds, linea.cantidad);
    if (precio) {
      items.push({
        precioUnitario: precio.precioUnitario,
        cantidad: linea.cantidad,
        cantidadAnulada: 0,
      });
    }
  }
  return totalOrden(items);
}

/**
 * Por qué una línea no se puede enviar, en palabras, o `null` si está bien: el producto ya no está en la carta
 * ("Ya no se vende"), se agotó ("Se agotó"), una opción se agotó ("Huevo frito ya no está disponible"), la API la
 * rechazó antes (`rechazo`) o ya no es una selección válida.
 */
export function problemaDeLinea(
  linea: LineaPedido,
  producto: ProductoMesa | undefined,
  disponibles: ReadonlyMap<string, ReadonlySet<string>> | null,
  rechazo: string | undefined,
): string | null {
  if (!producto) return 'Ya no se vende';
  const noDisponibles = disponibles?.get(producto.id);
  if (disponibles !== null && noDisponibles === undefined) return 'Se agotó';
  const opciones = new Map(
    producto.grupos.flatMap((g) => g.modificadores.map((m) => [m.id, m.nombre])),
  );
  for (const id of linea.modificadorIds) {
    const nombre = opciones.get(id);
    if (nombre === undefined) return 'Cambiaron las opciones de este plato. Edítalo';
    if (noDisponibles?.has(id)) return `${nombre} ya no está disponible`;
  }
  if (rechazo) return rechazo;
  if (precioDeLinea(producto, linea.modificadorIds, linea.cantidad) === null) {
    return 'Cambiaron las opciones de este plato. Edítalo';
  }
  return null;
}

const mismasOpciones = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export type ResultadoAgregar = { pedido: PedidoGuardado } | { error: 'LLENO' };

/**
 * Agrega una línea. Si ya hay otra igual (mismo plato, mismas opciones y mismas indicaciones) y la suma no pasa de
 * 20, se suman las cantidades para que el mozo vea una sola línea.
 */
export function agregarLinea(
  pedido: PedidoGuardado,
  linea: Omit<LineaPedido, 'clave'>,
): ResultadoAgregar {
  const igual = pedido.lineas.find(
    (l) =>
      l.productoId === linea.productoId &&
      l.observacion === linea.observacion &&
      mismasOpciones(l.modificadorIds, linea.modificadorIds) &&
      l.cantidad + linea.cantidad <= CANTIDAD_MAXIMA_LLAMADO,
  );
  if (igual) {
    return {
      pedido: {
        ...pedido,
        lineas: pedido.lineas.map((l) =>
          l === igual ? { ...l, cantidad: l.cantidad + linea.cantidad } : l,
        ),
        rechazos: quitarClave(pedido.rechazos, igual.clave),
      },
    };
  }
  if (pedido.lineas.length >= MAXIMO_LINEAS_LLAMADO) return { error: 'LLENO' };
  return { pedido: { ...pedido, lineas: [...pedido.lineas, { ...linea, clave: nuevoId() }] } };
}
