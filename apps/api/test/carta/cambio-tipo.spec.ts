// Historia 003, grupo C4 · cambio de tipo de un producto (criterios 10, 10b, 10c, 10d, 27 y 32): pruebas del
// desarrollador (no protegidas). Que el Cajero cambie el tipo y deje su fila de auditoría lo cubre la prueba
// protegida `cajero-carta.spec.ts`. Aquí: cada transición, lo que se quita y su confirmación, `EN_USO` por
// componente y por producto ligado, el orden de los rechazos, la carrera con una referencia nueva, un
// modificador inactivo que no se puede reactivar y el orden de bloqueo frente a `PATCH` de grupos.
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  instantaneaCarta,
  unaFila,
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
  camposDe,
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

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let adminS1: string;
let adminS2: string;
let base: Base;
let cocina: { id: string; nombre: string };
let bebida: GrupoCreado;
let acompanamiento: GrupoCreado;

let relojMovido = false;

async function abrirSesiones(): Promise<void> {
  tokenA = await sesionContrasena(ctx, e.A.base.admin, null);
  adminS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
  adminS2 = await sesionContrasena(ctx, e.A.base.admin, e.A.S2);
}

async function mover(instante: string): Promise<void> {
  ctx.reloj.fijar(instante);
  relojMovido = true;
  await abrirSesiones();
}

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  await abrirSesiones();
  const b = await sembrarBase(ctx, tokenA);
  base = b;
  const estacion = await pedir(ctx, tokenA, 'get', '/carta/estaciones');
  const { id, nombre } = estacion.body.find((x: { id: string }) => x.id === b.estacionId);
  cocina = { id, nombre };
  bebida = await crearGrupo(ctx, tokenA, [
    { nombre: 'Chicha' },
    { nombre: 'Inca Kola' },
    { nombre: 'Cerveza', precioExtra: '4.50' },
  ]);
  acompanamiento = await crearGrupo(ctx, tokenA, [
    { nombre: 'Papas' },
    { nombre: 'Ensalada', precioExtra: '1.00' },
  ]);
});

