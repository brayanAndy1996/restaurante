// Historia 003, grupo C4 · combos y menú del día como productos (criterios 6 a 12 en lo que toca a combos, 30 a
// 33): pruebas del desarrollador (no protegidas). Que el Cajero los cree y el aislamiento entre empresas los
// cubren las pruebas protegidas `cajero-carta.spec.ts` y `referencias-carta.spec.ts`; el menú de cada día, el
// archivo `menu-del-dia.spec.ts`, y el cambio de tipo, `cambio-tipo.spec.ts`.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  esperarError,
  exigirEstado,
  instantaneaCarta,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  llamar,
  sembrarBase,
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
  type ProductoCreado,
} from './ayudas-combos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let tokenB: string;
let base: Base;
let hamburguesa: ProductoCreado;
let papas: ProductoCreado;
let bebida: GrupoCreado;
let acompanamiento: GrupoCreado;

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  tokenA = e.A.tokenAdmin;
  tokenB = e.B.tokenAdmin;
  base = await sembrarBase(ctx, tokenA);
  hamburguesa = await crearSimple(ctx, tokenA, base, {
    nombre: unico('Hamburguesa clásica'),
    precio: '15.00',
  });
  papas = await crearLigable(ctx, tokenA, base, { nombre: unico('Papas del combo') });
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

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const post = (cuerpo: unknown, token = tokenA) =>
  pedir(ctx, token, 'post', '/carta/productos', cuerpo);
const patch = (id: string, cuerpo: unknown, token = tokenA) =>
  pedir(ctx, token, 'patch', `/carta/productos/${id}`, cuerpo);
const leer = async (id: string, token = tokenA) => {
  const res = await pedir(ctx, token, 'get', `/carta/productos/${id}`);
  exigirEstado(res, 200, 'leer producto');
  return res.body as Record<string, unknown> & {
    componentes: unknown[];
    usadoEn: unknown;
  };
};
const filasComponentes = async (comboId: string) =>
  (
    await admin.query(
      'SELECT producto_id, cantidad, orden FROM componente_combo WHERE combo_id = $1 ORDER BY orden',
      [comboId],
    )
  ).rows;

/** El combo de referencia del criterio 30. */
const comboHamburguesa = (extra: Record<string, unknown> = {}) =>
  cuerpoCombo(base, {
    nombre: unico('Combo hamburguesa'),
    componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    gruposModificadores: [bebida.id, acompanamiento.id],
    ...extra,
  });

