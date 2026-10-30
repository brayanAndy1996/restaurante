// Historia 004 · entrega 3b, grupo C7 (T37) · las tres tablas de esta migración (`impresora`, `estacion_destino` e
// `impresion_sucursal`) en la base (criterios 82 a 84 y 131): pruebas del desarrollador (no protegidas). Las
// protegidas de `impresion-critica/` recorren las seis tablas de 3b juntas y no pueden sembrar hasta que existan
// las del puente (T40); estas tres ya existen, así que se prueban aquí con la misma forma: lectura, actualización,
// borrado e inserción entre empresas con el actor fijado y el rechazo de la política RLS, y las llaves compuestas.
// Además prueban lo propio de esta migración: los `CHECK` de la conexión y del destino, los únicos que empiezan
// por `empresa_id` y que la impresora de un destino o de la caja sea de la misma sucursal.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import {
  arrancarP2,
  exigirEstado,
  llamar,
  prepararEscenarioP2,
  type AppP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { abrirCliente } from '../utilidades';
import { impresoraCreada, cuerpoRed, rutaDestino, rutaImpresion } from './ayudas-impresion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

interface Ids {
  empresaId: string;
  sucursal1: string;
  sucursal2: string;
  estacion1: string;
  estacion2: string;
  impresora: string;
  impresoraS2: string;
  destino: string;
  caja: string;
}

let ctx: AppP2;
let admin: Client;
let api: Client;
let esc: EscenarioP2;
let A: Ids;
let B: Ids;

/** Siembra por las rutas: dos impresoras (S1 y S2), el destino de Cocina y la impresora de caja de S1. */
async function sembrar(
  token: string,
  empresaId: string,
  s1: string,
  s2: string,
  cocina: string,
  barra: string,
) {
  const impresora = await impresoraCreada(ctx, token, s1, cuerpoRed());
  const impresoraS2 = await impresoraCreada(ctx, token, s2, cuerpoRed());
  exigirEstado(
    await llamar(ctx, token, {
      metodo: 'put',
      ruta: rutaDestino(s1, cocina),
      cuerpo: { destino: 'IMPRESORA', impresoraId: impresora.id },
    }),
    200,
    'destino',
  );
  exigirEstado(
    await llamar(ctx, token, {
      metodo: 'put',
      ruta: rutaImpresion(s1),
      cuerpo: { impresoraCajaId: impresora.id },
    }),
    200,
    'caja',
  );
  const destino = (
    await admin.query('SELECT id FROM estacion_destino WHERE empresa_id = $1', [empresaId])
  ).rows[0].id as string;
  const caja = (
    await admin.query('SELECT id FROM impresion_sucursal WHERE empresa_id = $1', [empresaId])
  ).rows[0].id as string;
  return {
    empresaId,
    sucursal1: s1,
    sucursal2: s2,
    estacion1: cocina,
    estacion2: barra,
    impresora: impresora.id,
    impresoraS2: impresoraS2.id,
    destino,
    caja,
  } satisfies Ids;
}

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  esc = await prepararEscenarioP2(ctx);
  A = await sembrar(
    esc.token.adminA,
    esc.e.A.empresaId,
    esc.e.A.S1,
    esc.e.A.S2,
    esc.carta.cocinaId,
    esc.carta.barraId,
  );
  B = await sembrar(
    esc.e.B.tokenAdmin,
    esc.e.B.empresaId,
    esc.e.B.S1,
    esc.e.B.S2,
    esc.cartaB.cocinaId,
    esc.cartaB.barraId,
  );
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

const comoApi = <T>(empresaId: string, fn: () => Promise<T>) => enTransaccion(api, empresaId, fn);
const TABLAS = ['impresora', 'estacion_destino', 'impresion_sucursal'] as const;
type Tabla = (typeof TABLAS)[number];

const idsDe = async (tabla: Tabla, empresaId: string): Promise<string[]> =>
  (
    await admin.query<{ id: string }>(`SELECT id FROM ${tabla} WHERE empresa_id = $1 ORDER BY id`, [
      empresaId,
    ])
  ).rows.map((f) => f.id);

const fotoDe = async (tabla: Tabla, empresaId: string) =>
  (
    await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    )
  ).rows.map((f) => f.fila);

