// Historia 003, grupo C1 · estaciones y familias (criterios 1 a 5, 2b y 13): pruebas del desarrollador (no
// protegidas). La clasificación de permisos y el aislamiento los cubren las pruebas protegidas de
// `carta-critica/`; aquí van los ejemplos de negocio, la auditoría y los eventos.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  esperarError,
  exigirEstado,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  llamar,
  productoSimple,
  sembrarBase,
  sesionContrasena,
  unico,
  type AppCarta,
  type EscenarioCarta,
} from './ayudas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  tokenA = e.A.tokenAdmin;
  tokenB = e.B.tokenAdmin;
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const post = (token: string, ruta: string, cuerpo: unknown) =>
  llamar(ctx, token, { metodo: 'post', ruta, cuerpo });
const patch = (token: string, ruta: string, cuerpo: unknown) =>
  llamar(ctx, token, { metodo: 'patch', ruta, cuerpo });
const get = (token: string, ruta: string) => llamar(ctx, token, { metodo: 'get', ruta });
const put = (token: string, ruta: string, cuerpo: unknown) =>
  llamar(ctx, token, { metodo: 'put', ruta, cuerpo });

describe('criterio 1 · crear una estación', () => {
  it('responde 201 con la forma del contrato y sin productos', async () => {
    const nombre = unico('Parrilla');
    const res = await post(tokenA, '/carta/estaciones', { nombre });
    exigirEstado(res, 201, 'crear estación');
    expect(res.body).toEqual({
      id: expect.any(String),
      nombre,
      activa: true,
      productosActivos: 0,
      creadoEn: expect.stringMatching(/Z$/),
      actualizadoEn: expect.stringMatching(/Z$/),
    });
  });

  it('el nombre es único sin distinguir mayúsculas (409) y el mismo nombre en B no choca', async () => {
    const nombre = unico('Barra');
    exigirEstado(await post(tokenA, '/carta/estaciones', { nombre }), 201, 'primera');
    esperarError(
      await post(tokenA, '/carta/estaciones', { nombre: nombre.toUpperCase() }),
      409,
      'CONFLICTO',
    );
    esperarError(
      await post(tokenA, '/carta/estaciones', { nombre: `  ${nombre.toLowerCase()}  ` }),
      409,
      'CONFLICTO',
    );
    exigirEstado(await post(tokenB, '/carta/estaciones', { nombre }), 201, 'en B');
  });

  it('rechaza un nombre vacío, de más de 50 caracteres o un campo desconocido (400)', async () => {
    esperarError(
      await post(tokenA, '/carta/estaciones', { nombre: '   ' }),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await post(tokenA, '/carta/estaciones', { nombre: 'x'.repeat(51) }),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await post(tokenA, '/carta/estaciones', { nombre: unico('E'), empresaId: e.B.empresaId }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('con la misma Idempotency-Key repite la respuesta y no crea otra estación', async () => {
    const clave = crypto.randomUUID();
    const cuerpo = { nombre: unico('Horno') };
    const a = await llamar(ctx, tokenA, {
      metodo: 'post',
      ruta: '/carta/estaciones',
      cuerpo,
      cabeceras: { 'Idempotency-Key': clave },
    });
    const b = await llamar(ctx, tokenA, {
      metodo: 'post',
      ruta: '/carta/estaciones',
      cuerpo,
      cabeceras: { 'Idempotency-Key': clave },
    });
    exigirEstado(a, 201, 'primera');
    exigirEstado(b, 201, 'repetida');
    expect(b.body).toEqual(a.body);
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM estacion WHERE nombre = $1',
      [cuerpo.nombre],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('criterio 2 · consultar y editar estaciones', () => {
  it('lista ordenada por nombre con los productos activos de cada una', async () => {
    const base = await sembrarBase(ctx, tokenA);
    exigirEstado(
      await post(tokenA, '/carta/productos', productoSimple(base)),
      201,
      'producto activo',
    );
    const inactivo = await post(tokenA, '/carta/productos', productoSimple(base));
    exigirEstado(
      await patch(tokenA, `/carta/productos/${inactivo.body.id}`, { activo: false }),
      200,
      'desactivar',
    );
    const lista = await get(tokenA, '/carta/estaciones');
    exigirEstado(lista, 200, 'listar');
    const nombres = (lista.body as { nombre: string }[]).map((s) => s.nombre.toLowerCase());
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b)));
    const fila = (lista.body as { id: string; productosActivos: number }[]).find(
      (s) => s.id === base.estacionId,
    );
    expect(fila?.productosActivos).toBe(1);
  });

  it('renombra con una fila de auditoría con el antes y el después; repetirlo no deja otra', async () => {
    const creada = await post(tokenA, '/carta/estaciones', { nombre: unico('Antes') });
    const id = creada.body.id as string;
    const nuevo = unico('Despues');
    const res = await patch(tokenA, `/carta/estaciones/${id}`, { nombre: nuevo });
    exigirEstado(res, 200, 'renombrar');
    expect(res.body.nombre).toBe(nuevo);
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'modificar_estacion',
      entidadId: id,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toEqual({
      nombre: { antes: creada.body.nombre, despues: nuevo },
    });
    exigirEstado(await patch(tokenA, `/carta/estaciones/${id}`, { nombre: nuevo }), 200, 'repetir');
    expect(
      await auditoriaCarta(admin, e.A.empresaId, { accion: 'modificar_estacion', entidadId: id }),
    ).toHaveLength(1);
  });

  it('no deja renombrar con el nombre de otra estación (409) ni activar sin campos (400)', async () => {
    const a = await post(tokenA, '/carta/estaciones', { nombre: unico('Una') });
    const b = await post(tokenA, '/carta/estaciones', { nombre: unico('Otra') });
    esperarError(
      await patch(tokenA, `/carta/estaciones/${b.body.id}`, { nombre: a.body.nombre }),
      409,
      'CONFLICTO',
    );
    esperarError(await patch(tokenA, `/carta/estaciones/${b.body.id}`, {}), 400, 'DATOS_INVALIDOS');
  });

  it('desactivar una estación que usan productos activos responde 409 EN_USO con la cantidad y no cambia nada', async () => {
    const base = await sembrarBase(ctx, tokenA);
    for (let i = 0; i < 2; i++) {
      exigirEstado(await post(tokenA, '/carta/productos', productoSimple(base)), 201, 'producto');
    }
    const res = await patch(tokenA, `/carta/estaciones/${base.estacionId}`, { activa: false });
    esperarError(res, 409, 'EN_USO');
    expect(res.body.mensaje).toContain('2 productos');
    const { rows } = await admin.query('SELECT activa FROM estacion WHERE id = $1', [
      base.estacionId,
    ]);
    expect(rows[0].activa).toBe(true);
  });

  it('desactiva una estación sin productos activos, y una inactiva no se puede asignar (422)', async () => {
    const base = await sembrarBase(ctx, tokenA);
    exigirEstado(
      await patch(tokenA, `/carta/estaciones/${base.estacionId}`, { activa: false }),
      200,
      'desactivar',
    );
    const res = await post(tokenA, '/carta/productos', productoSimple(base));
    esperarError(res, 422, 'REFERENCIA_INVALIDA');
    expect(res.body.campos).toEqual([{ campo: 'estacionId', mensaje: expect.any(String) }]);
    // Reactivarla la deja asignable otra vez.
    exigirEstado(
      await patch(tokenA, `/carta/estaciones/${base.estacionId}`, { activa: true }),
      200,
      'reactivar',
    );
    exigirEstado(await post(tokenA, '/carta/productos', productoSimple(base)), 201, 'asignable');
  });

  it('un producto inactivo no cuenta como uso: la estación se puede desactivar', async () => {
    const base = await sembrarBase(ctx, tokenA);
    const p = await post(tokenA, '/carta/productos', productoSimple(base));
    exigirEstado(
      await patch(tokenA, `/carta/productos/${p.body.id}`, { activo: false }),
      200,
      'off',
    );
    exigirEstado(
      await patch(tokenA, `/carta/estaciones/${base.estacionId}`, { activa: false }),
      200,
      'desactivar',
    );
  });
});

describe('criterio 2b · quién define las estaciones', () => {
  it('el Cajero las lee (200) pero POST y PATCH responden 403 sin cambiar nada', async () => {
    const token = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    exigirEstado(await get(token, '/carta/estaciones'), 200, 'el Cajero lee');
    const antes = await admin.query(
      'SELECT count(*)::int AS n FROM estacion WHERE empresa_id = $1',
      [e.A.empresaId],
    );
    esperarError(await post(token, '/carta/estaciones', { nombre: unico('X') }), 403, 'PROHIBIDO');
    const creada = await post(tokenA, '/carta/estaciones', { nombre: unico('Y') });
    esperarError(
      await patch(token, `/carta/estaciones/${creada.body.id}`, { nombre: unico('Z') }),
      403,
      'PROHIBIDO',
    );
    const despues = await admin.query(
      'SELECT count(*)::int AS n FROM estacion WHERE empresa_id = $1',
      [e.A.empresaId],
    );
    expect(despues.rows[0].n).toBe(antes.rows[0].n + 1); // solo la creada por el Administrador
  });
});

describe('criterio 3 y 4 · familias', () => {
  it('crea la familia al final del orden y la lista trae productos activos', async () => {
    const primera = await post(tokenA, '/carta/familias', { nombre: unico('Entradas') });
    const segunda = await post(tokenA, '/carta/familias', { nombre: unico('Postres') });
    exigirEstado(primera, 201, 'primera');
    exigirEstado(segunda, 201, 'segunda');
    expect(segunda.body.orden).toBeGreaterThan(primera.body.orden);
    expect(segunda.body).toMatchObject({ activa: true, productos: 0 });
    const lista = (await get(tokenA, '/carta/familias')).body as { id: string }[];
    expect(lista.at(-1)!.id).toBe(segunda.body.id);
  });

  it('el nombre es único sin distinguir mayúsculas; el mismo en B no choca', async () => {
    const nombre = unico('Bebidas');
    exigirEstado(await post(tokenA, '/carta/familias', { nombre }), 201, 'A');
    esperarError(
      await post(tokenA, '/carta/familias', { nombre: nombre.toLowerCase() }),
      409,
      'CONFLICTO',
    );
    exigirEstado(await post(tokenB, '/carta/familias', { nombre }), 201, 'B');
  });

  it('renombra y desactiva con auditoría; con productos activos responde 409 EN_USO', async () => {
    const base = await sembrarBase(ctx, tokenA);
    const producto = await post(tokenA, '/carta/productos', productoSimple(base));
    const enUso = await patch(tokenA, `/carta/familias/${base.familiaId}`, { activa: false });
    esperarError(enUso, 409, 'EN_USO');
    exigirEstado(
      await patch(tokenA, `/carta/productos/${producto.body.id}`, { activo: false }),
      200,
      'desactivar el producto',
    );
    const nuevo = unico('Platos');
    const res = await patch(tokenA, `/carta/familias/${base.familiaId}`, {
      nombre: nuevo,
      activa: false,
    });
    exigirEstado(res, 200, 'desactivar la familia');
    expect(res.body).toMatchObject({ nombre: nuevo, activa: false, productos: 0 });
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'modificar_familia',
      entidadId: base.familiaId,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toMatchObject({
      nombre: { despues: nuevo },
      activa: { antes: true, despues: false },
    });
    // Inactiva: no se asigna a un producto nuevo.
    esperarError(
      await post(tokenA, '/carta/productos', productoSimple(base)),
      422,
      'REFERENCIA_INVALIDA',
    );
  });
});

describe('criterio 5 · ordenar familias', () => {
  it('reordena con una fila de auditoría y devuelve la lista en el orden nuevo', async () => {
    const lista = (await get(tokenA, '/carta/familias')).body as { id: string }[];
    expect(lista.length).toBeGreaterThan(2);
    const invertida = lista.map((f) => f.id).reverse();
    const antes = (await auditoriaCarta(admin, e.A.empresaId, { accion: 'ordenar_familias' }))
      .length;
    const res = await put(tokenA, '/carta/familias/orden', { ids: invertida });
    exigirEstado(res, 200, 'ordenar');
    expect((res.body as { id: string }[]).map((f) => f.id)).toEqual(invertida);
    expect((res.body as { orden: number }[]).map((f) => f.orden)).toEqual(
      invertida.map((_, i) => i + 1),
    );
    const filas = await auditoriaCarta(admin, e.A.empresaId, { accion: 'ordenar_familias' });
    expect(filas).toHaveLength(antes + 1);
    expect(filas.at(-1)!.detalle).toEqual({
      antes: lista.map((f) => f.id),
      despues: invertida,
    });
    // El mismo orden otra vez: 200, sin auditoría.
    exigirEstado(await put(tokenA, '/carta/familias/orden', { ids: invertida }), 200, 'repetir');
    expect(await auditoriaCarta(admin, e.A.empresaId, { accion: 'ordenar_familias' })).toHaveLength(
      antes + 1,
    );
  });

  it('un id faltante, repetido, inexistente o de B responde 400 con el mismo cuerpo y nada cambia', async () => {
    const lista = (await get(tokenA, '/carta/familias')).body as { id: string; orden: number }[];
    const ids = lista.map((f) => f.id);
    const deB = ((await get(tokenB, '/carta/familias')).body as { id: string }[])[0]!.id;
    const casos = [
      ids.slice(1),
      [...ids, ids[0]!],
      [...ids.slice(1), crypto.randomUUID()],
      [...ids.slice(1), deB],
      [],
    ];
    const cuerpos = new Set<string>();
    for (const ids_ of casos) {
      const res = await put(tokenA, '/carta/familias/orden', { ids: ids_ });
      esperarError(res, 400, 'DATOS_INVALIDOS');
      cuerpos.add(JSON.stringify(res.body.mensaje));
    }
    expect(cuerpos.size).toBe(1);
    const despues = ((await get(tokenA, '/carta/familias')).body as { id: string }[]).map(
      (f) => f.id,
    );
    expect(despues).toEqual(ids);
  });
});

describe('criterio 13 · ordenar los productos de una familia', () => {
  it('reordena, un producto que cambia de familia queda el último de la nueva', async () => {
    const base = await sembrarBase(ctx, tokenA);
    const otra = await post(tokenA, '/carta/familias', { nombre: unico('Otra') });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await post(tokenA, '/carta/productos', productoSimple(base));
      ids.push(r.body.id);
    }
    const invertidos = [...ids].reverse();
    const res = await put(tokenA, `/carta/familias/${base.familiaId}/productos/orden`, {
      ids: invertidos,
    });
    exigirEstado(res, 200, 'ordenar productos');
    expect((res.body as { id: string }[]).map((p) => p.id)).toEqual(invertidos);
    const auditoria = await auditoriaCarta(admin, e.A.empresaId, { accion: 'ordenar_productos' });
    expect(auditoria.at(-1)!.detalle).toMatchObject({ familiaId: base.familiaId });

    // Falta un producto: 400 sin cambios.
    esperarError(
      await put(tokenA, `/carta/familias/${base.familiaId}/productos/orden`, {
        ids: invertidos.slice(1),
      }),
      400,
      'DATOS_INVALIDOS',
    );
    // Mover uno a otra familia: queda el último de la nueva.
    const movido = await patch(tokenA, `/carta/productos/${ids[0]}`, { familiaId: otra.body.id });
    exigirEstado(movido, 200, 'mover');
    const nuevo = await post(
      tokenA,
      '/carta/productos',
      productoSimple({ ...base, familiaId: otra.body.id }),
    );
    expect(nuevo.body.orden).toBeGreaterThan(movido.body.orden);
    // La familia vieja ya no lo contiene: el orden con él responde 400.
    esperarError(
      await put(tokenA, `/carta/familias/${base.familiaId}/productos/orden`, { ids: invertidos }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('una familia inexistente o de B responde 404 con el mismo cuerpo', async () => {
    const deB = ((await get(tokenB, '/carta/familias')).body as { id: string }[])[0]!.id;
    const a = await put(tokenA, `/carta/familias/${deB}/productos/orden`, { ids: [] });
    const b = await put(tokenA, `/carta/familias/${crypto.randomUUID()}/productos/orden`, {
      ids: [],
    });
    esperarError(a, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
  });
});

describe('eventos y trazabilidad de estaciones y familias', () => {
  it('cada escritura real publica un carta.actualizada de la empresa después de confirmar; un rechazo, ninguno', async () => {
    await asentar();
    ctx.publicador.limpiar();
    const creada = await post(tokenA, '/carta/estaciones', { nombre: unico('Evento') });
    exigirEstado(creada, 201, 'crear');
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'empresa' },
        nombre: 'carta.actualizada',
        datos: { sucursalId: null },
      },
    ]);
    ctx.publicador.limpiar();
    esperarError(
      await post(tokenA, '/carta/estaciones', { nombre: creada.body.nombre }),
      409,
      'CONFLICTO',
    );
    exigirEstado(
      await patch(tokenA, `/carta/estaciones/${creada.body.id}`, { nombre: creada.body.nombre }),
      200,
      'sin cambios',
    );
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('la fila queda con quien la creó y quien la cambió (criterio 63)', async () => {
    const token = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
    const cajero = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    const familia = await post(token, '/carta/familias', { nombre: unico('Trazada') });
    exigirEstado(familia, 201, 'crear');
    exigirEstado(
      await patch(cajero, `/carta/familias/${familia.body.id}`, { nombre: unico('Cambiada') }),
      200,
      'el Cajero la cambia',
    );
    const { rows } = await admin.query('SELECT * FROM familia WHERE id = $1', [familia.body.id]);
    expect(rows[0].creado_por_usuario_id).toBe(e.A.base.admin.id);
    expect(rows[0].actualizado_por_usuario_id).toBe(e.A.cajero.id);
    expect(rows[0].creado_por_superadministrador_id).toBeNull();
  });
});
