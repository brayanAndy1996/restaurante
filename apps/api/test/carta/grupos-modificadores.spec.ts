// Historia 003, grupo C3 · modificadores (criterios 24 a 29 y lo que toca a grupos en 6, 8, 9 y 10): pruebas del
// desarrollador (no protegidas). Lo que decide quién edita la carta (el Cajero, 403 por rol) y el antes y el
// después del precio extra por rol lo cubren las pruebas protegidas `permisos-carta.spec.ts` y
// `cajero-carta.spec.ts`; el aislamiento, `referencias-carta.spec.ts` y `rls-carta.spec.ts`. Aquí se prueban
// las reglas de mínimo, máximo y obligatorio, el reemplazo de la lista de modificadores, el producto ligado,
// `EN_USO`, la asignación a productos, la auditoría y los eventos.
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
  unaFila,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  llamar,
  productoSimple,
  sembrarBase,
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

interface Modificador {
  id: string;
  nombre: string;
  precioExtra: string;
  producto: { id: string; nombre: string } | null;
  orden: number;
}
interface Grupo {
  id: string;
  nombre: string;
  seleccion: 'UNICA' | 'MULTIPLE';
  minimo: number;
  maximo: number;
  obligatorio: boolean;
  activo: boolean;
  modificadores: Modificador[];
  productos: { id: string; nombre: string }[];
}

const RUTA = '/carta/grupos-modificadores';
const post = (cuerpo: unknown, token = tokenA) =>
  llamar(ctx, token, { metodo: 'post', ruta: RUTA, cuerpo });
const patch = (id: string, cuerpo: unknown, token = tokenA) =>
  llamar(ctx, token, { metodo: 'patch', ruta: `${RUTA}/${id}`, cuerpo });
const get = (ruta: string, token = tokenA) => llamar(ctx, token, { metodo: 'get', ruta });
const patchProducto = (id: string, cuerpo: unknown, token = tokenA) =>
  llamar(ctx, token, { metodo: 'patch', ruta: `/carta/productos/${id}`, cuerpo });

const unicaObligatoria = (extra: Record<string, unknown> = {}) => ({
  nombre: unico('Término'),
  seleccion: 'UNICA',
  obligatorio: true,
  modificadores: [{ nombre: 'Jugoso' }, { nombre: 'Medio' }, { nombre: 'Bien cocido' }],
  ...extra,
});
const multiple = (extra: Record<string, unknown> = {}) => ({
  nombre: unico('Extras'),
  seleccion: 'MULTIPLE',
  minimo: 0,
  maximo: 2,
  modificadores: [
    { nombre: 'Huevo', precioExtra: '2.50' },
    { nombre: 'Queso', precioExtra: '2.00' },
    { nombre: 'Tocino', precioExtra: '3.00' },
  ],
  ...extra,
});

async function crearGrupo(cuerpo: Record<string, unknown>, token = tokenA): Promise<Grupo> {
  const res = await post(cuerpo, token);
  exigirEstado(res, 201, 'crear grupo');
  return res.body as Grupo;
}

async function crearSimple(
  extra: Record<string, unknown> = {},
  b = base,
  token = tokenA,
): Promise<{ id: string; nombre: string }> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/carta/productos',
    cuerpo: productoSimple(b, extra),
  });
  exigirEstado(res, 201, 'crear producto');
  return res.body as { id: string; nombre: string };
}

/** Un producto simple que no se vende solo (el que se liga a un modificador). */
const crearLigable = (token = tokenA, b = base) =>
  crearSimple({ seVendeSolo: false, precio: undefined, tipoControlStock: 'PORCIONES' }, b, token);

const leer = async (id: string): Promise<Grupo> => {
  const res = await get(`${RUTA}/${id}`);
  exigirEstado(res, 200, 'leer grupo');
  return res.body as Grupo;
};

const campos = (res: { body: unknown }): string[] =>
  ((res.body as { campos?: { campo: string }[] }).campos ?? []).map((c) => c.campo);