describe.each(TABLAS)('criterios 82 y 83 · %s', (tabla) => {
  it('lectura: con el contexto de A no se ven filas de B, ni por id ni sin WHERE', async () => {
    const idsA = await idsDe(tabla, A.empresaId);
    const idsB = await idsDe(tabla, B.empresaId);
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsB.length).toBeGreaterThan(0);
    await comoApi(A.empresaId, async () => {
      const todas = await api.query<{ id: string; empresa_id: string }>(
        `SELECT id, empresa_id FROM ${tabla}`,
      );
      expect(todas.rows.map((f) => f.id).sort()).toEqual(idsA);
      const porId = await api.query(`SELECT id FROM ${tabla} WHERE id = ANY($1::uuid[])`, [idsB]);
      expect(porId.rows).toEqual([]);
    });
    await comoApi(B.empresaId, async () => {
      const propias = await api.query<{ id: string }>(`SELECT id FROM ${tabla}`);
      expect(propias.rows.map((f) => f.id).sort()).toEqual(idsB);
    });
  });

  it('actualización: el UPDATE no toca filas de B y cambiar el dueño a B falla por la política', async () => {
    const idsA = await idsDe(tabla, A.empresaId);
    const idsB = await idsDe(tabla, B.empresaId);
    const antesB = await fotoDe(tabla, B.empresaId);
    await comoApi(A.empresaId, async () => {
      const porId = await api.query(
        `UPDATE ${tabla} SET empresa_id = empresa_id WHERE id = ANY($1::uuid[]) RETURNING id`,
        [idsB],
      );
      expect(porId.rowCount).toBe(0);
      const sinWhere = await api.query<{ id: string }>(
        `UPDATE ${tabla} SET empresa_id = empresa_id RETURNING id`,
      );
      expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
      await api.query('SAVEPOINT dueno');
      const cambio = await errorDe(
        api.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [B.empresaId, idsA[0]]),
      );
      expect(cambio.code, cambio.message).toBe('42501');
      expect(cambio.message).toMatch(/row-level security/);
      await api.query('ROLLBACK TO SAVEPOINT dueno');
    });
    expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
  });

  it('borrado: la API no tiene DELETE (nada se borra) y el intento se rechaza por permisos', async () => {
    const idsA = await idsDe(tabla, A.empresaId);
    const antesB = await fotoDe(tabla, B.empresaId);
    await comoApi(A.empresaId, async () => {
      await api.query('SAVEPOINT sin_where');
      const sinWhere = await errorDe(api.query(`DELETE FROM ${tabla}`));
      expect(sinWhere.code, sinWhere.message).toBe('42501');
      expect(sinWhere.message).toMatch(/permission denied/i);
      await api.query('ROLLBACK TO SAVEPOINT sin_where');
      const porId = await errorDe(api.query(`DELETE FROM ${tabla} WHERE id = $1`, [idsA[0]]));
      expect(porId.code, porId.message).toBe('42501');
    });
    expect(await idsDe(tabla, A.empresaId)).toEqual(idsA);
    expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
  });

  it('inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado)', async () => {
    const idsAntes = await idsDe(tabla, B.empresaId);
    await comoApi(A.empresaId, async () => {
      const error = await errorDe(
        api.query(
          `INSERT INTO ${tabla}
             SELECT (jsonb_populate_record(NULL::${tabla},
                      to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
               FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`,
          [B.empresaId, A.empresaId],
        ),
      );
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/row-level security/);
      expect(error.message).not.toMatch(/contexto de actor ausente/);
    });
    expect(await idsDe(tabla, B.empresaId)).toEqual(idsAntes);
  });

  it('el privilegio de la API es solo SELECT, INSERT y UPDATE, y la tabla lleva su política y la trazabilidad', async () => {
    const privilegios = await admin.query<{ privilegio: string }>(
      `SELECT privilege_type AS privilegio FROM information_schema.role_table_grants
        WHERE table_name = $1 AND grantee = 'restaurante_api' ORDER BY 1`,
      [tabla],
    );
    expect(privilegios.rows.map((f) => f.privilegio)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    const politicas = await admin.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = $1 ORDER BY 1`,
      [tabla],
    );
    expect(politicas.rows.map((f) => f.policyname)).toEqual([
      'acceso_plataforma',
      'aislamiento_empresa',
    ]);
    const triggers = await admin.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
      [tabla],
    );
    expect(triggers.rows.map((f) => f.tgname)).toContain('trazabilidad');
    const columnas = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 AND column_name IN ('creado_por_equipo_id', 'actualizado_por_equipo_id')`,
      [tabla],
    );
    expect(columnas.rows).toHaveLength(2);
  });
});

