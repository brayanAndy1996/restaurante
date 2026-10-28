// Historia 003, grupo C1 · productos simples (criterios 6 a 12): pruebas del desarrollador (no protegidas).
// Los tipos COMBO y MENU_DEL_DIA, el cambio de tipo, los grupos y los componentes llegan en C3 y C4: aquí se
// comprueba que mientras tanto responden 400 y no cambian nada.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  equipoDe,
  esperarError,
  exigirEstado,
  instantaneaCarta,
  sesionPin,
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
let base: { estacionId: string; familiaId: string };

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  tokenA = e.A.tokenAdmin;
  tokenB = e.B.tokenAdmin;
  base = await sembrarBase(ctx, tokenA);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const post = (token: string, cuerpo: unknown) =>
  llamar(ctx, token, { metodo: 'post', ruta: '/carta/productos', cuerpo });
const patch = (token: string, id: string, cuerpo: unknown) =>
  llamar(ctx, token, { metodo: 'patch', ruta: `/carta/productos/${id}`, cuerpo });
const get = (token: string, ruta: string) => llamar(ctx, token, { metodo: 'get', ruta });

async function crearSimple(extra: Record<string, unknown> = {}, b = base, token = tokenA) {
  const res = await post(token, productoSimple(b, extra));
  exigirEstado(res, 201, 'crear producto');
  return res.body as { id: string; nombre: string; orden: number };
}

