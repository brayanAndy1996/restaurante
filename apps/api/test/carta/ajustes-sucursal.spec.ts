// Historia 003, grupo C2 · precio y disponibilidad por sucursal (criterios 18 a 23, 10d y `noDisponibleEn`):
// pruebas del desarrollador (no protegidas). Lo que decide quién ajusta cada sucursal (criterio 19b) lo cubren
// las pruebas protegidas `cajero-carta.spec.ts` y `permisos-carta.spec.ts`; aquí se prueban los ejemplos de los
// criterios 20 y 21, los valores por defecto y una sucursal nueva, el orden de los rechazos, la auditoría y los
// eventos, `noDisponibleEn` del alta y dejar de venderse solo con precios de sucursal.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  contarFilas,
  esperarError,
  exigirEstado,
  filaProductoSucursal,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  llamar,
  productoSimple,
  sembrarBase,
  sesionContrasena,
  type AppCarta,
  type EscenarioCarta,
} from './ayudas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let base: { estacionId: string; familiaId: string };

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  tokenA = e.A.tokenAdmin;
  base = await sembrarBase(ctx, tokenA);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

interface Ajuste {
  sucursalId: string;
  nombre: string;
  precio: string | null;
  precioEfectivo: string | null;
  disponible: boolean;
  agotado: boolean;
  editable: boolean;
}

const rutaAjuste = (productoId: string, sucursalId: string) =>
  `/carta/productos/${productoId}/sucursales/${sucursalId}`;

async function nuevoProducto(
  extra: Record<string, unknown> = {},
  token = tokenA,
  b = base,
): Promise<string> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/carta/productos',
    cuerpo: productoSimple(b, extra),
  });
  exigirEstado(res, 201, 'crear producto');
  return res.body.id as string;
}

const ajustar = (productoId: string, sucursalId: string, cuerpo: unknown, token = tokenA) =>
  llamar(ctx, token, { metodo: 'put', ruta: rutaAjuste(productoId, sucursalId), cuerpo });

async function listar(productoId: string, token = tokenA): Promise<Ajuste[]> {
  const res = await llamar(ctx, token, {
    metodo: 'get',
    ruta: `/carta/productos/${productoId}/sucursales`,
  });
  exigirEstado(res, 200, 'listar ajustes');
  return res.body as Ajuste[];
}

const deSucursal = (filas: Ajuste[], sucursalId: string): Ajuste =>
  filas.find((f) => f.sucursalId === sucursalId)!;

