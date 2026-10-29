// Historia 004 · salón y cocina, grupo C1 · aislamiento de `zona` y `mesa` en la base (criterios 82 a 84 para las
// dos tablas del mapa): pruebas del desarrollador (no protegidas). Las pruebas protegidas de `salon-critica/`
// recorren las once tablas de 3a juntas y quedan en rojo hasta que existan las de pedidos; estas dos tablas ya
// existen, así que se prueban aquí con la misma forma: lectura, actualización, borrado, inserción y llaves
// compuestas entre empresas, con el actor de A fijado y el rechazo de la política RLS (no el de "contexto de
// actor ausente").
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import { arrancarMapa, mesaCreada, zonaCreada, type EntornoMapa } from './ayudas-mapa';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let e: EntornoMapa;
let admin: Client;
let api: Client;
let idsA: { zona: string; mesa: string; sucursal: string };
let idsB: { zona: string; mesa: string; sucursal: string };

beforeAll(async () => {
  e = await arrancarMapa();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  const sembrar = async (token: string, sucursal: string) => {
    const zona = await zonaCreada(e.app, token, sucursal, { nombre: 'Salón principal' });
    const mesa = await mesaCreada(e.app, token, sucursal, zona.id, { nombre: 'Mesa 1' });
    return { zona: zona.id as string, mesa: mesa.id as string, sucursal };
  };
  idsA = await sembrar(e.admin, e.A.sucursales[0]!.id);
  idsB = await sembrar(e.adminB, e.B.sucursales[0]!.id);
}, 120_000);

afterAll(async () => {
  await e?.entorno.cerrar();
  await admin?.end();
  await api?.end();
});

const comoApi = <T>(empresaId: string, fn: () => Promise<T>) => enTransaccion(api, empresaId, fn);
const TABLAS = ['zona', 'mesa'] as const;

describe.each(TABLAS)('criterio 83 · %s', (tabla) => {
  const propios = (ids: typeof idsA) => (tabla === 'zona' ? ids.zona : ids.mesa);

  it('lectura: con el contexto de A no se ven filas de B, ni por id ni sin WHERE', async () => {
    await comoApi(e.A.id, async () => {
      const todas = await api.query<{ id: string; empresa_id: string }>(
        `SELECT id, empresa_id FROM ${tabla}`,
      );
      expect(todas.rows.length).toBeGreaterThan(0);
      expect(todas.rows.every((f) => f.empresa_id === e.A.id)).toBe(true);
      const deB = await api.query(`SELECT id FROM ${tabla} WHERE id = $1`, [propios(idsB)]);
      expect(deB.rows).toEqual([]);
    });
    await comoApi(e.B.id, async () => {
      const propias = await api.query(`SELECT id FROM ${tabla} WHERE id = $1`, [propios(idsB)]);
      expect(propias.rows).toHaveLength(1);
    });
  });

  it('actualización: el UPDATE no toca filas de B y cambiar el dueño a B falla por la política', async () => {
    const antes = (
      await admin.query(`SELECT to_jsonb(t) AS f FROM ${tabla} t WHERE id = $1`, [propios(idsB)])
    ).rows;
    await comoApi(e.A.id, async () => {
      const porId = await api.query(
        `UPDATE ${tabla} SET empresa_id = empresa_id WHERE id = $1 RETURNING id`,
        [propios(idsB)],
      );
      expect(porId.rowCount).toBe(0);
      await api.query('SAVEPOINT dueno');
      const cambio = await errorDe(
        api.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [e.B.id, propios(idsA)]),
      );
      expect(cambio.code, cambio.message).toBe('42501');
      expect(cambio.message).toMatch(/row-level security/);
      await api.query('ROLLBACK TO SAVEPOINT dueno');
    });
    const despues = (
      await admin.query(`SELECT to_jsonb(t) AS f FROM ${tabla} t WHERE id = $1`, [propios(idsB)])
    ).rows;
    expect(despues).toEqual(antes);
  });

  it('borrado: la API no tiene DELETE (nada se borra, se desactiva)', async () => {
    await comoApi(e.A.id, async () => {
      const error = await errorDe(api.query(`DELETE FROM ${tabla} WHERE id = $1`, [propios(idsA)]));
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/permission denied/i);
    });
  });

  it('inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado)', async () => {
    await comoApi(e.A.id, async () => {
      const error = await errorDe(
        api.query(
          `INSERT INTO ${tabla}
             SELECT (jsonb_populate_record(NULL::${tabla},
                      to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
               FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`,
          [e.B.id, e.A.id],
        ),
      );
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/row-level security/);
      expect(error.message).not.toMatch(/contexto de actor ausente/);
    });
  });
});