beforeEach(async () => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
  if (relojMovido) {
    relojMovido = false;
    await abrirSesiones();
  }
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const patch = (id: string, cuerpo: unknown, token = tokenA) =>
  pedir(ctx, token, 'patch', `/carta/productos/${id}`, cuerpo);
const filaDe = async (id: string) =>
  (await admin.query('SELECT * FROM producto WHERE id = $1', [id])).rows[0];
const componentesEn = async (id: string): Promise<string[]> =>
  (
    await admin.query(
      'SELECT producto_id FROM componente_combo WHERE combo_id = $1 ORDER BY orden',
      [id],
    )
  ).rows.map((r) => r.producto_id);
const opcionesEn = async (id: string): Promise<number> =>
  (
    await admin.query('SELECT count(*)::int AS n FROM menu_del_dia_opcion WHERE producto_id = $1', [
      id,
    ])
  ).rows[0].n;
const auditorias = (id: string) =>
  auditoriaCarta(admin, e.A.empresaId, { accion: 'modificar_producto', entidadId: id });

/** Un simple en la estación con su precio (el "Lomo saltado" del criterio 10b). */
const lomo = (extra: Record<string, unknown> = {}) =>
  crearSimple(ctx, tokenA, base, { nombre: unico('Lomo saltado'), precio: '28.00', ...extra });
const hamburguesaClasica = () =>
  crearSimple(ctx, tokenA, base, { nombre: unico('Hamburguesa clásica'), precio: '15.00' });
/** El combo de referencia del criterio 30. */
const comboHamburguesa = async () => {
  const hamburguesa = await hamburguesaClasica();
  const combo = await crearProducto(
    ctx,
    tokenA,
    cuerpoCombo(base, {
      nombre: unico('Combo hamburguesa'),
      componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
      gruposModificadores: [bebida.id, acompanamiento.id],
    }),
  );
  return { combo, hamburguesa };
};

describe('criterio 10b · SIMPLE → COMBO', () => {
  it('quita la estación: sin confirmar responde 409 con seQuita y no cambia nada; con confirmarPerdida lo aplica', async () => {
    const simple = await lomo({ gruposModificadores: [bebida.id, acompanamiento.id] });
    const papas = await crearLigable(ctx, tokenA, base, { nombre: unico('Papas del combo') });
    const cuerpo = { tipo: 'COMBO', componentes: [{ productoId: papas.id, cantidad: 1 }] };
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    ctx.publicador.limpiar();

    const res = await patch(simple.id, cuerpo);
    esperarError(res, 409, 'CONFIRMACION_REQUERIDA');
    expect(res.body.seQuita).toEqual({ estacion: cocina, componentes: [], opcionesDelDia: [] });
    expect(res.body.mensaje).toContain(cocina.nombre);
    await asentar();
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    expect(ctx.publicador.eventos()).toEqual([]);

    const ok = await patch(simple.id, { ...cuerpo, confirmarPerdida: true });
    exigirEstado(ok, 200, 'confirmado');
    expect(ok.body).toMatchObject({
      tipo: 'COMBO',
      estacionId: null,
      seVendeSolo: true,
      precio: '28.00',
      componentes: [{ productoId: papas.id, cantidad: 1 }],
    });
    expect(ok.body.grupos.map((g: { id: string }) => g.id)).toEqual([bebida.id, acompanamiento.id]);
    expect(await filaDe(simple.id)).toMatchObject({ tipo: 'COMBO', estacion_id: null });
    await asentar();
    expect(ctx.publicador.eventos()).toHaveLength(1);
    expect(ctx.publicador.eventos()[0]).toMatchObject({
      sala: { tipo: 'empresa' },
      nombre: 'carta.actualizada',
    });
    const filas = await auditorias(simple.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toMatchObject({
      tipo: { antes: 'SIMPLE', despues: 'COMBO' },
      estacionId: { antes: base.estacionId, despues: null },
      componentes: { antes: [], despues: [{ productoId: papas.id, cantidad: 1 }] },
      quitado: { estacion: cocina },
    });
  });

  it('un simple sin estación pasa a combo sin confirmar, y confirmarPerdida se ignora si no se quita nada', async () => {
    const sinEstacion = await lomo({ estacionId: null });
    const papas = await crearLigable(ctx, tokenA, base);
    const ok = await patch(sinEstacion.id, {
      tipo: 'COMBO',
      componentes: [{ productoId: papas.id, cantidad: 1 }],
    });
    exigirEstado(ok, 200, 'sin pérdida no hace falta confirmar');
    expect(ok.body.tipo).toBe('COMBO');
    const filas = await auditorias(sinEstacion.id);
    expect((filas[0]!.detalle as { quitado?: unknown }).quitado).toBeUndefined();
    const otro = await lomo({ estacionId: null });
    exigirEstado(
      await patch(otro.id, {
        tipo: 'COMBO',
        gruposModificadores: [bebida.id],
        confirmarPerdida: true,
      }),
      200,
      'confirmarPerdida sobrante',
    );
  });

  it('los datos del tipo nuevo se exigen sobre el resultado (400): el combo necesita algo que contener y su estación sigue en null', async () => {
    const simple = await lomo({ estacionId: null });
    const papas = await crearLigable(ctx, tokenA, base);
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const casos: [string, Record<string, unknown>, string][] = [
      ['sin componentes ni grupos', { tipo: 'COMBO' }, 'componentes'],
      [
        'con una estación nueva',
        {
          tipo: 'COMBO',
          estacionId: base.estacionId,
          componentes: [{ productoId: papas.id, cantidad: 1 }],
        },
        'estacionId',
      ],
      [
        'que no se venda solo',
        { tipo: 'COMBO', seVendeSolo: false, gruposModificadores: [bebida.id] },
        'seVendeSolo',
      ],
      ['sin precio', { tipo: 'COMBO', precio: null, gruposModificadores: [bebida.id] }, 'precio'],
    ];
    for (const [nombre, cuerpo, campo] of casos) {
      const res = await patch(simple.id, cuerpo);
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(
        camposDe(res).some((c) => c.startsWith(campo)),
        nombre,
      ).toBe(true);
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un producto que no se vende solo y no tiene precio necesita precio en el mismo PATCH', async () => {
    const sinPrecio = await crearLigable(ctx, tokenA, base, { estacionId: null });
    const sinPrecioEnElCuerpo = await patch(sinPrecio.id, {
      tipo: 'COMBO',
      gruposModificadores: [bebida.id],
    });
    esperarError(sinPrecioEnElCuerpo, 400, 'DATOS_INVALIDOS');
    expect(camposDe(sinPrecioEnElCuerpo)).toContain('precio');
    const ok = await patch(sinPrecio.id, {
      tipo: 'COMBO',
      precio: '19.9',
      gruposModificadores: [bebida.id],
    });
    exigirEstado(ok, 200, 'con precio');
    expect(ok.body).toMatchObject({ tipo: 'COMBO', seVendeSolo: true, precio: '19.90' });
  });

  it('un producto no puede ser componente de sí mismo al pasar a combo (422)', async () => {
    const simple = await lomo({ estacionId: null });
    const res = await patch(simple.id, {
      tipo: 'COMBO',
      componentes: [{ productoId: simple.id, cantidad: 1 }],
    });
    esperarError(res, 422, 'REFERENCIA_INVALIDA');
    expect(camposDe(res)).toEqual(['componentes']);
    expect((await filaDe(simple.id)).tipo).toBe('SIMPLE');
  });

  it('SIMPLE → MENU_DEL_DIA exige al menos un grupo; con grupos nace sin opciones del día', async () => {
    const simple = await lomo({ estacionId: null });
    const papas = await crearLigable(ctx, tokenA, base);
    esperarError(
      await patch(simple.id, {
        tipo: 'MENU_DEL_DIA',
        componentes: [{ productoId: papas.id, cantidad: 1 }],
      }),
      400,
      'DATOS_INVALIDOS',
    );
    const ok = await patch(simple.id, { tipo: 'MENU_DEL_DIA', gruposModificadores: [bebida.id] });
    exigirEstado(ok, 200, 'a menú');
    expect(ok.body.tipo).toBe('MENU_DEL_DIA');
    expect(await opcionesEn(simple.id)).toBe(0);
  });
});

describe('criterio 10b · COMBO → SIMPLE', () => {
  it('ejemplo del combo hamburguesa: pide la estación, lista los componentes, y al confirmar los borra y conserva los grupos', async () => {
    const { combo, hamburguesa } = await comboHamburguesa();
    const sinEstacion = await patch(combo.id, { tipo: 'SIMPLE' });
    esperarError(sinEstacion, 400, 'DATOS_INVALIDOS');
    expect(camposDe(sinEstacion)).toEqual(['estacionId']);

    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const res = await patch(combo.id, { tipo: 'SIMPLE', estacionId: base.estacionId });
    esperarError(res, 409, 'CONFIRMACION_REQUERIDA');
    expect(res.body.seQuita).toEqual({
      estacion: null,
      componentes: [{ productoId: hamburguesa.id, nombre: hamburguesa.nombre, cantidad: 1 }],
      opcionesDelDia: [],
    });
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);

    const ok = await patch(combo.id, {
      tipo: 'SIMPLE',
      estacionId: base.estacionId,
      confirmarPerdida: true,
    });
    exigirEstado(ok, 200, 'confirmado');
    expect(ok.body).toMatchObject({
      tipo: 'SIMPLE',
      estacionId: base.estacionId,
      componentes: [],
      precio: '22.90',
      seVendeSolo: true,
    });
    expect(ok.body.grupos.map((g: { id: string }) => g.id)).toEqual([bebida.id, acompanamiento.id]);
    expect(await componentesEn(combo.id)).toEqual([]);
    const filas = await auditorias(combo.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toMatchObject({
      tipo: { antes: 'COMBO', despues: 'SIMPLE' },
      quitado: {
        componentes: [{ productoId: hamburguesa.id, nombre: hamburguesa.nombre, cantidad: 1 }],
      },
    });
  });

  it('con estacionId null (sin estación) también es un id explícito y no pide más que la confirmación', async () => {
    const { combo } = await comboHamburguesa();
    esperarError(
      await patch(combo.id, { tipo: 'SIMPLE', estacionId: null }),
      409,
      'CONFIRMACION_REQUERIDA',
    );
    const ok = await patch(combo.id, { tipo: 'SIMPLE', estacionId: null, confirmarPerdida: true });
    exigirEstado(ok, 200, 'confirmado');
    expect(ok.body.estacionId).toBeNull();
  });

  it('un combo sin componentes pasa a simple sin confirmar', async () => {
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { gruposModificadores: [bebida.id] }),
    );
    exigirEstado(
      await patch(combo.id, { tipo: 'SIMPLE', estacionId: base.estacionId }),
      200,
      'sin pérdida',
    );
  });

  it('no admite componentes en el cuerpo (400) ni una estación inactiva, de B o inexistente (422)', async () => {
    const { combo, hamburguesa } = await comboHamburguesa();
    const conComponentes = await patch(combo.id, {
      tipo: 'SIMPLE',
      estacionId: base.estacionId,
      componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    });
    esperarError(conComponentes, 400, 'DATOS_INVALIDOS');
    expect(camposDe(conComponentes)).toContain('componentes');
    const estacionB = await pedir(ctx, e.B.tokenAdmin, 'post', '/carta/estaciones', {
      nombre: unico('Cocina B'),
    });
    for (const estacionId of [crypto.randomUUID(), estacionB.body.id]) {
      const res = await patch(combo.id, { tipo: 'SIMPLE', estacionId, confirmarPerdida: true });
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(camposDe(res)).toEqual(['estacionId']);
    }
    expect((await filaDe(combo.id)).tipo).toBe('COMBO');
  });

  it('dejar de venderse solo es válido sin precio propio en las sucursales (10d) y se rechaza con 409 si lo tiene', async () => {
    const { combo } = await comboHamburguesa();
    const dejaDeVenderse = {
      tipo: 'SIMPLE',
      estacionId: base.estacionId,
      seVendeSolo: false,
      precio: null,
      confirmarPerdida: true,
    };
    // Con un precio propio en S1 (lo pone el Administrador) el cambio se rechaza y nada se toca.
    exigirEstado(
      await pedir(ctx, tokenA, 'put', `/carta/productos/${combo.id}/sucursales/${e.A.S1}`, {
        precio: '24.00',
        disponible: true,
      }),
      200,
      'precio propio en S1',
    );
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const res = await patch(combo.id, dejaDeVenderse);
    esperarError(res, 409, 'CONFLICTO');
    expect(camposDe(res)).toEqual(['seVendeSolo']);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    // Sin precios de sucursal pasa: se quitan primero con el criterio 19.
    exigirEstado(
      await pedir(ctx, tokenA, 'put', `/carta/productos/${combo.id}/sucursales/${e.A.S1}`, {
        precio: null,
        disponible: true,
      }),
      200,
      'quitar el precio propio',
    );
    const ok = await patch(combo.id, dejaDeVenderse);
    exigirEstado(ok, 200, 'ahora sí');
    expect(ok.body).toMatchObject({ tipo: 'SIMPLE', seVendeSolo: false, precio: null });
  });

  it('dejar de venderse solo con precio propio responde 409 CONFLICTO antes de pedir la confirmación', async () => {
    const { combo } = await comboHamburguesa();
    exigirEstado(
      await pedir(ctx, tokenA, 'put', `/carta/productos/${combo.id}/sucursales/${e.A.S2}`, {
        precio: '25.00',
        disponible: true,
      }),
      200,
      'precio propio en S2',
    );
    const res = await patch(combo.id, {
      tipo: 'SIMPLE',
      estacionId: base.estacionId,
      seVendeSolo: false,
      precio: null,
    });
    esperarError(res, 409, 'CONFLICTO');
  });
});

describe('criterio 10b · MENU_DEL_DIA → COMBO o SIMPLE', () => {
  /** Un menú armado hoy en S1 (3 opciones) y mañana en S2 (1 opción). */
  async function menuArmado() {
    const entrada = await crearGrupo(ctx, tokenA, [{ nombre: 'Papa' }, { nombre: 'Sopa' }]);
    const segundo = await crearGrupo(ctx, tokenA, [{ nombre: 'Ají' }, { nombre: 'Lomo' }]);
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [entrada.id, segundo.id] }),
    );
    const ruta = `/carta/sucursal/menu-del-dia/${menu.id}`;
    exigirEstado(
      await pedir(ctx, adminS1, 'put', ruta, {
        opciones: [
          entrada.modificadores[0]!.id,
          entrada.modificadores[1]!.id,
          segundo.modificadores[0]!.id,
        ],
      }),
      200,
      'armar hoy en S1',
    );
    exigirEstado(
      await pedir(ctx, adminS2, 'put', ruta, {
        dia: '2026-11-03',
        opciones: [segundo.modificadores[1]!.id],
      }),
      200,
      'armar mañana en S2',
    );
    return { menu, entrada, segundo };
  }

  it('ejemplo: un menú armado hoy en S1 y mañana en S2 a COMBO lista las dos filas; confirmado, borra todas las opciones', async () => {
    const { menu } = await menuArmado();
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const res = await patch(menu.id, { tipo: 'COMBO' });
    esperarError(res, 409, 'CONFIRMACION_REQUERIDA');
    const nombres = new Map(e.A.base.sucursales.map((s) => [s.id, s.nombre]));
    expect(res.body.seQuita.estacion).toBeNull();
    expect(res.body.seQuita.componentes).toEqual([]);
    expect(res.body.seQuita.opcionesDelDia).toHaveLength(2);
    expect(res.body.seQuita.opcionesDelDia).toEqual(
      expect.arrayContaining([
        { sucursalId: e.A.S1, sucursalNombre: nombres.get(e.A.S1), dia: '2026-11-02', opciones: 3 },
        { sucursalId: e.A.S2, sucursalNombre: nombres.get(e.A.S2), dia: '2026-11-03', opciones: 1 },
      ]),
    );
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);

    const ok = await patch(menu.id, { tipo: 'COMBO', confirmarPerdida: true });
    exigirEstado(ok, 200, 'confirmado');
    expect(ok.body.tipo).toBe('COMBO');
    expect(await opcionesEn(menu.id)).toBe(0);
    const filas = await auditorias(menu.id);
    expect(filas).toHaveLength(1);
    const quitado = (filas[0]!.detalle as { quitado: { opcionesDelDia: unknown } }).quitado
      .opcionesDelDia as {
      sucursalId: string;
      dia: string;
      modificadorIds: string[];
    }[];
    expect(quitado.map((o) => [o.sucursalId, o.dia, o.modificadorIds.length]).sort()).toEqual(
      [
        [e.A.S1, '2026-11-02', 3],
        [e.A.S2, '2026-11-03', 1],
      ].sort(),
    );
  });

  it('las opciones de días anteriores no se listan, no piden confirmación por sí solas y se borran de todos modos', async () => {
    const { menu, entrada } = await menuArmado();
    // Sale del día de S1 y S2: las del 2 y 3 de noviembre quedan en el pasado de ambas sucursales.
    await mover('2026-11-05T10:00:00-05:00');
    const sinPendientes = await patch(menu.id, { tipo: 'COMBO' });
    exigirEstado(
      sinPendientes,
      200,
      'solo había opciones de días pasados: no hace falta confirmar',
    );
    expect(await opcionesEn(menu.id)).toBe(0);
    const detalle = (await auditorias(menu.id))[0]!.detalle as {
      quitado: { opcionesDelDia?: unknown[] };
    };
    const quitado = detalle.quitado.opcionesDelDia ?? [];
    expect(quitado).toHaveLength(2);

    // Con una de hoy y otra de ayer: solo la de hoy se lista, y se borran las dos.
    const otro = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [entrada.id] }),
    );
    const ruta = `/carta/sucursal/menu-del-dia/${otro.id}`;
    exigirEstado(
      await pedir(ctx, adminS1, 'put', ruta, { opciones: [entrada.modificadores[0]!.id] }),
      200,
      'hoy',
    );
    ctx.reloj.fijar('2026-11-06T10:00:00-05:00');
    await abrirSesiones();
    exigirEstado(
      await pedir(ctx, adminS1, 'put', ruta, { opciones: [entrada.modificadores[1]!.id] }),
      200,
      'hoy (6)',
    );
    expect(await opcionesEn(otro.id)).toBe(2);
    const res = await patch(otro.id, { tipo: 'SIMPLE', estacionId: null });
    esperarError(res, 409, 'CONFIRMACION_REQUERIDA');
    expect(res.body.seQuita.opcionesDelDia).toEqual([
      expect.objectContaining({ sucursalId: e.A.S1, dia: '2026-11-06', opciones: 1 }),
    ]);
    exigirEstado(
      await patch(otro.id, { tipo: 'SIMPLE', estacionId: null, confirmarPerdida: true }),
      200,
      'confirmar',
    );
    expect(await opcionesEn(otro.id)).toBe(0);
  });

  it('un menú con componentes y opciones que pasa a simple lista las dos cosas', async () => {
    const entrada = await crearGrupo(ctx, tokenA, [{ nombre: 'Papa' }, { nombre: 'Sopa' }]);
    const refresco = await crearLigable(ctx, tokenA, base, { nombre: unico('Refresco') });
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, {
        gruposModificadores: [entrada.id],
        componentes: [{ productoId: refresco.id, cantidad: 1 }],
      }),
    );
    exigirEstado(
      await pedir(ctx, adminS1, 'put', `/carta/sucursal/menu-del-dia/${menu.id}`, {
        opciones: [entrada.modificadores[0]!.id],
      }),
      200,
      'armar',
    );
    const res = await patch(menu.id, { tipo: 'SIMPLE', estacionId: base.estacionId });
    esperarError(res, 409, 'CONFIRMACION_REQUERIDA');
    expect(res.body.seQuita.componentes).toEqual([
      { productoId: refresco.id, nombre: refresco.nombre, cantidad: 1 },
    ]);
    expect(res.body.seQuita.opcionesDelDia).toHaveLength(1);
    exigirEstado(
      await patch(menu.id, { tipo: 'SIMPLE', estacionId: base.estacionId, confirmarPerdida: true }),
      200,
      'confirmar',
    );
    expect(await componentesEn(menu.id)).toEqual([]);
    expect(await opcionesEn(menu.id)).toBe(0);
  });

  it('un menú sin opciones armadas pasa a combo sin confirmar', async () => {
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [bebida.id] }),
    );
    exigirEstado(await patch(menu.id, { tipo: 'COMBO' }), 200, 'sin opciones');
  });
});

