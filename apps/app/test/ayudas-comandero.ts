import type {
  CartaSucursalRespuesta,
  OrdenRespuesta,
  ProductoDeVenta,
  SesionRespuesta,
} from '@restaurante/contratos';
import { ID, json, servidor, type Manejador } from './ayudas';
import { ordenDeMesa, sesionDeRol, uuid } from './ayudas-salon';

type Grupo = ProductoDeVenta['grupos'][number];
type Modificador = Grupo['modificadores'][number];

export const P_LOMO = uuid(2001);
export const P_COMBO = uuid(2002);
export const P_GASEOSA = uuid(2003);
export const P_CHICHA = uuid(2004);
export const P_MENU = uuid(2005);
export const P_HUEVO_FRITO = uuid(2006);

export const G_TERMINO = uuid(2101);
export const G_EXTRAS = uuid(2102);
export const G_BEBIDA = uuid(2103);
export const G_FONDO = uuid(2104);

export const M_JUGOSO = uuid(2201);
export const M_TRES_CUARTOS = uuid(2202);
export const M_BIEN_COCIDO = uuid(2203);
export const M_HUEVO = uuid(2204);
export const M_PLATANO = uuid(2205);
export const M_QUESO = uuid(2206);
export const M_CHICHA = uuid(2207);
export const M_INCA = uuid(2208);
export const M_CERVEZA = uuid(2209);

const modificador = (
  id: string,
  nombre: string,
  precioExtra = '0.00',
  disponible = true,
): Modificador => ({ id, nombre, precioExtra, productoId: null, disponible });

/** Un producto de la vista de la sucursal con lo mínimo; cada prueba cambia lo que necesita. */
export function productoDeVenta(
  id: string,
  nombre: string,
  extra: Partial<ProductoDeVenta> = {},
): ProductoDeVenta {
  return {
    id,
    tipo: 'SIMPLE',
    nombre,
    descripcion: null,
    fotoUrl: null,
    precio: '10.00',
    seVendeSolo: true,
    afectacionIgv: 'GRAVADO',
    aplicaIcbper: false,
    estacionId: null,
    tipoControlStock: 'SIN_CONTROL',
    agotado: null,
    vendible: true,
    motivo: null,
    grupos: [],
    componentes: [],
    ...extra,
  };
}

/** La carta de ejemplo del comandero (como la de `spec.md`, más un producto agotado y otro que no se vende solo). */
export function cartaDeEjemplo(): CartaSucursalRespuesta {
  return {
    sucursalId: ID.sucursalA,
    diaOperativo: '2026-10-29',
    estaciones: [],
    familias: [
      {
        id: uuid(2301),
        nombre: 'Fondos',
        productos: [
          productoDeVenta(P_LOMO, 'Lomo saltado', {
            precio: '28.00',
            grupos: [
              {
                id: G_TERMINO,
                nombre: 'Término',
                seleccion: 'UNICA',
                minimo: 1,
                maximo: 1,
                obligatorio: true,
                modificadores: [
                  modificador(M_JUGOSO, 'Jugoso'),
                  modificador(M_TRES_CUARTOS, '3/4'),
                  modificador(M_BIEN_COCIDO, 'Bien cocido'),
                ],
              },
              {
                id: G_EXTRAS,
                nombre: 'Extras',
                seleccion: 'MULTIPLE',
                minimo: 0,
                maximo: 2,
                obligatorio: false,
                modificadores: [
                  modificador(M_HUEVO, 'Huevo', '2.50'),
                  modificador(M_PLATANO, 'Plátano', '3.00'),
                  modificador(M_QUESO, 'Queso', '2.00'),
                ],
              },
            ],
          }),
          productoDeVenta(P_COMBO, 'Combo hamburguesa', {
            tipo: 'COMBO',
            precio: '22.90',
            componentes: [
              {
                productoId: uuid(2401),
                nombre: 'Hamburguesa clásica',
                cantidad: 1,
                estacionId: null,
                disponible: true,
              },
            ],
            grupos: [
              {
                id: G_BEBIDA,
                nombre: 'Bebida',
                seleccion: 'UNICA',
                minimo: 1,
                maximo: 1,
                obligatorio: true,
                modificadores: [
                  modificador(M_CHICHA, 'Chicha morada'),
                  modificador(M_INCA, 'Inca Kola'),
                  modificador(M_CERVEZA, 'Cerveza Pilsen', '4.50', false),
                ],
              },
            ],
          }),
          productoDeVenta(P_MENU, 'Menú del día', {
            tipo: 'MENU_DEL_DIA',
            precio: '12.00',
            vendible: false,
            motivo: 'MENU_SIN_ARMAR',
          }),
          // Solo es un ingrediente: no se ofrece.
          productoDeVenta(P_HUEVO_FRITO, 'Huevo frito', { seVendeSolo: false, precio: null }),
        ],
      },
      {
        id: uuid(2302),
        nombre: 'Bebidas',
        productos: [
          productoDeVenta(P_GASEOSA, 'Gaseosa 1 L', { precio: '9.00' }),
          productoDeVenta(P_CHICHA, 'Chicha morada', {
            precio: '8.00',
            vendible: false,
            motivo: 'AGOTADO',
            agotado: { desde: '2026-10-29T16:00:00.000Z', hasta: 'FIN_DEL_DIA', origen: 'MANUAL' },
          }),
        ],
      },
    ],
  };
}

export const ORDEN_ID = uuid(904);

/**
 * El servidor de una cuenta: sesión, la cuenta (se puede cambiar con `.orden`), la carta con `ETag` y,
 * en `extra`, lo que cada prueba necesite (el envío, la marcha).
 */
export function servidorDeCuenta(
  opciones: {
    sesion?: SesionRespuesta;
    orden?: OrdenRespuesta;
    carta?: CartaSucursalRespuesta;
    extra?: Record<string, Manejador>;
  } = {},
) {
  const estado = {
    orden: opciones.orden ?? ordenDeMesa(4),
    carta: opciones.carta ?? cartaDeEjemplo(),
  };
  const s = servidor({
    'GET /sesion': () => json(200, opciones.sesion ?? sesionDeRol('MOZO')),
    'GET /ordenes/*': () => json(200, estado.orden),
    'GET /carta/sucursal': ({ cabeceras }) =>
      cabeceras.get('If-None-Match') === '"carta-1"'
        ? json(304)
        : json(200, estado.carta, { ETag: '"carta-1"' }),
    ...(opciones.extra ?? {}),
  });
  return Object.assign(s, { estado });
}