describe('criterio 18 · consultar los ajustes de un producto', () => {
  it('devuelve todas las sucursales de la empresa ordenadas por nombre, con los valores por defecto', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    const filas = await listar(id);
    const nombres = (
      await admin.query<{ id: string; nombre: string }>(
        'SELECT id, nombre FROM sucursal WHERE empresa_id = $1 ORDER BY nombre, id',
        [e.A.empresaId],
      )
    ).rows;
    expect(filas.map((f) => f.sucursalId)).toEqual(nombres.map((n) => n.id));
    expect(filas.map((f) => f.nombre)).toEqual(nombres.map((n) => n.nombre));
    for (const fila of filas) {
      expect(fila).toEqual({
        sucursalId: fila.sucursalId,
        nombre: fila.nombre,
        precio: null,
        precioEfectivo: '25.00',
        disponible: true,
        agotado: false,
        editable: true,
      });
    }
    // Sin ajuste guardado no hace falta una fila por sucursal (criterio 23).
    expect(await contarFilas(admin, 'producto_sucursal', e.A.empresaId)).toBeGreaterThanOrEqual(0);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM producto_sucursal WHERE producto_id = $1',
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('un producto que no se vende solo tiene precio efectivo nulo en todas las sucursales', async () => {
    const id = await nuevoProducto({ seVendeSolo: false, precio: undefined });
    const filas = await listar(id);
    expect(filas.length).toBe(3);
    expect(filas.every((f) => f.precio === null && f.precioEfectivo === null)).toBe(true);
  });

  it('un producto de B o inexistente responde 404 con el mismo cuerpo', async () => {
    const baseB = await sembrarBase(ctx, e.B.tokenAdmin);
    const deB = await nuevoProducto({}, e.B.tokenAdmin, baseB);
    const a = await llamar(ctx, tokenA, {
      metodo: 'get',
      ruta: `/carta/productos/${deB}/sucursales`,
    });
    const b = await llamar(ctx, tokenA, {
      metodo: 'get',
      ruta: `/carta/productos/${randomUUID()}/sucursales`,
    });
    esperarError(a, 404, 'NO_ENCONTRADO');
    esperarError(b, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
  });

  it('la lista de B solo trae las sucursales de B', async () => {
    const baseB = await sembrarBase(ctx, e.B.tokenAdmin);
    const deB = await nuevoProducto({}, e.B.tokenAdmin, baseB);
    const filas = await listar(deB, e.B.tokenAdmin);
    expect(filas.map((f) => f.sucursalId).sort()).toEqual([e.B.S1, e.B.S2].sort());
  });
});

describe('criterios 20 y 21 · solo esa sucursal y el cambio del precio de la empresa', () => {
  it('el ajuste de S1 no toca a S2; cambiar el precio de la empresa mueve a S2 y no a S1; precio null vuelve al de la empresa', async () => {
    const id = await nuevoProducto({ precio: '25.00' });

    const ajuste = await ajustar(id, e.A.S1, { precio: '27.50', disponible: false });
    exigirEstado(ajuste, 200, 'ajustar S1');
    expect(ajuste.body).toMatchObject({
      sucursalId: e.A.S1,
      precio: '27.50',
      precioEfectivo: '27.50',
      disponible: false,
      agotado: false,
      editable: true,
    });
    let filas = await listar(id);
    expect(deSucursal(filas, e.A.S1)).toMatchObject({
      precio: '27.50',
      precioEfectivo: '27.50',
      disponible: false,
    });
    expect(deSucursal(filas, e.A.S2)).toMatchObject({
      precio: null,
      precioEfectivo: '25.00',
      disponible: true,
    });

    exigirEstado(
      await llamar(ctx, tokenA, {
        metodo: 'patch',
        ruta: `/carta/productos/${id}`,
        cuerpo: { precio: '26.00' },
      }),
      200,
      'cambiar el precio de la empresa',
    );
    filas = await listar(id);
    expect(deSucursal(filas, e.A.S2).precioEfectivo).toBe('26.00');
    expect(deSucursal(filas, e.A.S1).precioEfectivo).toBe('27.50');

    exigirEstado(
      await ajustar(id, e.A.S1, { precio: null, disponible: true }),
      200,
      'volver al precio de la empresa',
    );
    expect(deSucursal(await listar(id), e.A.S1)).toMatchObject({
      precio: null,
      precioEfectivo: '26.00',
      disponible: true,
    });
  });

  it('el precio se normaliza a 2 decimales y no se pierde precisión', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    const res = await ajustar(id, e.A.S1, { precio: '19.9', disponible: true });
    exigirEstado(res, 200, 'precio con un decimal');
    expect(res.body).toMatchObject({ precio: '19.90', precioEfectivo: '19.90' });
    const fila = await filaProductoSucursal(admin, id, e.A.S1);
    expect(fila).toMatchObject({ precio: 19.9 });
  });
});

describe('criterio 23 · valores por defecto', () => {
  it('sin ajuste guardado el producto está disponible con el precio de la empresa; ajustar a los valores por defecto sin fila previa no crea nada', async () => {
    const id = await nuevoProducto({ precio: '31.00' });
    const res = await ajustar(id, e.A.S3!, { precio: null, disponible: true });
    exigirEstado(res, 200, 'ajuste igual al por defecto');
    expect(res.body).toMatchObject({ precio: null, precioEfectivo: '31.00', disponible: true });
    expect(await filaProductoSucursal(admin, id, e.A.S3!)).toBeUndefined();
    await asentar();
    expect(
      await auditoriaCarta(admin, e.A.empresaId, {
        accion: 'ajustar_producto_sucursal',
        entidadId: id,
      }),
    ).toHaveLength(0);
  });
});

describe('criterios 19 y 22 · validación y rechazos del PUT', () => {
  it('400 con un precio inválido, sin disponible, con campos de más o con ids que no son UUID', async () => {
    const id = await nuevoProducto();
    for (const cuerpo of [
      { precio: '0', disponible: true },
      { precio: '0.00', disponible: true },
      { precio: '-1.00', disponible: true },
      { precio: 'abc', disponible: true },
      { precio: '1.234', disponible: true },
      { precio: 12, disponible: true },
      { precio: '10.00' },
      { disponible: true },
      { precio: '10.00', disponible: 'si' },
      { precio: '10.00', disponible: true, empresaId: e.B.empresaId },
    ]) {
      esperarError(await ajustar(id, e.A.S1, cuerpo), 400, 'DATOS_INVALIDOS');
    }
    esperarError(
      await llamar(ctx, tokenA, {
        metodo: 'put',
        ruta: `/carta/productos/${id}/sucursales/no-es-uuid`,
        cuerpo: { precio: null, disponible: true },
      }),
      400,
      'DATOS_INVALIDOS',
    );
    expect(await filaProductoSucursal(admin, id, e.A.S1)).toBeUndefined();
  });

  it('en un producto que no se vende solo, el precio debe ser null (400); disponible sí se ajusta', async () => {
    const id = await nuevoProducto({ seVendeSolo: false, precio: undefined });
    const rechazo = await ajustar(id, e.A.S1, { precio: '10.00', disponible: true });
    esperarError(rechazo, 400, 'DATOS_INVALIDOS');
    expect(rechazo.body.campos).toEqual([expect.objectContaining({ campo: 'precio' })]);
    expect(await filaProductoSucursal(admin, id, e.A.S1)).toBeUndefined();
    const ok = await ajustar(id, e.A.S1, { precio: null, disponible: false });
    exigirEstado(ok, 200, 'dejarlo no disponible');
    expect(ok.body).toMatchObject({ precio: null, precioEfectivo: null, disponible: false });
  });

  it('un producto de B o inexistente, y una sucursal de B o inexistente, responden 404 con el mismo cuerpo y sin cambios', async () => {
    const baseB = await sembrarBase(ctx, e.B.tokenAdmin);
    const deB = await nuevoProducto({}, e.B.tokenAdmin, baseB);
    const propio = await nuevoProducto();
    const cuerpo = { precio: '12.00', disponible: false };

    const productoDeB = await ajustar(deB, e.A.S1, cuerpo);
    const productoInexistente = await ajustar(randomUUID(), e.A.S1, cuerpo);
    esperarError(productoDeB, 404, 'NO_ENCONTRADO');
    expect(productoDeB.body).toEqual(productoInexistente.body);

    const sucursalDeB = await ajustar(propio, e.B.S1, cuerpo);
    const sucursalInexistente = await ajustar(propio, randomUUID(), cuerpo);
    esperarError(sucursalDeB, 404, 'NO_ENCONTRADO');
    expect(sucursalDeB.body).toEqual(sucursalInexistente.body);

    // La sucursal de A con el producto de B tampoco crea nada.
    const cruzado = await ajustar(deB, e.B.S1, cuerpo, tokenA);
    esperarError(cruzado, 404, 'NO_ENCONTRADO');
    expect(await filaProductoSucursal(admin, deB, e.B.S1)).toBeUndefined();
    expect(await filaProductoSucursal(admin, propio, e.A.S1)).toBeUndefined();
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM producto_sucursal WHERE sucursal_id = $1',
          [e.B.S1],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('el id de la sucursal o del producto en mayúsculas es el mismo recurso', async () => {
    const id = await nuevoProducto();
    const res = await ajustar(id.toUpperCase(), e.A.S2.toUpperCase(), {
      precio: '15.00',
      disponible: true,
    });
    exigirEstado(res, 200, 'ids en mayúsculas');
    expect(res.body.sucursalId).toBe(e.A.S2);
    expect(await filaProductoSucursal(admin, id, e.A.S2)).toMatchObject({ precio: 15 });
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM producto_sucursal WHERE producto_id = $1',
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('auditoría, trazabilidad y eventos del ajuste', () => {
  it('cada cambio deja una fila con la sucursal, el antes y el después de lo que cambió; repetir no deja nada', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    const filas = () =>
      auditoriaCarta(admin, e.A.empresaId, { accion: 'ajustar_producto_sucursal', entidadId: id });

    exigirEstado(await ajustar(id, e.A.S1, { precio: '27.50', disponible: true }), 200, 'primero');
    let auditoria = await filas();
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      sucursal_id: e.A.S1,
      entidad: 'producto',
      actor_usuario_id: e.A.base.admin.id,
    });
    expect(auditoria[0]!.detalle).toEqual({ precio: { antes: null, despues: '27.50' } });

    await asentar();
    ctx.publicador.limpiar();
    exigirEstado(await ajustar(id, e.A.S1, { precio: '27.50', disponible: true }), 200, 'repetido');
    await asentar();
    expect(await filas()).toHaveLength(1);
    expect(ctx.publicador.eventos()).toEqual([]);

    exigirEstado(
      await ajustar(id, e.A.S1, { precio: '27.50', disponible: false }),
      200,
      'solo disp.',
    );
    auditoria = await filas();
    expect(auditoria).toHaveLength(2);
    expect(auditoria.map((f) => f.detalle)).toContainEqual({
      disponible: { antes: true, despues: false },
    });

    exigirEstado(await ajustar(id, e.A.S1, { precio: null, disponible: true }), 200, 'a defecto');
    auditoria = await filas();
    expect(auditoria).toHaveLength(3);
    expect(auditoria.map((f) => f.detalle)).toContainEqual({
      precio: { antes: '27.50', despues: null },
      disponible: { antes: false, despues: true },
    });
    // La fila no se borra al volver a los valores por defecto: conserva su último autor.
    expect(await filaProductoSucursal(admin, id, e.A.S1)).toMatchObject({
      precio: null,
      disponible: true,
      actualizado_por_usuario_id: e.A.base.admin.id,
    });
  });

  it('publica un solo carta.actualizada con la sala de esa sucursal y la empresa de A, después de confirmar', async () => {
    const id = await nuevoProducto();
    await asentar();
    ctx.publicador.limpiar();
    exigirEstado(await ajustar(id, e.A.S2, { precio: '9.90', disponible: true }), 200, 'ajustar');
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S2 },
        nombre: 'carta.actualizada',
        datos: { sucursalId: e.A.S2 },
      },
    ]);
  });

  it('un rechazo no deja filas, auditoría ni eventos', async () => {
    const id = await nuevoProducto({ seVendeSolo: false, precio: undefined });
    await asentar();
    ctx.publicador.limpiar();
    const antes = await auditoriaCarta(admin, e.A.empresaId, { entidadId: id });
    esperarError(
      await ajustar(id, e.A.S1, { precio: '9.90', disponible: true }),
      400,
      'DATOS_INVALIDOS',
    );
    await asentar();
    expect(await auditoriaCarta(admin, e.A.empresaId, { entidadId: id })).toEqual(antes);
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('el Cajero de S1 que ajusta S1 queda como autor de la fila y de la auditoría', async () => {
    const id = await nuevoProducto();
    const cajero = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    exigirEstado(
      await ajustar(id, e.A.S1, { precio: '8.00', disponible: true }, cajero),
      200,
      'Cajero',
    );
    expect(await filaProductoSucursal(admin, id, e.A.S1)).toMatchObject({
      creado_por_usuario_id: e.A.cajero.id,
      actualizado_por_usuario_id: e.A.cajero.id,
    });
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'ajustar_producto_sucursal',
      entidadId: id,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ actor_usuario_id: e.A.cajero.id, sucursal_id: e.A.S1 });
    // Y la lista del Cajero marca como no editables las sucursales donde no lo es.
    const lista = await listar(id, cajero);
    expect(Object.fromEntries(lista.map((f) => [f.sucursalId, f.editable]))).toEqual({
      [e.A.S1]: true,
      [e.A.S2]: false,
      [e.A.S3!]: false,
    });
  });
});