describe('criterio 10b · COMBO → MENU_DEL_DIA', () => {
  it('no quita nada: conserva el precio, los componentes y los grupos, y nace sin opciones del día', async () => {
    const { combo, hamburguesa } = await comboHamburguesa();
    ctx.publicador.limpiar();
    const ok = await patch(combo.id, { tipo: 'MENU_DEL_DIA' });
    exigirEstado(ok, 200, 'sin confirmar');
    expect(ok.body).toMatchObject({
      tipo: 'MENU_DEL_DIA',
      precio: '22.90',
      seVendeSolo: true,
      estacionId: null,
      componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    });
    expect(ok.body.grupos.map((g: { id: string }) => g.id)).toEqual([bebida.id, acompanamiento.id]);
    expect(await opcionesEn(combo.id)).toBe(0);
    const menus = await pedir(ctx, adminS1, 'get', '/carta/sucursal/menu-del-dia');
    const elMenu = (
      menus.body as { productoId: string; grupos: { opciones: { elegida: boolean }[] }[] }[]
    ).find((m) => m.productoId === combo.id)!;
    expect(elMenu.grupos.flatMap((g) => g.opciones).every((o) => !o.elegida)).toBe(true);
    const filas = await auditorias(combo.id);
    expect(filas[0]!.detalle).toEqual({ tipo: { antes: 'COMBO', despues: 'MENU_DEL_DIA' } });
  });

  it('un combo que solo tiene componentes (sin grupos) no puede ser menú: necesita un grupo (400)', async () => {
    const hamburguesa = await hamburguesaClasica();
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { componentes: [{ productoId: hamburguesa.id, cantidad: 1 }] }),
    );
    esperarError(await patch(combo.id, { tipo: 'MENU_DEL_DIA' }), 400, 'DATOS_INVALIDOS');
    exigirEstado(
      await patch(combo.id, { tipo: 'MENU_DEL_DIA', gruposModificadores: [bebida.id] }),
      200,
      'con un grupo',
    );
  });
});

