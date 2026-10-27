// spec: 001-base-multitenancy (pruebas protegidas)
//
// P15 · Criterio 22e (el contexto se fija una sola vez por transacción, garantizado por la base), incisos
// (a) a (e), y el caso límite de revertir a un SAVEPOINT anterior a la fijación.
//
// Todo con `restaurante_api` conectado directamente por SQL (sin pasar por la guarda de la API):
// - (a) `set_config('app.empresa_id', B, true)` no cambia `empresa_actual()` (directo, con `PERFORM` en un
//   `DO` y con `EXECUTE` de SQL dinámico en un `DO`); `current_setting('app.empresa_id')` sí muestra B porque
//   es solo diagnóstico.
// - (b) una segunda `fijar_contexto_empresa` (con B o con A, directa o en un `DO`) falla con 42501
//   `contexto de empresa ya fijado`; `fijar_contexto_empresa(NULL)` falla con 22004 y no fija nada.
// - (c) solo `set_config(A)`, sin `fijar_contexto_empresa`: contexto ausente.
// - (d) la fijación muere con su transacción (COMMIT o ROLLBACK, en transacción o en autocommit); una
//   transacción nueva de la misma conexión puede fijar B; dos conexiones simultáneas ven cada una la suya.
// - (e) catálogo: esquema `contexto`, tabla `contexto.sesion_empresa` UNLOGGED sin privilegios para los
//   roles de la aplicación, `EXECUTE` solo de `restaurante_api`, funciones SECURITY DEFINER de
//   `restaurante_migrador` con `search_path` fijado.
//
// Actualizado por la sección 002 (P10): cada transacción fija además el actor de sistema `prueba`
// (`comenzar`), para que un INSERT rechazado lo sea por la política RLS (se comprueba el mensaje) y no
// por falta de actor (criterios 115 y 116).
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  comenzar,
  crearEmpresaSql,
  enTransaccionConSetConfig,
  errorDe,
  exigirContextoAusente,
  fotoDeFila,
  rucAleatorio,
  textoUnico,
  type EmpresaSql,
} from './fabrica';

let plataforma: Client;
let admin: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  plataforma = await abrirCliente('plataforma');
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await plataforma?.end();
  await admin?.end();
});

