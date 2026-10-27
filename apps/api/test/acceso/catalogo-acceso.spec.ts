// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P9 (parte 1) · Criterios 88 a 90 (catálogo y aislamiento de las tablas nuevas, ruta crítica):
// - 88 el criterio 38 de 001 se cumple con las tablas nuevas, con los ajustes de la sección: privilegios
//   exactos de la tabla "Permisos" para `restaurante_api` y `restaurante_plataforma`, `plan` con política de
//   solo lectura para la API, las tablas solo de plataforma sin ningún privilegio para la API, y los esquemas
//   `autenticacion` y `contexto` sin `USAGE` para los roles de la aplicación;
// - 89 `public.empresa_de_usuario(text)` (`SECURITY DEFINER`, `search_path` fijo, `EXECUTE` solo para la API,
//   coincidencia exacta sin comodines) y la relación nombre de usuario → empresa fuera de `public`;
// - 90 unicidad global del nombre de usuario por SQL como `restaurante_api` y relación al día al renombrar.
// Los títulos llevan [C0]..[C3] según el grupo de la fase C que crea la tabla o la función.
import type { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRES_DE_ROLES, abrirCliente } from '../utilidades';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  crearUsuario,
  nuevoSuperadmin,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
} from './fabrica-plataforma';

const { api, plataforma, migrador } = NOMBRES_DE_ROLES;

const PRIVILEGIOS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

type Grupo = 'C0' | 'C1' | 'C2' | 'C3';
type Priv = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

interface TablaEsperada {
  tabla: string;
  grupo: Grupo;
  /** Tiene `empresa_id` (y la política `aislamiento_empresa` para la API). */
  conEmpresa: boolean;
  api: Priv[];
  plataforma: Priv[];
}

/** Tabla "Permisos" de la sección (spec.md, "Permisos"). */
const TABLAS: TablaEsperada[] = [
  {
    tabla: 'superadministrador',
    grupo: 'C0',
    conEmpresa: false,
    api: [],
    plataforma: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    tabla: 'sesion_superadministrador',
    grupo: 'C0',
    conEmpresa: false,
    api: [],
    plataforma: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    tabla: 'idempotencia_plataforma',
    grupo: 'C0',
    conEmpresa: false,
    api: [],
    plataforma: ['SELECT', 'INSERT', 'DELETE'],
  },
  {
    tabla: 'usuario',
    grupo: 'C0',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    plataforma: ['SELECT', 'INSERT'],
  },
  {
    tabla: 'acceso_sucursal',
    grupo: 'C0',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    plataforma: ['SELECT'],
  },
  {
    tabla: 'sesion',
    grupo: 'C0',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    plataforma: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    tabla: 'bloqueo_intentos',
    grupo: 'C0',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    plataforma: [],
  },
  {
    tabla: 'idempotencia',
    grupo: 'C0',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'DELETE'],
    plataforma: [],
  },
  {
    tabla: 'auditoria',
    grupo: 'C0',
    conEmpresa: true,
    api: ['SELECT', 'INSERT'],
    plataforma: ['SELECT', 'INSERT'],
  },
  {
    tabla: 'plan',
    grupo: 'C1',
    conEmpresa: false,
    api: ['SELECT'],
    plataforma: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    tabla: 'suscripcion',
    grupo: 'C1',
    conEmpresa: true,
    api: ['SELECT', 'INSERT'],
    plataforma: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    tabla: 'pago_suscripcion',
    grupo: 'C1',
    conEmpresa: true,
    api: [],
    plataforma: ['SELECT', 'INSERT'],
  },
  {
    tabla: 'consumo_comprobantes',
    grupo: 'C1',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    plataforma: ['SELECT'],
  },
  {
    tabla: 'equipo',
    grupo: 'C2',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    plataforma: [],
  },
  {
    tabla: 'equipo_recordado',
    grupo: 'C2',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    plataforma: [],
  },
  {
    tabla: 'sucursal_acceso',
    grupo: 'C2',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    plataforma: [],
  },
  {
    tabla: 'autorizacion',
    grupo: 'C3',
    conEmpresa: true,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    plataforma: [],
  },
];

let admin: Client;

beforeAll(async () => {
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await admin?.end();
});

/** La tabla existe en public (así las comprobaciones de "no tiene nada" no pasan en vacío). */
const exigirTabla = async (tabla: string) => {
  const { rows } = await admin.query(`SELECT to_regclass('public.' || $1::text) AS t`, [tabla]);
  expect(rows[0].t, `la tabla ${tabla} no existe en public`).not.toBeNull();
};

