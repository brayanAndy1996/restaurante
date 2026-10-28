// Historia 003, grupo C5 · vista de la carta de la sucursal y línea preparada (criterios 45, 47 a 52 y 58):
// pruebas del desarrollador (no protegidas). Que `prepararLinea` devuelva exactamente lo que `calcularLinea`
// (criterio 58) lo prueba `carta-critica/linea-preparada.spec.ts`; el aislamiento y la concurrencia de la
// vista, `referencias-carta.spec.ts`. Aquí: qué entra y qué no, el efecto de un agotado en combos,
// modificadores y menú, el `ETag` y el 304, el número fijo de consultas con 10 y 300 productos y los errores
// de `prepararLinea`.
import { cartaSucursalRespuestaSchema, lineaPreparadaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartaVentaService } from '../../src/modulos/carta';
import { cargarCarta } from '../../src/modulos/carta/cargador-carta';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  pngValido,
  llamar,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  sembrarBase,
  sesionContrasena,
  unico,
  type AppCarta,
  type EscenarioCarta,
} from './ayudas';
import {
  crearGrupo,
  crearLigable,
  crearProducto,
  crearSimple,
  cuerpoCombo,
  cuerpoMenu,
  pedir,
  type Base,
  type GrupoCreado,
} from './ayudas-combos';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let adminS1: string;
let adminS2: string;
let cocinaS1: string;
let mozoS1: string;
let tokenB: string;
let base: Base;

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  await abrirSesiones();
  base = await sembrarBase(ctx, tokenA);
});

let relojMovido = false;

async function abrirSesiones(): Promise<void> {
  tokenA = await sesionContrasena(ctx, e.A.base.admin, null);
  adminS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
  adminS2 = await sesionContrasena(ctx, e.A.base.admin, e.A.S2);
  cocinaS1 = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
  mozoS1 = await sesionContrasena(ctx, e.A.mozo, e.A.S1);
  tokenB = await sesionContrasena(ctx, e.B.base.admin, null);
}

async function mover(instante: string): Promise<void> {
  ctx.reloj.fijar(instante);
  relojMovido = true;
  await abrirSesiones();
}

beforeEach(async () => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO); // lunes 2 de noviembre de 2026, 10:00 (día operativo 2026-11-02)
  if (relojMovido) {
    relojMovido = false;
    await abrirSesiones();
  }
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const HOY = '2026-11-02';

// ------------------------------------------------------------------------------------------------
// Ayudantes
// ------------------------------------------------------------------------------------------------

interface ModificadorDeVista {
  id: string;
  nombre: string;
  precioExtra: string;
  productoId: string | null;
  disponible: boolean;
}
interface ProductoDeVista {
  id: string;
  tipo: string;
  nombre: string;
  descripcion: string | null;
  fotoUrl: string | null;
  precio: string | null;
  seVendeSolo: boolean;
  afectacionIgv: string;
  aplicaIcbper: boolean;
  estacionId: string | null;
  tipoControlStock: string;
  agotado: { desde: string; hasta: string; origen: string } | null;
  vendible: boolean;
  motivo: string | null;
  grupos: {
    id: string;
    nombre: string;
    seleccion: string;
    minimo: number;
    maximo: number;
    obligatorio: boolean;
    modificadores: ModificadorDeVista[];
  }[];
  componentes: {
    productoId: string;
    nombre: string;
    cantidad: number;
    estacionId: string | null;
    disponible: boolean;
  }[];
}
interface Vista {
  sucursalId: string;
  diaOperativo: string;
  estaciones: { id: string; nombre: string }[];
  familias: { id: string; nombre: string; productos: ProductoDeVista[] }[];
}

const vista = async (token = adminS1): Promise<Vista> => {
  const res = await pedir(ctx, token, 'get', '/carta/sucursal');
  exigirEstado(res, 200, 'la vista');
  return res.body as Vista;
};
const enVista = async (id: string, token = adminS1): Promise<ProductoDeVista | undefined> =>
  (await vista(token)).familias.flatMap((f) => f.productos).find((p) => p.id === id);
const elProducto = async (id: string, token = adminS1): Promise<ProductoDeVista> => {
  const p = await enVista(id, token);
  if (p === undefined) throw new Error(`El producto ${id} no está en la vista`);
  return p;
};
const agotar = (id: string, cuerpo: unknown = {}, token = cocinaS1) =>
  pedir(ctx, token, 'put', `/carta/sucursal/agotados/${id}`, cuerpo);
const reactivar = (id: string, token = cocinaS1) =>
  pedir(ctx, token, 'delete', `/carta/sucursal/agotados/${id}`);
const patch = async (ruta: string, cuerpo: unknown, token = tokenA) =>
  exigirEstado(await pedir(ctx, token, 'patch', ruta, cuerpo), 200, `PATCH ${ruta}`);
const put = async (ruta: string, cuerpo: unknown, token = tokenA, estado = 200) =>
  exigirEstado(await pedir(ctx, token, 'put', ruta, cuerpo), estado, `PUT ${ruta}`);
const post = async (ruta: string, cuerpo: unknown, token = tokenA) => {
  const res = await pedir(ctx, token, 'post', ruta, cuerpo);
  exigirEstado(res, 201, `POST ${ruta}`);
  return res.body as { id: string; [campo: string]: unknown };
};
const nuevaBase = async (): Promise<Base> => sembrarBase(ctx, tokenA);

// ------------------------------------------------------------------------------------------------
// Criterios 47 y 48 · la vista y qué entra
// ------------------------------------------------------------------------------------------------