describe('criterio 6 · crear un producto simple', () => {
  it('responde 201 con todos los campos, los valores por defecto y el último lugar de su familia', async () => {
    const b = await sembrarBase(ctx, tokenA);
    const nombre = unico('Lomo saltado');
    const res = await post(tokenA, {
      tipo: 'SIMPLE',
      nombre,
      descripcion: 'Con papas',
      familiaId: b.familiaId,
      precio: '28',
      estacionId: b.estacionId,
      tipoControlStock: 'PORCIONES',
    });
    exigirEstado(res, 201, 'crear');
    expect(res.body).toMatchObject({
      tipo: 'SIMPLE',
      nombre,
      descripcion: 'Con papas',
      familiaId: b.familiaId,
      precio: '28.00', // normalizado a 2 decimales
      seVendeSolo: true,
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      estacionId: b.estacionId,
      tipoControlStock: 'PORCIONES',
      fotoUrl: null,
      activo: true,
      orden: 1,
      grupos: [],
      componentes: [],
      usadoEn: { combos: [], modificadores: [] },
    });
    const segundo = await crearSimple({}, b);
    expect(segundo.orden).toBe(2);
  });

  it('acepta afectación, ICBPER, estación null y un producto que no se vende solo', async () => {
    const res = await post(
      tokenA,
      productoSimple(base, {
        afectacionIgv: 'EXONERADO',
        aplicaIcbper: true,
        estacionId: null,
      }),
    );
    exigirEstado(res, 201, 'crear');
    expect(res.body).toMatchObject({
      afectacionIgv: 'EXONERADO',
      aplicaIcbper: true,
      estacionId: null,
    });
    const ligado = await post(tokenA, {
      ...productoSimple(base),
      seVendeSolo: false,
      precio: undefined,
    });
    exigirEstado(ligado, 201, 'no se vende solo');
    expect(ligado.body).toMatchObject({ seVendeSolo: false, precio: null });
  });

  it('las reglas del criterio 7 para SIMPLE responden 400 con campos y no crean nada', async () => {
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const casos: [string, Record<string, unknown>, string][] = [
      ['sin precio y se vende solo', { precio: undefined }, 'precio'],
      ['con precio y no se vende solo', { seVendeSolo: false }, 'precio'],
      ['sin estación (ni null)', { estacionId: undefined }, 'estacionId'],
      ['precio 0', { precio: '0.00' }, 'precio'],
      ['precio con 3 decimales', { precio: '1.234' }, 'precio'],
      ['sin tipo de control de stock', { tipoControlStock: undefined }, 'tipoControlStock'],
      [
        'componentes en un simple',
        { componentes: [{ productoId: crypto.randomUUID(), cantidad: 1 }] },
        'componentes',
      ],
    ];
    for (const [nombre, extra, campo] of casos) {
      const res = await post(tokenA, productoSimple(base, extra));
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(
        (res.body.campos as { campo: string }[]).map((c) => c.campo),
        nombre,
      ).toContain(campo);
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un grupo repetido, un campo desconocido o empresaId responden 400', async () => {
    for (const extra of [
      {
        gruposModificadores: [crypto.randomUUID(), crypto.randomUUID()]
          .map((x) => x)
          .flatMap((x) => [x, x]),
      },
      { empresaId: e.B.empresaId },
      { creadoPorUsuarioId: e.A.cajero.id },
      { desconocido: 1 },
    ]) {
      esperarError(await post(tokenA, productoSimple(base, extra)), 400, 'DATOS_INVALIDOS');
    }
  });

  it('en esta versión COMBO, MENU_DEL_DIA, grupos, componentes y noDisponibleEn responden 400 sin crear nada', async () => {
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const casos: [string, Record<string, unknown>][] = [
      [
        'combo',
        {
          tipo: 'COMBO',
          estacionId: undefined,
          componentes: [{ productoId: crypto.randomUUID(), cantidad: 1 }],
        },
      ],
      [
        'menú del día',
        { tipo: 'MENU_DEL_DIA', estacionId: undefined, gruposModificadores: [crypto.randomUUID()] },
      ],
      ['grupos en un simple', { gruposModificadores: [crypto.randomUUID()] }],
      ['noDisponibleEn', { noDisponibleEn: [e.A.S2] }],
    ];
    for (const [nombre, extra] of casos) {
      const res = await post(tokenA, productoSimple(base, extra));
      expect(res.status, nombre).toBe(400);
      expect(res.body.codigo, nombre).toBe('DATOS_INVALIDOS');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('una lista vacía de grupos, componentes o noDisponibleEn se acepta (no cambia nada)', async () => {
    exigirEstado(
      await post(
        tokenA,
        productoSimple(base, { gruposModificadores: [], componentes: [], noDisponibleEn: [] }),
      ),
      201,
      'listas vacías',
    );
  });

  it('el nombre es único sin distinguir mayúsculas ni espacios en los extremos; el mismo en B no choca', async () => {
    const primero = await crearSimple();
    const antes = (await auditoriaCarta(admin, e.A.empresaId, { accion: 'crear_producto' })).length;
    for (const nombre of [primero.nombre.toUpperCase(), `  ${primero.nombre.toLowerCase()} `]) {
      esperarError(await post(tokenA, productoSimple(base, { nombre })), 409, 'CONFLICTO');
    }
    expect(await auditoriaCarta(admin, e.A.empresaId, { accion: 'crear_producto' })).toHaveLength(
      antes,
    );
    const baseB = await sembrarBase(ctx, tokenB);
    exigirEstado(
      await post(tokenB, productoSimple(baseB, { nombre: primero.nombre })),
      201,
      'mismo nombre en B',
    );
  });

  it('deja una fila crear_producto con el autor, los datos y el precio como texto exacto', async () => {
    const token = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    const antes = new Set(
      (await auditoriaCarta(admin, e.A.empresaId, { accion: 'crear_producto' })).map((f) => f.id),
    );
    const res = await post(token, productoSimple(base, { precio: '19.9' }));
    exigirEstado(res, 201, 'el Cajero crea');
    const nuevas = (
      await auditoriaCarta(admin, e.A.empresaId, { accion: 'crear_producto' })
    ).filter((f) => !antes.has(f.id));
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]).toMatchObject({
      actor_usuario_id: e.A.cajero.id,
      entidad: 'producto',
      entidad_id: res.body.id,
    });
    expect(nuevas[0]!.detalle).toMatchObject({ precio: '19.90', nombre: res.body.nombre });
    // Trazabilidad (criterio 63): creado por el Cajero.
    const { rows } = await admin.query('SELECT * FROM producto WHERE id = $1', [res.body.id]);
    expect(rows[0].creado_por_usuario_id).toBe(e.A.cajero.id);
  });
});

describe('criterio 63 · trazabilidad con el equipo', () => {
  it('un producto creado y cambiado con una sesión de PIN queda con el usuario y el equipo; con contraseña, sin equipo', async () => {
    const tokenEquipo = await equipoDe(ctx, e.A.cajero);
    const equipoId = tokenEquipo.split('.')[2]!;
    const pin = await sesionPin(ctx, e.A.cajero, tokenEquipo, e.A.S1);
    const creado = await post(pin, productoSimple(base));
    exigirEstado(creado, 201, 'crear con PIN');
    const fila = (await admin.query('SELECT * FROM producto WHERE id = $1', [creado.body.id]))
      .rows[0];
    expect(fila.creado_por_usuario_id).toBe(e.A.cajero.id);
    expect(fila.creado_por_equipo_id).toBe(equipoId);
    const contrasena = await sesionContrasena(ctx, e.A.base.admin, null);
    exigirEstado(await patch(contrasena, creado.body.id, { precio: '31.00' }), 200, 'cambiar');
    const despues = (await admin.query('SELECT * FROM producto WHERE id = $1', [creado.body.id]))
      .rows[0];
    expect(despues.actualizado_por_usuario_id).toBe(e.A.base.admin.id);
    expect(despues.actualizado_por_equipo_id).toBeNull();
    expect(despues.creado_por_equipo_id).toBe(equipoId);
    // La auditoría lleva el mismo equipo que la fila.
    const auditoria = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'crear_producto',
      entidadId: creado.body.id,
    });
    expect(auditoria[0]).toMatchObject({ actor_usuario_id: e.A.cajero.id, equipo_id: equipoId });
  });
});