describe('criterio 10: un tipo igual al guardado no es un cambio', () => {
  it('SIMPLE → SIMPLE no pide estación ni confirmación y no deja auditoría', async () => {
    const simple = await lomo();
    const n = (await auditorias(simple.id)).length;
    exigirEstado(
      await patch(simple.id, { tipo: 'SIMPLE', confirmarPerdida: true, nombre: simple.nombre }),
      200,
      'igual',
    );
    expect((await auditorias(simple.id)).length).toBe(n);
  });

  it('confirmarPerdida solo no es un cuerpo válido (400)', async () => {
    const simple = await lomo();
    esperarError(await patch(simple.id, { confirmarPerdida: true }), 400, 'DATOS_INVALIDOS');
    esperarError(await patch(simple.id, { tipo: 'OTRO' }), 400, 'DATOS_INVALIDOS');
    esperarError(await patch(simple.id, { tipo: 'combo' }), 400, 'DATOS_INVALIDOS');
  });
});

describe('criterio 10c · un producto que se usa en otro no pasa a combo ni a menú', () => {
  it('como componente de combos activos e inactivos: 409 EN_USO con usadoEn y el mensaje de dónde se usa, con o sin confirmación', async () => {
    const componente = await hamburguesaClasica();
    const a = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, {
        nombre: unico('B combo'),
        componentes: [{ productoId: componente.id, cantidad: 1 }],
      }),
    );
    const b = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, {
        nombre: unico('A combo'),
        componentes: [{ productoId: componente.id, cantidad: 2 }],
      }),
    );
    exigirEstado(await patch(b.id, { activo: false }), 200, 'desactivar un combo');
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const cuerpo of [
      { tipo: 'COMBO', gruposModificadores: [bebida.id] },
      { tipo: 'MENU_DEL_DIA', gruposModificadores: [bebida.id], confirmarPerdida: true },
    ]) {
      const res = await patch(componente.id, { ...cuerpo, estacionId: null });
      esperarError(res, 409, 'EN_USO');
      expect(res.body.usadoEn).toEqual({
        combos: [
          { id: b.id, nombre: b.nombre },
          { id: a.id, nombre: a.nombre },
        ],
        modificadores: [],
      });
      expect(res.body.mensaje).toContain(`Se usa en: ${b.nombre}; ${a.nombre}`);
      expect(res.body.mensaje).toContain('Quítalo de ahí antes de convertirlo en');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    // Al quitarlo de los combos, ya puede cambiar.
    for (const combo of [a, b]) {
      exigirEstado(
        await patch(combo.id, { componentes: [], gruposModificadores: [bebida.id] }),
        200,
        'quitar el componente',
      );
    }
    exigirEstado(
      await patch(componente.id, {
        tipo: 'COMBO',
        estacionId: null,
        gruposModificadores: [bebida.id],
        confirmarPerdida: true,
      }),
      200,
      'ya no se usa',
    );
  });

  it('como producto ligado de un modificador activo: 409 EN_USO con el grupo y el modificador', async () => {
    const ligado = await crearLigable(ctx, tokenA, base, { estacionId: null });
    const grupo = await crearGrupo(
      ctx,
      tokenA,
      [{ nombre: 'Inca Kola', productoId: ligado.id }, { nombre: 'Agua' }],
      { nombre: unico('Bebida del combo') },
    );
    const res = await patch(ligado.id, {
      tipo: 'COMBO',
      precio: '10.00',
      gruposModificadores: [bebida.id],
    });
    esperarError(res, 409, 'EN_USO');
    expect(res.body.usadoEn).toEqual({
      combos: [],
      modificadores: [
        {
          id: grupo.modificadores[0]!.id,
          nombre: 'Inca Kola',
          grupoId: grupo.id,
          grupoNombre: grupo.nombre,
        },
      ],
    });
    expect(res.body.mensaje).toContain(`${grupo.nombre} › Inca Kola`);
    expect((await filaDe(ligado.id)).tipo).toBe('SIMPLE');
  });

  it('un modificador inactivo no cuenta; si se reactiva con su producto ya convertido, 422 y el grupo no cambia', async () => {
    const ligado = await crearLigable(ctx, tokenA, base, { estacionId: null });
    const grupo = await crearGrupo(ctx, tokenA, [
      { nombre: 'Inca Kola', productoId: ligado.id },
      { nombre: 'Agua' },
    ]);
    const [incaKola, agua] = grupo.modificadores as unknown as [{ id: string }, { id: string }];
    // Se quita Inca Kola del grupo (pasa a inactivo) y entonces el producto ya puede ser combo.
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${grupo.id}`, {
        modificadores: [{ id: agua.id, nombre: 'Agua' }],
      }),
      200,
      'quitar Inca Kola',
    );
    exigirEstado(
      await patch(ligado.id, { tipo: 'COMBO', precio: '9.00', gruposModificadores: [bebida.id] }),
      200,
      'el modificador inactivo no cuenta',
    );
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const reactivar = await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${grupo.id}`, {
      modificadores: [
        { id: agua.id, nombre: 'Agua' },
        { id: incaKola.id, nombre: 'Inca Kola', productoId: ligado.id },
      ],
    });
    esperarError(reactivar, 422, 'REFERENCIA_INVALIDA');
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    // Sin el producto ligado, sí se reactiva.
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${grupo.id}`, {
        modificadores: [
          { id: agua.id, nombre: 'Agua' },
          { id: incaKola.id, nombre: 'Inca Kola', productoId: null },
        ],
      }),
      200,
      'reactivar sin producto ligado',
    );
  });
});

describe('criterio 10: el orden de los rechazos', () => {
  it('400 de forma, 404, 422, 400 de las reglas, 409 EN_USO, 409 CONFLICTO y al final 409 CONFIRMACION_REQUERIDA', async () => {
    // 400 de forma antes que el 404.
    esperarError(await patch(crypto.randomUUID(), { tipo: 'OTRO' }), 400, 'DATOS_INVALIDOS');
    // 404 antes que todo lo demás.
    esperarError(
      await patch(crypto.randomUUID(), { tipo: 'COMBO', componentes: [] }),
      404,
      'NO_ENCONTRADO',
    );
    // 422 antes que las reglas (400): el combo no tiene componentes ni grupos, pero la estación no existe.
    const simple = await lomo();
    esperarError(
      await patch(simple.id, { tipo: 'COMBO', estacionId: crypto.randomUUID() }),
      422,
      'REFERENCIA_INVALIDA',
    );
    // 400 de las reglas antes que EN_USO: el producto se usa, pero el combo queda sin nada que contener.
    const usado = await hamburguesaClasica();
    await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { componentes: [{ productoId: usado.id, cantidad: 1 }] }),
    );
    esperarError(
      await patch(usado.id, { tipo: 'COMBO', estacionId: null }),
      400,
      'DATOS_INVALIDOS',
    );
    // EN_USO antes que CONFIRMACION_REQUERIDA: el producto tiene estación (se quitaría) y además se usa.
    esperarError(
      await patch(usado.id, { tipo: 'COMBO', gruposModificadores: [bebida.id] }),
      409,
      'EN_USO',
    );
    // CONFLICTO antes que CONFIRMACION_REQUERIDA.
    const { combo } = await comboHamburguesa();
    exigirEstado(
      await pedir(ctx, tokenA, 'put', `/carta/productos/${combo.id}/sucursales/${e.A.S1}`, {
        precio: '20.00',
        disponible: true,
      }),
      200,
      'precio en S1',
    );
    esperarError(
      await patch(combo.id, { tipo: 'SIMPLE', estacionId: null, seVendeSolo: false, precio: null }),
      409,
      'CONFLICTO',
    );
  });
});

describe('criterio 10c y plan · carreras entre un cambio de tipo y una referencia nueva', () => {
  const REPETICIONES = 8;

  it('agregar un componente a un combo mientras el producto pasa a combo: nunca quedan las dos cosas', async () => {
    for (let i = 0; i < REPETICIONES; i++) {
      const objetivo = await lomo({ estacionId: null });
      const combo = await crearProducto(
        ctx,
        tokenA,
        cuerpoCombo(base, { gruposModificadores: [bebida.id] }),
      );
      const [conversion, agregado] = await Promise.all([
        patch(objetivo.id, { tipo: 'COMBO', gruposModificadores: [bebida.id] }),
        patch(combo.id, { componentes: [{ productoId: objetivo.id, cantidad: 1 }] }),
      ]);
      const tipo = (await filaDe(objetivo.id)).tipo;
      const esComponente = (await componentesEn(combo.id)).includes(objetivo.id);
      expect(
        esComponente && tipo !== 'SIMPLE',
        `iteración ${i}: ${conversion.status}/${agregado.status}`,
      ).toBe(false);
      if (tipo === 'COMBO') {
        expect([conversion.status, agregado.status]).toEqual([200, 422]);
        expect(agregado.body.codigo).toBe('REFERENCIA_INVALIDA');
      } else {
        expect([conversion.status, agregado.status]).toEqual([409, 200]);
        expect(conversion.body.codigo).toBe('EN_USO');
      }
    }
  });

  it('ligar un producto a un modificador mientras pasa a combo: nunca quedan las dos cosas', async () => {
    for (let i = 0; i < REPETICIONES; i++) {
      const objetivo = await lomo({ estacionId: null });
      const grupo = await crearGrupo(ctx, tokenA, [{ nombre: 'A' }, { nombre: 'B' }]);
      const [conversion, ligado] = await Promise.all([
        patch(objetivo.id, { tipo: 'COMBO', gruposModificadores: [bebida.id] }),
        pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${grupo.id}`, {
          modificadores: [
            { id: grupo.modificadores[0]!.id, nombre: 'A', productoId: objetivo.id },
            { id: grupo.modificadores[1]!.id, nombre: 'B' },
          ],
        }),
      ]);
      const tipo = (await filaDe(objetivo.id)).tipo;
      const ligados = (
        await admin.query(
          'SELECT count(*)::int AS n FROM modificador WHERE producto_id = $1 AND activo',
          [objetivo.id],
        )
      ).rows[0].n;
      expect(
        ligados > 0 && tipo !== 'SIMPLE',
        `iteración ${i}: ${conversion.status}/${ligado.status}`,
      ).toBe(false);
      if (tipo === 'COMBO') {
        expect([conversion.status, ligado.status]).toEqual([200, 422]);
      } else {
        expect([conversion.status, ligado.status]).toEqual([409, 200]);
      }
    }
  });
});

