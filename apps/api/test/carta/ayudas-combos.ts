// Ayudantes de las pruebas no protegidas de combos, menú del día y cambio de tipo (historia 003, grupo C4).
// Solo usan la API real (rutas de `/carta`) y las ayudas de la fábrica protegida; no la modifican.
import { exigirEstado } from '../carta-critica/fabrica-permisos-carta';
import { llamar, productoSimple, unico, type AppCarta } from './ayudas';

export interface Base {
  estacionId: string;
  familiaId: string;
}

export interface ProductoCreado {
  id: string;
  nombre: string;
  [campo: string]: unknown;
}

export interface GrupoCreado {
  id: string;
  nombre: string;
  modificadores: { id: string; nombre: string; precioExtra: string }[];
}

/** Envía una petición y devuelve la respuesta tal cual. */
export const pedir = (
  ctx: AppCarta,
  token: string,
  metodo: 'get' | 'post' | 'put' | 'patch' | 'delete',
  ruta: string,
  cuerpo?: unknown,
) => llamar(ctx, token, { metodo, ruta, cuerpo });

/** Crea un producto simple (exige 201). */
export async function crearSimple(
  ctx: AppCarta,
  token: string,
  base: Base,
  extra: Record<string, unknown> = {},
): Promise<ProductoCreado> {
  const res = await pedir(ctx, token, 'post', '/carta/productos', productoSimple(base, extra));
  exigirEstado(res, 201, 'crear producto simple');
  return res.body as ProductoCreado;
}

/** Un producto simple que no se vende solo (el que sirve de componente o de producto ligado). */
export const crearLigable = (
  ctx: AppCarta,
  token: string,
  base: Base,
  extra: Record<string, unknown> = {},
) =>
  crearSimple(ctx, token, base, {
    seVendeSolo: false,
    precio: undefined,
    tipoControlStock: 'PORCIONES',
    ...extra,
  });

/** Crea un grupo de selección única obligatoria (exige 201). */
export async function crearGrupo(
  ctx: AppCarta,
  token: string,
  modificadores: { nombre: string; precioExtra?: string; productoId?: string | null }[],
  extra: Record<string, unknown> = {},
): Promise<GrupoCreado> {
  const res = await pedir(ctx, token, 'post', '/carta/grupos-modificadores', {
    nombre: unico('Grupo'),
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores,
    ...extra,
  });
  exigirEstado(res, 201, 'crear grupo');
  return res.body as GrupoCreado;
}

/** Cuerpo de un combo válido: precio `"22.90"` y los componentes y grupos dados. */
export const cuerpoCombo = (
  base: Base,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  tipo: 'COMBO',
  nombre: unico('Combo'),
  familiaId: base.familiaId,
  precio: '22.90',
  tipoControlStock: 'SIN_CONTROL',
  ...extra,
});

/** Cuerpo de un menú del día válido: precio `"12.00"`, por porciones. */
export const cuerpoMenu = (
  base: Base,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  tipo: 'MENU_DEL_DIA',
  nombre: unico('Menú del día'),
  familiaId: base.familiaId,
  precio: '12.00',
  tipoControlStock: 'PORCIONES',
  ...extra,
});

/** Crea un producto con ese cuerpo (exige 201). */
export async function crearProducto(
  ctx: AppCarta,
  token: string,
  cuerpo: Record<string, unknown>,
): Promise<ProductoCreado> {
  const res = await pedir(ctx, token, 'post', '/carta/productos', cuerpo);
  exigirEstado(res, 201, `crear ${String(cuerpo.tipo)}`);
  return res.body as ProductoCreado;
}

/** Los nombres de los campos de un 400/422. */
export const camposDe = (res: { body: unknown }): string[] =>
  ((res.body as { campos?: { campo: string }[] }).campos ?? []).map((c) => c.campo);