describe('Idempotency-Key en los POST de la carta (criterio 85 de 002)', () => {
  it('repetir el POST con la misma clave devuelve el mismo producto y no crea otro; con otro cuerpo, 422', async () => {
    const clave = crypto.randomUUID();
    const cuerpo = productoSimple(base);
    const enviar = (c: unknown) =>
      llamar(ctx, tokenA, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: c,
        cabeceras: { 'Idempotency-Key': clave },
      });
    const primera = await enviar(cuerpo);
    const repetida = await enviar(cuerpo);
    exigirEstado(primera, 201, 'primera');
    exigirEstado(repetida, 201, 'repetida');
    expect(repetida.body).toEqual(primera.body);
    const n = await admin.query('SELECT count(*)::int AS n FROM producto WHERE nombre = $1', [
      cuerpo.nombre,
    ]);
    expect(n.rows[0].n).toBe(1);
    esperarError(
      await enviar({ ...cuerpo, nombre: unico('Otro') }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
  });

  it('un rol sin permiso recibe 403 aunque la clave ya exista: nunca ve la respuesta guardada', async () => {
    const clave = crypto.randomUUID();
    const cuerpo = productoSimple(base);
    exigirEstado(
      await llamar(ctx, tokenA, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo,
        cabeceras: { 'Idempotency-Key': clave },
      }),
      201,
      'el Administrador',
    );
    const mozo = await sesionContrasena(ctx, e.A.mozo, e.A.S1);
    esperarError(
      await llamar(ctx, mozo, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo,
        cabeceras: { 'Idempotency-Key': clave },
      }),
      403,
      'PROHIBIDO',
    );
  });
});

describe('criterio 9 · referencias', () => {
  it('una familia o una estación inexistente, de B o inactiva responde 422 con el mismo cuerpo y no crea nada', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const inactiva = await sembrarBase(ctx, tokenA);
    exigirEstado(
      await llamar(ctx, tokenA, {
        metodo: 'patch',
        ruta: `/carta/familias/${inactiva.familiaId}`,
        cuerpo: { activa: false },
      }),
      200,
      'familia inactiva',
    );
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const familias = [baseB.familiaId, crypto.randomUUID(), inactiva.familiaId];
    const cuerpos = new Set<string>();
    for (const familiaId of familias) {
      const res = await post(tokenA, productoSimple({ ...base, familiaId }));
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(res.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['familiaId']);
      cuerpos.add(JSON.stringify(res.body));
    }
    expect(cuerpos.size).toBe(1);
    cuerpos.clear();
    for (const estacionId of [baseB.estacionId, crypto.randomUUID()]) {
      const res = await post(tokenA, productoSimple({ ...base, estacionId }));
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(res.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['estacionId']);
      cuerpos.add(JSON.stringify(res.body));
    }
    expect(cuerpos.size).toBe(1);
    // Las dos a la vez se señalan juntas.
    const ambas = await post(
      tokenA,
      productoSimple({ familiaId: crypto.randomUUID(), estacionId: crypto.randomUUID() }),
    );
    expect(ambas.body.campos.map((c: { campo: string }) => c.campo).sort()).toEqual([
      'estacionId',
      'familiaId',
    ]);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });
});

