import {
  ajusteSucursalRespuestaSchema,
  estacionRespuestaSchema,
  familiaRespuestaSchema,
  fotoRespuestaSchema,
  productoResumenSchema,
  productoRespuestaSchema,
  type AjusteSucursalEntrada,
  type AjusteSucursalRespuesta,
  type EstacionModificarEntrada,
  type EstacionRespuesta,
  type FamiliaModificarEntrada,
  type FamiliaRespuesta,
  type ProductoCrearEntrada,
  type ProductoModificarEntrada,
  type ProductoResumen,
  type SesionRespuesta,
} from '@restaurante/contratos';
import { requisitoPermiso, type TipoControlStock } from '@restaurante/dominio';
import { api, listaDe } from '../../lib/api';

/** Claves de TanStack Query de la carta: todo lo que cuelga de `['carta']` se limpia al cerrar la sesión. */
export const CLAVES = {
  todo: ['carta'] as const,
  estaciones: ['carta', 'estaciones'] as const,
  familias: ['carta', 'familias'] as const,
  productos: ['carta', 'productos'] as const,
  producto: (id: string) => ['carta', 'producto', id] as const,
  /** Una fila por sucursal con el precio y la disponibilidad del producto (003, criterio 18). */
  sucursalesDeProducto: (id: string) => ['carta', 'producto', id, 'sucursales'] as const,
};

// --- Llamadas a la API ----------------------------------------------------------------------------

type Senal = { senal?: AbortSignal };
const conSenal = (senal?: AbortSignal): Senal => (senal ? { senal } : {});

export const listarEstaciones = (senal?: AbortSignal) =>
  api.get('/carta/estaciones', { esquema: listaDe(estacionRespuestaSchema), ...conSenal(senal) });
export const crearEstacion = (nombre: string) =>
  api.post(
    '/carta/estaciones',
    { nombre },
    { esquema: estacionRespuestaSchema, idempotente: true },
  );
export const modificarEstacion = (id: string, cambios: EstacionModificarEntrada) =>
  api.patch(`/carta/estaciones/${id}`, cambios, { esquema: estacionRespuestaSchema });

export const listarFamilias = (senal?: AbortSignal) =>
  api.get('/carta/familias', { esquema: listaDe(familiaRespuestaSchema), ...conSenal(senal) });
export const crearFamilia = (nombre: string) =>
  api.post('/carta/familias', { nombre }, { esquema: familiaRespuestaSchema, idempotente: true });
export const modificarFamilia = (id: string, cambios: FamiliaModificarEntrada) =>
  api.patch(`/carta/familias/${id}`, cambios, { esquema: familiaRespuestaSchema });
export const ordenarFamilias = (ids: string[]) =>
  api.put('/carta/familias/orden', { ids }, { esquema: listaDe(familiaRespuestaSchema) });

export const listarProductos = (senal?: AbortSignal) =>
  api.get('/carta/productos', { esquema: listaDe(productoResumenSchema), ...conSenal(senal) });
export const obtenerProducto = (id: string, senal?: AbortSignal) =>
  api.get(`/carta/productos/${id}`, { esquema: productoRespuestaSchema, ...conSenal(senal) });
export const crearProducto = (entrada: ProductoCrearEntrada) =>
  api.post('/carta/productos', entrada, { esquema: productoRespuestaSchema, idempotente: true });
export const modificarProducto = (id: string, cambios: ProductoModificarEntrada) =>
  api.patch(`/carta/productos/${id}`, cambios, { esquema: productoRespuestaSchema });
export const ordenarProductosDeFamilia = (familiaId: string, ids: string[]) =>
  api.put(
    `/carta/familias/${familiaId}/productos/orden`,
    { ids },
    { esquema: listaDe(productoResumenSchema) },
  );

/** Una fila por sucursal de la empresa, con lo que quien consulta puede cambiar (`editable`). */
export const listarSucursalesDeProducto = (id: string, senal?: AbortSignal) =>
  api.get(`/carta/productos/${id}/sucursales`, {
    esquema: listaDe(ajusteSucursalRespuestaSchema),
    ...conSenal(senal),
  });
/**
 * Guarda el precio y la disponibilidad de una sola sucursal. Lleva clave de idempotencia (se reutiliza
 * en los reintentos por un corte): repetir el mismo ajuste no repite el efecto.
 */
export const ajustarSucursalDeProducto = (
  id: string,
  sucursalId: string,
  ajuste: AjusteSucursalEntrada,
): Promise<AjusteSucursalRespuesta> =>
  api.put(`/carta/productos/${id}/sucursales/${sucursalId}`, ajuste, {
    esquema: ajusteSucursalRespuestaSchema,
    idempotente: true,
  });

/** Sube la foto ya reducida (cuerpo binario con su `Content-Type`). */
export const subirFotoDeProducto = (id: string, foto: Blob) =>
  api.put(`/carta/productos/${id}/foto`, foto, { esquema: fotoRespuestaSchema });
export const quitarFotoDeProducto = (id: string) => api.delete(`/carta/productos/${id}/foto`);

// --- Reglas de presentación -----------------------------------------------------------------------

export const ETIQUETA_DE_CONTROL: Record<TipoControlStock, string> = {
  UNIDADES: 'Por unidades',
  PORCIONES: 'Por porciones',
  SIN_CONTROL: 'Sin control',
};

/** "1 producto", "4 productos". */
export function pluralProductos(cantidad: number): string {
  return cantidad === 1 ? '1 producto' : `${cantidad} productos`;
}

/**
 * Si quien tiene esta sesión puede cambiar el precio y la disponibilidad de una sucursal (criterio 19b):
 * el Administrador en todas; los demás, solo donde su rol en esa sucursal edita la carta. Es solo para
 * ordenar la pantalla: la API vuelve a decidir.
 */
export function puedeAjustarSucursal(
  sesion: Pick<SesionRespuesta, 'esAdministrador'>,
  sucursal: SesionRespuesta['sucursales'][number],
): boolean {
  return sesion.esAdministrador || requisitoPermiso(sucursal.rol, 'EDITAR_CARTA') === 'permitido';
}

export interface GrupoDeFamilia {
  familia: FamiliaRespuesta;
  productos: ProductoResumen[];
}

/**
 * Agrupa los productos por familia en el orden de las familias (la API las da en su orden y los
 * productos en el suyo dentro de cada una). Una familia sin productos no sale; un producto cuya familia
 * no llegó (no debería pasar) tampoco se pierde: se agrupa aparte al final.
 */
export function agruparPorFamilia(
  familias: readonly FamiliaRespuesta[],
  productos: readonly ProductoResumen[],
): GrupoDeFamilia[] {
  const porFamilia = new Map<string, ProductoResumen[]>();
  for (const p of productos) {
    const lista = porFamilia.get(p.familiaId) ?? [];
    lista.push(p);
    porFamilia.set(p.familiaId, lista);
  }
  const grupos: GrupoDeFamilia[] = [];
  for (const familia of familias) {
    const lista = porFamilia.get(familia.id);
    if (lista && lista.length > 0) grupos.push({ familia, productos: lista });
  }
  return grupos;
}

export type EstacionPorId = ReadonlyMap<string, EstacionRespuesta['nombre']>;