describe('criterio 84 · referencias entre empresas en zona y mesa', () => {
  /** Copia una fila de A con otro id y otras claves únicas, cambiando una columna. */
  const copia = (tabla: 'zona' | 'mesa', cambios: Record<string, unknown>) =>
    api.query(
      `INSERT INTO ${tabla}
         SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
           FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`,
      [JSON.stringify({ id: randomUUID(), ...cambios }), e.A.id],
    );
  const unico = () => `Copia ${randomUUID().slice(0, 8)}`;

  const casos: {
    nombre: string;
    tabla: 'zona' | 'mesa';
    columna: string;
    deB: () => string;
    extra?: () => Record<string, unknown>;
  }[] = [
    {
      nombre: 'zona.sucursal_id',
      tabla: 'zona',
      columna: 'sucursal_id',
      deB: () => idsB.sucursal,
      extra: () => ({ nombre: unico() }),
    },
    {
      nombre: 'mesa.zona_id',
      tabla: 'mesa',
      columna: 'zona_id',
      deB: () => idsB.zona,
      extra: () => ({ nombre: unico(), columna: 3, fila: 2 }),
    },
    {
      nombre: 'mesa.sucursal_id',
      tabla: 'mesa',
      columna: 'sucursal_id',
      deB: () => idsB.sucursal,
      extra: () => ({ nombre: unico(), columna: 3, fila: 2 }),
    },
  ];

  it.each(casos)(
    '$nombre: apuntar a B falla por la llave foránea igual que un id inexistente',
    async ({ tabla, columna, deB, extra }) => {
      const control = await comoApi(e.A.id, () => copia(tabla, extra!()));
      expect(control.rowCount, 'control: la copia sin la referencia cruzada se inserta').toBe(1);
      const cruzada = await comoApi(e.A.id, () =>
        errorDe(copia(tabla, { ...extra!(), [columna]: deB() })),
      );
      const inexistente = await comoApi(e.A.id, () =>
        errorDe(copia(tabla, { ...extra!(), [columna]: randomUUID() })),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint).toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
    },
  );

  it('una zona de otra sucursal de la misma empresa tampoco vale para la mesa', async () => {
    const otra = await zonaCreada(e.app, e.admin, e.A.sucursales[1]!.id);
    const error = await comoApi(e.A.id, () =>
      errorDe(copia('mesa', { nombre: unico(), columna: 3, fila: 2, zona_id: otra.id })),
    );
    expect(error.code, error.message).toBe('23503');
    expect(error.constraint).toBe('mesa_zona_fk');
  });
});

describe('índices únicos y trazabilidad', () => {
  it('los únicos de nombre y de celda llevan empresa_id primero', async () => {
    const r = await admin.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('zona', 'mesa') AND indexdef LIKE 'CREATE UNIQUE%'`,
    );
    const porNombre = new Map(r.rows.map((f) => [f.indexname, f.indexdef]));
    for (const nombre of [
      'zona_nombre_unico',
      'mesa_nombre_activa_unico',
      'mesa_celda_activa_unica',
    ]) {
      expect(porNombre.get(nombre), nombre).toMatch(/\(empresa_id, /);
    }
    expect(porNombre.get('mesa_celda_activa_unica')).toMatch(/WHERE activa/);
  });

  it('cada fila trae quién la creó (trazabilidad) y la API no puede dejar el autor en blanco', async () => {
    const fila = (
      await admin.query<{ creado_por_usuario_id: string | null }>(
        'SELECT creado_por_usuario_id FROM mesa WHERE id = $1',
        [idsA.mesa],
      )
    ).rows[0]!;
    expect(fila.creado_por_usuario_id).toBe(e.A.admin.id);
    await api.query('BEGIN');
    try {
      await api.query('SELECT fijar_contexto_empresa($1)', [e.A.id]);
      const error = await errorDe(
        api.query('UPDATE mesa SET capacidad = capacidad WHERE id = $1', [idsA.mesa]),
      );
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/actor/i);
    } finally {
      await api.query('ROLLBACK');
    }
  });
});