describe('orden de bloqueo · un PATCH de producto y otra escritura que se esperan entre sí', () => {
  /**
   * Fuerza el entrelazado que forma un abrazo mortal si el orden de bloqueo no es el mismo: un cliente
   * administrador retiene una fila; se lanza primero la escritura A y luego el `PATCH` del producto, y las dos
   * quedan esperando esa fila; al soltarla, A la toma primero y busca la fila del producto.
   */
  async function entrelazar(
    retener: { sql: string; parametros: unknown[] },
    primero: () => Promise<{ status: number }>,
    segundo: () => Promise<{ status: number }>,
  ): Promise<[number, number]> {
    const retenedor = await abrirCliente('admin');
    try {
      const { rows } = await retenedor.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const pid = rows[0]!.pid;
      await retenedor.query('BEGIN');
      await retenedor.query(retener.sql, retener.parametros);
      const esperando = async (n: number) => {
        for (let i = 0; i < 100; i++) {
          const { rows: r } = await admin.query<{ n: number }>(
            // Las que esperan la fila retenida y las que esperan a las que la esperan (la cola de bloqueos).
            `WITH RECURSIVE esperan AS (
               SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
               UNION
               SELECT a.pid FROM pg_stat_activity a JOIN esperan e ON e.pid = ANY(pg_blocking_pids(a.pid))
             ) SELECT count(*)::int AS n FROM esperan`,
            [pid],
          );
          if (r[0]!.n >= n) return;
          await asentar(50);
        }
        const { rows: vista } = await admin.query(
          `SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS bloquea,
                  left(query, 90) AS consulta
             FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
        );
        throw new Error(
          `No llegaron ${n} peticiones a esperar la fila retenida (retenedor ${pid}): ${JSON.stringify(vista.filter((v) => v.state !== 'idle'))}`,
        );
      };
      // `supertest` envía la petición al esperarla: se convierte en una promesa de inmediato.
      const a = Promise.resolve(primero());
      await esperando(1);
      const b = Promise.resolve(segundo());
      await esperando(2);
      await retenedor.query('COMMIT');
      const [ra, rb] = await Promise.all([a, b]);
      return [ra.status, rb.status];
    } finally {
      await retenedor.query('ROLLBACK').catch(() => undefined);
      await retenedor.end();
    }
  }

  it('un producto que es el producto ligado de un grupo y se le asigna ese mismo grupo, mientras el grupo cambia, no se traba ni da error', async () => {
    const objetivo = await lomo({ estacionId: null });
    const grupo = await crearGrupo(ctx, tokenA, [
      { nombre: 'Propio', productoId: objetivo.id },
      { nombre: 'Otro' },
    ]);
    const estados = await entrelazar(
      {
        sql: 'SELECT id FROM grupo_modificadores WHERE id = $1 FOR UPDATE',
        parametros: [grupo.id],
      },
      () =>
        pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${grupo.id}`, {
          // Un modificador nuevo ligado al producto: el grupo lee el producto `FOR SHARE`.
          modificadores: [
            { id: grupo.modificadores[0]!.id, nombre: 'Propio', productoId: objetivo.id },
            { id: grupo.modificadores[1]!.id, nombre: 'Otro' },
            { nombre: 'Nuevo', productoId: objetivo.id },
          ],
        }),
      () => patch(objetivo.id, { gruposModificadores: [grupo.id], nombre: unico('Renombrado') }),
    );
    expect(estados).toEqual([200, 200]);
  });

  it('reactivar un producto mientras se ordenan los productos de su familia no se traba ni da error', async () => {
    const familia = await pedir(ctx, tokenA, 'post', '/carta/familias', {
      nombre: unico('Familia'),
    });
    exigirEstado(familia, 201, 'familia');
    const propia = { ...base, familiaId: familia.body.id as string };
    const producto = await crearSimple(ctx, tokenA, propia);
    const otro = await crearSimple(ctx, tokenA, propia);
    exigirEstado(await patch(producto.id, { activo: false }), 200, 'desactivar');
    const estados = await entrelazar(
      { sql: 'SELECT id FROM familia WHERE id = $1 FOR UPDATE', parametros: [familia.body.id] },
      () =>
        pedir(ctx, tokenA, 'put', `/carta/familias/${familia.body.id}/productos/orden`, {
          ids: [otro.id, producto.id],
        }),
      () => patch(producto.id, { activo: true }),
    );
    expect(estados).toEqual([200, 200]);
  });
});

describe('auditoría del cambio de tipo hecha por el Administrador', () => {
  it('queda una sola fila con el autor y la sucursal vacía (es de toda la empresa)', async () => {
    const simple = await lomo();
    const antes = await auditoriaCarta(admin, e.A.empresaId);
    exigirEstado(
      await patch(simple.id, {
        tipo: 'COMBO',
        gruposModificadores: [bebida.id],
        confirmarPerdida: true,
      }),
      200,
      'cambiar',
    );
    const nuevas = (await auditoriaCarta(admin, e.A.empresaId)).filter(
      (f) => !antes.some((a) => a.id === f.id),
    );
    unaFila(nuevas, {
      accion: 'modificar_producto',
      actorUsuarioId: e.A.base.admin.id,
      entidadId: simple.id,
      sucursalId: null,
    });
  });
});
