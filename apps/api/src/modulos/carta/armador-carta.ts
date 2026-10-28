import type { CartaSucursalRespuesta, ProductoDeVenta } from '@restaurante/contratos';
import { precioEfectivo, vendibilidad } from '@restaurante/dominio';
import type { CartaCargada, ProductoCargado } from './cargador-carta';
import { agotadoEstaVigente, productoDisponible } from './disponibilidad-carta';

/**
 * Arma la vista de la carta con lo que cargó `cargador-carta.ts`. Es lógica pura y sin consultas: aplica
 * `precioEfectivo`, `agotadoVigente` y `vendibilidad` de `packages/dominio` (criterios 45, 47, 48 y 59). Ningún
 * otro código de la API suma ni elige un precio de la carta (criterio 58).
 */

/** Disponibilidad de un producto cargado como componente u opción ligada (una sola regla, criterio 45). */
function disponibleComoParte(carta: CartaCargada, productoId: string | null): boolean {
  if (productoId === null) return true;
  const producto = carta.porId.get(productoId);
  return producto !== undefined && productoDisponible(producto, carta.diaOperativo);
}

/**
 * El `productoDeVenta` de un producto cargado (criterio 47). En un `MENU_DEL_DIA` solo van los modificadores
 * elegidos para el día operativo actual (criterio 48). `urlFoto` arma la URL pública de la clave de la foto.
 * Sirve también para un producto que no entra en la vista (inactivo, no disponible…): `prepararLinea` lo
 * necesita para dar el motivo.
 */
export function armarProductoDeVenta(
  carta: CartaCargada,
  producto: ProductoCargado,
  urlFoto: (clave: string) => string,
): ProductoDeVenta {
  const hoy = carta.diaOperativo;
  const vigente = agotadoEstaVigente(producto.agotado, hoy);
  const precio = precioEfectivo(producto.precio, producto.precioSucursal);

  const elegidasDelDia =
    producto.tipo === 'MENU_DEL_DIA' ? carta.opcionesDelDia.get(producto.id) : null;
  const grupos = (carta.gruposDe.get(producto.id) ?? []).map((grupo) => ({
    id: grupo.id,
    nombre: grupo.nombre,
    seleccion: grupo.seleccion,
    minimo: grupo.minimo,
    maximo: grupo.maximo,
    obligatorio: grupo.minimo >= 1,
    modificadores: grupo.modificadores
      .filter((m) => elegidasDelDia === null || (elegidasDelDia?.has(m.id) ?? false))
      .map((m) => ({
        id: m.id,
        nombre: m.nombre,
        precioExtra: m.precioExtra,
        productoId: m.productoLigadoId,
        disponible: disponibleComoParte(carta, m.productoLigadoId),
      })),
  }));

  const componentes = (carta.componentesDe.get(producto.id) ?? []).map((c) => {
    const parte = carta.porId.get(c.productoId);
    return {
      productoId: c.productoId,
      nombre: parte?.nombre ?? '',
      cantidad: c.cantidad,
      estacionId: parte?.estacionId ?? null,
      disponible: disponibleComoParte(carta, c.productoId),
    };
  });

  const { vendible, motivo } = vendibilidad({
    activo: producto.activo && producto.familiaActiva,
    disponibleEnSucursal: producto.disponible,
    agotado: vigente,
    tipo: producto.tipo,
    precio,
    componentes,
    grupos,
    // Para un menú, `grupos` ya trae solo las opciones del día: son las que cuentan.
    opcionesDelDia: grupos.reduce((suma, g) => suma + g.modificadores.length, 0),
  });

  return {
    id: producto.id,
    tipo: producto.tipo,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    fotoUrl: producto.fotoClave === null ? null : urlFoto(producto.fotoClave),
    precio,
    seVendeSolo: producto.seVendeSolo,
    afectacionIgv: producto.afectacionIgv,
    aplicaIcbper: producto.aplicaIcbper,
    estacionId: producto.estacionId,
    tipoControlStock: producto.tipoControlStock,
    agotado:
      vigente && producto.agotado !== null
        ? {
            desde: producto.agotado.desde.toISOString(),
            hasta: producto.agotado.hasta,
            origen: producto.agotado.origen,
          }
        : null,
    vendible,
    motivo,
    grupos,
    componentes,
  };
}

/**
 * La vista de la sucursal (criterios 47 y 48): las familias activas en su orden y, en cada una, los productos
 * activos y disponibles en la sucursal (también los que no se venden solos y los agotados). Una familia sin
 * productos en la vista no aparece.
 */
export function armarVista(
  carta: CartaCargada,
  urlFoto: (clave: string) => string,
): CartaSucursalRespuesta {
  const porFamilia = new Map<string, ProductoDeVenta[]>();
  for (const producto of carta.productos) {
    if (!producto.activo || !producto.familiaActiva || !producto.disponible) continue;
    const lista = porFamilia.get(producto.familiaId) ?? [];
    lista.push(armarProductoDeVenta(carta, producto, urlFoto));
    porFamilia.set(producto.familiaId, lista);
  }
  return {
    sucursalId: carta.sucursalId,
    diaOperativo: carta.diaOperativo,
    estaciones: carta.estaciones,
    familias: carta.familias
      .filter((familia) => porFamilia.has(familia.id))
      .map((familia) => ({
        id: familia.id,
        nombre: familia.nombre,
        productos: porFamilia.get(familia.id) ?? [],
      })),
  };
}