describe('criterios 47 y 48 · la vista y qué entra', () => {
  it('cumple el contrato y trae la sucursal activa y su día operativo', async () => {
    const simple = await crearSimple(ctx, tokenA, base, { descripcion: 'Con papas' });
    const v = await vista();
    expect(() => cartaSucursalRespuestaSchema.parse(v)).not.toThrow();
    expect(v.sucursalId).toBe(e.A.S1);
    expect(v.diaOperativo).toBe(HOY);
    const p = await elProducto(simple.id);
    expect(p).toMatchObject({
      tipo: 'SIMPLE',
      descripcion: 'Con papas',
      fotoUrl: null,
      precio: '25.00',
      seVendeSolo: true,
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      estacionId: base.estacionId,
      tipoControlStock: 'UNIDADES',
      agotado: null,
      vendible: true,
      motivo: null,
      grupos: [],
      componentes: [],
    });
    expect((await vista(adminS2)).sucursalId).toBe(e.A.S2);
  });

  it('responde a todos los roles con sucursal activa y 409 SUCURSAL_NO_ELEGIDA sin ella', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    for (const token of [mozoS1, cocinaS1, adminS1]) {
      expect((await elProducto(simple.id, token)).id).toBe(simple.id);
    }
    esperarError(await pedir(ctx, tokenA, 'get', '/carta/sucursal'), 409, 'SUCURSAL_NO_ELEGIDA');
    esperarError(
      await pedir(ctx, undefined as unknown as string, 'get', '/carta/sucursal'),
      401,
      'NO_AUTENTICADO',
    );
  });

  it('las familias activas van en su orden y solo las que tienen productos en la vista', async () => {
    const baseUno = await nuevaBase();
    const baseDos = await nuevaBase();
    const vacia = await post('/carta/familias', { nombre: unico('Vacía') });
    const inactiva = await post('/carta/familias', { nombre: unico('Inactiva') });
    await patch(`/carta/familias/${inactiva.id}`, { activa: false });
    const p1 = await crearSimple(ctx, tokenA, baseUno);
    const p2 = await crearSimple(ctx, tokenA, baseDos);
    // Se ordena la segunda antes que la primera.
    const familias = (await pedir(ctx, tokenA, 'get', '/carta/familias')).body as { id: string }[];
    const orden = [
      baseDos.familiaId,
      baseUno.familiaId,
      ...familias
        .map((f) => f.id)
        .filter((id) => id !== baseUno.familiaId && id !== baseDos.familiaId),
    ];
    await put('/carta/familias/orden', { ids: orden });
    const v = await vista();
    const ids = v.familias.map((f) => f.id);
    expect(ids.indexOf(baseDos.familiaId)).toBeLessThan(ids.indexOf(baseUno.familiaId));
    expect(ids).not.toContain(vacia.id);
    expect(ids).not.toContain(inactiva.id);
    expect(v.familias.find((f) => f.id === baseUno.familiaId)!.productos.map((p) => p.id)).toEqual([
      p1.id,
    ]);
    expect(v.familias.find((f) => f.id === baseDos.familiaId)!.productos.map((p) => p.id)).toEqual([
      p2.id,
    ]);
  });

  it('los productos van en el orden de su familia', async () => {
    const b = await nuevaBase();
    const a = await crearSimple(ctx, tokenA, b);
    const c = await crearSimple(ctx, tokenA, b);
    const d = await crearSimple(ctx, tokenA, b);
    await put(`/carta/familias/${b.familiaId}/productos/orden`, { ids: [d.id, a.id, c.id] });
    const familia = (await vista()).familias.find((f) => f.id === b.familiaId)!;
    expect(familia.productos.map((p) => p.id)).toEqual([d.id, a.id, c.id]);
  });

  it('no entran los productos inactivos ni los no disponibles en la sucursal (en la otra sí)', async () => {
    const inactivo = await crearSimple(ctx, tokenA, base);
    const noDisponible = await crearSimple(ctx, tokenA, base);
    await patch(`/carta/productos/${inactivo.id}`, { activo: false });
    await put(`/carta/productos/${noDisponible.id}/sucursales/${e.A.S1}`, {
      precio: null,
      disponible: false,
    });
    expect(await enVista(inactivo.id)).toBeUndefined();
    expect(await enVista(noDisponible.id)).toBeUndefined();
    expect(await enVista(noDisponible.id, adminS2)).toBeDefined();
    // Reactivar lo devuelve.
    await patch(`/carta/productos/${inactivo.id}`, { activo: true });
    expect(await enVista(inactivo.id)).toBeDefined();
  });

  it('un producto que no se vende solo sí entra (sin precio, seVendeSolo: false) y un agotado también', async () => {
    const ligable = await crearLigable(ctx, tokenA, base);
    const p = await elProducto(ligable.id);
    expect(p).toMatchObject({ seVendeSolo: false, precio: null, vendible: true });
    exigirEstado(await agotar(ligable.id), 200, 'agotar');
    expect(await elProducto(ligable.id)).toMatchObject({ vendible: false, motivo: 'AGOTADO' });
  });

  it('el precio es el efectivo: el de la sucursal si lo hay y, si no, el de la empresa', async () => {
    const simple = await crearSimple(ctx, tokenA, base, { precio: '25.00' });
    await put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
      precio: '27.50',
      disponible: true,
    });
    expect((await elProducto(simple.id, adminS1)).precio).toBe('27.50');
    expect((await elProducto(simple.id, adminS2)).precio).toBe('25.00');
    await patch(`/carta/productos/${simple.id}`, { precio: '26.00' });
    expect((await elProducto(simple.id, adminS1)).precio).toBe('27.50');
    expect((await elProducto(simple.id, adminS2)).precio).toBe('26.00');
    await put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
      precio: null,
      disponible: true,
    });
    expect((await elProducto(simple.id, adminS1)).precio).toBe('26.00');
  });

  it('las estaciones activas van por nombre y las inactivas no', async () => {
    const activa = await post('/carta/estaciones', { nombre: unico('Barra') });
    const inactiva = await post('/carta/estaciones', { nombre: unico('Parrilla') });
    await patch(`/carta/estaciones/${inactiva.id}`, { activa: false });
    const v = await vista();
    const ids = v.estaciones.map((x) => x.id);
    expect(ids).toContain(activa.id);
    expect(ids).toContain(base.estacionId);
    expect(ids).not.toContain(inactiva.id);
    expect(v.estaciones.find((x) => x.id === activa.id)).toEqual({
      id: activa.id,
      nombre: activa.nombre,
    });
  });

  it('la foto sale como URL pública', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    const foto = await llamar(ctx, tokenA, {
      metodo: 'put',
      ruta: `/carta/productos/${simple.id}/foto`,
      binario: { tipo: 'image/png', datos: pngValido() },
    });
    exigirEstado(foto, 200, 'foto');
    expect((await elProducto(simple.id)).fotoUrl).toBe(foto.body.fotoUrl);
  });

  it('los grupos y sus modificadores activos van en su orden, con el precio extra y el producto ligado', async () => {
    const ligado = await crearLigable(ctx, tokenA, base);
    const g1 = await crearGrupo(ctx, tokenA, [
      { nombre: 'Jugoso' },
      { nombre: 'Huevo', precioExtra: '2.50', productoId: ligado.id },
      { nombre: 'Quitar' },
    ]);
    const g2 = await post('/carta/grupos-modificadores', {
      nombre: unico('Extras'),
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      modificadores: [
        { nombre: 'Queso', precioExtra: '2.00' },
        { nombre: 'Plátano', precioExtra: '3.00' },
      ],
    });
    const simple = await crearSimple(ctx, tokenA, base, {
      gruposModificadores: [g2.id, g1.id],
    });
    // Se desactiva "Quitar": deja de verse.
    await patch(`/carta/grupos-modificadores/${g1.id}`, {
      modificadores: [
        { id: g1.modificadores[0]!.id, nombre: 'Jugoso' },
        {
          id: g1.modificadores[1]!.id,
          nombre: 'Huevo',
          precioExtra: '2.50',
          productoId: ligado.id,
        },
      ],
    });
    const p = await elProducto(simple.id);
    expect(p.grupos.map((g) => g.id)).toEqual([g2.id, g1.id]);
    expect(p.grupos[0]).toMatchObject({
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      obligatorio: false,
    });
    expect(
      p.grupos[0]!.modificadores.map((m) => [m.nombre, m.precioExtra, m.productoId, m.disponible]),
    ).toEqual([
      ['Queso', '2.00', null, true],
      ['Plátano', '3.00', null, true],
    ]);
    expect(p.grupos[1]).toMatchObject({
      seleccion: 'UNICA',
      minimo: 1,
      maximo: 1,
      obligatorio: true,
    });
    expect(p.grupos[1]!.modificadores.map((m) => [m.nombre, m.precioExtra, m.productoId])).toEqual([
      ['Jugoso', '0.00', null],
      ['Huevo', '2.50', ligado.id],
    ]);
    // Desactivar un grupo asignado a un producto activo responde EN_USO: se desasigna primero.
    await patch(`/carta/productos/${simple.id}`, { gruposModificadores: [g1.id] });
    await patch(`/carta/grupos-modificadores/${g2.id}`, { activo: false });
    expect((await elProducto(simple.id)).grupos.map((g) => g.id)).toEqual([g1.id]);
  });

  it('un combo trae sus componentes con cantidad, estación y disponibilidad', async () => {
    const hamburguesa = await crearLigable(ctx, tokenA, base);
    const sinEstacion = await crearLigable(ctx, tokenA, base, { estacionId: null });
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, {
        componentes: [
          { productoId: hamburguesa.id, cantidad: 2 },
          { productoId: sinEstacion.id, cantidad: 1 },
        ],
      }),
    );
    const p = await elProducto(combo.id);
    expect(p).toMatchObject({ tipo: 'COMBO', precio: '22.90', estacionId: null, vendible: true });
    expect(p.componentes).toEqual([
      {
        productoId: hamburguesa.id,
        nombre: hamburguesa.nombre,
        cantidad: 2,
        estacionId: base.estacionId,
        disponible: true,
      },
      {
        productoId: sinEstacion.id,
        nombre: sinEstacion.nombre,
        cantidad: 1,
        estacionId: null,
        disponible: true,
      },
    ]);
  });

  it('un menú del día muestra solo las opciones del día operativo actual y no se vende sin armar', async () => {
    const sopa = await crearLigable(ctx, tokenA, base);
    const aji = await crearLigable(ctx, tokenA, base);
    const entrada = await crearGrupo(ctx, tokenA, [
      { nombre: 'Papa a la huancaína' },
      { nombre: 'Sopa', productoId: sopa.id },
    ]);
    const segundo = await crearGrupo(ctx, tokenA, [
      { nombre: 'Ají de gallina', productoId: aji.id },
      { nombre: 'Lomo saltado', precioExtra: '5.00' },
    ]);
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [entrada.id, segundo.id] }),
    );
    const sinArmar = await elProducto(menu.id);
    expect(sinArmar).toMatchObject({
      vendible: false,
      motivo: 'MENU_SIN_ARMAR',
      tipo: 'MENU_DEL_DIA',
    });
    expect(sinArmar.grupos.map((g) => g.modificadores)).toEqual([[], []]);

    const [papa, sopaOp] = entrada.modificadores;
    const [ajiOp, lomo] = segundo.modificadores;
    // Se arma el menú de mañana y solo parte del de hoy.
    await put(
      `/carta/sucursal/menu-del-dia/${menu.id}`,
      { dia: '2026-11-03', opciones: [sopaOp!.id, lomo!.id] },
      cocinaS1,
    );
    expect((await elProducto(menu.id)).motivo).toBe('MENU_SIN_ARMAR');
    await put(`/carta/sucursal/menu-del-dia/${menu.id}`, { opciones: [papa!.id] }, cocinaS1);
    const parcial = await elProducto(menu.id);
    expect(parcial).toMatchObject({ vendible: false, motivo: 'OPCIONES_INSUFICIENTES' });
    expect(parcial.grupos.map((g) => g.modificadores.map((m) => m.nombre))).toEqual([
      ['Papa a la huancaína'],
      [],
    ]);
    await put(
      `/carta/sucursal/menu-del-dia/${menu.id}`,
      { opciones: [papa!.id, ajiOp!.id] },
      cocinaS1,
    );
    const armado = await elProducto(menu.id);
    expect(armado).toMatchObject({ vendible: true, motivo: null });
    expect(armado.grupos.map((g) => g.modificadores.map((m) => m.nombre))).toEqual([
      ['Papa a la huancaína'],
      ['Ají de gallina'],
    ]);
    // Otra sucursal: nada armado, sin ver las opciones de S1.
    expect((await elProducto(menu.id, adminS2)).motivo).toBe('MENU_SIN_ARMAR');
    // Mañana (a la hora de corte) valen las armadas de víspera.
    await mover('2026-11-03T05:00:00-05:00');
    const manana = await elProducto(menu.id);
    expect(manana).toMatchObject({ vendible: true });
    expect(manana.grupos.map((g) => g.modificadores.map((m) => m.nombre))).toEqual([
      ['Sopa'],
      ['Lomo saltado'],
    ]);
  });
});