describe('criterios 24 y 25 · crear un grupo', () => {
  it('crea un grupo de selección única obligatorio con sus modificadores en orden y precio extra "0.00" por defecto', async () => {
    const grupo = await crearGrupo(unicaObligatoria());
    expect(grupo).toMatchObject({
      seleccion: 'UNICA',
      minimo: 1,
      maximo: 1,
      obligatorio: true,
      activo: true,
      productos: [],
    });
    expect(grupo.modificadores.map((m) => [m.nombre, m.precioExtra, m.orden, m.producto])).toEqual([
      ['Jugoso', '0.00', 1, null],
      ['Medio', '0.00', 2, null],
      ['Bien cocido', '0.00', 3, null],
    ]);
  });

  it('una selección única opcional lleva mínimo 0 y máximo 1', async () => {
    const grupo = await crearGrupo(unicaObligatoria({ obligatorio: false }));
    expect(grupo).toMatchObject({ seleccion: 'UNICA', minimo: 0, maximo: 1, obligatorio: false });
  });

  it('una selección múltiple guarda su mínimo y su máximo; obligatorio es mínimo ≥ 1; los montos se normalizan', async () => {
    const grupo = await crearGrupo(
      multiple({
        minimo: 1,
        maximo: 3,
        modificadores: [
          { nombre: 'Huevo', precioExtra: '2.5' },
          { nombre: 'Queso', precioExtra: '0' },
          { nombre: 'Tocino', precioExtra: '10' },
        ],
      }),
    );
    expect(grupo).toMatchObject({ seleccion: 'MULTIPLE', minimo: 1, maximo: 3, obligatorio: true });
    expect(grupo.modificadores.map((m) => m.precioExtra)).toEqual(['2.50', '0.00', '10.00']);
    const opcional = await crearGrupo(multiple());
    expect(opcional.obligatorio).toBe(false);
  });

  it('el nombre es único en la empresa sin distinguir mayúsculas (409) y el mismo nombre en B no choca', async () => {
    const nombre = unico('Salsas');
    await crearGrupo(unicaObligatoria({ nombre }));
    const repetido = await post(unicaObligatoria({ nombre: nombre.toUpperCase() }));
    esperarError(repetido, 409, 'CONFLICTO');
    exigirEstado(await post(unicaObligatoria({ nombre }), tokenB), 201, 'el mismo nombre en B');
  });

  it('rechaza con 400 lo que no cumple las reglas, sin crear nada', async () => {
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const casos: [string, Record<string, unknown>, string][] = [
      ['mínimo mayor que el máximo', multiple({ minimo: 3, maximo: 2 }), 'minimo'],
      [
        'mínimo mayor que la cantidad de modificadores',
        multiple({ minimo: 4, maximo: 5 }),
        'minimo',
      ],
      ['máximo 51', multiple({ maximo: 51 }), 'maximo'],
      ['máximo 0', multiple({ maximo: 0 }), 'maximo'],
      ['mínimo negativo', multiple({ minimo: -1 }), 'minimo'],
      ['mínimo decimal', multiple({ minimo: 0.5 }), 'minimo'],
      ['nombre vacío', unicaObligatoria({ nombre: '   ' }), 'nombre'],
      ['nombre de 61', unicaObligatoria({ nombre: 'x'.repeat(61) }), 'nombre'],
      ['sin modificadores', unicaObligatoria({ modificadores: [] }), 'modificadores'],
      [
        '51 modificadores',
        unicaObligatoria({
          modificadores: Array.from({ length: 51 }, (_, i) => ({ nombre: `Opción ${i}` })),
        }),
        'modificadores',
      ],
      [
        'nombre de modificador repetido sin distinguir mayúsculas',
        unicaObligatoria({ modificadores: [{ nombre: 'Sal' }, { nombre: 'SAL' }] }),
        'modificadores',
      ],
      [
        'precio extra negativo',
        unicaObligatoria({ modificadores: [{ nombre: 'Sal', precioExtra: '-1.00' }] }),
        'precioExtra',
      ],
      [
        'precio extra con 3 decimales',
        unicaObligatoria({ modificadores: [{ nombre: 'Sal', precioExtra: '1.005' }] }),
        'precioExtra',
      ],
      [
        'precio extra como número',
        unicaObligatoria({ modificadores: [{ nombre: 'Sal', precioExtra: 2.5 }] }),
        'precioExtra',
      ],
      [
        'selección única sin obligatorio',
        { ...unicaObligatoria(), obligatorio: undefined },
        'obligatorio',
      ],
      ['única con mínimo', unicaObligatoria({ minimo: 0 }), 'minimo'],
      ['múltiple con obligatorio', multiple({ obligatorio: true }), 'obligatorio'],
      ['selección desconocida', unicaObligatoria({ seleccion: 'VARIAS' }), 'seleccion'],
      ['campo desconocido', unicaObligatoria({ desconocido: 1 }), 'desconocido'],
      ['empresaId', unicaObligatoria({ empresaId: e.B.empresaId }), 'empresaId'],
      ['creadoPorUsuarioId', unicaObligatoria({ creadoPorUsuarioId: e.A.cajero.id }), 'creadoPor'],
    ];
    for (const [nombre, cuerpo] of casos) {
      const res = await post(cuerpo);
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(campos(res).length, nombre).toBeGreaterThan(0);
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('con la misma Idempotency-Key repite la respuesta y no crea otro grupo', async () => {
    const clave = crypto.randomUUID();
    const cuerpo = unicaObligatoria();
    const llamada = {
      metodo: 'post' as const,
      ruta: RUTA,
      cuerpo,
      cabeceras: { 'Idempotency-Key': clave },
    };
    const a = await llamar(ctx, tokenA, llamada);
    const b = await llamar(ctx, tokenA, llamada);
    exigirEstado(a, 201, 'primera');
    exigirEstado(b, 201, 'repetida');
    expect(b.body).toEqual(a.body);
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM grupo_modificadores WHERE nombre = $1',
      [cuerpo.nombre],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('criterio 26 · producto ligado', () => {
  it('liga un producto simple activo (también uno que no se vende solo) y lo muestra con su nombre', async () => {
    const ligable = await crearLigable();
    const vendible = await crearSimple();
    const grupo = await crearGrupo(
      unicaObligatoria({
        modificadores: [
          { nombre: 'Chicha', precioExtra: '2.50', productoId: ligable.id },
          { nombre: 'Gaseosa', productoId: vendible.id },
          { nombre: 'Agua' },
        ],
      }),
    );
    expect(grupo.modificadores.map((m) => m.producto)).toEqual([
      { id: ligable.id, nombre: ligable.nombre },
      { id: vendible.id, nombre: vendible.nombre },
      null,
    ]);
  });

  it('un producto inexistente, de B o inactivo responde 422 REFERENCIA_INVALIDA con el mismo cuerpo y no crea nada', async () => {
    const baseB = await sembrarBase(ctx, tokenB);
    const deB = await crearSimple({}, baseB, tokenB);
    const inactivo = await crearSimple();
    exigirEstado(await patchProducto(inactivo.id, { activo: false }), 200, 'desactivar');
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const cuerpos: unknown[] = [];
    for (const productoId of [deB.id, crypto.randomUUID(), inactivo.id]) {
      const res = await post(
        unicaObligatoria({ modificadores: [{ nombre: 'Sal' }, { nombre: 'Chicha', productoId }] }),
      );
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(campos(res)).toEqual(['modificadores.1.productoId']);
      cuerpos.push(res.body);
    }
    expect(cuerpos[1]).toEqual(cuerpos[0]);
    expect(cuerpos[2]).toEqual(cuerpos[0]);
    expect(JSON.stringify(cuerpos[0])).not.toContain(deB.id);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('el producto ligado muestra dónde se usa en GET /carta/productos/:id (usadoEn.modificadores)', async () => {
    const ligable = await crearLigable();
    const grupo = await crearGrupo(
      unicaObligatoria({
        nombre: unico('Bebida'),
        modificadores: [{ nombre: 'Chicha', productoId: ligable.id }, { nombre: 'Agua' }],
      }),
    );
    const res = await get(`/carta/productos/${ligable.id}`);
    exigirEstado(res, 200, 'leer producto');
    expect(res.body.usadoEn).toEqual({
      combos: [],
      modificadores: [
        {
          id: grupo.modificadores[0]!.id,
          nombre: 'Chicha',
          grupoId: grupo.id,
          grupoNombre: grupo.nombre,
        },
      ],
    });
    // Un modificador desactivado ya no cuenta.
    exigirEstado(
      await patch(grupo.id, { modificadores: [{ nombre: 'Agua' }] }),
      200,
      'desactivar la opción',
    );
    expect((await get(`/carta/productos/${ligable.id}`)).body.usadoEn.modificadores).toEqual([]);
  });
});

describe('criterio 27 · editar un grupo', () => {
  it('reemplaza la lista: actualiza por id, crea sin id y desactiva los que no aparecen (no se borran)', async () => {
    const grupo = await crearGrupo(multiple());
    const [huevo, queso, tocino] = grupo.modificadores;
    const res = await patch(grupo.id, {
      modificadores: [
        { id: queso!.id, nombre: 'Queso', precioExtra: '2.50' },
        { nombre: 'Palta', precioExtra: '4.00' },
        { id: huevo!.id, nombre: 'Huevo frito', precioExtra: '2.50' },
      ],
    });
    exigirEstado(res, 200, 'reemplazar');
    const despues = res.body as Grupo;
    expect(despues.modificadores.map((m) => [m.nombre, m.precioExtra, m.orden])).toEqual([
      ['Queso', '2.50', 1],
      ['Palta', '4.00', 2],
      ['Huevo frito', '2.50', 3],
    ]);
    expect(despues.modificadores[0]!.id).toBe(queso!.id);
    expect(despues.modificadores[2]!.id).toBe(huevo!.id);
    // El que no aparece sigue en la base, inactivo.
    const { rows } = await admin.query('SELECT activo, nombre FROM modificador WHERE id = $1', [
      tocino!.id,
    ]);
    expect(rows[0]).toEqual({ activo: false, nombre: 'Tocino' });
  });

  it('un modificador inactivo que vuelve a la lista se reactiva; su nombre puede usarlo otro mientras tanto', async () => {
    const grupo = await crearGrupo(multiple({ maximo: 2 }));
    const [huevo, queso, tocino] = grupo.modificadores;
    exigirEstado(
      await patch(grupo.id, {
        modificadores: [
          { id: huevo!.id, nombre: 'Huevo' },
          { id: queso!.id, nombre: 'Queso' },
        ],
      }),
      200,
      'quitar tocino',
    );
    // Otro modificador nuevo con el nombre del inactivo: el único es solo entre los activos.
    const reuso = await patch(grupo.id, {
      modificadores: [
        { id: huevo!.id, nombre: 'Huevo' },
        { nombre: 'Tocino', precioExtra: '1.00' },
      ],
    });
    exigirEstado(reuso, 200, 'reusar nombre');
    // Ahora el inactivo original vuelve con otro nombre.
    const vuelve = await patch(grupo.id, {
      modificadores: [
        { id: huevo!.id, nombre: 'Huevo' },
        { id: tocino!.id, nombre: 'Tocino ahumado', precioExtra: '3.50' },
      ],
    });
    exigirEstado(vuelve, 200, 'reactivar');
    expect(
      (vuelve.body as Grupo).modificadores.map((m) => [m.id, m.nombre, m.precioExtra]),
    ).toEqual([
      // Cada elemento de la lista es el modificador completo: sin `precioExtra` vale "0.00".
      [huevo!.id, 'Huevo', '0.00'],
      [tocino!.id, 'Tocino ahumado', '3.50'],
    ]);
  });

  it('se pueden intercambiar los nombres de dos modificadores en un solo PATCH', async () => {
    const grupo = await crearGrupo(
      unicaObligatoria({ modificadores: [{ nombre: 'A' }, { nombre: 'B' }] }),
    );
    const [a, b] = grupo.modificadores;
    const res = await patch(grupo.id, {
      modificadores: [
        { id: a!.id, nombre: 'B' },
        { id: b!.id, nombre: 'A' },
      ],
    });
    exigirEstado(res, 200, 'intercambiar');
    expect((res.body as Grupo).modificadores.map((m) => [m.id, m.nombre])).toEqual([
      [a!.id, 'B'],
      [b!.id, 'A'],
    ]);
  });

  it('un id que no es de este grupo (de otro grupo, de B o inexistente) responde 422 con el mismo cuerpo', async () => {
    const grupo = await crearGrupo(unicaObligatoria());
    const otro = await crearGrupo(unicaObligatoria());
    const grupoB = await crearGrupo(unicaObligatoria(), tokenB);
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const cuerpos: unknown[] = [];
    for (const id of [
      otro.modificadores[0]!.id,
      grupoB.modificadores[0]!.id,
      crypto.randomUUID(),
    ]) {
      const res = await patch(grupo.id, {
        modificadores: [{ nombre: 'Sal' }, { id, nombre: 'Pimienta' }],
      });
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(campos(res)).toEqual(['modificadores.1.id']);
      cuerpos.push(res.body);
    }
    expect(cuerpos[1]).toEqual(cuerpos[0]);
    expect(cuerpos[2]).toEqual(cuerpos[0]);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un modificador cuyo producto ligado se desactivó conserva el vínculo, pero no se puede reactivar ni volver a ligar', async () => {
    const ligable = await crearLigable();
    const grupo = await crearGrupo(
      unicaObligatoria({
        modificadores: [{ nombre: 'Chicha', productoId: ligable.id }, { nombre: 'Agua' }],
      }),
    );
    const [chicha, agua] = grupo.modificadores;
    // Con el producto ligado inactivo, el grupo se puede seguir editando mientras la lista conserve el vínculo.
    exigirEstado(await patchProducto(ligable.id, { activo: false }), 200, 'desactivar producto');
    exigirEstado(
      await patch(grupo.id, {
        modificadores: [
          { id: chicha!.id, nombre: 'Chicha', precioExtra: '1.00', productoId: ligable.id },
          { id: agua!.id, nombre: 'Agua' },
        ],
      }),
      200,
      'editar con el vínculo conservado',
    );
    // Quitar el modificador y volver a ofrecerlo con el producto inactivo: 422.
    exigirEstado(
      await patch(grupo.id, { modificadores: [{ id: agua!.id, nombre: 'Agua' }] }),
      200,
      'quitar',
    );
    const vuelve = await patch(grupo.id, {
      modificadores: [
        { id: chicha!.id, nombre: 'Chicha', productoId: ligable.id },
        { id: agua!.id, nombre: 'Agua' },
      ],
    });
    esperarError(vuelve, 422, 'REFERENCIA_INVALIDA');
    expect(campos(vuelve)).toEqual(['modificadores.0.productoId']);
    // Sin el vínculo sí vuelve.
    exigirEstado(
      await patch(grupo.id, {
        modificadores: [
          { id: chicha!.id, nombre: 'Chicha' },
          { id: agua!.id, nombre: 'Agua' },
        ],
      }),
      200,
      'reactivar sin vínculo',
    );
  });

  it('reactivar un grupo vuelve a validar el producto ligado de sus modificadores activos', async () => {
    const ligable = await crearLigable();
    const grupo = await crearGrupo(
      unicaObligatoria({
        modificadores: [{ nombre: 'Chicha', productoId: ligable.id }, { nombre: 'Agua' }],
      }),
    );
    exigirEstado(await patch(grupo.id, { activo: false }), 200, 'desactivar');
    exigirEstado(await patchProducto(ligable.id, { activo: false }), 200, 'desactivar producto');
    const reactivar = await patch(grupo.id, { activo: true });
    esperarError(reactivar, 422, 'REFERENCIA_INVALIDA');
    expect((await leer(grupo.id)).activo).toBe(false);
    exigirEstado(await patchProducto(ligable.id, { activo: true }), 200, 'reactivar producto');
    exigirEstado(await patch(grupo.id, { activo: true }), 200, 'reactivar');
    expect((await leer(grupo.id)).activo).toBe(true);
  });

  it('un PATCH puede cambiar el nombre, la selección, el mínimo y el máximo; las reglas se comprueban sobre el resultado', async () => {
    const grupo = await crearGrupo(multiple({ minimo: 2, maximo: 2 }));
    const nombre = unico('Complementos');
    const renombrado = await patch(grupo.id, { nombre });
    exigirEstado(renombrado, 200, 'renombrar');
    expect(renombrado.body).toMatchObject({ nombre, minimo: 2, maximo: 2 });

    // Solo el máximo: el mínimo guardado se conserva.
    expect((await patch(grupo.id, { maximo: 3 })).body).toMatchObject({ minimo: 2, maximo: 3 });
    // Un mínimo mayor que el máximo guardado, o que la cantidad de modificadores: 400.
    esperarError(await patch(grupo.id, { minimo: 4 }), 400, 'DATOS_INVALIDOS');
    esperarError(await patch(grupo.id, { maximo: 1, minimo: 2 }), 400, 'DATOS_INVALIDOS');
    // Reducir la lista por debajo del mínimo guardado: 400.
    const reducida = await patch(grupo.id, { modificadores: [{ nombre: 'Huevo' }] });
    esperarError(reducida, 400, 'DATOS_INVALIDOS');
    expect(campos(reducida)).toContain('minimo');
    // Obligatorio solo vale en la selección única; mínimo y máximo, en la múltiple.
    esperarError(await patch(grupo.id, { obligatorio: false }), 400, 'DATOS_INVALIDOS');

    // De múltiple a única (obligatorio), y de vuelta.
    const unica = await patch(grupo.id, { seleccion: 'UNICA', obligatorio: false });
    expect(unica.body).toMatchObject({
      seleccion: 'UNICA',
      minimo: 0,
      maximo: 1,
      obligatorio: false,
    });
    esperarError(await patch(grupo.id, { minimo: 1 }), 400, 'DATOS_INVALIDOS');
    expect((await patch(grupo.id, { obligatorio: true })).body).toMatchObject({
      minimo: 1,
      maximo: 1,
    });
    const multipleOtraVez = await patch(grupo.id, { seleccion: 'MULTIPLE', minimo: 0, maximo: 3 });
    expect(multipleOtraVez.body).toMatchObject({ seleccion: 'MULTIPLE', minimo: 0, maximo: 3 });
    // Un grupo con nombre repetido: 409.
    const otro = await crearGrupo(unicaObligatoria());
    esperarError(await patch(otro.id, { nombre: nombre.toLowerCase() }), 409, 'CONFLICTO');
  });

  it('un PATCH vacío o con un campo desconocido responde 400 y no cambia nada', async () => {
    const grupo = await crearGrupo(unicaObligatoria());
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const cuerpo of [
      {},
      { desconocido: 1 },
      { empresaId: e.B.empresaId },
      { seleccion: 'UNICA' },
      { seleccion: 'MULTIPLE', minimo: 0 },
      { modificadores: [] },
    ]) {
      esperarError(await patch(grupo.id, cuerpo), 400, 'DATOS_INVALIDOS');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un PATCH que no cambia nada responde 200 sin auditoría ni evento ni escrituras', async () => {
    const grupo = await crearGrupo(multiple());
    const [huevo, queso, tocino] = grupo.modificadores;
    await asentar();
    ctx.publicador.limpiar();
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const filas = () =>
      auditoriaCarta(admin, e.A.empresaId, {
        accion: 'modificar_grupo_modificadores',
        entidadId: grupo.id,
      });
    const res = await patch(grupo.id, {
      nombre: grupo.nombre,
      minimo: 0,
      maximo: 2,
      modificadores: [
        { id: huevo!.id, nombre: 'Huevo', precioExtra: '2.5' },
        { id: queso!.id, nombre: 'Queso', precioExtra: '2.00' },
        { id: tocino!.id, nombre: 'Tocino', precioExtra: '3' },
      ],
    });
    exigirEstado(res, 200, 'sin cambios');
    expect(res.body).toEqual(grupo);
    await asentar();
    expect(await filas()).toHaveLength(0);
    expect(ctx.publicador.eventos()).toEqual([]);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un grupo de B o inexistente responde 404 con el mismo cuerpo, en GET y en PATCH, sin cambiar nada de B', async () => {
    const deB = await crearGrupo(unicaObligatoria(), tokenB);
    const antesB = await instantaneaCarta(admin, e.B.empresaId);
    const inexistente = crypto.randomUUID();
    for (const [metodo, cuerpo] of [
      ['get', undefined],
      ['patch', { nombre: 'Robado' }],
    ] as const) {
      const a = await llamar(ctx, tokenA, { metodo, ruta: `${RUTA}/${deB.id}`, cuerpo });
      const b = await llamar(ctx, tokenA, { metodo, ruta: `${RUTA}/${inexistente}`, cuerpo });
      esperarError(a, 404, 'NO_ENCONTRADO');
      expect(a.body).toEqual(b.body);
    }
    expect(await instantaneaCarta(admin, e.B.empresaId)).toEqual(antesB);
  });
});

describe('criterios 28 y 29 · asignar a productos, desactivar y listar', () => {
  it('un producto se crea con grupos en su orden y los muestra; el grupo lista los productos que lo usan', async () => {
    const g1 = await crearGrupo(unicaObligatoria());
    const g2 = await crearGrupo(multiple());
    const g3 = await crearGrupo(unicaObligatoria({ obligatorio: false }));
    const res = await llamar(ctx, tokenA, {
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimple(base, { gruposModificadores: [g3.id, g1.id, g2.id] }),
    });
    exigirEstado(res, 201, 'crear con grupos');
    expect(res.body.grupos).toEqual([
      { id: g3.id, nombre: g3.nombre },
      { id: g1.id, nombre: g1.nombre },
      { id: g2.id, nombre: g2.nombre },
    ]);
    const auditoria = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'crear_producto',
      entidadId: res.body.id,
    });
    expect(auditoria[0]!.detalle).toMatchObject({ gruposModificadores: [g3.id, g1.id, g2.id] });
    for (const g of [g1, g2, g3]) {
      expect((await leer(g.id)).productos).toEqual([{ id: res.body.id, nombre: res.body.nombre }]);
    }
  });

  it('PATCH reemplaza la lista de grupos del producto (orden, quitar, agregar) y audita el antes y el después', async () => {
    const g1 = await crearGrupo(unicaObligatoria());
    const g2 = await crearGrupo(multiple());
    const g3 = await crearGrupo(unicaObligatoria());
    const p = await crearSimple({ gruposModificadores: [g1.id, g2.id] });
    const res = await patchProducto(p.id, { gruposModificadores: [g3.id, g2.id] });
    exigirEstado(res, 200, 'reemplazar grupos');
    expect(res.body.grupos.map((g: { id: string }) => g.id)).toEqual([g3.id, g2.id]);
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'modificar_producto',
      entidadId: p.id,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toEqual({
      gruposModificadores: { antes: [g1.id, g2.id], despues: [g3.id, g2.id] },
    });
    // Solo reordenar también es un cambio.
    const orden = await patchProducto(p.id, { gruposModificadores: [g2.id, g3.id] });
    expect(orden.body.grupos.map((g: { id: string }) => g.id)).toEqual([g2.id, g3.id]);
    expect(await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).toHaveLength(3);
    // Quitarlos todos.
    const vacio = await patchProducto(p.id, { gruposModificadores: [] });
    expect(vacio.body.grupos).toEqual([]);
    expect((await leer(g2.id)).productos).toEqual([]);
  });

  it('la misma lista de grupos no cambia nada: 200 sin auditoría ni evento', async () => {
    const g1 = await crearGrupo(unicaObligatoria());
    const g2 = await crearGrupo(multiple());
    const p = await crearSimple({ gruposModificadores: [g1.id, g2.id] });
    await asentar();
    ctx.publicador.limpiar();
    const antes = await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id });
    exigirEstado(await patchProducto(p.id, { gruposModificadores: [g1.id, g2.id] }), 200, 'igual');
    await asentar();
    expect(await auditoriaCarta(admin, e.A.empresaId, { entidadId: p.id })).toEqual(antes);
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('un grupo repetido responde 400; uno inexistente, de B o inactivo, 422 con el mismo cuerpo; y no cambia nada', async () => {
    const g = await crearGrupo(unicaObligatoria());
    const inactivo = await crearGrupo(unicaObligatoria());
    exigirEstado(await patch(inactivo.id, { activo: false }), 200, 'desactivar');
    const deB = await crearGrupo(unicaObligatoria(), tokenB);
    const p = await crearSimple({ gruposModificadores: [g.id] });
    const antes = await instantaneaCarta(admin, e.A.empresaId);

    esperarError(
      await patchProducto(p.id, { gruposModificadores: [g.id, g.id] }),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await llamar(ctx, tokenA, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: productoSimple(base, { gruposModificadores: [g.id, g.id] }),
      }),
      400,
      'DATOS_INVALIDOS',
    );
    const cuerpos: unknown[] = [];
    for (const id of [deB.id, crypto.randomUUID(), inactivo.id]) {
      const enPatch = await patchProducto(p.id, { gruposModificadores: [g.id, id] });
      esperarError(enPatch, 422, 'REFERENCIA_INVALIDA');
      expect(campos(enPatch)).toEqual(['gruposModificadores']);
      cuerpos.push(enPatch.body);
      const enPost = await llamar(ctx, tokenA, {
        metodo: 'post',
        ruta: '/carta/productos',
        cuerpo: productoSimple(base, { gruposModificadores: [id] }),
      });
      esperarError(enPost, 422, 'REFERENCIA_INVALIDA');
      expect(campos(enPost)).toEqual(['gruposModificadores']);
    }
    expect(cuerpos[1]).toEqual(cuerpos[0]);
    expect(cuerpos[2]).toEqual(cuerpos[0]);
    // Más de 10 grupos: 400.
    const once = Array.from({ length: 11 }, () => crypto.randomUUID());
    esperarError(await patchProducto(p.id, { gruposModificadores: once }), 400, 'DATOS_INVALIDOS');
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('desactivar un grupo que usan productos activos responde 409 EN_USO; sin productos activos lo desactiva', async () => {
    const g = await crearGrupo(unicaObligatoria());
    const p1 = await crearSimple({ gruposModificadores: [g.id] });
    const p2 = await crearSimple({ gruposModificadores: [g.id] });
    const uso = await patch(g.id, { activo: false });
    esperarError(uso, 409, 'EN_USO');
    expect(uso.body.mensaje).toContain('2 productos');
    expect((await leer(g.id)).activo).toBe(true);

    exigirEstado(await patchProducto(p1.id, { activo: false }), 200, 'desactivar p1');
    esperarError(await patch(g.id, { activo: false }), 409, 'EN_USO');
    // Quitarle el grupo al último producto activo libera el grupo.
    exigirEstado(await patchProducto(p2.id, { gruposModificadores: [] }), 200, 'quitar de p2');
    const res = await patch(g.id, { activo: false });
    exigirEstado(res, 200, 'desactivar');
    expect(res.body.activo).toBe(false);
    // Un grupo inactivo no se puede asignar (422), pero el producto inactivo que lo tenía lo conserva.
    esperarError(
      await patchProducto(p2.id, { gruposModificadores: [g.id] }),
      422,
      'REFERENCIA_INVALIDA',
    );
    esperarError(await patchProducto(p1.id, { activo: true }), 422, 'REFERENCIA_INVALIDA');
    exigirEstado(
      await patchProducto(p1.id, { activo: true, gruposModificadores: [] }),
      200,
      'reactivar quitando el grupo',
    );
    // Reactivar el grupo lo deja asignable otra vez.
    exigirEstado(await patch(g.id, { activo: true }), 200, 'reactivar grupo');
    exigirEstado(await patchProducto(p2.id, { gruposModificadores: [g.id] }), 200, 'asignar');
  });

  it('un cambio en el grupo vale para todos los productos que lo usan desde la siguiente lectura', async () => {
    const g = await crearGrupo(multiple());
    const p1 = await crearSimple({ gruposModificadores: [g.id] });
    const p2 = await crearSimple({ gruposModificadores: [g.id] });
    const nuevo = unico('Adicionales');
    exigirEstado(await patch(g.id, { nombre: nuevo }), 200, 'renombrar');
    for (const p of [p1, p2]) {
      const res = await get(`/carta/productos/${p.id}`);
      expect(res.body.grupos).toEqual([{ id: g.id, nombre: nuevo }]);
    }
    const lista = await get(RUTA);
    exigirEstado(lista, 200, 'listar');
    const ids = (lista.body as Grupo[]).map((x) => x.id);
    expect(ids).toContain(g.id);
    const fila = (lista.body as Grupo[]).find((x) => x.id === g.id)!;
    expect(fila.productos.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
  });

  it('GET lista los grupos de la empresa ordenados por nombre y nunca los de B', async () => {
    const deB = await crearGrupo(unicaObligatoria({ nombre: unico('Grupo de B') }), tokenB);
    const a = await crearGrupo(unicaObligatoria({ nombre: `ZZ ${unico('último')}` }));
    const b = await crearGrupo(unicaObligatoria({ nombre: `AA ${unico('primero')}` }));
    const lista = (await get(RUTA)).body as Grupo[];
    const nombres = lista.map((g) => g.nombre);
    expect(nombres).toEqual(
      [...nombres].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())),
    );
    expect(lista.map((g) => g.id)).toContain(a.id);
    expect(lista.map((g) => g.id)).toContain(b.id);
    expect(lista.map((g) => g.id)).not.toContain(deB.id);
  });

  it('un grupo desactivado sale en la lista con activo false y sin sus productos inactivos', async () => {
    const g = await crearGrupo(unicaObligatoria());
    const p = await crearSimple({ gruposModificadores: [g.id] });
    exigirEstado(await patchProducto(p.id, { activo: false }), 200, 'desactivar producto');
    const leido = await leer(g.id);
    expect(leido.productos).toEqual([]);
    exigirEstado(await patch(g.id, { activo: false }), 200, 'desactivar grupo');
    const lista = (await get(RUTA)).body as Grupo[];
    expect(lista.find((x) => x.id === g.id)).toMatchObject({ activo: false });
  });
});

describe('carreras entre asignar y desactivar un grupo (criterio 29)', () => {
  it('nunca queda un producto activo con un grupo inactivo, ganen quien gane', async () => {
    const resultados: string[] = [];
    for (let ronda = 0; ronda < 8; ronda++) {
      const g = await crearGrupo(unicaObligatoria());
      const p = await crearSimple();
      const [desactivar, asignar] = await Promise.all([
        patch(g.id, { activo: false }),
        patchProducto(p.id, { gruposModificadores: [g.id] }),
      ]);
      // Gana uno solo: o el grupo se desactiva (y la asignación es 422) o se asigna (y desactivar es 409).
      const par = `${desactivar.status}/${asignar.status}`;
      resultados.push(par);
      expect(['200/422', '409/200'], par).toContain(par);
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM producto_grupo pg
           JOIN producto pr ON pr.id = pg.producto_id
           JOIN grupo_modificadores gr ON gr.id = pg.grupo_id
          WHERE pg.grupo_id = $1 AND pr.activo AND NOT gr.activo`,
        [g.id],
      );
      expect(rows[0].n).toBe(0);
    }
  });
});

describe('auditoría y eventos (criterios 54 y 62)', () => {
  it('crear deja una fila con los modificadores y un solo carta.actualizada de empresa', async () => {
    await asentar();
    ctx.publicador.limpiar();
    const antes = new Set((await auditoriaCarta(admin, e.A.empresaId)).map((f) => f.id));
    const grupo = await crearGrupo(multiple());
    await asentar();
    const nuevas = (await auditoriaCarta(admin, e.A.empresaId)).filter((f) => !antes.has(f.id));
    const fila = unaFila(nuevas, {
      accion: 'crear_grupo_modificadores',
      actorUsuarioId: e.A.base.admin.id,
      entidad: 'grupo_modificadores',
      entidadId: grupo.id,
    });
    expect(fila.detalle).toMatchObject({
      nombre: grupo.nombre,
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      modificadores: [
        { nombre: 'Huevo', precioExtra: '2.50', productoId: null },
        { nombre: 'Queso', precioExtra: '2.00', productoId: null },
        { nombre: 'Tocino', precioExtra: '3.00', productoId: null },
      ],
    });
    expect(ctx.publicador.eventos()).toEqual([
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'empresa' },
        nombre: 'carta.actualizada',
        datos: { sucursalId: null },
      },
    ]);
  });

  it('modificar deja una sola fila con lo creado, lo cambiado (antes y después de cada campo) y lo desactivado', async () => {
    const ligable = await crearLigable();
    const grupo = await crearGrupo(multiple());
    const [huevo, queso, tocino] = grupo.modificadores;
    await asentar();
    ctx.publicador.limpiar();
    const antes = new Set((await auditoriaCarta(admin, e.A.empresaId)).map((f) => f.id));
    const res = await patch(grupo.id, {
      nombre: unico('Extras 2'),
      maximo: 3,
      modificadores: [
        { id: huevo!.id, nombre: 'Huevo', precioExtra: '2.80', productoId: ligable.id },
        { id: queso!.id, nombre: 'Queso', precioExtra: '2.00' },
        { nombre: 'Palta', precioExtra: '4.00' },
      ],
    });
    exigirEstado(res, 200, 'modificar');
    await asentar();
    const nuevas = (await auditoriaCarta(admin, e.A.empresaId)).filter((f) => !antes.has(f.id));
    const fila = unaFila(nuevas, {
      accion: 'modificar_grupo_modificadores',
      actorUsuarioId: e.A.base.admin.id,
      entidad: 'grupo_modificadores',
      entidadId: grupo.id,
    });
    expect(fila.detalle).toEqual({
      nombre: { antes: grupo.nombre, despues: (res.body as Grupo).nombre },
      maximo: { antes: 2, despues: 3 },
      modificadores: {
        creados: [{ nombre: 'Palta', precioExtra: '4.00', productoId: null }],
        cambiados: [
          {
            id: huevo!.id,
            nombre: 'Huevo',
            precioExtra: { antes: '2.50', despues: '2.80' },
            productoId: { antes: null, despues: ligable.id },
          },
        ],
        desactivados: [{ id: tocino!.id, nombre: 'Tocino', precioExtra: '3.00' }],
      },
    });
    expect(ctx.publicador.eventos()).toHaveLength(1);
    expect(ctx.publicador.eventos()[0]).toMatchObject({
      empresaId: e.A.empresaId,
      sala: { tipo: 'empresa' },
      nombre: 'carta.actualizada',
    });
  });

  it('cambiar solo el orden o solo quitar uno no ensucia la auditoría con renumeraciones', async () => {
    const grupo = await crearGrupo(multiple());
    const [huevo, queso, tocino] = grupo.modificadores;
    const quitar = await patch(grupo.id, {
      modificadores: [
        { id: queso!.id, nombre: 'Queso', precioExtra: '2.00' },
        { id: tocino!.id, nombre: 'Tocino', precioExtra: '3.00' },
      ],
    });
    exigirEstado(quitar, 200, 'quitar el primero');
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'modificar_grupo_modificadores',
      entidadId: grupo.id,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toEqual({
      modificadores: {
        creados: [],
        cambiados: [],
        desactivados: [{ id: huevo!.id, nombre: 'Huevo', precioExtra: '2.50' }],
      },
    });
    const reordenar = await patch(grupo.id, {
      modificadores: [
        { id: tocino!.id, nombre: 'Tocino', precioExtra: '3.00' },
        { id: queso!.id, nombre: 'Queso', precioExtra: '2.00' },
      ],
    });
    expect((reordenar.body as Grupo).modificadores.map((m) => m.id)).toEqual([
      tocino!.id,
      queso!.id,
    ]);
    const despues = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'modificar_grupo_modificadores',
      entidadId: grupo.id,
    });
    expect(despues).toHaveLength(2);
    // El reloj de la prueba no avanza: las filas no tienen un orden estable por hora.
    const delOrden = despues.find(
      (f) => 'modificadores' in (f.detalle ?? {}) && JSON.stringify(f.detalle).includes('"orden"'),
    );
    expect(delOrden?.detalle).toEqual({
      modificadores: {
        creados: [],
        cambiados: [],
        desactivados: [],
        orden: { antes: [queso!.id, tocino!.id], despues: [tocino!.id, queso!.id] },
      },
    });
  });

  it('un rechazo (400, 404, 409, 422) no deja auditoría ni eventos', async () => {
    const grupo = await crearGrupo(unicaObligatoria());
    const p = await crearSimple({ gruposModificadores: [grupo.id] });
    await asentar();
    ctx.publicador.limpiar();
    const antes = (await auditoriaCarta(admin, e.A.empresaId)).length;
    esperarError(await patch(grupo.id, { activo: false }), 409, 'EN_USO');
    esperarError(await patch(grupo.id, { nombre: '' }), 400, 'DATOS_INVALIDOS');
    esperarError(await patch(crypto.randomUUID(), { nombre: 'x' }), 404, 'NO_ENCONTRADO');
    esperarError(
      await patch(grupo.id, { modificadores: [{ id: crypto.randomUUID(), nombre: 'x' }] }),
      422,
      'REFERENCIA_INVALIDA',
    );
    esperarError(
      await patchProducto(p.id, { gruposModificadores: [crypto.randomUUID()] }),
      422,
      'REFERENCIA_INVALIDA',
    );
    await asentar();
    expect((await auditoriaCarta(admin, e.A.empresaId)).length).toBe(antes);
    expect(ctx.publicador.eventos()).toEqual([]);
  });
});