const privilegiosDe = async (rol: string, tabla: string): Promise<string[]> => {
  const tiene: string[] = [];
  for (const privilegio of PRIVILEGIOS) {
    const { rows } = await admin.query<{ tiene: boolean }>(
      `SELECT has_table_privilege($1::name, ('public.' || $2::text)::regclass, $3::text) AS tiene`,
      [rol, tabla, privilegio],
    );
    if (rows[0]!.tiene) tiene.push(privilegio);
  }
  return tiene;
};

// ------------------------------------------------------------------------------------------------
// 88 · Convención del criterio 38 con las tablas nuevas
// ------------------------------------------------------------------------------------------------
describe.each(TABLAS)(
  'criterio 88 · tabla $tabla [$grupo]',
  ({ tabla, conEmpresa, api: dePi, plataforma: dePlat }) => {
    it('existe en public con RLS activada y forzada', async () => {
      const { rows } = await admin.query<{ rls: boolean; forzada: boolean }>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forzada
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'p')`,
        [tabla],
      );
      expect(rows, `${tabla} no existe en public`).toHaveLength(1);
      expect(rows[0]).toEqual({ rls: true, forzada: true });
    });

    it('los privilegios de restaurante_api y restaurante_plataforma son exactamente los de la tabla "Permisos"', async () => {
      const ordenar = (lista: string[]) => PRIVILEGIOS.filter((p) => lista.includes(p));
      expect(await privilegiosDe(api, tabla), `privilegios de ${api}`).toEqual(ordenar(dePi));
      expect(await privilegiosDe(plataforma, tabla), `privilegios de ${plataforma}`).toEqual(
        ordenar(dePlat),
      );
    });

    it('un rol sin privilegios sobre la tabla tampoco los tiene por columna', async () => {
      await exigirTabla(tabla);
      for (const [rol, permitidos] of [
        [api, dePi],
        [plataforma, dePlat],
      ] as const) {
        if (permitidos.length > 0) continue;
        const { rows } = await admin.query<{ tiene: boolean }>(
          `SELECT has_any_column_privilege($1::name, ('public.' || $2::text)::regclass, 'SELECT, INSERT, UPDATE, REFERENCES') AS tiene`,
          [rol, tabla],
        );
        expect(rows[0]!.tiene, `${rol} sobre ${tabla}`).toBe(false);
      }
    });

    it('PUBLIC no tiene ningún privilegio sobre la tabla', async () => {
      await exigirTabla(tabla);
      const { rows } = await admin.query(
        `SELECT a.privilege_type
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
              aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.grantee = 0`,
        [tabla],
      );
      expect(rows).toEqual([]);
    });

    if (conEmpresa) {
      it('tiene empresa_id y la política aislamiento_empresa de restaurante_api con empresa_actual() en USING y WITH CHECK', async () => {
        const columna = await admin.query(
          `SELECT 1 FROM pg_attribute a WHERE a.attrelid = ('public.' || $1::text)::regclass
            AND a.attname = 'empresa_id' AND NOT a.attisdropped`,
          [tabla],
        );
        expect(columna.rows, `${tabla}.empresa_id`).toHaveLength(1);
        const { rows } = await admin.query<{
          roles: string;
          usando: string | null;
          verificando: string | null;
        }>(
          `SELECT array_to_string(roles, ',') AS roles, qual AS usando, with_check AS verificando
           FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'aislamiento_empresa'`,
          [tabla],
        );
        expect(rows, `política aislamiento_empresa de ${tabla}`).toHaveLength(1);
        expect(rows[0]!.roles.split(',')).toContain(api);
        expect(rows[0]!.usando ?? '').toMatch(/empresa_actual\(\)/);
        expect(rows[0]!.verificando ?? '').toMatch(/empresa_actual\(\)/);
      });

      it('tiene la política acceso_plataforma para restaurante_plataforma', async () => {
        const { rows } = await admin.query<{ roles: string }>(
          `SELECT array_to_string(roles, ',') AS roles FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'acceso_plataforma'`,
          [tabla],
        );
        expect(rows, `política acceso_plataforma de ${tabla}`).toHaveLength(1);
        expect(rows[0]!.roles.split(',')).toContain(plataforma);
      });

      it('toda llave foránea hacia otra tabla con empresa_id es compuesta e incluye empresa_id en ambos lados', async () => {
        const { rows } = await admin.query<{
          nombre: string;
          columnas: string[];
          referenciadas: string[];
          destino: string;
        }>(
          `SELECT con.conname AS nombre, cr.relname AS destino,
                (SELECT array_agg(a.attname::text) FROM unnest(con.conkey) k(n)
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS columnas,
                (SELECT array_agg(a.attname::text) FROM unnest(con.confkey) k(n)
                   JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n) AS referenciadas
           FROM pg_constraint con
           JOIN pg_class cr ON cr.oid = con.confrelid
          WHERE con.contype = 'f' AND con.conrelid = ('public.' || $1::text)::regclass
            AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.confrelid
                          AND a.attname IN ('empresa_id') AND NOT a.attisdropped)`,
          [tabla],
        );
        for (const fk of rows) {
          expect(fk.columnas, `${fk.nombre} -> ${fk.destino}`).toContain('empresa_id');
          expect(fk.referenciadas, `${fk.nombre} -> ${fk.destino}`).toContain('empresa_id');
        }
      });
    }
  },
);

describe('criterio 88 · tablas con reglas propias', () => {
  it('[C1] plan (sin empresa_id) tiene una política de solo lectura para restaurante_api y acceso_plataforma', async () => {
    const columna = await admin.query(
      `SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.plan'::regclass AND a.attname = 'empresa_id' AND NOT a.attisdropped`,
    );
    expect(columna.rows).toEqual([]);
    const { rows } = await admin.query<{
      politica: string;
      comando: string;
      roles: string;
      usando: string | null;
    }>(
      `SELECT policyname AS politica, cmd AS comando, array_to_string(roles, ',') AS roles, qual AS usando
         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan'`,
    );
    const deApi = rows.filter((p) => p.roles.split(',').includes(api));
    expect(deApi, 'políticas de la API sobre plan').toHaveLength(1);
    expect(deApi[0]).toMatchObject({ politica: 'lectura_api', comando: 'SELECT' });
    expect(deApi[0]!.usando).toBe('true');
    const dePlataforma = rows.filter((p) => p.roles.split(',').includes(plataforma));
    expect(dePlataforma.map((p) => p.politica)).toContain('acceso_plataforma');
  });

  it.each(['superadministrador', 'sesion_superadministrador', 'idempotencia_plataforma'])(
    '[C0] %s no tiene ninguna política para restaurante_api ni para PUBLIC y sí acceso_plataforma',
    async (tabla) => {
      const { rows } = await admin.query<{ politica: string; roles: string }>(
        `SELECT policyname AS politica, array_to_string(roles, ',') AS roles
           FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [tabla],
      );
      for (const p of rows) {
        expect(p.roles.split(','), `política ${p.politica} de ${tabla}`).not.toContain(api);
        expect(p.roles.split(','), `política ${p.politica} de ${tabla}`).not.toContain('public');
      }
      expect(rows.map((p) => p.politica)).toContain('acceso_plataforma');
    },
  );

  it('[C1] pago_suscripcion es inmutable: ni restaurante_plataforma ni el migrador pueden UPDATE, DELETE ni TRUNCATE', async () => {
    const clientes: [string, Client][] = [
      ['plataforma', await abrirCliente('plataforma')],
      ['migrador', await abrirCliente('migrador')],
    ];
    try {
      for (const [nombre, cliente] of clientes) {
        for (const sql of [
          "UPDATE pago_suscripcion SET referencia = 'alterada'",
          'DELETE FROM pago_suscripcion',
          'TRUNCATE pago_suscripcion',
        ]) {
          await cliente.query('BEGIN');
          try {
            const error = await errorDe(cliente.query(sql));
            expect(error.code, `${nombre}: ${sql}: ${error.message}`).not.toBe('42P01'); // la tabla existe
            expect(error.message, `${nombre}: ${sql}`).toBeTruthy();
          } finally {
            await cliente.query('ROLLBACK');
          }
        }
      }
    } finally {
      for (const [, cliente] of clientes) await cliente.end();
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 88/89 · Esquemas internos
// ------------------------------------------------------------------------------------------------
describe('criterios 88 y 89 · esquemas autenticacion y contexto', () => {
  it.each(['autenticacion', 'contexto'])(
    '[C0] el esquema %s no da USAGE ni CREATE a restaurante_api, restaurante_plataforma ni PUBLIC',
    async (esquema) => {
      const { rows } = await admin.query<{ rol: string; usage: boolean; crear: boolean }>(
        `SELECT r AS rol, has_schema_privilege(r, $1, 'USAGE') AS usage, has_schema_privilege(r, $1, 'CREATE') AS crear
           FROM unnest(ARRAY['restaurante_api', 'restaurante_plataforma']) AS r`,
        [esquema],
      );
      expect(rows).toEqual([
        { rol: api, usage: false, crear: false },
        { rol: plataforma, usage: false, crear: false },
      ]);
      const publico = await admin.query(
        `SELECT a.privilege_type FROM pg_namespace n,
                aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
          WHERE n.nspname = $1 AND a.grantee = 0`,
        [esquema],
      );
      expect(publico.rows, `privilegios de PUBLIC sobre ${esquema}`).toEqual([]);
    },
  );

  it('[C0] autenticacion es de restaurante_migrador y su tabla nombre_usuario no es accesible para la API ni para plataforma', async () => {
    const { rows } = await admin.query<{ dueno: string }>(
      `SELECT pg_get_userbyid(nspowner) AS dueno FROM pg_namespace WHERE nspname = 'autenticacion'`,
    );
    expect(rows).toEqual([{ dueno: migrador }]);
    const columnas = await admin.query<{ nombre: string }>(
      `SELECT a.attname::text AS nombre FROM pg_attribute a
        WHERE a.attrelid = 'autenticacion.nombre_usuario'::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    expect(columnas.rows.map((c) => c.nombre)).toEqual(
      expect.arrayContaining(['nombre', 'empresa_id', 'usuario_id']),
    );
    for (const rol of ['api', 'plataforma'] as const) {
      const cliente = await abrirCliente(rol);
      try {
        for (const sql of [
          'SELECT * FROM autenticacion.nombre_usuario',
          "INSERT INTO autenticacion.nombre_usuario (nombre, empresa_id, usuario_id) VALUES ('x', gen_random_uuid(), gen_random_uuid())",
          'DELETE FROM autenticacion.nombre_usuario',
        ]) {
          const error = await errorDe(cliente.query(sql));
          expect(error.code, `${rol}: ${sql}: ${error.message}`).toBe('42501');
        }
      } finally {
        await cliente.end();
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 89 · empresa_de_usuario
// ------------------------------------------------------------------------------------------------
describe('criterio 89 · public.empresa_de_usuario(text)', () => {
  let ctx: AppDePrueba;
  let apiCliente: Client;
  let A: EmpresaDePrueba;
  let nombreConGuion: string;
  let usuarioConGuion: { id: string; usuario: string };
  let sembradoPendiente: Promise<void> | undefined;

  beforeAll(async () => {
    ctx = await arrancar();
    apiCliente = await abrirCliente('api');
  });
  afterAll(async () => {
    await apiCliente?.end();
    await ctx?.cerrar();
  });

  function sembrar(): Promise<void> {
    sembradoPendiente ??= (async () => {
      const sa = await nuevoSuperadmin(ctx);
      A = await altaEmpresa(ctx, sa);
      // Un nombre con guion, punto y guion bajo: los tres pueden confundirse con comodines o con separadores.
      nombreConGuion = `ab_c-d.${randomUUID().slice(0, 8)}`;
      const u = await crearUsuario(ctx, A.admin.token, {
        nombreUsuario: nombreConGuion,
        accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
      });
      usuarioConGuion = { id: u.id, usuario: nombreConGuion };
    })();
    return sembradoPendiente;
  }

  const empresaDe = async (texto: string | null) =>
    (
      await apiCliente.query<{ id: string | null }>('SELECT public.empresa_de_usuario($1) AS id', [
        texto,
      ])
    ).rows[0]!.id;

  it('[C0] es SECURITY DEFINER de restaurante_migrador con search_path fijo y devuelve uuid', async () => {
    const { rows } = await admin.query<{
      definer: boolean;
      dueno: string;
      config: string[] | null;
      retorno: string;
    }>(
      `SELECT p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS dueno, p.proconfig AS config,
              pg_get_function_result(p.oid) AS retorno
         FROM pg_proc p WHERE p.oid = 'public.empresa_de_usuario(text)'::regprocedure`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.definer).toBe(true);
    expect(rows[0]!.dueno).toBe(migrador);
    expect(rows[0]!.retorno).toBe('uuid');
    const searchPath = (rows[0]!.config ?? []).find((c) => c.startsWith('search_path='));
    expect(searchPath, `proconfig: ${JSON.stringify(rows[0]!.config)}`).toBeDefined();
    expect(searchPath!.replace(/\s+/g, '')).toBe('search_path=pg_catalog,pg_temp');
  });

  it('[C0] EXECUTE solo para restaurante_api: ni restaurante_plataforma ni PUBLIC', async () => {
    const { rows } = await admin.query<{ api: boolean; plataforma: boolean; publico: number }>(
      `SELECT has_function_privilege('restaurante_api', f.oid, 'EXECUTE') AS api,
              has_function_privilege('restaurante_plataforma', f.oid, 'EXECUTE') AS plataforma,
              (SELECT count(*)::int FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc f WHERE f.oid = 'public.empresa_de_usuario(text)'::regprocedure`,
    );
    expect(rows).toEqual([{ api: true, plataforma: false, publico: 0 }]);
    const cliente = await abrirCliente('plataforma');
    try {
      const error = await errorDe(cliente.query("SELECT public.empresa_de_usuario('cualquiera')"));
      expect(error.code, error.message).toBe('42501');
    } finally {
      await cliente.end();
    }
  });

  it('[C0] devuelve la empresa del usuario con el nombre exacto, sin distinguir mayúsculas', async () => {
    await sembrar();
    expect(await empresaDe(A.admin.usuario)).toBe(A.empresaId);
    expect(await empresaDe(A.admin.usuario.toUpperCase())).toBe(A.empresaId);
    expect(await empresaDe(nombreConGuion)).toBe(A.empresaId);
    expect(await empresaDe(nombreConGuion.toUpperCase())).toBe(A.empresaId);
  });

  it('[C0] la relación está en autenticacion.nombre_usuario, en minúsculas, con la empresa y el usuario', async () => {
    await sembrar();
    const { rows } = await admin.query(
      'SELECT nombre, empresa_id, usuario_id FROM autenticacion.nombre_usuario WHERE usuario_id = $1',
      [usuarioConGuion.id],
    );
    expect(rows).toEqual([
      { nombre: nombreConGuion, empresa_id: A.empresaId, usuario_id: usuarioConGuion.id },
    ]);
  });

  it('[C0] devuelve NULL para un nombre inexistente y para textos parecidos: comodines, prefijos, espacios y vacío', async () => {
    await sembrar();
    const reemplazado = nombreConGuion.replace('_', '%');
    const conGuionBajo = nombreConGuion.replace('-', '_'); // `_` coincidiría con `-` si fuera un LIKE
    const sinUnaLetra = nombreConGuion.replace('b', '_');
    const textos = [
      usuarioUnico('no-existe'),
      '%',
      '_',
      '%%',
      `${nombreConGuion.slice(0, 5)}%`,
      `${A.admin.usuario.slice(0, 6)}%`,
      A.admin.usuario.slice(0, -1),
      `${A.admin.usuario}x`,
      reemplazado,
      conGuionBajo,
      sinUnaLetra,
      ` ${A.admin.usuario}`,
      `${A.admin.usuario} `,
      `${A.admin.usuario}\n`,
      '',
      ' ',
      A.admin.usuario.replace(/[a-z]/, (c) => c.toUpperCase().normalize('NFD') + '́'),
      'x'.repeat(10_000),
    ];
    for (const texto of textos) {
      expect(await empresaDe(texto), JSON.stringify(texto.slice(0, 60))).toBeNull();
    }
    expect(await empresaDe(null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// 90 · Unicidad global del nombre de usuario
// ------------------------------------------------------------------------------------------------
describe('criterio 90 · unicidad global del nombre de usuario por SQL como restaurante_api', () => {
  let ctx: AppDePrueba;
  let apiCliente: Client;
  let A: EmpresaDePrueba;
  let B: EmpresaDePrueba;
  let sembradoPendiente: Promise<void> | undefined;

  beforeAll(async () => {
    ctx = await arrancar();
    apiCliente = await abrirCliente('api');
  });
  afterAll(async () => {
    await apiCliente?.end();
    await ctx?.cerrar();
  });

  function sembrar(): Promise<void> {
    sembradoPendiente ??= (async () => {
      const sa = await nuevoSuperadmin(ctx);
      A = await altaEmpresa(ctx, sa);
      B = await altaEmpresa(ctx, sa);
    })();
    return sembradoPendiente;
  }

  const empresaDe = async (texto: string) =>
    (
      await apiCliente.query<{ id: string | null }>('SELECT public.empresa_de_usuario($1) AS id', [
        texto,
      ])
    ).rows[0]!.id;

  it('[C0] con el contexto de A, renombrar un usuario de A con un nombre ya usado en B falla con unicidad (23505) sin revelar nada de B', async () => {
    await sembrar();
    const error = await errorDe(
      enTransaccion(apiCliente, A.empresaId, () =>
        apiCliente.query('UPDATE usuario SET nombre_usuario = $1 WHERE id = $2', [
          B.admin.usuario,
          A.admin.id,
        ]),
      ),
    );
    expect(error.code, error.message).toBe('23505');
    const texto = JSON.stringify([error.message, error.detail, error.table, error.constraint]);
    expect(texto).not.toContain(B.empresaId);
    expect(texto).not.toContain(B.admin.id);
  });

  it('[C0] con el contexto de A, insertar un usuario de A con un nombre ya usado en B falla con unicidad (23505)', async () => {
    await sembrar();
    const error = await errorDe(
      enTransaccion(apiCliente, A.empresaId, () =>
        apiCliente.query(
          `INSERT INTO usuario (empresa_id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal,
                                huella_pin, largo_pin, es_administrador, activo, creado_en, actualizado_en)
           SELECT empresa_id, 'Copia', $1, hash_contrasena, contrasena_temporal,
                  decode(md5(random()::text), 'hex'), largo_pin, es_administrador, activo, now(), now()
             FROM usuario WHERE id = $2`,
          [B.admin.usuario, A.admin.id],
        ),
      ),
    );
    expect(error.code, error.message).toBe('23505');
    const texto = JSON.stringify([error.message, error.detail]);
    expect(texto).not.toContain(B.empresaId);
    expect(texto).not.toContain(B.admin.id);
  });

  it('[C0] por la API, un nombre ya usado en A o en B responde 409 CONFLICTO con el mismo mensaje', async () => {
    await sembrar();
    const alta = (nombreUsuario: string) =>
      ctx
        .http()
        .post('/usuarios')
        .set({ Authorization: `Bearer ${A.admin.token}` })
        .send({
          nombre: 'Repetido',
          nombreUsuario,
          esAdministrador: false,
          accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
          contrasenaTemporal: `Clave-${randomUUID()}`,
        });
    const deA = await alta(A.admin.usuario);
    const deB = await alta(B.admin.usuario);
    expect(deA.status).toBe(409);
    expect(deB.status).toBe(409);
    expect(deB.body).toEqual(deA.body);
    expect(JSON.stringify(deB.body)).not.toContain(B.empresaId);
  });

  it('[C0] renombrar actualiza la relación del criterio 89 en la misma transacción, y el nombre viejo queda libre para otra empresa', async () => {
    await sembrar();
    const viejo = usuarioUnico('renombrar');
    const nuevo = usuarioUnico('renombrado');
    const usuario = await crearUsuario(ctx, A.admin.token, {
      nombreUsuario: viejo,
      accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
    });
    expect(await empresaDe(viejo)).toBe(A.empresaId);

    // Dentro de la misma transacción la relación ya cambió (y se revierte con ella).
    await enTransaccion(apiCliente, A.empresaId, async () => {
      await apiCliente.query('UPDATE usuario SET nombre_usuario = $1 WHERE id = $2', [
        nuevo,
        usuario.id,
      ]);
      expect(await empresaDe(nuevo)).toBe(A.empresaId);
      expect(await empresaDe(viejo)).toBeNull();
    });
    expect(await empresaDe(viejo)).toBe(A.empresaId);
    expect(await empresaDe(nuevo)).toBeNull();

    // Confirmado el cambio, el nombre viejo se puede reutilizar en otra empresa.
    await enTransaccion(
      apiCliente,
      A.empresaId,
      () =>
        apiCliente.query('UPDATE usuario SET nombre_usuario = $1 WHERE id = $2', [
          nuevo,
          usuario.id,
        ]),
      { confirmar: true },
    );
    expect(await empresaDe(nuevo)).toBe(A.empresaId);
    expect(await empresaDe(viejo)).toBeNull();
    const reutilizado = await crearUsuario(ctx, B.admin.token, {
      nombreUsuario: viejo,
      accesos: [{ sucursalId: B.sucursales[0]!.id, rol: 'MOZO' }],
    });
    expect(reutilizado.id).not.toBe(usuario.id);
    expect(await empresaDe(viejo)).toBe(B.empresaId);
  });
});