beforeEach(async () => {
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

const ids = (filas: { id: string }[]) => filas.map((f) => f.id).sort();

/** Abre una conexión nueva de `restaurante_api`, corre `fn` y la cierra siempre (con ROLLBACK previo). */
async function conApi<T>(fn: (api: Client) => Promise<T>): Promise<T> {
  const api = await abrirCliente('api');
  try {
    return await fn(api);
  } finally {
    await api.query('ROLLBACK').catch(() => undefined);
    await api.end();
  }
}

/** Foto de todas las filas de una empresa (vista por el administrador, que salta la RLS). */
async function fotoDeEmpresa(empresa: EmpresaSql): Promise<unknown[]> {
  const filas: unknown[] = [await fotoDeFila(admin, 'empresa', empresa.id)];
  for (const emisor of empresa.emisores) filas.push(await fotoDeFila(admin, 'emisor', emisor.id));
  for (const sucursal of empresa.sucursales) {
    filas.push(await fotoDeFila(admin, 'sucursal', sucursal.id));
  }
  return filas;
}

async function empresaActual(api: Client): Promise<string> {
  const { rows } = await api.query<{ id: string }>('SELECT empresa_actual()::text AS id');
  return rows[0]!.id;
}

/** Con el contexto de `esperada` fijado, las tres tablas solo muestran filas de esa empresa. */
async function exigirSoloVe(api: Client, esperada: EmpresaSql): Promise<void> {
  expect(await empresaActual(api)).toBe(esperada.id);
  const empresas = await api.query<{ id: string }>('SELECT id FROM empresa');
  expect(ids(empresas.rows)).toEqual([esperada.id]);
  const emisores = await api.query<{ id: string }>('SELECT id FROM emisor');
  expect(ids(emisores.rows)).toEqual(ids(esperada.emisores));
  const sucursales = await api.query<{ id: string }>('SELECT id FROM sucursal');
  expect(ids(sucursales.rows)).toEqual(ids(esperada.sucursales));
}

/** Intentos de escribir en B con el contexto de A: UPDATE y DELETE afectan 0 filas, INSERT falla. */
async function exigirNoPuedeTocar(api: Client, ajena: EmpresaSql): Promise<void> {
  const actualizada = await api.query('UPDATE sucursal SET direccion = $1 WHERE id = $2', [
    'Hackeada 22e',
    ajena.sucursales[0]!.id,
  ]);
  expect(actualizada.rowCount).toBe(0);
  const emisorActualizado = await api.query('UPDATE emisor SET razon_social = $1 WHERE id = $2', [
    'Hackeada 22e',
    ajena.emisores[0]!.id,
  ]);
  expect(emisorActualizado.rowCount).toBe(0);
  const borrada = await api.query('DELETE FROM sucursal WHERE id = $1', [ajena.sucursales[0]!.id]);
  expect(borrada.rowCount).toBe(0);
  const emisorBorrado = await api.query('DELETE FROM emisor WHERE id = $1', [
    ajena.emisores[0]!.id,
  ]);
  expect(emisorBorrado.rowCount).toBe(0);

  await api.query('SAVEPOINT insercion');
  const sucursal = await errorDe(
    api.query(
      `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
       VALUES ($1, $2, $3, '0099', 'Calle falsa 123', now(), now())`,
      [ajena.id, ajena.emisores[0]!.id, textoUnico('Intrusa')],
    ),
  );
  expect(sucursal.code, sucursal.message).toBe('42501');
  // Con el actor fijado, el rechazo es el de la política RLS y no el de "contexto de actor ausente".
  expect(sucursal.message).toMatch(/row-level security/);
  await api.query('ROLLBACK TO SAVEPOINT insercion');
  const emisor = await errorDe(
    api.query(
      `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
       VALUES ($1, $2, 'Intruso SAC', 'GENERAL', now(), now())`,
      [ajena.id, rucAleatorio()],
    ),
  );
  expect(emisor.code, emisor.message).toBe('42501');
  expect(emisor.message).toMatch(/row-level security/);
  await api.query('ROLLBACK TO SAVEPOINT insercion');
}

// --------------------------------------------------------------------------------------------------
// (a) set_config no cambia el contexto
// --------------------------------------------------------------------------------------------------
describe('criterio 22e (a) · set_config("app.empresa_id") no cambia el contexto de la transacción', () => {
  const FORMAS: [string, (b: string) => string][] = [
    ['directo', (b) => `SELECT set_config('app.empresa_id', '${b}', true)`],
    [
      'con PERFORM en un bloque DO',
      (b) => `DO $$ BEGIN PERFORM set_config('app.empresa_id', '${b}', true); END $$`,
    ],
    [
      'con EXECUTE de SQL dinámico en un bloque DO',
      (b) => `DO $$ BEGIN EXECUTE 'SELECT set_config(''app.empresa_id'', ''${b}'', true)'; END $$`,
    ],
  ];

  it.each(FORMAS)(
    '%s: empresa_actual() sigue en A, solo se ven filas de A, B no se toca y sus filas quedan idénticas',
    async (_nombre, sqlDe) => {
      const antesB = await fotoDeEmpresa(B);
      await conApi(async (api) => {
        await comenzar(api);
        await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        await api.query(sqlDe(B.id));

        // Solo diagnóstico: el parámetro sí muestra B, pero la RLS no lo lee.
        const copia = await api.query<{ valor: string }>(
          `SELECT current_setting('app.empresa_id') AS valor`,
        );
        expect(copia.rows[0]!.valor).toBe(B.id);

        await exigirSoloVe(api, A);
        await exigirNoPuedeTocar(api, B);
        // Se confirma a propósito: si algo hubiera cambiado en B, quedaría guardado.
        await api.query('COMMIT');
      });
      expect(await fotoDeEmpresa(B)).toEqual(antesB);
    },
  );
});

// --------------------------------------------------------------------------------------------------
// (b) Segunda fijación
// --------------------------------------------------------------------------------------------------
describe('criterio 22e (b) · la empresa se fija una sola vez por transacción', () => {
  const SEGUNDAS: [string, (empresa: string) => string][] = [
    ['directa', (e) => `SELECT fijar_contexto_empresa('${e}')`],
    [
      'con PERFORM en un bloque DO',
      (e) => `DO $$ BEGIN PERFORM fijar_contexto_empresa('${e}'); END $$`,
    ],
    [
      'con EXECUTE de SQL dinámico en un bloque DO',
      (e) => `DO $$ BEGIN EXECUTE 'SELECT fijar_contexto_empresa(''${e}'')'; END $$`,
    ],
  ];
  const CASOS = SEGUNDAS.flatMap(([forma, sqlDe]) => [
    [`${forma} con B`, sqlDe, 'B'] as const,
    [`${forma} con la misma A`, sqlDe, 'A'] as const,
  ]);

  it.each(CASOS)(
    'la segunda fijación %s falla con 42501 "contexto de empresa ya fijado" y el contexto sigue siendo A',
    async (_nombre, sqlDe, cual) => {
      await conApi(async (api) => {
        await comenzar(api);
        await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        await api.query('SAVEPOINT intento');
        const error = await errorDe(api.query(sqlDe(cual === 'A' ? A.id : B.id)));
        expect(error.code, error.message).toBe('42501');
        expect(error.message).toMatch(/^contexto de empresa ya fijado/);
        await api.query('ROLLBACK TO SAVEPOINT intento');
        await exigirSoloVe(api, A);
        await api.query('ROLLBACK');
      });
    },
  );

  it('fijar_contexto_empresa(NULL) falla con 22004 "contexto de empresa inválido" y no fija nada: sin contexto previo sigue ausente', async () => {
    await conApi(async (api) => {
      await comenzar(api);
      await api.query('SAVEPOINT intento');
      const error = await errorDe(api.query('SELECT fijar_contexto_empresa(NULL)'));
      expect(error.code, error.message).toBe('22004');
      expect(error.message).toMatch(/^contexto de empresa inválido/);
      await api.query('ROLLBACK TO SAVEPOINT intento');
      await exigirContextoAusente(api, A.id, { enTransaccionAbierta: true });
      await api.query('ROLLBACK');
    });
  });

  it('fijar_contexto_empresa(NULL) con A ya fijado falla con 22004 y el contexto sigue siendo A', async () => {
    await conApi(async (api) => {
      await comenzar(api);
      await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
      await api.query('SAVEPOINT intento');
      const error = await errorDe(api.query('SELECT fijar_contexto_empresa(NULL)'));
      expect(error.code, error.message).toBe('22004');
      expect(error.message).toMatch(/^contexto de empresa inválido/);
      await api.query('ROLLBACK TO SAVEPOINT intento');
      await exigirSoloVe(api, A);
      await api.query('ROLLBACK');
    });
  });

  it('caso límite · revertir a un SAVEPOINT anterior a la fijación la deshace: queda sin contexto y puede fijar otra empresa, sin ver dos a la vez', async () => {
    await conApi(async (api) => {
      await comenzar(api);
      await api.query('SAVEPOINT antes');
      await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
      expect(await empresaActual(api)).toBe(A.id);
      await api.query('ROLLBACK TO SAVEPOINT antes');
      await exigirContextoAusente(api, A.id, { enTransaccionAbierta: true });
      await api.query('SELECT fijar_contexto_empresa($1)', [B.id]);
      await exigirSoloVe(api, B);
      await api.query('ROLLBACK');
    });
  });
});

// --------------------------------------------------------------------------------------------------
// (c) set_config sin fijación
// --------------------------------------------------------------------------------------------------
describe('criterio 22e (c) · solo set_config("app.empresa_id", A, true), sin fijar_contexto_empresa', () => {
  it('toda sentencia del criterio 19 falla con 42501 "contexto de empresa ausente"', async () => {
    await conApi(async (api) => {
      await enTransaccionConSetConfig(api, A.id, () =>
        exigirContextoAusente(api, A.id, { enTransaccionAbierta: true }),
      );
    });
  });

  it('empresa_actual() falla con 42501 "contexto de empresa ausente" aunque el parámetro tenga a A', async () => {
    await conApi(async (api) => {
      await comenzar(api);
      await api.query(`SELECT set_config('app.empresa_id', $1, true)`, [A.id]);
      const error = await errorDe(api.query('SELECT empresa_actual()'));
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/^contexto de empresa ausente/);
      await api.query('ROLLBACK');
    });
  });
});

// --------------------------------------------------------------------------------------------------
// (d) La fijación muere con la transacción
// --------------------------------------------------------------------------------------------------
describe('criterio 22e (d) · la fijación muere con su transacción', () => {
  it.each([
    ['confirmada', 'COMMIT'],
    ['revertida', 'ROLLBACK'],
  ] as const)(
    'tras una transacción %s, la misma conexión falla sin contexto (en autocommit y en una transacción nueva)',
    async (_nombre, cierre) => {
      await conApi(async (api) => {
        await comenzar(api);
        await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        await exigirSoloVe(api, A);
        await api.query(cierre);

        // Modo autocommit.
        await exigirContextoAusente(api, A.id);
        // Transacción nueva sin volver a fijar.
        await comenzar(api);
        await exigirContextoAusente(api, A.id, { enTransaccionAbierta: true });
        await api.query('ROLLBACK');
      });
    },
  );

  it.each([['COMMIT'], ['ROLLBACK']] as const)(
    'tras %s, una transacción nueva de la misma conexión puede fijar B y solo ve filas de B',
    async (cierre) => {
      await conApi(async (api) => {
        await comenzar(api);
        await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        await api.query(cierre);

        await comenzar(api);
        await api.query('SELECT fijar_contexto_empresa($1)', [B.id]);
        await exigirSoloVe(api, B);
        await api.query('COMMIT');

        // Y de nuevo sin contexto.
        await exigirContextoAusente(api, B.id);
      });
    },
  );

  it('dos conexiones abiertas a la vez, cada una con su empresa fijada, ven cada una solo la suya', async () => {
    const [apiA, apiB] = await Promise.all([abrirCliente('api'), abrirCliente('api')]);
    try {
      await comenzar(apiA);
      await comenzar(apiB);
      await apiA.query('SELECT fijar_contexto_empresa($1)', [A.id]);
      await apiB.query('SELECT fijar_contexto_empresa($1)', [B.id]);
      // Consultas intercaladas.
      await exigirSoloVe(apiA, A);
      await exigirSoloVe(apiB, B);
      await exigirSoloVe(apiA, A);
      await exigirSoloVe(apiB, B);
      await apiA.query('ROLLBACK');
      // La otra sigue con lo suyo; la primera quedó sin contexto.
      await exigirSoloVe(apiB, B);
      await exigirContextoAusente(apiA, A.id);
      await apiB.query('ROLLBACK');
    } finally {
      await apiA.end();
      await apiB.end();
    }
  });
});

// --------------------------------------------------------------------------------------------------
// (e) Catálogo
// --------------------------------------------------------------------------------------------------
describe('criterio 22e (e) · catálogo del esquema contexto y de las funciones', () => {
  it('el esquema contexto existe y su dueño es restaurante_migrador', async () => {
    const { rows } = await admin.query<{ dueno: string }>(
      `SELECT pg_get_userbyid(nspowner) AS dueno FROM pg_namespace WHERE nspname = 'contexto'`,
    );
    expect(rows).toEqual([{ dueno: 'restaurante_migrador' }]);
  });

  it('ni restaurante_api, ni restaurante_plataforma, ni PUBLIC tienen USAGE ni CREATE sobre el esquema', async () => {
    const { rows } = await admin.query<{ rol: string; usage: boolean; crear: boolean }>(
      `SELECT r AS rol,
              has_schema_privilege(r, 'contexto', 'USAGE') AS usage,
              has_schema_privilege(r, 'contexto', 'CREATE') AS crear
         FROM unnest(ARRAY['restaurante_api', 'restaurante_plataforma']) AS r`,
    );
    expect(rows).toEqual([
      { rol: 'restaurante_api', usage: false, crear: false },
      { rol: 'restaurante_plataforma', usage: false, crear: false },
    ]);
    const publico = await admin.query<{ privilegio: string }>(
      `SELECT a.privilege_type AS privilegio
         FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE n.nspname = 'contexto' AND a.grantee = 0`,
    );
    expect(publico.rows, 'privilegios de PUBLIC sobre el esquema contexto').toEqual([]);
  });

  it('contexto.sesion_empresa existe, es UNLOGGED y es de restaurante_migrador', async () => {
    const { rows } = await admin.query<{ persistencia: string; dueno: string }>(
      `SELECT c.relpersistence AS persistencia, pg_get_userbyid(c.relowner) AS dueno
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'contexto' AND c.relname = 'sesion_empresa'`,
    );
    expect(rows).toEqual([{ persistencia: 'u', dueno: 'restaurante_migrador' }]);
  });

  it('ningún rol de la aplicación ni PUBLIC tiene privilegio alguno sobre contexto.sesion_empresa', async () => {
    const { rows } = await admin.query<{ rol: string; privilegio: string; tiene: boolean }>(
      `SELECT r AS rol, p AS privilegio,
              has_table_privilege(r, 'contexto.sesion_empresa', p) AS tiene
         FROM unnest(ARRAY['restaurante_api', 'restaurante_plataforma']) AS r,
              unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p`,
    );
    expect(rows.filter((f) => f.tiene)).toEqual([]);
    const columnas = await admin.query<{ rol: string; tiene: boolean }>(
      `SELECT r AS rol, has_any_column_privilege(r, 'contexto.sesion_empresa', 'SELECT,INSERT,UPDATE,REFERENCES') AS tiene
         FROM unnest(ARRAY['restaurante_api', 'restaurante_plataforma']) AS r`,
    );
    expect(columnas.rows.filter((f) => f.tiene)).toEqual([]);
    const publico = await admin.query<{ privilegio: string }>(
      `SELECT a.privilege_type AS privilegio
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace,
              aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'contexto' AND c.relname = 'sesion_empresa' AND a.grantee = 0`,
    );
    expect(publico.rows, 'privilegios de PUBLIC sobre contexto.sesion_empresa').toEqual([]);
  });

  it.each(['api', 'plataforma'] as const)(
    '%s: SELECT, INSERT, UPDATE y DELETE directos sobre contexto.sesion_empresa fallan por permisos (42501)',
    async (rol) => {
      const cliente = await abrirCliente(rol);
      try {
        for (const sql of [
          'SELECT * FROM contexto.sesion_empresa',
          `INSERT INTO contexto.sesion_empresa (pid, xid, empresa_id) VALUES (1, '1'::xid8, '${B.id}')`,
          `UPDATE contexto.sesion_empresa SET empresa_id = '${B.id}'`,
          'DELETE FROM contexto.sesion_empresa',
        ]) {
          const error = await errorDe(cliente.query(sql));
          expect(error.code, `${sql}: ${error.message}`).toBe('42501');
        }
      } finally {
        await cliente.end();
      }
    },
  );

  it('restaurante_api con A fijado tampoco puede leer ni escribir contexto.sesion_empresa (42501)', async () => {
    await conApi(async (api) => {
      await comenzar(api);
      await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
      for (const sql of [
        'SELECT * FROM contexto.sesion_empresa',
        `UPDATE contexto.sesion_empresa SET empresa_id = '${B.id}'`,
        `DELETE FROM contexto.sesion_empresa`,
      ]) {
        await api.query('SAVEPOINT intento');
        const error = await errorDe(api.query(sql));
        expect(error.code, `${sql}: ${error.message}`).toBe('42501');
        await api.query('ROLLBACK TO SAVEPOINT intento');
      }
      await exigirSoloVe(api, A);
      await api.query('ROLLBACK');
    });
  });

  it('EXECUTE sobre fijar_contexto_empresa(uuid): solo restaurante_api; ni restaurante_plataforma ni PUBLIC', async () => {
    const { rows } = await admin.query<{ api: boolean; plataforma: boolean; publico: number }>(
      `SELECT has_function_privilege('restaurante_api', f.oid, 'EXECUTE') AS api,
              has_function_privilege('restaurante_plataforma', f.oid, 'EXECUTE') AS plataforma,
              (SELECT count(*)::int
                 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc f
        WHERE f.oid = 'public.fijar_contexto_empresa(uuid)'::regprocedure`,
    );
    expect(rows).toEqual([{ api: true, plataforma: false, publico: 0 }]);
  });

  it('restaurante_plataforma no puede llamar fijar_contexto_empresa (42501)', async () => {
    const cliente = await abrirCliente('plataforma');
    try {
      const error = await errorDe(cliente.query('SELECT fijar_contexto_empresa($1)', [A.id]));
      expect(error.code, error.message).toBe('42501');
    } finally {
      await cliente.end();
    }
  });

  it('EXECUTE sobre empresa_actual(): solo restaurante_api; ni restaurante_plataforma ni PUBLIC', async () => {
    const { rows } = await admin.query<{ api: boolean; plataforma: boolean; publico: number }>(
      `SELECT has_function_privilege('restaurante_api', f.oid, 'EXECUTE') AS api,
              has_function_privilege('restaurante_plataforma', f.oid, 'EXECUTE') AS plataforma,
              (SELECT count(*)::int
                 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc f
        WHERE f.oid = 'public.empresa_actual()'::regprocedure`,
    );
    expect(rows).toEqual([{ api: true, plataforma: false, publico: 0 }]);
  });

  it.each(['public.fijar_contexto_empresa(uuid)', 'public.empresa_actual()'])(
    '%s es SECURITY DEFINER, de restaurante_migrador y con search_path fijado a pg_catalog, pg_temp',
    async (firma) => {
      const { rows } = await admin.query<{
        definer: boolean;
        dueno: string;
        config: string[] | null;
      }>(
        `SELECT p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS dueno, p.proconfig AS config
           FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [firma],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.definer).toBe(true);
      expect(rows[0]!.dueno).toBe('restaurante_migrador');
      const searchPath = (rows[0]!.config ?? []).find((c) => c.startsWith('search_path='));
      expect(searchPath, `proconfig: ${JSON.stringify(rows[0]!.config)}`).toBeDefined();
      expect(searchPath!.replace(/\s+/g, '')).toBe('search_path=pg_catalog,pg_temp');
    },
  );
});