describe('criterio 84 · llaves compuestas entre empresas', () => {
  /** Copia una fila de A con otro id y otras claves únicas, cambiando algunas columnas. */
  const copia = (tabla: Tabla, cambios: Record<string, unknown>) =>
    api.query(
      `INSERT INTO ${tabla}
         SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
           FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`,
      [JSON.stringify({ id: randomUUID(), ...cambios }), A.empresaId],
    );
  const nombre = () => `Copia ${randomUUID().slice(0, 8)}`;

  const casos: {
    nombre: string;
    tabla: Tabla;
    columna: string;
    deB: () => string;
    sinChocar: () => Record<string, unknown>;
  }[] = [
    {
      nombre: 'impresora.sucursal_id',
      tabla: 'impresora',
      columna: 'sucursal_id',
      deB: () => B.sucursal1,
      sinChocar: () => ({ nombre: nombre() }),
    },
    {
      nombre: 'estacion_destino.sucursal_id',
      tabla: 'estacion_destino',
      columna: 'sucursal_id',
      deB: () => B.sucursal1,
      sinChocar: () => ({ estacion_id: A.estacion2 }),
    },
    {
      nombre: 'estacion_destino.estacion_id',
      tabla: 'estacion_destino',
      columna: 'estacion_id',
      deB: () => B.estacion1,
      sinChocar: () => ({}),
    },
    {
      nombre: 'estacion_destino.impresora_id',
      tabla: 'estacion_destino',
      columna: 'impresora_id',
      deB: () => B.impresora,
      sinChocar: () => ({ estacion_id: A.estacion2 }),
    },
    {
      nombre: 'impresion_sucursal.sucursal_id',
      tabla: 'impresion_sucursal',
      columna: 'sucursal_id',
      deB: () => B.sucursal2,
      sinChocar: () => ({ impresora_caja_id: null }),
    },
    {
      nombre: 'impresion_sucursal.impresora_caja_id',
      tabla: 'impresion_sucursal',
      columna: 'impresora_caja_id',
      deB: () => B.impresora,
      sinChocar: () => ({ sucursal_id: A.sucursal2 }),
    },
  ];

  it.each(casos)(
    '$nombre: apuntar a B falla por la llave foránea, igual que un id inexistente',
    async (c) => {
      const control = await comoApi(A.empresaId, () => copia(c.tabla, c.sinChocar()));
      expect(control.rowCount).toBe(1);
      const cruzada = await comoApi(A.empresaId, () =>
        errorDe(copia(c.tabla, { ...c.sinChocar(), [c.columna]: c.deB() })),
      );
      const inexistente = await comoApi(A.empresaId, () =>
        errorDe(copia(c.tabla, { ...c.sinChocar(), [c.columna]: randomUUID() })),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint).toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
    },
  );

  it('el destino y la impresora de caja deben ser de la misma sucursal: la de S2 en S1 falla por la llave', async () => {
    await comoApi(A.empresaId, async () => {
      await api.query('SAVEPOINT a');
      const destino = await errorDe(
        copia('estacion_destino', { estacion_id: A.estacion2, impresora_id: A.impresoraS2 }),
      );
      expect(destino.code, destino.message).toBe('23503');
      expect(destino.constraint).toBe('estacion_destino_impresora_fk');
      await api.query('ROLLBACK TO SAVEPOINT a');
      const caja = await errorDe(
        api.query('UPDATE impresion_sucursal SET impresora_caja_id = $1 WHERE id = $2', [
          A.impresoraS2,
          A.caja,
        ]),
      );
      expect(caja.code, caja.message).toBe('23503');
      expect(caja.constraint).toBe('impresion_sucursal_caja_fk');
    });
  });
});