describe('criterios 6, 7 y 30 · crear un combo', () => {
  it('crea el combo de referencia: precio fijo, sin estación propia, con su componente y sus grupos en orden', async () => {
    ctx.publicador.limpiar();
    const res = await post(comboHamburguesa());
    exigirEstado(res, 201, 'crear combo');
    expect(res.body).toMatchObject({
      tipo: 'COMBO',
      precio: '22.90',
      seVendeSolo: true,
      estacionId: null,
      tipoControlStock: 'SIN_CONTROL',
      activo: true,
      componentes: [{ productoId: hamburguesa.id, nombre: hamburguesa.nombre, cantidad: 1 }],
      grupos: [
        { id: bebida.id, nombre: bebida.nombre },
        { id: acompanamiento.id, nombre: acompanamiento.nombre },
      ],
      usadoEn: { combos: [], modificadores: [] },
    });
    const fila = (await admin.query('SELECT * FROM producto WHERE id = $1', [res.body.id])).rows[0];
    expect(fila).toMatchObject({ tipo: 'COMBO', se_vende_solo: true, estacion_id: null });
    expect(await filasComponentes(res.body.id)).toEqual([
      { producto_id: hamburguesa.id, cantidad: 1, orden: 1 },
    ]);
    await asentar();
    expect(ctx.publicador.eventos()).toHaveLength(1);
    expect(ctx.publicador.eventos()[0]).toMatchObject({
      empresaId: e.A.empresaId,
      sala: { tipo: 'empresa' },
      nombre: 'carta.actualizada',
      datos: { sucursalId: null },
    });
    const [auditoria] = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'crear_producto',
      entidadId: res.body.id,
    });
    expect(auditoria!.detalle).toMatchObject({
      tipo: 'COMBO',
      precio: '22.90',
      estacionId: null,
      componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
      gruposModificadores: [bebida.id, acompanamiento.id],
    });
  });

  it('se lista con los demás productos y trae el componente al consultarlo', async () => {
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    const lista = await pedir(ctx, tokenA, 'get', '/carta/productos');
    exigirEstado(lista, 200, 'listar');
    expect(lista.body.find((p: { id: string }) => p.id === combo.id)).toMatchObject({
      tipo: 'COMBO',
      precio: '22.90',
      estacionId: null,
    });
    const completo = await leer(combo.id);
    expect(completo.componentes).toHaveLength(1);
  });

  it('un combo puede tener solo componentes, solo grupos, o un componente que no se vende solo', async () => {
    const soloComponentes = await post(
      cuerpoCombo(base, { componentes: [{ productoId: papas.id, cantidad: 2 }] }),
    );
    exigirEstado(soloComponentes, 201, 'solo componentes (uno que no se vende solo)');
    const soloGrupos = await post(cuerpoCombo(base, { gruposModificadores: [bebida.id] }));
    exigirEstado(soloGrupos, 201, 'solo grupos');
    expect(soloGrupos.body.componentes).toEqual([]);
  });

  it('el orden de los componentes es el enviado y la cantidad se guarda', async () => {
    const res = await post(
      cuerpoCombo(base, {
        componentes: [
          { productoId: papas.id, cantidad: 3 },
          { productoId: hamburguesa.id, cantidad: 99 },
        ],
      }),
    );
    exigirEstado(res, 201, 'crear');
    expect(
      res.body.componentes.map((c: { productoId: string; cantidad: number }) => [
        c.productoId,
        c.cantidad,
      ]),
    ).toEqual([
      [papas.id, 3],
      [hamburguesa.id, 99],
    ]);
  });

  it('rechaza con 400 lo que no cumple las reglas del tipo, sin crear nada', async () => {
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const componentes = [{ productoId: hamburguesa.id, cantidad: 1 }];
    const casos: [string, Record<string, unknown>, string][] = [
      ['combo sin componentes ni grupos', cuerpoCombo(base), 'componentes'],
      [
        'combo que no se vende solo',
        cuerpoCombo(base, { componentes, seVendeSolo: false }),
        'seVendeSolo',
      ],
      ['combo sin precio', { ...cuerpoCombo(base, { componentes }), precio: undefined }, 'precio'],
      ['combo con precio null', cuerpoCombo(base, { componentes, precio: null }), 'precio'],
      [
        'combo con estación',
        cuerpoCombo(base, { componentes, estacionId: base.estacionId }),
        'estacionId',
      ],
      [
        'componente repetido',
        cuerpoCombo(base, { componentes: [...componentes, ...componentes] }),
        'componentes',
      ],
      [
        'cantidad 0',
        cuerpoCombo(base, { componentes: [{ productoId: hamburguesa.id, cantidad: 0 }] }),
        'cantidad',
      ],
      [
        'cantidad 100',
        cuerpoCombo(base, { componentes: [{ productoId: hamburguesa.id, cantidad: 100 }] }),
        'cantidad',
      ],
      [
        'cantidad decimal',
        cuerpoCombo(base, { componentes: [{ productoId: hamburguesa.id, cantidad: 1.5 }] }),
        'cantidad',
      ],
      [
        '21 componentes',
        cuerpoCombo(base, {
          componentes: Array.from({ length: 21 }, () => ({
            productoId: crypto.randomUUID(),
            cantidad: 1,
          })),
        }),
        'componentes',
      ],
      [
        'grupo repetido',
        cuerpoCombo(base, { gruposModificadores: [bebida.id, bebida.id] }),
        'gruposModificadores',
      ],
      [
        'componente con campo desconocido',
        cuerpoCombo(base, { componentes: [{ productoId: hamburguesa.id, cantidad: 1, extra: 1 }] }),
        'componentes',
      ],
    ];
    for (const [nombre, cuerpo] of casos) {
      const res = await post(cuerpo);
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(camposDe(res).length, nombre).toBeGreaterThan(0);
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un producto simple no admite componentes (400)', async () => {
    const res = await post({
      tipo: 'SIMPLE',
      nombre: unico('Simple'),
      familiaId: base.familiaId,
      precio: '10.00',
      estacionId: base.estacionId,
      tipoControlStock: 'UNIDADES',
      componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(camposDe(res)).toContain('componentes');
  });

  it('el nombre es único en la empresa sin distinguir mayúsculas (409)', async () => {
    const nombre = unico('Combo repetido');
    await crearProducto(ctx, tokenA, comboHamburguesa({ nombre }));
    esperarError(await post(comboHamburguesa({ nombre: nombre.toUpperCase() })), 409, 'CONFLICTO');
  });

  it('con la misma Idempotency-Key repite la respuesta y no crea otro combo', async () => {
    const cuerpo = comboHamburguesa();
    const llamada = {
      metodo: 'post' as const,
      ruta: '/carta/productos',
      cuerpo,
      cabeceras: { 'Idempotency-Key': crypto.randomUUID() },
    };
    const a = await llamar(ctx, tokenA, llamada);
    const b = await llamar(ctx, tokenA, llamada);
    exigirEstado(a, 201, 'primera');
    exigirEstado(b, 201, 'repetida');
    expect(b.body).toEqual(a.body);
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM producto WHERE nombre = $1',
      [cuerpo.nombre],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('criterio 9 y 32 · referencias de un combo y sin anidar', () => {
  it('un componente inexistente, de B, inactivo, combo o menú responde 422 con el mismo cuerpo y no crea nada', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const deB = await crearSimple(ctx, tokenB, baseB);
    const inactivo = await crearSimple(ctx, tokenA, base);
    exigirEstado(await patch(inactivo.id, { activo: false }), 200, 'desactivar');
    const otroCombo = await crearProducto(ctx, tokenA, comboHamburguesa());
    const unMenu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [bebida.id] }),
    );
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const cuerpos: unknown[] = [];
    for (const productoId of [crypto.randomUUID(), deB.id, inactivo.id, otroCombo.id, unMenu.id]) {
      const res = await post(
        cuerpoCombo(base, {
          componentes: [
            { productoId: hamburguesa.id, cantidad: 1 },
            { productoId, cantidad: 1 },
          ],
        }),
      );
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(camposDe(res)).toEqual(['componentes']);
      cuerpos.push(res.body);
    }
    for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
    expect(JSON.stringify(cuerpos[0])).not.toContain(deB.id);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un grupo inactivo o de B responde 422 en el campo de los grupos', async () => {
    const grupoB = await crearGrupo(ctx, tokenB, [{ nombre: 'Sal' }]);
    const inactivo = await crearGrupo(ctx, tokenA, [{ nombre: 'Sal' }]);
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${inactivo.id}`, {
        activo: false,
      }),
      200,
      'desactivar el grupo',
    );
    for (const grupo of [grupoB.id, inactivo.id]) {
      const res = await post(comboHamburguesa({ gruposModificadores: [grupo] }));
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(camposDe(res)).toEqual(['gruposModificadores']);
    }
  });

  it('un combo no puede ser producto ligado de un modificador (criterio 32)', async () => {
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    const res = await pedir(ctx, tokenA, 'post', '/carta/grupos-modificadores', {
      nombre: unico('Grupo'),
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: [{ nombre: 'Combo', productoId: combo.id }],
    });
    esperarError(res, 422, 'REFERENCIA_INVALIDA');
  });
});

describe('criterio 33 · menú del día como producto', () => {
  it('se configura como un combo: precio, grupos (un tiempo cada uno) y componentes fijos', async () => {
    const entrada = await crearGrupo(ctx, tokenA, [
      { nombre: 'Papa a la huancaína' },
      { nombre: 'Sopa', productoId: papas.id },
    ]);
    const res = await post(
      cuerpoMenu(base, {
        gruposModificadores: [entrada.id, bebida.id],
        componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
      }),
    );
    exigirEstado(res, 201, 'crear menú');
    expect(res.body).toMatchObject({
      tipo: 'MENU_DEL_DIA',
      precio: '12.00',
      seVendeSolo: true,
      estacionId: null,
      tipoControlStock: 'PORCIONES',
      componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    });
    expect(res.body.grupos.map((g: { id: string }) => g.id)).toEqual([entrada.id, bebida.id]);
  });

  it('exige al menos un grupo, aunque tenga componentes (400)', async () => {
    const res = await post(
      cuerpoMenu(base, { componentes: [{ productoId: hamburguesa.id, cantidad: 1 }] }),
    );
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(camposDe(res)).toContain('gruposModificadores');
    esperarError(await post(cuerpoMenu(base)), 400, 'DATOS_INVALIDOS');
  });

  it('no puede tener estación, ni dejar de venderse solo, ni quedar sin precio (400)', async () => {
    for (const extra of [
      { estacionId: base.estacionId },
      { seVendeSolo: false },
      { precio: null },
    ]) {
      const res = await post(cuerpoMenu(base, { gruposModificadores: [bebida.id], ...extra }));
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
  });
});

describe('criterios 10 y 11 · editar un combo', () => {
  it('reemplaza la lista de componentes completa (cantidad, orden, altas y bajas) y audita el antes y el después', async () => {
    const combo = await crearProducto(
      ctx,
      tokenA,
      comboHamburguesa({
        componentes: [
          { productoId: hamburguesa.id, cantidad: 1 },
          { productoId: papas.id, cantidad: 2 },
        ],
      }),
    );
    const otra = await crearSimple(ctx, tokenA, base);
    ctx.publicador.limpiar();
    const res = await patch(combo.id, {
      componentes: [
        { productoId: otra.id, cantidad: 4 },
        { productoId: papas.id, cantidad: 3 },
      ],
    });
    exigirEstado(res, 200, 'reemplazar componentes');
    expect(
      res.body.componentes.map((c: { productoId: string; cantidad: number }) => [
        c.productoId,
        c.cantidad,
      ]),
    ).toEqual([
      [otra.id, 4],
      [papas.id, 3],
    ]);
    expect(await filasComponentes(combo.id)).toEqual([
      { producto_id: otra.id, cantidad: 4, orden: 1 },
      { producto_id: papas.id, cantidad: 3, orden: 2 },
    ]);
    await asentar();
    expect(ctx.publicador.eventos()).toHaveLength(1);
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'modificar_producto',
      entidadId: combo.id,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toEqual({
      componentes: {
        antes: [
          { productoId: hamburguesa.id, cantidad: 1 },
          { productoId: papas.id, cantidad: 2 },
        ],
        despues: [
          { productoId: otra.id, cantidad: 4 },
          { productoId: papas.id, cantidad: 3 },
        ],
      },
    });
  });

  it('enviar los mismos componentes o los mismos datos responde 200 sin auditoría ni evento', async () => {
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    ctx.publicador.limpiar();
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const nAuditoria = (await auditoriaCarta(admin, e.A.empresaId)).length;
    for (const cuerpo of [
      { componentes: [{ productoId: hamburguesa.id, cantidad: 1 }] },
      { precio: '22.90', nombre: combo.nombre },
      { tipo: 'COMBO' },
      { tipo: 'COMBO', confirmarPerdida: true },
      { gruposModificadores: [bebida.id, acompanamiento.id] },
    ]) {
      exigirEstado(await patch(combo.id, cuerpo), 200, JSON.stringify(cuerpo));
    }
    await asentar();
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    expect((await auditoriaCarta(admin, e.A.empresaId)).length).toBe(nAuditoria);
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('cambiar el precio del combo guarda el antes y el después como texto exacto', async () => {
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    exigirEstado(await patch(combo.id, { precio: '24.5' }), 200, 'cambiar precio');
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'modificar_producto',
      entidadId: combo.id,
    });
    expect(filas.at(-1)!.detalle).toEqual({ precio: { antes: '22.90', despues: '24.50' } });
  });

  it('las reglas se comprueban sobre el resultado: no se puede quedar sin nada, ni darle estación o quitarle el precio (400)', async () => {
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const casos: [string, Record<string, unknown>, string][] = [
      ['quitar componentes y grupos', { componentes: [], gruposModificadores: [] }, 'componentes'],
      ['darle estación', { estacionId: base.estacionId }, 'estacionId'],
      ['quitarle el precio', { precio: null }, 'precio'],
      ['que no se venda solo', { seVendeSolo: false }, 'seVendeSolo'],
      [
        'componente repetido',
        {
          componentes: [
            { productoId: papas.id, cantidad: 1 },
            { productoId: papas.id, cantidad: 2 },
          ],
        },
        'componentes',
      ],
    ];
    for (const [nombre, cuerpo, campo] of casos) {
      const res = await patch(combo.id, cuerpo);
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(
        camposDe(res).some((c) => c.startsWith(campo)),
        nombre,
      ).toBe(true);
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('quitar los componentes sigue siendo válido si quedan grupos, y al revés', async () => {
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    exigirEstado(await patch(combo.id, { componentes: [] }), 200, 'solo grupos');
    expect(await filasComponentes(combo.id)).toEqual([]);
    exigirEstado(
      await patch(combo.id, {
        componentes: [{ productoId: papas.id, cantidad: 1 }],
        gruposModificadores: [],
      }),
      200,
      'solo componentes',
    );
  });

  it('un componente nuevo debe ser simple y activo (422); uno que se desactivó se conserva y no se puede volver a agregar', async () => {
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    const componente = await crearSimple(ctx, tokenA, base);
    exigirEstado(
      await patch(combo.id, {
        componentes: [
          { productoId: hamburguesa.id, cantidad: 1 },
          { productoId: componente.id, cantidad: 1 },
        ],
      }),
      200,
      'agregar',
    );
    exigirEstado(await patch(componente.id, { activo: false }), 200, 'desactivar el componente');
    // Criterio 11: la referencia que ya tenía se conserva, y el combo se puede seguir editando.
    exigirEstado(await patch(combo.id, { nombre: unico('Combo editado') }), 200, 'editar el combo');
    exigirEstado(
      await patch(combo.id, {
        componentes: [
          { productoId: hamburguesa.id, cantidad: 2 },
          { productoId: componente.id, cantidad: 1 },
        ],
      }),
      200,
      'conservar el inactivo',
    );
    expect((await leer(combo.id)).componentes).toHaveLength(2);
    // Pero no se puede agregar a otro combo.
    const otro = await crearProducto(ctx, tokenA, comboHamburguesa());
    const res = await patch(otro.id, {
      componentes: [{ productoId: componente.id, cantidad: 1 }],
    });
    esperarError(res, 422, 'REFERENCIA_INVALIDA');
    expect(camposDe(res)).toEqual(['componentes']);
  });

  it('un combo, un menú, un producto de B o uno inexistente como componente nuevo responde 422 y no cambia nada', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const deB = await crearSimple(ctx, tokenB, baseB);
    const combo = await crearProducto(ctx, tokenA, comboHamburguesa());
    const otroCombo = await crearProducto(ctx, tokenA, comboHamburguesa());
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const productoId of [crypto.randomUUID(), deB.id, otroCombo.id, combo.id]) {
      const res = await patch(combo.id, {
        componentes: [
          { productoId: hamburguesa.id, cantidad: 1 },
          { productoId, cantidad: 1 },
        ],
      });
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un simple no admite componentes al editarlo, y una lista vacía no cambia nada', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    esperarError(
      await patch(simple.id, { componentes: [{ productoId: hamburguesa.id, cantidad: 1 }] }),
      400,
      'DATOS_INVALIDOS',
    );
    exigirEstado(await patch(simple.id, { componentes: [] }), 200, 'lista vacía');
    expect(
      (await auditoriaCarta(admin, e.A.empresaId, { entidadId: simple.id })).map((f) => f.accion),
    ).toEqual(['crear_producto']);
  });

  it('desactivar un componente deja al combo vigente y reactivarlo no pide nada más (criterio 11)', async () => {
    const componente = await crearSimple(ctx, tokenA, base);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { componentes: [{ productoId: componente.id, cantidad: 1 }] }),
    );
    exigirEstado(await patch(componente.id, { activo: false }), 200, 'desactivar');
    expect((await leer(combo.id)).componentes).toHaveLength(1);
    exigirEstado(await patch(componente.id, { activo: true }), 200, 'reactivar');
    // Y el combo que lo contiene se puede desactivar y reactivar con el componente inactivo.
    exigirEstado(await patch(componente.id, { activo: false }), 200, 'desactivar de nuevo');
    exigirEstado(await patch(combo.id, { activo: false }), 200, 'desactivar el combo');
    exigirEstado(await patch(combo.id, { activo: true }), 200, 'reactivar el combo');
  });
});

describe('criterio 12 · dónde se usa un producto', () => {
  it('lista los combos que lo tienen como componente, activos o no, por nombre', async () => {
    const componente = await crearSimple(ctx, tokenA, base);
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
    expect((await leer(componente.id)).usadoEn).toEqual({
      combos: [
        { id: b.id, nombre: b.nombre },
        { id: a.id, nombre: a.nombre },
      ],
      modificadores: [],
    });
  });

  it('los datos de B no aparecen: un id de B responde 404', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const deB = await crearSimple(ctx, tokenB, baseB);
    esperarError(
      await pedir(ctx, tokenA, 'get', `/carta/productos/${deB.id}`),
      404,
      'NO_ENCONTRADO',
    );
  });
});