describe('noDisponibleEn en el alta (criterios 6, 9, 19b y 23)', () => {
  it('el producto nace no disponible en esas sucursales y disponible, con el precio de la empresa, en las demás', async () => {
    const id = await nuevoProducto({ precio: '14.00', noDisponibleEn: [e.A.S2, e.A.S3!] });
    const filas = await listar(id);
    expect(deSucursal(filas, e.A.S1)).toMatchObject({ disponible: true, precioEfectivo: '14.00' });
    expect(deSucursal(filas, e.A.S2)).toMatchObject({
      disponible: false,
      precio: null,
      precioEfectivo: '14.00',
    });
    expect(deSucursal(filas, e.A.S3!)).toMatchObject({ disponible: false });
    expect(await filaProductoSucursal(admin, id, e.A.S1)).toBeUndefined();
    const auditoria = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'crear_producto',
      entidadId: id,
    });
    expect(auditoria).toHaveLength(1);
    expect((auditoria[0]!.detalle as { noDisponibleEn: string[] }).noDisponibleEn.sort()).toEqual(
      [e.A.S2, e.A.S3!].sort(),
    );
  });

  it('una sucursal repetida se cuenta una vez; la lista vacía no crea filas', async () => {
    const repetida = await nuevoProducto({ noDisponibleEn: [e.A.S1, e.A.S1.toUpperCase()] });
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM producto_sucursal WHERE producto_id = $1',
          [repetida],
        )
      ).rows[0].n,
    ).toBe(1);
    const vacia = await nuevoProducto({ noDisponibleEn: [] });
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM producto_sucursal WHERE producto_id = $1',
          [vacia],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('una sucursal de B o inexistente responde 422 REFERENCIA_INVALIDA con el mismo cuerpo y no crea nada', async () => {
    const antes = {
      productos: await contarFilas(admin, 'producto', e.A.empresaId),
      ajustes: await contarFilas(admin, 'producto_sucursal', e.A.empresaId),
    };
    const nombre = `Con sucursal ajena ${randomUUID().slice(0, 8)}`;
    const deB = await llamar(ctx, tokenA, {
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimple(base, { nombre, noDisponibleEn: [e.A.S1, e.B.S1] }),
    });
    const inexistente = await llamar(ctx, tokenA, {
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimple(base, { nombre, noDisponibleEn: [e.A.S1, randomUUID()] }),
    });
    esperarError(deB, 422, 'REFERENCIA_INVALIDA');
    esperarError(inexistente, 422, 'REFERENCIA_INVALIDA');
    expect(deB.body).toEqual(inexistente.body);
    expect(deB.body.campos).toEqual([expect.objectContaining({ campo: 'noDisponibleEn' })]);
    expect(await contarFilas(admin, 'producto', e.A.empresaId)).toBe(antes.productos);
    expect(await contarFilas(admin, 'producto_sucursal', e.A.empresaId)).toBe(antes.ajustes);
  });

  it('el 422 va antes que el 403: para el Cajero, una sucursal inexistente y una ajena a su rol juntas dan 422', async () => {
    const cajero = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    const res = await llamar(ctx, cajero, {
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimple(base, { noDisponibleEn: [e.A.S2, randomUUID()] }),
    });
    esperarError(res, 422, 'REFERENCIA_INVALIDA');
  });

  it('un 409 por nombre repetido no deja filas de ajuste', async () => {
    const primero = await nuevoProducto();
    const nombre = (
      await admin.query<{ nombre: string }>('SELECT nombre FROM producto WHERE id = $1', [primero])
    ).rows[0]!.nombre;
    const antes = await contarFilas(admin, 'producto_sucursal', e.A.empresaId);
    esperarError(
      await llamar(ctx, tokenA, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: productoSimple(base, { nombre, noDisponibleEn: [e.A.S1] }),
      }),
      409,
      'CONFLICTO',
    );
    expect(await contarFilas(admin, 'producto_sucursal', e.A.empresaId)).toBe(antes);
  });
});