describe('únicos y CHECK de esta migración', () => {
  const copia = (tabla: Tabla, cambios: Record<string, unknown>, empresaId = A.empresaId) =>
    api.query(
      `INSERT INTO ${tabla}
         SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
           FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`,
      [JSON.stringify({ id: randomUUID(), ...cambios }), empresaId],
    );
  const nombreDe = async (id: string) =>
    (await admin.query<{ nombre: string }>('SELECT nombre FROM impresora WHERE id = $1', [id]))
      .rows[0]!.nombre;

  it('los índices únicos de las tres tablas empiezan por empresa_id', async () => {
    const { rows } = await admin.query<{ indice: string; definicion: string }>(
      `SELECT indexname AS indice, indexdef AS definicion FROM pg_indexes
        WHERE indexname IN ('impresora_nombre_unico', 'estacion_destino_unico', 'impresion_sucursal_unico')`,
    );
    expect(rows.map((f) => f.indice).sort()).toEqual([
      'estacion_destino_unico',
      'impresion_sucursal_unico',
      'impresora_nombre_unico',
    ]);
    for (const f of rows) {
      expect(/\(empresa_id, /.test(f.definicion), f.definicion).toBe(true);
    }
  });

  it('el nombre de la impresora es único en la sucursal sin mayúsculas, y vale en otra sucursal y en otra empresa', async () => {
    const nombre = await nombreDe(A.impresora);
    const repetido = await comoApi(A.empresaId, () =>
      errorDe(copia('impresora', { nombre: nombre.toUpperCase() })),
    );
    expect(repetido.code, repetido.message).toBe('23505');
    expect(repetido.constraint).toBe('impresora_nombre_unico');
    const enOtraSucursal = await comoApi(A.empresaId, () =>
      copia('impresora', { nombre: nombre.toUpperCase(), sucursal_id: A.sucursal2 }),
    );
    expect(enOtraSucursal.rowCount).toBe(1);
    const enB = await comoApi(B.empresaId, () =>
      copia('impresora', { nombre }, B.empresaId).catch((e) => e),
    );
    // La copia sale de una fila de B con el nombre de A: no choca con nada de A ni se entera de A.
    expect((enB as { rowCount?: number }).rowCount ?? 0).toBe(1);
  });

  it('una estación tiene un solo destino por sucursal, y una sola fila de impresión por sucursal', async () => {
    const destino = await comoApi(A.empresaId, () => errorDe(copia('estacion_destino', {})));
    expect(destino.code, destino.message).toBe('23505');
    expect(destino.constraint).toBe('estacion_destino_unico');
    const caja = await comoApi(A.empresaId, () => errorDe(copia('impresion_sucursal', {})));
    expect(caja.code, caja.message).toBe('23505');
    expect(caja.constraint).toBe('impresion_sucursal_unico');
  });

  it('CHECK de la conexión: de red lleva host y puerto, Bluetooth la dirección y nada de red', async () => {
    const casos: [string, Record<string, unknown>][] = [
      ['RED sin host', { host: null }],
      ['RED sin puerto', { puerto: null }],
      ['RED con dirección', { mac: 'AA:BB:CC:DD:EE:FF' }],
      [
        'BLUETOOTH sin dirección',
        { conexion_tipo: 'BLUETOOTH', host: null, puerto: null, mac: null },
      ],
      [
        'BLUETOOTH con host',
        { conexion_tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF', puerto: null },
      ],
      ['puerto fuera de rango', { puerto: 70000 }],
      [
        'dirección mal escrita',
        { conexion_tipo: 'BLUETOOTH', host: null, puerto: null, mac: 'aa:bb' },
      ],
      ['ancho de 70 mm', { ancho_mm: 70 }],
      ['juego de caracteres desconocido', { juego_caracteres: 'LATIN1' }],
      ['tipo desconocido', { conexion_tipo: 'USB' }],
    ];
    for (const [descripcion, cambios] of casos) {
      const error = await comoApi(A.empresaId, () =>
        errorDe(copia('impresora', { nombre: nombreUnico(), ...cambios })),
      );
      expect(error.code, `${descripcion}: ${error.message}`).toBe('23514');
    }
  });

  it('CHECK del destino: IMPRESORA exige su impresora y KDS no puede llevarla', async () => {
    for (const cambios of [
      { estacion_id: A.estacion2, destino: 'IMPRESORA', impresora_id: null },
      { estacion_id: A.estacion2, destino: 'KDS' },
      { estacion_id: A.estacion2, destino: 'PANTALLA', impresora_id: null },
    ]) {
      const error = await comoApi(A.empresaId, () => errorDe(copia('estacion_destino', cambios)));
      expect(error.code, `${JSON.stringify(cambios)}: ${error.message}`).toBe('23514');
    }
    const kds = await comoApi(A.empresaId, () =>
      copia('estacion_destino', { estacion_id: A.estacion2, destino: 'KDS', impresora_id: null }),
    );
    expect(kds.rowCount).toBe(1);
  });
});

const nombreUnico = () => `Impresora ${randomUUID().slice(0, 8)}`;