describe('criterio 12 · consultar', () => {
  it('lista toda la empresa por el orden de su familia y luego el del producto, y nada de B', async () => {
    const b = await sembrarBase(ctx, tokenA);
    const x = await crearSimple({}, b);
    const y = await crearSimple({}, b);
    const lista = await get(tokenA, '/carta/productos');
    exigirEstado(lista, 200, 'listar');
    const filas = lista.body as { id: string; familiaId: string; orden: number }[];
    const familias = (await get(tokenA, '/carta/familias')).body as { id: string }[];
    const posicion = new Map(familias.map((f, i) => [f.id, i]));
    const claves = filas.map((f) => [posicion.get(f.familiaId)!, f.orden]);
    expect(claves).toEqual([...claves].sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!));
    const ids = filas.map((f) => f.id);
    expect(ids.indexOf(x.id)).toBeLessThan(ids.indexOf(y.id));
    const total = await admin.query(
      'SELECT count(*)::int AS n FROM producto WHERE empresa_id = $1',
      [e.A.empresaId],
    );
    expect(filas).toHaveLength(total.rows[0].n);
    expect(Object.keys(filas[0]!).sort()).toEqual(
      [
        'activo',
        'estacionId',
        'familiaId',
        'fotoUrl',
        'id',
        'nombre',
        'orden',
        'precio',
        'seVendeSolo',
        'tipo',
        'tipoControlStock',
      ].sort(),
    );
  });

  it('el detalle de un producto de B o inexistente responde 404 con el mismo cuerpo; un id mal formado, 400', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const deB = await crearSimple({}, baseB, tokenB);
    const a = await get(tokenA, `/carta/productos/${deB.id}`);
    const b = await get(tokenA, `/carta/productos/${crypto.randomUUID()}`);
    esperarError(a, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
    esperarError(await get(tokenA, '/carta/productos/no-es-un-uuid'), 400, 'DATOS_INVALIDOS');
  });
});