// ------------------------------------------------------------------------------------------------
// Criterio 45 · efecto de un agotado
// ------------------------------------------------------------------------------------------------

describe('criterio 45 · efecto de un agotado en la vista', () => {
  it('el producto trae agotado y vendible false con motivo AGOTADO; al reactivar vuelve a venderse', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    exigirEstado(await agotar(simple.id, { hasta: 'REACTIVAR' }), 200, 'agotar');
    const p = await elProducto(simple.id);
    expect(p).toMatchObject({ vendible: false, motivo: 'AGOTADO' });
    expect(p.agotado).toMatchObject({ hasta: 'REACTIVAR', origen: 'MANUAL' });
    expect(p.agotado!.desde).toBe('2026-11-02T15:00:00.000Z');
    exigirEstado(await reactivar(simple.id), 204, 'reactivar');
    expect(await elProducto(simple.id)).toMatchObject({ vendible: true, agotado: null });
  });

  it('un agotado "por hoy" deja de contar al cambiar el día operativo y no aparece en la vista', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    exigirEstado(await agotar(simple.id), 200, 'agotar por hoy');
    await mover('2026-11-03T04:59:00-05:00');
    expect((await elProducto(simple.id)).motivo).toBe('AGOTADO');
    await mover('2026-11-03T05:00:00-05:00');
    expect(await elProducto(simple.id)).toMatchObject({ vendible: true, agotado: null });
  });

  it('el combo con un componente agotado es no vendible con COMPONENTE_NO_DISPONIBLE', async () => {
    const hamburguesa = await crearLigable(ctx, tokenA, base);
    const papas = await crearLigable(ctx, tokenA, base);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, {
        componentes: [
          { productoId: hamburguesa.id, cantidad: 1 },
          { productoId: papas.id, cantidad: 1 },
        ],
      }),
    );
    exigirEstado(await agotar(papas.id), 200, 'agotar el componente');
    const p = await elProducto(combo.id);
    expect(p).toMatchObject({ vendible: false, motivo: 'COMPONENTE_NO_DISPONIBLE', agotado: null });
    expect(p.componentes.map((c) => [c.productoId, c.disponible])).toEqual([
      [hamburguesa.id, true],
      [papas.id, false],
    ]);
    // El mismo componente agotado en S2 no afecta al combo de S1... ni al revés.
    expect((await elProducto(combo.id, adminS2)).vendible).toBe(true);
    // Un componente desactivado o no disponible cuenta igual.
    exigirEstado(await reactivar(papas.id), 204, 'reactivar');
    expect((await elProducto(combo.id)).vendible).toBe(true);
    await put(`/carta/productos/${hamburguesa.id}/sucursales/${e.A.S1}`, {
      precio: null,
      disponible: false,
    });
    expect(await elProducto(combo.id)).toMatchObject({
      vendible: false,
      motivo: 'COMPONENTE_NO_DISPONIBLE',
    });
    await put(`/carta/productos/${hamburguesa.id}/sucursales/${e.A.S1}`, {
      precio: null,
      disponible: true,
    });
    await patch(`/carta/productos/${hamburguesa.id}`, { activo: false });
    expect(await elProducto(combo.id)).toMatchObject({
      vendible: false,
      motivo: 'COMPONENTE_NO_DISPONIBLE',
    });
  });

  it('el modificador ligado a un producto agotado queda disponible: false y, si había otra opción, el producto sigue vendible', async () => {
    const cerveza = await crearLigable(ctx, tokenA, base);
    const grupo = await crearGrupo(ctx, tokenA, [
      { nombre: 'Chicha' },
      { nombre: 'Cerveza', precioExtra: '4.50', productoId: cerveza.id },
    ]);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { gruposModificadores: [grupo.id] }),
    );
    exigirEstado(await agotar(cerveza.id), 200, 'agotar la cerveza');
    const p = await elProducto(combo.id);
    expect(p).toMatchObject({ vendible: true, motivo: null });
    expect(p.grupos[0]!.modificadores.map((m) => [m.nombre, m.disponible])).toEqual([
      ['Chicha', true],
      ['Cerveza', false],
    ]);
  });

  it('un grupo obligatorio cuyas opciones están todas agotadas deja el producto no vendible con OPCIONES_INSUFICIENTES', async () => {
    const cerveza = await crearLigable(ctx, tokenA, base);
    const gaseosa = await crearLigable(ctx, tokenA, base);
    const grupo = await crearGrupo(ctx, tokenA, [
      { nombre: 'Cerveza', productoId: cerveza.id },
      { nombre: 'Gaseosa', productoId: gaseosa.id },
    ]);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { gruposModificadores: [grupo.id] }),
    );
    exigirEstado(await agotar(cerveza.id), 200, 'agotar la cerveza');
    expect((await elProducto(combo.id)).vendible).toBe(true);
    exigirEstado(await agotar(gaseosa.id), 200, 'agotar la gaseosa');
    // El combo mismo no está agotado: el motivo es el de las opciones.
    expect(await elProducto(combo.id)).toMatchObject({
      vendible: false,
      motivo: 'OPCIONES_INSUFICIENTES',
      agotado: null,
    });
  });

  it('un producto agotado que también es componente y opción ligada del menú: combo y menú no vendibles', async () => {
    const sopa = await crearLigable(ctx, tokenA, base);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { componentes: [{ productoId: sopa.id, cantidad: 1 }] }),
    );
    const entrada = await crearGrupo(ctx, tokenA, [{ nombre: 'Sopa', productoId: sopa.id }]);
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [entrada.id] }),
    );
    await put(
      `/carta/sucursal/menu-del-dia/${menu.id}`,
      { opciones: [entrada.modificadores[0]!.id] },
      cocinaS1,
    );
    expect((await elProducto(menu.id)).vendible).toBe(true);
    exigirEstado(await agotar(sopa.id), 200, 'agotar la sopa');
    expect(await elProducto(combo.id)).toMatchObject({
      vendible: false,
      motivo: 'COMPONENTE_NO_DISPONIBLE',
    });
    const m = await elProducto(menu.id);
    expect(m).toMatchObject({ vendible: false, motivo: 'OPCIONES_INSUFICIENTES' });
    expect(m.grupos[0]!.modificadores[0]).toMatchObject({ nombre: 'Sopa', disponible: false });
    // Y la consulta del menú del día usa la misma regla para `disponible`.
    const consulta = await pedir(ctx, cocinaS1, 'get', '/carta/sucursal/menu-del-dia');
    const delMenu = (
      consulta.body as { productoId: string; grupos: { opciones: { disponible: boolean }[] }[] }[]
    ).find((x) => x.productoId === menu.id)!;
    expect(delMenu.grupos[0]!.opciones[0]!.disponible).toBe(false);
    exigirEstado(await reactivar(sopa.id), 204, 'reactivar');
    expect((await elProducto(menu.id)).vendible).toBe(true);
  });

  it('un producto no disponible en la sucursal que tiene un agotado vigente conserva el agotado al volver', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    exigirEstado(await agotar(simple.id), 200, 'agotar');
    await put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
      precio: null,
      disponible: false,
    });
    expect(await enVista(simple.id)).toBeUndefined();
    await put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
      precio: null,
      disponible: true,
    });
    expect(await elProducto(simple.id)).toMatchObject({ vendible: false, motivo: 'AGOTADO' });
  });
});