describe('criterio 10d · dejar de venderse solo con precios de sucursal', () => {
  const dejarDeVenderseSolo = (id: string, token = tokenA) =>
    llamar(ctx, token, {
      metodo: 'patch',
      ruta: `/carta/productos/${id}`,
      cuerpo: { seVendeSolo: false, precio: null },
    });

  it('responde 409 CONFLICTO con campos en seVendeSolo y las sucursales en el mensaje; nada cambia; sin precios de sucursal, sí', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    exigirEstado(await ajustar(id, e.A.S1, { precio: '27.50', disponible: true }), 200, 'S1');
    exigirEstado(await ajustar(id, e.A.S2, { precio: '24.00', disponible: false }), 200, 'S2');
    const nombres = (
      await admin.query<{ nombre: string }>(
        'SELECT nombre FROM sucursal WHERE id = ANY($1::uuid[]) ORDER BY nombre',
        [[e.A.S1, e.A.S2]],
      )
    ).rows.map((r) => r.nombre);

    await asentar();
    ctx.publicador.limpiar();
    const productoAntes = (await admin.query('SELECT * FROM producto WHERE id = $1', [id])).rows[0];
    const auditoriaAntes = await auditoriaCarta(admin, e.A.empresaId, { entidadId: id });
    const res = await dejarDeVenderseSolo(id);
    esperarError(res, 409, 'CONFLICTO');
    expect(res.body.campos).toEqual([expect.objectContaining({ campo: 'seVendeSolo' })]);
    for (const nombre of nombres) expect(res.body.mensaje).toContain(nombre);
    await asentar();
    expect((await admin.query('SELECT * FROM producto WHERE id = $1', [id])).rows[0]).toEqual(
      productoAntes,
    );
    expect(await auditoriaCarta(admin, e.A.empresaId, { entidadId: id })).toEqual(auditoriaAntes);
    expect(ctx.publicador.eventos()).toEqual([]);
    expect(await filaProductoSucursal(admin, id, e.A.S1)).toMatchObject({ precio: 27.5 });

    // Se quitan los precios de sucursal (S2 queda con su fila, sin precio y no disponible) y ya se puede.
    exigirEstado(await ajustar(id, e.A.S1, { precio: null, disponible: true }), 200, 'quitar S1');
    exigirEstado(await ajustar(id, e.A.S2, { precio: null, disponible: false }), 200, 'quitar S2');
    exigirEstado(await dejarDeVenderseSolo(id), 200, 'ahora sí');
    const despues = await llamar(ctx, tokenA, { metodo: 'get', ruta: `/carta/productos/${id}` });
    expect(despues.body).toMatchObject({ seVendeSolo: false, precio: null });
  });

  it('una fila de disponibilidad sin precio propio no lo impide', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    exigirEstado(await ajustar(id, e.A.S2, { precio: null, disponible: false }), 200, 'solo disp.');
    exigirEstado(await dejarDeVenderseSolo(id), 200, 'dejar de venderse solo');
  });

  it('el Cajero no puede borrar el precio de una sucursal donde no es Cajero dejando de venderlo solo', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    exigirEstado(
      await ajustar(id, e.A.S2, { precio: '24.00', disponible: true }),
      200,
      'S2 (Admin)',
    );
    const cajero = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    esperarError(await dejarDeVenderseSolo(id, cajero), 409, 'CONFLICTO');
    expect(await filaProductoSucursal(admin, id, e.A.S2)).toMatchObject({ precio: 24 });
  });

  it('con un PATCH que no deja de venderse solo, los precios de sucursal siguen igual', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    exigirEstado(await ajustar(id, e.A.S1, { precio: '27.50', disponible: true }), 200, 'S1');
    exigirEstado(
      await llamar(ctx, tokenA, {
        metodo: 'patch',
        ruta: `/carta/productos/${id}`,
        cuerpo: { nombre: `Renombrado ${randomUUID().slice(0, 8)}` },
      }),
      200,
      'renombrar',
    );
    expect(await filaProductoSucursal(admin, id, e.A.S1)).toMatchObject({ precio: 27.5 });
  });

  it('el 400 del criterio 7 va antes que el 409: dejar de venderse solo sin quitar el precio es 400', async () => {
    const id = await nuevoProducto({ precio: '25.00' });
    exigirEstado(await ajustar(id, e.A.S1, { precio: '27.50', disponible: true }), 200, 'S1');
    esperarError(
      await llamar(ctx, tokenA, {
        metodo: 'patch',
        ruta: `/carta/productos/${id}`,
        cuerpo: { seVendeSolo: false },
      }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('un ajuste con precio y un PATCH que deja de venderse solo, a la vez, nunca dejan un producto sin precio propio con precio de sucursal', async () => {
    for (let ronda = 0; ronda < 6; ronda++) {
      const id = await nuevoProducto({ precio: '25.00' });
      const [a, b] = await Promise.all([
        ajustar(id, e.A.S1, { precio: '27.50', disponible: true }),
        dejarDeVenderseSolo(id),
      ]);
      // Gana uno de los dos: el ajuste (y el PATCH responde 409) o el PATCH (y el ajuste responde 400).
      const resultados = `${a.status}/${b.status}`;
      expect(['200/409', '400/200'], resultados).toContain(resultados);
      const huerfanos = await admin.query(
        `SELECT 1 FROM producto p JOIN producto_sucursal ps ON ps.producto_id = p.id
          WHERE p.id = $1 AND NOT p.se_vende_solo AND ps.precio IS NOT NULL`,
        [id],
      );
      expect(huerfanos.rowCount).toBe(0);
    }
  });
});

// Última a propósito: deja una sucursal más en la empresa A (las sucursales no se borran) y las demás pruebas
// cuentan las tres del alta.
describe('criterio 23 · una sucursal nueva', () => {
  it('ofrece los productos existentes con el precio de la empresa, sin crear filas, y el Administrador la ajusta de inmediato', async () => {
    const id = await nuevoProducto({ precio: '18.50' });
    const alta = await llamar(ctx, tokenA, {
      metodo: 'post',
      ruta: '/sucursales',
      cuerpo: {
        rucEmisor: e.A.base.emisores[0]!.ruc,
        nombre: `Sucursal nueva ${randomUUID().slice(0, 8)}`,
        codigoEstablecimiento: String(3000 + Math.floor(Math.random() * 6000)),
        direccion: 'Av. Nueva 1',
      },
    });
    exigirEstado(alta, 201, 'crear la sucursal nueva');
    const nueva = alta.body.id as string;
    const filas = await listar(id);
    expect(filas).toHaveLength(4);
    expect(deSucursal(filas, nueva)).toMatchObject({
      precio: null,
      precioEfectivo: '18.50',
      disponible: true,
      editable: true,
    });
    expect(await filaProductoSucursal(admin, id, nueva)).toBeUndefined();
    exigirEstado(
      await ajustar(id, nueva, { precio: '20.00', disponible: true }),
      200,
      'ajustar la sucursal nueva',
    );
    expect(deSucursal(await listar(id), nueva).precioEfectivo).toBe('20.00');
  });
});