describe('criterios 10 y 11 · editar y desactivar', () => {
  it('cambia el precio con el antes y el después exactos y la fila de actualizado_por; repetirlo no deja otra', async () => {
    const p = await crearSimple({ precio: '25.00' });
    const token = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    const antes = new Set(
      (await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).map((f) => f.id),
    );
    const res = await patch(token, p.id, { precio: '26' });
    exigirEstado(res, 200, 'cambiar precio');
    expect(res.body.precio).toBe('26.00');
    const nuevas = (await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).filter(
      (f) => !antes.has(f.id),
    );
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]).toMatchObject({
      accion: 'modificar_producto',
      actor_usuario_id: e.A.cajero.id,
    });
    expect(nuevas[0]!.detalle).toEqual({ precio: { antes: '25.00', despues: '26.00' } });
    const { rows } = await admin.query('SELECT * FROM producto WHERE id = $1', [p.id]);
    expect(rows[0].actualizado_por_usuario_id).toBe(e.A.cajero.id);
    expect(rows[0].creado_por_usuario_id).toBe(e.A.base.admin.id);

    await asentar();
    ctx.publicador.limpiar();
    exigirEstado(await patch(token, p.id, { precio: '26.00' }), 200, 'mismo precio');
    exigirEstado(await patch(token, p.id, { nombre: p.nombre }), 200, 'mismo nombre');
    exigirEstado(await patch(token, p.id, { tipo: 'SIMPLE' }), 200, 'mismo tipo');
    exigirEstado(
      await patch(token, p.id, { gruposModificadores: [], componentes: [] }),
      200,
      'listas vacías',
    );
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
    expect(await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).toHaveLength(
      antes.size + 1,
    );
  });

  it('un cambio de varios campos deja una sola fila con cada campo y un solo evento', async () => {
    const p = await crearSimple({ precio: '10.00', descripcion: 'uno' });
    await asentar();
    ctx.publicador.limpiar();
    const res = await patch(tokenA, p.id, {
      nombre: unico('Nuevo nombre'),
      descripcion: null,
      afectacionIgv: 'INAFECTO',
      aplicaIcbper: true,
      tipoControlStock: 'SIN_CONTROL',
      estacionId: null,
    });
    exigirEstado(res, 200, 'editar');
    const filas = (await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).filter(
      (f) => f.accion === 'modificar_producto',
    );
    expect(filas).toHaveLength(1);
    expect(Object.keys(filas[0]!.detalle!).sort()).toEqual(
      [
        'afectacionIgv',
        'aplicaIcbper',
        'descripcion',
        'estacionId',
        'nombre',
        'tipoControlStock',
      ].sort(),
    );
    expect((filas[0]!.detalle as { descripcion: unknown }).descripcion).toEqual({
      antes: 'uno',
      despues: null,
    });
    await asentar();
    expect(ctx.publicador.eventos()).toHaveLength(1);
  });

  it('las reglas del criterio 7 se aplican al resultado de mezclar lo guardado con lo enviado (400)', async () => {
    const p = await crearSimple({ precio: '10.00' });
    // No se vende solo pero conserva el precio guardado.
    esperarError(await patch(tokenA, p.id, { seVendeSolo: false }), 400, 'DATOS_INVALIDOS');
    // Con precio null en el mismo PATCH sí.
    const ligado = await patch(tokenA, p.id, { seVendeSolo: false, precio: null });
    exigirEstado(ligado, 200, 'dejar de venderse solo');
    expect(ligado.body).toMatchObject({ seVendeSolo: false, precio: null });
    // Volver a venderse solo exige precio.
    esperarError(await patch(tokenA, p.id, { seVendeSolo: true }), 400, 'DATOS_INVALIDOS');
    exigirEstado(await patch(tokenA, p.id, { seVendeSolo: true, precio: '12.50' }), 200, 'vuelve');
    // Un precio solo, sin se_vende_solo, en un producto que no se vende solo.
    exigirEstado(await patch(tokenA, p.id, { seVendeSolo: false, precio: null }), 200, 'otra vez');
    esperarError(await patch(tokenA, p.id, { precio: '9.00' }), 400, 'DATOS_INVALIDOS');
  });

  it('un PATCH vacío, con un campo desconocido o con otro tipo responde 400 y no cambia nada', async () => {
    const p = await crearSimple();
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const cuerpo of [
      {},
      { confirmarPerdida: true },
      { desconocido: 1 },
      { empresaId: e.B.empresaId },
      { tipo: 'COMBO' },
      { tipo: 'MENU_DEL_DIA' },
      { gruposModificadores: [crypto.randomUUID()] },
      { componentes: [{ productoId: crypto.randomUUID(), cantidad: 1 }] },
    ]) {
      esperarError(await patch(tokenA, p.id, cuerpo), 400, 'DATOS_INVALIDOS');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un id de B o inexistente responde 404 con el mismo cuerpo y no cambia nada de B', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const deB = await crearSimple({}, baseB, tokenB);
    const antesB = await instantaneaCarta(admin, e.B.empresaId);
    const a = await patch(tokenA, deB.id, { precio: '99.00' });
    const b = await patch(tokenA, crypto.randomUUID(), { precio: '99.00' });
    esperarError(a, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
    expect(await instantaneaCarta(admin, e.B.empresaId)).toEqual(antesB);
  });

  it('familia o estación de B, inexistente o inactiva responde 422 y no cambia nada; null en estación es válido', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const p = await crearSimple();
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const cuerpo of [
      { familiaId: baseB.familiaId },
      { familiaId: crypto.randomUUID() },
      { estacionId: baseB.estacionId },
      { estacionId: crypto.randomUUID() },
    ]) {
      esperarError(await patch(tokenA, p.id, cuerpo), 422, 'REFERENCIA_INVALIDA');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    exigirEstado(await patch(tokenA, p.id, { estacionId: null }), 200, 'sin estación');
  });

  it('el nombre de otro producto responde 409 y no deja auditoría', async () => {
    const a = await crearSimple();
    const b = await crearSimple();
    const antes = (await auditoriaCarta(admin, e.A.empresaId, { entidadId: b.id })).length;
    esperarError(await patch(tokenA, b.id, { nombre: a.nombre.toUpperCase() }), 409, 'CONFLICTO');
    expect(await auditoriaCarta(admin, e.A.empresaId, { entidadId: b.id })).toHaveLength(antes);
    // Cambiar las mayúsculas del propio nombre sí se puede.
    exigirEstado(
      await patch(tokenA, b.id, { nombre: b.nombre.toUpperCase() }),
      200,
      'propio nombre',
    );
  });

  it('desactiva y reactiva: queda registrado; reactivar con la familia o la estación inactivas responde 422', async () => {
    const b = await sembrarBase(ctx, tokenA);
    const p = await crearSimple({}, b);
    const off = await patch(tokenA, p.id, { activo: false });
    exigirEstado(off, 200, 'desactivar');
    expect(off.body.activo).toBe(false);
    exigirEstado(
      await llamar(ctx, tokenA, {
        metodo: 'patch',
        ruta: `/carta/estaciones/${b.estacionId}`,
        cuerpo: { activa: false },
      }),
      200,
      'estación inactiva',
    );
    // Un producto inactivo se puede seguir editando aunque su estación esté inactiva.
    exigirEstado(await patch(tokenA, p.id, { nombre: unico('Editado inactivo') }), 200, 'editar');
    const reactivar = await patch(tokenA, p.id, { activo: true });
    esperarError(reactivar, 422, 'REFERENCIA_INVALIDA');
    expect(reactivar.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['estacionId']);
    // Pasando a otra estación activa en el mismo PATCH sí se reactiva.
    const otra = await sembrarBase(ctx, tokenA);
    exigirEstado(
      await patch(tokenA, p.id, { activo: true, estacionId: otra.estacionId }),
      200,
      'reactivar con otra estación',
    );
    const filas = (await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).map(
      (f) => f.accion,
    );
    expect(filas.filter((a) => a === 'modificar_producto')).toHaveLength(3);
  });

  it('un producto que cambia de familia queda el último de la nueva y la familia nueva debe estar activa', async () => {
    const otra = await sembrarBase(ctx, tokenA);
    const p = await crearSimple();
    const ultimo = await crearSimple({}, { ...base, familiaId: otra.familiaId });
    const movido = await patch(tokenA, p.id, { familiaId: otra.familiaId });
    exigirEstado(movido, 200, 'mover');
    expect(movido.body.orden).toBe(ultimo.orden + 1);
    // Con el reloj manual las filas comparten instante: se busca la de la mudanza por su contenido.
    const fila = (await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).find(
      (f) => f.accion === 'modificar_producto',
    )!;
    expect(fila.detalle).toMatchObject({
      familiaId: { antes: base.familiaId, despues: otra.familiaId },
    });
  });
});