// ------------------------------------------------------------------------------------------------
// Criterio 49 · ETag y 304
// ------------------------------------------------------------------------------------------------

describe('criterio 49 · ETag', () => {
  const etagDe = async (token = adminS1): Promise<string> => {
    const res = await pedir(ctx, token, 'get', '/carta/sucursal');
    exigirEstado(res, 200, 'la vista');
    const etag = res.headers['etag'] as string | undefined;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    return etag!;
  };

  it('la respuesta trae un ETag fuerte; con If-None-Match igual responde 304 sin cuerpo', async () => {
    await crearSimple(ctx, tokenA, base);
    const etag = await etagDe();
    const res = await ctx
      .http()
      .get('/carta/sucursal')
      .set({ Authorization: `Bearer ${adminS1}` })
      .set('If-None-Match', etag);
    expect(res.status).toBe(304);
    expect(res.text).toBe('');
    expect(res.headers['etag']).toBe(etag);
    expect(res.headers['cache-control']).toBe('private, no-cache');
  });

  it('acepta una lista, la forma débil y *; con otro valor responde 200 con la vista', async () => {
    const etag = await etagDe();
    const con = (valor: string) =>
      ctx
        .http()
        .get('/carta/sucursal')
        .set({ Authorization: `Bearer ${adminS1}` })
        .set('If-None-Match', valor);
    expect((await con(`"otro", ${etag}`)).status).toBe(304);
    expect((await con(`W/${etag}`)).status).toBe(304);
    expect((await con('*')).status).toBe(304);
    const otro = await con('"no-es-este"');
    expect(otro.status).toBe(200);
    expect(otro.body.sucursalId).toBe(e.A.S1);
  });

  it('es el mismo para cualquier rol de la sucursal y distinto en otra sucursal', async () => {
    const etag = await etagDe(adminS1);
    expect(await etagDe(mozoS1)).toBe(etag);
    expect(await etagDe(cocinaS1)).toBe(etag);
    expect(await etagDe(adminS2)).not.toBe(etag);
  });

  it('no cambia si no cambió nada', async () => {
    expect(await etagDe()).toBe(await etagDe());
  });

  it('cambia con cada tipo de cambio que altera la vista', async () => {
    const simple = await crearSimple(ctx, tokenA, base, { precio: '25.00' });
    const ligado = await crearLigable(ctx, tokenA, base);
    const grupo = await crearGrupo(ctx, tokenA, [
      { nombre: 'Papas', productoId: ligado.id },
      { nombre: 'Ensalada' },
    ]);
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [grupo.id] }),
    );
    const cambios: [string, () => Promise<unknown>][] = [
      ['agotar', () => agotar(simple.id)],
      ['cambiar el hasta del agotado', () => agotar(simple.id, { hasta: 'REACTIVAR' })],
      ['reactivar', () => reactivar(simple.id)],
      ['precio de la empresa', () => patch(`/carta/productos/${simple.id}`, { precio: '26.00' })],
      [
        'precio de la sucursal',
        () =>
          put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
            precio: '27.00',
            disponible: true,
          }),
      ],
      [
        'disponibilidad',
        () =>
          put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
            precio: '27.00',
            disponible: false,
          }),
      ],
      [
        'volver a disponible',
        () =>
          put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
            precio: '27.00',
            disponible: true,
          }),
      ],
      [
        'nombre del producto',
        () => patch(`/carta/productos/${simple.id}`, { nombre: unico('Renombrado') }),
      ],
      [
        'descripción',
        () => patch(`/carta/productos/${simple.id}`, { descripcion: 'Nueva descripción' }),
      ],
      ['desactivar', () => patch(`/carta/productos/${simple.id}`, { activo: false })],
      ['reactivar el producto', () => patch(`/carta/productos/${simple.id}`, { activo: true })],
      [
        'foto',
        () =>
          llamar(ctx, tokenA, {
            metodo: 'put',
            ruta: `/carta/productos/${simple.id}/foto`,
            binario: { tipo: 'image/png', datos: pngValido() },
          }),
      ],
      [
        'menú del día',
        () =>
          put(
            `/carta/sucursal/menu-del-dia/${menu.id}`,
            { opciones: [grupo.modificadores[1]!.id] },
            cocinaS1,
          ),
      ],
      [
        'precio extra del modificador',
        () =>
          patch(`/carta/grupos-modificadores/${grupo.id}`, {
            modificadores: [
              { id: grupo.modificadores[0]!.id, nombre: 'Papas', productoId: ligado.id },
              { id: grupo.modificadores[1]!.id, nombre: 'Ensalada', precioExtra: '1.00' },
            ],
          }),
      ],
      [
        'nombre de la estación',
        () => patch(`/carta/estaciones/${base.estacionId}`, { nombre: unico('Cocina nueva') }),
      ],
    ];
    let anterior = await etagDe();
    for (const [nombre, hacer] of cambios) {
      await hacer();
      const actual = await etagDe();
      expect(actual, `el ETag no cambió con: ${nombre}`).not.toBe(anterior);
      anterior = actual;
    }
  });

  it('cambia al pasar la hora de corte (día operativo) y con la hora de corte de la sucursal', async () => {
    const antes = await etagDe();
    await mover('2026-11-03T04:59:00-05:00');
    expect(await etagDe()).toBe(antes);
    await mover('2026-11-03T05:00:00-05:00');
    const siguiente = await etagDe();
    expect(siguiente).not.toBe(antes);
    // Cambiar la hora de corte de S1 a las 06:00 hace que a las 05:30 siga siendo el día anterior.
    await mover('2026-11-03T05:30:00-05:00');
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/sucursales/${e.A.S1}`, { horaCorte: '06:00' }),
      200,
      'corte 06:00',
    );
    try {
      const conOtroCorte = await etagDe();
      expect(conOtroCorte).not.toBe(siguiente);
      expect((await vista()).diaOperativo).toBe('2026-11-02');
    } finally {
      exigirEstado(
        await pedir(ctx, tokenA, 'patch', `/sucursales/${e.A.S1}`, { horaCorte: '05:00' }),
        200,
        'restaurar',
      );
    }
  });

  it('CORS permite If-None-Match y expone ETag al origen de la PWA', async () => {
    const origen = 'http://localhost:5173';
    const preflight = await ctx
      .http()
      .options('/carta/sucursal')
      .set('Origin', origen)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,if-none-match');
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers['access-control-allow-headers']?.toLowerCase()).toContain(
      'if-none-match',
    );
    const res = await ctx
      .http()
      .get('/carta/sucursal')
      .set({ Authorization: `Bearer ${adminS1}` })
      .set('Origin', origen);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-expose-headers']?.toLowerCase()).toContain('etag');
    const etag = res.headers['etag'] as string;
    const cond = await ctx
      .http()
      .get('/carta/sucursal')
      .set({ Authorization: `Bearer ${adminS1}` })
      .set('Origin', origen)
      .set('If-None-Match', etag);
    expect(cond.status).toBe(304);
    expect(cond.headers['access-control-expose-headers']?.toLowerCase()).toContain('etag');
  });

  it('no cambia con una escritura que no cambia nada', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    const antes = await etagDe();
    await patch(`/carta/productos/${simple.id}`, { precio: '25.00' });
    await put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
      precio: null,
      disponible: true,
    });
    expect(await etagDe()).toBe(antes);
  });
});

// ------------------------------------------------------------------------------------------------
// Criterio 50 · número fijo de consultas
// ------------------------------------------------------------------------------------------------

describe('criterio 50 · sin consultas por producto', () => {
  async function poblar(token: string, base_: Base, cantidad: number): Promise<void> {
    const grupo = await crearGrupo(ctx, token, [
      { nombre: 'Uno' },
      { nombre: 'Dos', precioExtra: '1.00' },
    ]);
    const ligado = await crearLigable(ctx, token, base_);
    for (let i = 0; i < cantidad; i++) {
      const extra: Record<string, unknown> = { gruposModificadores: [grupo.id] };
      if (i % 5 === 0) {
        await crearProducto(
          ctx,
          token,
          cuerpoCombo(base_, {
            componentes: [{ productoId: ligado.id, cantidad: 1 }],
            gruposModificadores: [grupo.id],
          }),
        );
      } else {
        await crearSimple(ctx, token, base_, extra);
      }
    }
  }

  async function contar(empresaId: string): Promise<{ cargador: number; peticion: number }> {
    const sequelize = ctx.app.get<Sequelize>(CONEXION_API, { strict: false });
    const sucursalId = empresaId === e.A.empresaId ? e.A.S1 : e.B.S1;
    // Las consultas del cargador, solas.
    let cargador = 0;
    const contador = {
      query: ((...args: Parameters<Sequelize['query']>) => {
        cargador++;
        return sequelize.query(...args);
      }) as Sequelize['query'],
    };
    await ctx.app
      .get(ContextoEmpresa)
      .ejecutar(empresaId, () => cargarCarta(contador, { sucursalId, diaOperativo: HOY }), {
        actor: { sistema: 'prueba' },
      });
    // Todas las consultas de una petición `GET /carta/sucursal` (la sesión se abre antes de contar).
    const token =
      empresaId === e.A.empresaId ? adminS1 : await sesionContrasena(ctx, e.B.base.admin, e.B.S1);
    const original = sequelize.query.bind(sequelize);
    let peticion = 0;
    const espia = vi.spyOn(sequelize, 'query').mockImplementation(((...args: unknown[]) => {
      peticion++;
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as never);
    try {
      exigirEstado(await pedir(ctx, token, 'get', '/carta/sucursal'), 200, 'la vista');
    } finally {
      espia.mockRestore();
    }
    return { cargador, peticion };
  }

  it('el cargador hace seis consultas y la petición el mismo número de consultas con 10 que con 300 productos', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    await poblar(tokenA, base, 10);
    await poblar(tokenB, baseB, 300);
    const pocos = await contar(e.A.empresaId);
    const muchos = await contar(e.B.empresaId);
    const productosDeB = (await vistaDe(e.B)).familias.flatMap((f) => f.productos).length;
    expect(productosDeB).toBeGreaterThanOrEqual(300);
    expect(pocos.cargador).toBe(6);
    expect(muchos.cargador).toBe(6);
    expect(muchos.peticion).toBe(pocos.peticion);
  });

  async function vistaDe(empresa: EscenarioCarta['B']): Promise<Vista> {
    const token = await sesionContrasena(ctx, empresa.base.admin, empresa.S1);
    const res = await pedir(ctx, token, 'get', '/carta/sucursal');
    exigirEstado(res, 200, 'la vista de B');
    return res.body as Vista;
  }

  it('la vista de 300 productos responde en menos de un segundo (RNF-03)', async () => {
    const token = await sesionContrasena(ctx, e.B.base.admin, e.B.S1);
    const tiempos: number[] = [];
    for (let i = 0; i < 5; i++) {
      const inicio = performance.now();
      exigirEstado(await pedir(ctx, token, 'get', '/carta/sucursal'), 200, 'la vista');
      tiempos.push(performance.now() - inicio);
    }
    tiempos.sort((a, b) => a - b);
    expect(tiempos[2]).toBeLessThan(1000);
  });
});

// ------------------------------------------------------------------------------------------------
// Criterios 51, 52 y 58 · prepararLinea y cartaDeSucursal
// ------------------------------------------------------------------------------------------------

describe('criterios 51 y 52 · CartaVentaService', () => {
  const servicio = () => ctx.app.get(CartaVentaService, { strict: false });
  const dentro = <T>(fn: () => Promise<T>, empresaId = e.A.empresaId): Promise<T> =>
    ctx.app.get(ContextoEmpresa).ejecutar(empresaId, fn, { actor: { sistema: 'prueba' } });
  const preparar = (
    productoId: string,
    modificadorIds: string[],
    cantidad = 1,
    sucursalId = e.A.S1,
    instante = ctx.reloj.ahora(),
  ) =>
    dentro(() =>
      servicio().prepararLinea({ sucursalId, productoId, modificadorIds, cantidad, instante }),
    );

  it('cartaDeSucursal devuelve lo mismo que GET /carta/sucursal, para cualquier sucursal de la empresa', async () => {
    await crearSimple(ctx, tokenA, base);
    const instante = ctx.reloj.ahora();
    const desdeServicio = await dentro(() => servicio().cartaDeSucursal(e.A.S1, instante));
    expect(desdeServicio).toEqual(await vista(adminS1));
    const deS2 = await dentro(() => servicio().cartaDeSucursal(e.A.S2, instante));
    expect(deS2).toEqual(await vista(adminS2));
    // Una sucursal de otra empresa o inexistente es 404 (como una inexistente).
    await expect(dentro(() => servicio().cartaDeSucursal(e.B.S1, instante))).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    });
    await expect(
      dentro(() => servicio().cartaDeSucursal('no-es-uuid', instante)),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('cartaDeSucursal con un instante de mañana usa el día operativo de mañana (menú y agotados)', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    exigirEstado(await agotar(simple.id), 200, 'agotar por hoy');
    const manana = new Date('2026-11-03T12:00:00-05:00');
    const v = await dentro(() => servicio().cartaDeSucursal(e.A.S1, manana));
    expect(v.diaOperativo).toBe('2026-11-03');
    const p = v.familias.flatMap((f) => f.productos).find((x) => x.id === simple.id)!;
    expect(p).toMatchObject({ vendible: true, agotado: null });
  });

  it('una línea de un simple con modificadores trae la copia de lo que la venta guarda', async () => {
    const huevo = await crearLigable(ctx, tokenA, base, { tipoControlStock: 'UNIDADES' });
    const termino = await crearGrupo(ctx, tokenA, [{ nombre: 'Jugoso' }, { nombre: '3/4' }]);
    const extras = (await post('/carta/grupos-modificadores', {
      nombre: unico('Extras'),
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      modificadores: [
        { nombre: 'Huevo', precioExtra: '2.50', productoId: huevo.id },
        { nombre: 'Plátano', precioExtra: '3.00' },
      ],
    })) as unknown as GrupoCreado;
    const lomo = await crearSimple(ctx, tokenA, base, {
      precio: '28.00',
      afectacionIgv: 'EXONERADO',
      aplicaIcbper: true,
      gruposModificadores: [termino.id, extras.id],
    });
    const linea = await preparar(
      lomo.id,
      [termino.modificadores[1]!.id, extras.modificadores[0]!.id, extras.modificadores[1]!.id],
      2,
    );
    expect(() => lineaPreparadaSchema.parse(linea)).not.toThrow();
    expect(linea).toEqual({
      productoId: lomo.id,
      nombre: lomo.nombre,
      tipo: 'SIMPLE',
      cantidad: 2,
      precioUnitario: '33.50',
      total: '67.00',
      afectacionIgv: 'EXONERADO',
      aplicaIcbper: true,
      estacionId: base.estacionId,
      tipoControlStock: 'UNIDADES',
      modificadores: [
        {
          id: termino.modificadores[1]!.id,
          nombre: '3/4',
          grupoId: termino.id,
          grupoNombre: termino.nombre,
          precioExtra: '0.00',
          productoLigado: null,
        },
        {
          id: extras.modificadores[0]!.id,
          nombre: 'Huevo',
          grupoId: extras.id,
          grupoNombre: extras.nombre,
          precioExtra: '2.50',
          productoLigado: {
            id: huevo.id,
            nombre: huevo.nombre,
            estacionId: base.estacionId,
            tipoControlStock: 'UNIDADES',
          },
        },
        {
          id: extras.modificadores[1]!.id,
          nombre: 'Plátano',
          grupoId: extras.id,
          grupoNombre: extras.nombre,
          precioExtra: '3.00',
          productoLigado: null,
        },
      ],
      componentes: [],
    });
  });

  it('un combo trae cada componente y cada producto ligado a su propia estación y control de stock (criterio 31)', async () => {
    const otraEstacion = await post('/carta/estaciones', { nombre: unico('Barra') });
    const hamburguesa = await crearLigable(ctx, tokenA, base, { tipoControlStock: 'UNIDADES' });
    const cerveza = await crearLigable(
      ctx,
      tokenA,
      { ...base, estacionId: otraEstacion.id },
      { tipoControlStock: 'PORCIONES' },
    );
    const bebida = await crearGrupo(ctx, tokenA, [
      { nombre: 'Chicha' },
      { nombre: 'Cerveza', precioExtra: '4.50', productoId: cerveza.id },
    ]);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, {
        componentes: [{ productoId: hamburguesa.id, cantidad: 3 }],
        gruposModificadores: [bebida.id],
      }),
    );
    const linea = await preparar(combo.id, [bebida.modificadores[1]!.id], 2);
    expect(linea).toMatchObject({
      tipo: 'COMBO',
      estacionId: null,
      precioUnitario: '27.40',
      total: '54.80',
      componentes: [
        {
          productoId: hamburguesa.id,
          nombre: hamburguesa.nombre,
          cantidad: 3,
          estacionId: base.estacionId,
          tipoControlStock: 'UNIDADES',
        },
      ],
    });
    expect(linea.modificadores[0]!.productoLigado).toEqual({
      id: cerveza.id,
      nombre: cerveza.nombre,
      estacionId: otraEstacion.id,
      tipoControlStock: 'PORCIONES',
    });
  });

  it('acepta los ids de modificadores en mayúsculas y los devuelve normalizados', async () => {
    const grupo = await crearGrupo(ctx, tokenA, [{ nombre: 'Uno' }]);
    const simple = await crearSimple(ctx, tokenA, base, { gruposModificadores: [grupo.id] });
    const linea = await preparar(simple.id.toUpperCase(), [
      grupo.modificadores[0]!.id.toUpperCase(),
    ]);
    expect(linea.productoId).toBe(simple.id);
    expect(linea.modificadores[0]!.id).toBe(grupo.modificadores[0]!.id);
  });

  it('el precio sale del precio efectivo de la sucursal pedida', async () => {
    const simple = await crearSimple(ctx, tokenA, base, { precio: '25.00' });
    await put(`/carta/productos/${simple.id}/sucursales/${e.A.S1}`, {
      precio: '30.00',
      disponible: true,
    });
    expect((await preparar(simple.id, [], 1, e.A.S1)).precioUnitario).toBe('30.00');
    expect((await preparar(simple.id, [], 1, e.A.S2)).precioUnitario).toBe('25.00');
  });

  describe('PRODUCTO_NO_VENDIBLE (422, con el motivo)', () => {
    const rechazo = async (
      productoId: string,
      sucursalId = e.A.S1,
      instante = ctx.reloj.ahora(),
    ) => {
      const error = (await preparar(productoId, [], 1, sucursalId, instante).then(
        () => null,
        (x: unknown) => x,
      )) as { codigo: string; getStatus: () => number; motivo: string; campos: unknown } | null;
      expect(error, 'esperaba un rechazo').not.toBeNull();
      expect(error!.codigo).toBe('PRODUCTO_NO_VENDIBLE');
      expect(error!.getStatus()).toBe(422);
      return error!;
    };

    it('agotado', async () => {
      const simple = await crearSimple(ctx, tokenA, base);
      exigirEstado(await agotar(simple.id), 200, 'agotar');
      const error = await rechazo(simple.id);
      expect(error.motivo).toBe('AGOTADO');
      expect(error.campos).toEqual([{ campo: 'productoId', mensaje: 'AGOTADO' }]);
      // En S2 se vende; con un instante de mañana vuelve a venderse en S1.
      await expect(preparar(simple.id, [], 1, e.A.S2)).resolves.toBeDefined();
      await expect(
        preparar(simple.id, [], 1, e.A.S1, new Date('2026-11-03T12:00:00-05:00')),
      ).resolves.toBeDefined();
    });

    it('inactivo, no disponible en la sucursal y que no se vende solo', async () => {
      const inactivo = await crearSimple(ctx, tokenA, base);
      await patch(`/carta/productos/${inactivo.id}`, { activo: false });
      expect((await rechazo(inactivo.id)).motivo).toBe('INACTIVO');
      const noDisponible = await crearSimple(ctx, tokenA, base);
      await put(`/carta/productos/${noDisponible.id}/sucursales/${e.A.S1}`, {
        precio: null,
        disponible: false,
      });
      expect((await rechazo(noDisponible.id)).motivo).toBe('NO_DISPONIBLE');
      await expect(preparar(noDisponible.id, [], 1, e.A.S2)).resolves.toBeDefined();
      const ligable = await crearLigable(ctx, tokenA, base);
      expect((await rechazo(ligable.id)).motivo).toBe('NO_SE_VENDE_SOLO');
    });

    it('combo con un componente agotado, menú sin armar y opciones insuficientes', async () => {
      const componente = await crearLigable(ctx, tokenA, base);
      const combo = await crearProducto(
        ctx,
        tokenA,
        cuerpoCombo(base, { componentes: [{ productoId: componente.id, cantidad: 1 }] }),
      );
      exigirEstado(await agotar(componente.id), 200, 'agotar');
      expect((await rechazo(combo.id)).motivo).toBe('COMPONENTE_NO_DISPONIBLE');

      const plato = await crearLigable(ctx, tokenA, base);
      const entrada = await crearGrupo(ctx, tokenA, [
        { nombre: 'Sopa', productoId: plato.id },
        { nombre: 'Ensalada' },
      ]);
      const menu = await crearProducto(
        ctx,
        tokenA,
        cuerpoMenu(base, { gruposModificadores: [entrada.id] }),
      );
      expect((await rechazo(menu.id)).motivo).toBe('MENU_SIN_ARMAR');
      await put(
        `/carta/sucursal/menu-del-dia/${menu.id}`,
        { opciones: [entrada.modificadores[0]!.id] },
        cocinaS1,
      );
      await expect(preparar(menu.id, [entrada.modificadores[0]!.id])).resolves.toBeDefined();
      exigirEstado(await agotar(plato.id), 200, 'agotar el plato');
      expect((await rechazo(menu.id)).motivo).toBe('OPCIONES_INSUFICIENTES');
    });

    it('el producto se rechaza antes que la selección', async () => {
      const simple = await crearSimple(ctx, tokenA, base);
      exigirEstado(await agotar(simple.id), 200, 'agotar');
      const error = await preparar(simple.id, ['no-existe'], 1).catch((x: unknown) => x);
      expect(error).toMatchObject({ codigo: 'PRODUCTO_NO_VENDIBLE' });
    });
  });

  describe('SELECCION_INVALIDA (422, con los errores de validarSeleccion)', () => {
    const errores = async (productoId: string, modificadorIds: string[]) => {
      const error = (await preparar(productoId, modificadorIds).then(
        () => null,
        (x: unknown) => x,
      )) as {
        codigo: string;
        getStatus: () => number;
        errores: unknown[];
        campos: unknown[];
      } | null;
      expect(error, 'esperaba un rechazo').not.toBeNull();
      expect(error!.codigo).toBe('SELECCION_INVALIDA');
      expect(error!.getStatus()).toBe(422);
      return error!;
    };

    it('menos del mínimo, más del máximo, repetido y desconocido, con los datos de cada error', async () => {
      const termino = await crearGrupo(ctx, tokenA, [{ nombre: 'Jugoso' }, { nombre: '3/4' }]);
      const extras = (await post('/carta/grupos-modificadores', {
        nombre: unico('Extras'),
        seleccion: 'MULTIPLE',
        minimo: 0,
        maximo: 2,
        modificadores: [{ nombre: 'Huevo' }, { nombre: 'Plátano' }, { nombre: 'Queso' }],
      })) as unknown as GrupoCreado;
      const lomo = await crearSimple(ctx, tokenA, base, {
        gruposModificadores: [termino.id, extras.id],
      });
      const [jugoso, tresCuartos] = termino.modificadores;
      const [huevo, platano, queso] = extras.modificadores;

      expect((await errores(lomo.id, [])).errores).toEqual([
        { codigo: 'MENOS_DEL_MINIMO', grupoId: termino.id, minimo: 1, elegidos: 0 },
      ]);
      expect((await errores(lomo.id, [jugoso!.id, tresCuartos!.id])).errores).toEqual([
        { codigo: 'MAS_DEL_MAXIMO', grupoId: termino.id, maximo: 1, elegidos: 2 },
      ]);
      expect(
        (await errores(lomo.id, [tresCuartos!.id, huevo!.id, platano!.id, queso!.id])).errores,
      ).toEqual([{ codigo: 'MAS_DEL_MAXIMO', grupoId: extras.id, maximo: 2, elegidos: 3 }]);
      expect((await errores(lomo.id, [tresCuartos!.id, huevo!.id, huevo!.id])).errores).toEqual([
        { codigo: 'MODIFICADOR_REPETIDO', modificadorId: huevo!.id },
      ]);
      const desconocido = '7b9a2c3e-0000-4000-8000-0000000000aa';
      const rechazo = await errores(lomo.id, [tresCuartos!.id, desconocido]);
      expect(rechazo.errores).toEqual([
        { codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: desconocido },
      ]);
      expect(rechazo.campos).toEqual([
        { campo: 'modificadorIds', mensaje: `MODIFICADOR_DESCONOCIDO: ${desconocido}` },
      ]);
    });

    it('un modificador de otro producto es desconocido; uno agotado es MODIFICADOR_NO_DISPONIBLE', async () => {
      const cerveza = await crearLigable(ctx, tokenA, base);
      const grupo = await crearGrupo(ctx, tokenA, [
        { nombre: 'Chicha' },
        { nombre: 'Cerveza', productoId: cerveza.id },
      ]);
      const otroGrupo = await crearGrupo(ctx, tokenA, [{ nombre: 'Ajeno' }]);
      const combo = await crearProducto(
        ctx,
        tokenA,
        cuerpoCombo(base, { gruposModificadores: [grupo.id] }),
      );
      await crearSimple(ctx, tokenA, base, { gruposModificadores: [otroGrupo.id] });
      const ajeno = otroGrupo.modificadores[0]!.id;
      expect((await errores(combo.id, [grupo.modificadores[0]!.id, ajeno])).errores).toEqual([
        { codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: ajeno },
      ]);
      exigirEstado(await agotar(cerveza.id), 200, 'agotar la cerveza');
      expect((await errores(combo.id, [grupo.modificadores[1]!.id])).errores).toEqual([
        { codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId: grupo.modificadores[1]!.id },
      ]);
      await expect(preparar(combo.id, [grupo.modificadores[0]!.id])).resolves.toBeDefined();
    });

    it('en un menú del día, un plato que no es de las opciones de hoy es desconocido', async () => {
      const entrada = await crearGrupo(ctx, tokenA, [{ nombre: 'Sopa' }, { nombre: 'Ensalada' }]);
      const menu = await crearProducto(
        ctx,
        tokenA,
        cuerpoMenu(base, { gruposModificadores: [entrada.id] }),
      );
      await put(
        `/carta/sucursal/menu-del-dia/${menu.id}`,
        { opciones: [entrada.modificadores[0]!.id] },
        cocinaS1,
      );
      const fueraDelDia = entrada.modificadores[1]!.id;
      expect((await errores(menu.id, [fueraDelDia])).errores).toEqual([
        { codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: fueraDelDia },
        { codigo: 'MENOS_DEL_MINIMO', grupoId: entrada.id, minimo: 1, elegidos: 0 },
      ]);
    });
  });

  it('una cantidad fuera de 1 a 999 lanza RangeError y no escribe nada', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    for (const cantidad of [0, -1, 1.5, 1000, Number.NaN]) {
      await expect(preparar(simple.id, [], cantidad)).rejects.toBeInstanceOf(RangeError);
    }
    await expect(preparar(simple.id, [], 999)).resolves.toMatchObject({ cantidad: 999 });
  });

  it('una sucursal o un producto inexistente o de otra empresa es 404 con el mismo cuerpo', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    const deB = await crearSimple(ctx, tokenB, await sembrarBase(ctx, tokenB));
    const cuerpo = (x: unknown) =>
      JSON.stringify({ ...(x as object), mensaje: (x as Error).message });
    const errorProducto = await preparar('7b9a2c3e-0000-4000-8000-0000000000bb', []).catch(
      (x: unknown) => x,
    );
    const errorB = await preparar(deB.id, []).catch((x: unknown) => x);
    expect(errorProducto).toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(cuerpo(errorB)).toBe(cuerpo(errorProducto));
    await expect(preparar(simple.id, [], 1, e.B.S1)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    });
    await expect(preparar('no-es-uuid', [])).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('prepararLinea no escribe nada: ni filas, ni auditoría, ni eventos', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    await asentar();
    ctx.publicador.limpiar();
    const antes = (
      await admin.query('SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = $1', [
        e.A.empresaId,
      ])
    ).rows[0].n;
    await preparar(simple.id, [], 3);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
    const despues = (
      await admin.query('SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = $1', [
        e.A.empresaId,
      ])
    ).rows[0].n;
    expect(despues).toBe(antes);
  });
});