describe('permisos y rechazos de los productos', () => {
  it('Mozo, Cocina/Barra y Supervisor reciben 403 sin cambiar nada; el Cajero y el Administrador pueden', async () => {
    const p = await crearSimple();
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const persona of [e.A.mozo, e.A.cocina, e.A.supervisor]) {
      const token = await sesionContrasena(ctx, persona, e.A.S1);
      esperarError(await post(token, productoSimple(base)), 403, 'PROHIBIDO');
      esperarError(await patch(token, p.id, { precio: '1.00' }), 403, 'PROHIBIDO');
      esperarError(await get(token, '/carta/productos'), 403, 'PROHIBIDO');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    const cajero = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    exigirEstado(await patch(cajero, p.id, { precio: '27.00' }), 200, 'el Cajero');
  });

  it('con S2 activa (donde el Cajero es Mozo) el Cajero recibe 403; sin sucursal activa, 409', async () => {
    const p = await crearSimple();
    const s2 = await sesionContrasena(ctx, e.A.cajero, e.A.S2);
    esperarError(await patch(s2, p.id, { precio: '3.00' }), 403, 'PROHIBIDO');
    const sinSucursal = await sesionContrasena(ctx, e.A.cajero, null);
    esperarError(await get(sinSucursal, '/carta/productos'), 409, 'SUCURSAL_NO_ELEGIDA');
  });
});
