// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P12 (parte 1) · Criterios 113, 114, 115, 116 y 118 a nivel de catálogo y de SQL (trazabilidad, ruta crítica):
// - 113 recorrido de `pg_catalog` de toda tabla de `public` con `empresa_id` (y `empresa`), salvo la lista
//   cerrada de excepciones: las ocho columnas, los `CHECK` por grupo, las llaves compuestas hacia `usuario` y
//   `equipo` y simple hacia `superadministrador`, y el trigger `trazabilidad`. Una tabla actual o futura que no
//   cumpla, o un cambio en la lista de excepciones, hace fallar la prueba;
// - 114 la base llena las columnas y descarta lo que se envíe en ellas; `creado_por_*` no cambia en `UPDATE`;
// - 115 sin actor no hay escritura (42501 "contexto de actor ausente");
// - 116 `fijar_contexto_actor`: privilegios, reglas, una sola vez por transacción, muere con ella y la llave
//   compuesta rechaza a un usuario o equipo de otra empresa;
// - 118 la migración de trazabilidad sobre las tablas de 001 (filas existentes con `migracion:trazabilidad`) y su
//   reversión.
// Los títulos llevan [C0]..[C3] según el grupo de la fase C que lo hace posible.
import type { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRES_DE_ROLES, abrirCliente } from '../utilidades';
import {
  crearEmpresaSql,
  errorDe,
  rucAleatorio,
  textoUnico,
  type EmpresaSql,
} from '../aislamiento/fabrica';
import {
  PREFIJO_CONTEXTO_UNICO,
  PREFIJO_TRAZABILIDAD,
  altaEmpresa,
  arrancar,
  checkAcepta,
  crearBaseNueva,
  migrarHasta,
  nuevoSuperadmin,
  recordarEquipo,
  revertirHasta,
  type AppDePrueba,
  type EmpresaDePrueba,
} from './fabrica-plataforma';

const { migrador } = NOMBRES_DE_ROLES;

/** Lista cerrada de excepciones del criterio 113 (motivos en "Reglas de negocio"). */
const EXCEPCIONES = ['auditoria', 'bloqueo_intentos', 'idempotencia', 'sesion'];
const GRUPOS = ['creado_por', 'actualizado_por'] as const;
const SUFIJOS = ['usuario_id', 'equipo_id', 'superadministrador_id', 'sistema'] as const;
const COLUMNAS = GRUPOS.flatMap((g) => SUFIJOS.map((s) => `${g}_${s}`));

let admin: Client;

beforeAll(async () => {
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await admin?.end();
});

/** Tablas de `public` con `empresa_id`, más `empresa`. */
async function tablasDeClientes(cliente: Client = admin): Promise<string[]> {
  const { rows } = await cliente.query<{ nombre: string }>(
    `SELECT c.relname AS nombre
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'migraciones'
        AND (c.relname = 'empresa'
             OR EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attname = 'empresa_id' AND NOT a.attisdropped))
      ORDER BY c.relname`,
  );
  return rows.map((f) => f.nombre);
}

async function tieneTriggerDeTrazabilidad(
  tabla: string,
  cliente: Client = admin,
): Promise<boolean> {
  const { rows } = await cliente.query(
    `SELECT 1 FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = ('public.' || $1::text)::regclass AND NOT t.tgisinternal
        AND p.proname = 'trazabilidad'`,
    [tabla],
  );
  return rows.length > 0;
}

// ------------------------------------------------------------------------------------------------
// 113 · Recorrido del catálogo
// ------------------------------------------------------------------------------------------------
describe('criterio 113 · toda tabla con datos de clientes lleva la trazabilidad (salvo la lista cerrada)', () => {
  it('[C0] la lista de tablas sin trigger de trazabilidad es exactamente la lista cerrada de excepciones', async () => {
    const todas = await tablasDeClientes();
    expect(todas).toEqual(expect.arrayContaining(['empresa', 'emisor', 'sucursal', 'usuario']));
    const sinTrigger: string[] = [];
    for (const tabla of todas)
      if (!(await tieneTriggerDeTrazabilidad(tabla))) sinTrigger.push(tabla);
    expect(sinTrigger.sort()).toEqual(EXCEPCIONES.filter((t) => todas.includes(t)).sort());
    // Las cuatro excepciones existen y tienen empresa_id: la lista no se puede vaciar en silencio.
    expect(todas).toEqual(
      expect.arrayContaining(['auditoria', 'sesion', 'bloqueo_intentos', 'idempotencia']),
    );
  });

  it('[C0] cada tabla trazada tiene las ocho columnas con su tipo y admite NULL', async () => {
    const problemas: string[] = [];
    for (const tabla of (await tablasDeClientes()).filter((t) => !EXCEPCIONES.includes(t))) {
      const { rows } = await admin.query<{ nombre: string; tipo: string; nulo: boolean }>(
        `SELECT a.attname::text AS nombre, format_type(a.atttypid, a.atttypmod) AS tipo, NOT a.attnotnull AS nulo
           FROM pg_attribute a
          WHERE a.attrelid = ('public.' || $1::text)::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname = ANY($2::text[])`,
        [tabla, COLUMNAS],
      );
      for (const columna of COLUMNAS) {
        const fila = rows.find((f) => f.nombre === columna);
        const esperado = columna.endsWith('_sistema') ? 'text' : 'uuid';
        if (!fila) problemas.push(`${tabla}.${columna}: falta`);
        else if (fila.tipo !== esperado) problemas.push(`${tabla}.${columna}: tipo ${fila.tipo}`);
        else if (!fila.nulo) problemas.push(`${tabla}.${columna}: no admite NULL`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it('[C0] por grupo, una restricción CHECK exige exactamente uno de usuario, superadministrador o sistema, y equipo solo con usuario', async () => {
    const problemas: string[] = [];
    for (const tabla of (await tablasDeClientes()).filter((t) => !EXCEPCIONES.includes(t))) {
      for (const grupo of GRUPOS) {
        const otro = grupo === 'creado_por' ? 'actualizado_por' : 'creado_por';
        for (const usuario of [false, true]) {
          for (const equipo of [false, true]) {
            for (const superadmin of [false, true]) {
              for (const sistema of [false, true]) {
                const valores: Record<string, unknown> = {
                  [`${otro}_sistema`]: 'otro-grupo-valido',
                };
                if (usuario) valores[`${grupo}_usuario_id`] = randomUUID();
                if (equipo) valores[`${grupo}_equipo_id`] = randomUUID();
                if (superadmin) valores[`${grupo}_superadministrador_id`] = randomUUID();
                if (sistema) valores[`${grupo}_sistema`] = 'prueba';
                const esperado =
                  [usuario, superadmin, sistema].filter(Boolean).length === 1 &&
                  (!equipo || usuario);
                const real = await checkAcepta(admin, tabla, valores);
                if (real !== esperado) {
                  problemas.push(
                    `${tabla}.${grupo}: usuario=${usuario} equipo=${equipo} superadministrador=${superadmin} sistema=${sistema} ` +
                      `debía ${esperado ? 'aceptarse' : 'rechazarse'}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(problemas).toEqual([]);
  });

  /** Llaves foráneas de una tabla que incluyen la columna dada. */
  async function llavesDe(tabla: string, columna: string) {
    const { rows } = await admin.query<{
      destino: string;
      columnas: string[];
      referenciadas: string[];
    }>(
      `SELECT cr.relname AS destino,
              (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS columnas,
              (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(n, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n) AS referenciadas
         FROM pg_constraint con JOIN pg_class cr ON cr.oid = con.confrelid
        WHERE con.contype = 'f' AND con.conrelid = ('public.' || $1::text)::regclass`,
      [tabla],
    );
    return rows.filter((f) => f.columnas.includes(columna));
  }

  it('[C0] las llaves hacia usuario son compuestas con la empresa y las de superadministrador, simples', async () => {
    const problemas: string[] = [];
    for (const tabla of (await tablasDeClientes()).filter((t) => !EXCEPCIONES.includes(t))) {
      const columnaEmpresa = tabla === 'empresa' ? 'id' : 'empresa_id';
      for (const grupo of GRUPOS) {
        const deUsuario = await llavesDe(tabla, `${grupo}_usuario_id`);
        if (deUsuario.length !== 1)
          problemas.push(`${tabla}.${grupo}_usuario_id: ${deUsuario.length} llaves`);
        else {
          const [fk] = deUsuario;
          if (fk!.destino !== 'usuario')
            problemas.push(`${tabla}.${grupo}_usuario_id apunta a ${fk!.destino}`);
          if (
            JSON.stringify(fk!.columnas) !== JSON.stringify([`${grupo}_usuario_id`, columnaEmpresa])
          )
            problemas.push(`${tabla}.${grupo}_usuario_id: columnas ${fk!.columnas}`);
          if (JSON.stringify(fk!.referenciadas) !== JSON.stringify(['id', 'empresa_id']))
            problemas.push(`${tabla}.${grupo}_usuario_id: referenciadas ${fk!.referenciadas}`);
        }
        const deSuper = await llavesDe(tabla, `${grupo}_superadministrador_id`);
        if (deSuper.length !== 1)
          problemas.push(`${tabla}.${grupo}_superadministrador_id: ${deSuper.length} llaves`);
        else {
          const [fk] = deSuper;
          if (fk!.destino !== 'superadministrador')
            problemas.push(`${tabla}.${grupo}_superadministrador_id apunta a ${fk!.destino}`);
          if (JSON.stringify(fk!.columnas) !== JSON.stringify([`${grupo}_superadministrador_id`]))
            problemas.push(`${tabla}.${grupo}_superadministrador_id: columnas ${fk!.columnas}`);
          if (JSON.stringify(fk!.referenciadas) !== JSON.stringify(['id']))
            problemas.push(
              `${tabla}.${grupo}_superadministrador_id: referenciadas ${fk!.referenciadas}`,
            );
        }
      }
    }
    expect(problemas).toEqual([]);
  });

  it('[C2] las llaves hacia equipo son compuestas con la empresa (también en las tablas de 001)', async () => {
    const problemas: string[] = [];
    for (const tabla of (await tablasDeClientes()).filter((t) => !EXCEPCIONES.includes(t))) {
      const columnaEmpresa = tabla === 'empresa' ? 'id' : 'empresa_id';
      for (const grupo of GRUPOS) {
        const deEquipo = await llavesDe(tabla, `${grupo}_equipo_id`);
        if (deEquipo.length !== 1)
          problemas.push(`${tabla}.${grupo}_equipo_id: ${deEquipo.length} llaves`);
        else {
          const [fk] = deEquipo;
          if (fk!.destino !== 'equipo')
            problemas.push(`${tabla}.${grupo}_equipo_id apunta a ${fk!.destino}`);
          if (
            JSON.stringify(fk!.columnas) !== JSON.stringify([`${grupo}_equipo_id`, columnaEmpresa])
          )
            problemas.push(`${tabla}.${grupo}_equipo_id: columnas ${fk!.columnas}`);
          if (JSON.stringify(fk!.referenciadas) !== JSON.stringify(['id', 'empresa_id']))
            problemas.push(`${tabla}.${grupo}_equipo_id: referenciadas ${fk!.referenciadas}`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });

  it('[C0] el trigger trazabilidad es BEFORE INSERT OR UPDATE por fila, está activo y llama a public.trazabilidad()', async () => {
    const problemas: string[] = [];
    for (const tabla of (await tablasDeClientes()).filter((t) => !EXCEPCIONES.includes(t))) {
      const { rows } = await admin.query<{ tgtype: number; tgenabled: string; esquema: string }>(
        `SELECT t.tgtype::int AS tgtype, t.tgenabled::text AS tgenabled, n.nspname AS esquema
           FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE t.tgrelid = ('public.' || $1::text)::regclass AND NOT t.tgisinternal AND p.proname = 'trazabilidad'`,
        [tabla],
      );
      if (rows.length !== 1) {
        problemas.push(`${tabla}: ${rows.length} triggers de trazabilidad`);
        continue;
      }
      const { tgtype, tgenabled, esquema } = rows[0]!;
      const fila = (tgtype & 1) !== 0;
      const antes = (tgtype & 2) !== 0;
      const insertar = (tgtype & 4) !== 0;
      const borrar = (tgtype & 8) !== 0;
      const actualizar = (tgtype & 16) !== 0;
      const vaciar = (tgtype & 32) !== 0;
      if (!(fila && antes && insertar && actualizar && !borrar && !vaciar)) {
        problemas.push(
          `${tabla}: el trigger no es BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype ${tgtype})`,
        );
      }
      if (tgenabled !== 'O') problemas.push(`${tabla}: el trigger no está activo (${tgenabled})`);
      if (esquema !== 'public') problemas.push(`${tabla}: la función es de ${esquema}`);
    }
    expect(problemas).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// 114 a 116 · Contexto de actor y funciones
// ------------------------------------------------------------------------------------------------
describe('criterio 116 · contexto.sesion_actor y las funciones de la trazabilidad', () => {
  it('[C0] contexto.sesion_actor es UNLOGGED, del migrador, con sus columnas y sin privilegios para nadie más', async () => {
    const { rows } = await admin.query<{ persistencia: string; dueno: string }>(
      `SELECT c.relpersistence AS persistencia, pg_get_userbyid(c.relowner) AS dueno
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'contexto' AND c.relname = 'sesion_actor'`,
    );
    expect(rows).toEqual([{ persistencia: 'u', dueno: migrador }]);
    const columnas = await admin.query<{ nombre: string }>(
      `SELECT a.attname::text AS nombre FROM pg_attribute a
        WHERE a.attrelid = 'contexto.sesion_actor'::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    expect(columnas.rows.map((c) => c.nombre)).toEqual(
      expect.arrayContaining([
        'pid',
        'xid',
        'usuario_id',
        'equipo_id',
        'superadministrador_id',
        'sistema',
      ]),
    );
    const privilegios = await admin.query<{ rol: string; privilegio: string; tiene: boolean }>(
      `SELECT r AS rol, p AS privilegio, has_table_privilege(r, 'contexto.sesion_actor', p) AS tiene
         FROM unnest(ARRAY['restaurante_api', 'restaurante_plataforma']) AS r,
              unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p`,
    );
    expect(privilegios.rows.filter((f) => f.tiene)).toEqual([]);
    const publico = await admin.query(
      `SELECT a.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
              aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'contexto' AND c.relname = 'sesion_actor' AND a.grantee = 0`,
    );
    expect(publico.rows).toEqual([]);
    for (const rol of ['api', 'plataforma'] as const) {
      const cliente = await abrirCliente(rol);
      try {
        for (const sql of [
          'SELECT * FROM contexto.sesion_actor',
          'DELETE FROM contexto.sesion_actor',
        ]) {
          const error = await errorDe(cliente.query(sql));
          expect(error.code, `${rol}: ${sql}: ${error.message}`).toBe('42501');
        }
      } finally {
        await cliente.end();
      }
    }
  });

  it.each([
    ['public.fijar_contexto_actor(uuid, uuid, uuid, text)', { api: true, plataforma: true }],
    ['public.trazabilidad()', { api: false, plataforma: false }],
  ])(
    '[C0] %s es SECURITY DEFINER del migrador, con search_path fijo y los EXECUTE esperados',
    async (firma, ejecutan) => {
      const { rows } = await admin.query<{
        definer: boolean;
        dueno: string;
        config: string[] | null;
        api: boolean;
        plataforma: boolean;
        publico: number;
      }>(
        `SELECT p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS dueno, p.proconfig AS config,
              has_function_privilege('restaurante_api', p.oid, 'EXECUTE') AS api,
              has_function_privilege('restaurante_plataforma', p.oid, 'EXECUTE') AS plataforma,
              (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [firma],
      );
      expect(rows).toHaveLength(1);
      const f = rows[0]!;
      expect(f.definer).toBe(true);
      expect(f.dueno).toBe(migrador);
      const searchPath = (f.config ?? []).find((c) => c.startsWith('search_path='));
      expect(searchPath, `proconfig: ${JSON.stringify(f.config)}`).toBeDefined();
      expect(searchPath!.replace(/\s+/g, '')).toBe('search_path=pg_catalog,pg_temp');
      expect({ api: f.api, plataforma: f.plataforma, publico: f.publico }).toEqual({
        ...ejecutan,
        publico: 0,
      });
    },
  );

  describe.each([
    ['api', 'restaurante_api'],
    ['plataforma', 'restaurante_plataforma'],
  ] as const)('fijar_contexto_actor como %s', (rol, _usuario) => {
    let cliente: Client;
    beforeAll(async () => {
      cliente = await abrirCliente(rol);
    });
    afterAll(async () => {
      await cliente?.end();
    });

    /** Ejecuta `fn` en una transacción que se revierte. */
    async function enTx<T>(fn: () => Promise<T>): Promise<T> {
      await cliente.query('BEGIN');
      try {
        return await fn();
      } finally {
        await cliente.query('ROLLBACK');
      }
    }
    const fijar = (args: readonly (string | null)[]) =>
      cliente.query('SELECT fijar_contexto_actor($1, $2, $3, $4)', [...args]);

    it('[C0] acepta exactamente un actor: usuario (con equipo opcional), superadministrador o sistema', async () => {
      for (const [nombre, args] of [
        ['usuario', [randomUUID(), null, null, null]],
        ['usuario con equipo', [randomUUID(), randomUUID(), null, null]],
        ['superadministrador', [null, null, randomUUID(), null]],
        ['sistema', [null, null, null, 'semilla']],
      ] as const) {
        await enTx(async () => {
          await fijar(args);
        });
        expect(nombre).toBeTruthy();
      }
    });

    it.each([
      ['ninguno', [null, null, null, null]],
      ['usuario y superadministrador', [randomUUID(), null, randomUUID(), null]],
      ['usuario y sistema', [randomUUID(), null, null, 'x']],
      ['superadministrador y sistema', [null, null, randomUUID(), 'x']],
      ['los tres', [randomUUID(), null, randomUUID(), 'x']],
      ['equipo sin usuario (con sistema)', [null, randomUUID(), null, 'x']],
      ['equipo sin usuario (con superadministrador)', [null, randomUUID(), randomUUID(), null]],
      ['equipo solo', [null, randomUUID(), null, null]],
      ['sistema vacío', [null, null, null, '']],
      ['sistema de más de 100 caracteres', [null, null, null, 'x'.repeat(101)]],
    ] as const)('[C0] rechaza %s con 22023', async (_nombre, args) => {
      await enTx(async () => {
        const error = await errorDe(fijar(args));
        expect(error.code, error.message).toBe('22023');
      });
    });

    it('[C0] acepta un sistema de 1 y de 100 caracteres', async () => {
      for (const sistema of ['x', 'y'.repeat(100)]) {
        await enTx(async () => {
          await fijar([null, null, null, sistema]);
        });
      }
    });

    it('[C0] una segunda llamada en la misma transacción falla con 42501, aunque sea el mismo actor', async () => {
      const usuario = randomUUID();
      for (const segundo of [
        [usuario, null, null, null],
        [randomUUID(), null, null, null],
        [null, null, null, 'otro'],
      ] as const) {
        await enTx(async () => {
          await fijar([usuario, null, null, null]);
          const error = await errorDe(fijar(segundo));
          expect(error.code, error.message).toBe('42501');
        });
      }
    });

    it('[C0] el actor muere con la transacción (confirmada o revertida)', async () => {
      for (const cierre of ['COMMIT', 'ROLLBACK']) {
        await cliente.query('BEGIN');
        await fijar([null, null, null, 'efimero']);
        await cliente.query(cierre);
        // Otra transacción de la misma conexión puede fijar otro actor.
        await cliente.query('BEGIN');
        try {
          await fijar([null, null, null, 'siguiente']);
        } finally {
          await cliente.query('ROLLBACK');
        }
      }
    });
  });
});

// ------------------------------------------------------------------------------------------------
// 114, 115 · Lo llena la base y sin actor no hay escritura (SQL directo)
// ------------------------------------------------------------------------------------------------
describe('criterios 114 y 115 · SQL directo con y sin actor', () => {
  let plataformaCliente: Client;
  let apiCliente: Client;
  let A: EmpresaSql;

  beforeAll(async () => {
    plataformaCliente = await abrirCliente('plataforma');
    apiCliente = await abrirCliente('api');
  });
  afterAll(async () => {
    await plataformaCliente?.end();
    await apiCliente?.end();
  });

  const empresaSql = async () => {
    A ??= await crearEmpresaSql(plataformaCliente);
    return A;
  };

  async function comoApi<T>(
    empresaId: string,
    actor: string | null,
    fn: () => Promise<T>,
    confirmar = false,
  ): Promise<T> {
    await apiCliente.query('BEGIN');
    try {
      if (actor !== null)
        await apiCliente.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', [actor]);
      await apiCliente.query('SELECT fijar_contexto_empresa($1)', [empresaId]);
      const resultado = await fn();
      await apiCliente.query(confirmar ? 'COMMIT' : 'ROLLBACK');
      return resultado;
    } catch (error) {
      await apiCliente.query('ROLLBACK');
      throw error;
    }
  }

  it('[C0] sin actor, un UPDATE o un INSERT como restaurante_api falla con 42501 "contexto de actor ausente" y no escribe nada', async () => {
    const empresa = await empresaSql();
    const sucursalId = empresa.sucursales[0]!.id;
    const ruc = rucAleatorio();
    const antes = (
      await plataformaCliente.query('SELECT direccion FROM sucursal WHERE id = $1', [sucursalId])
    ).rows[0];
    for (const [nombre, sql, parametros] of [
      ['UPDATE', "UPDATE sucursal SET direccion = 'sin actor' WHERE id = $1", [sucursalId]],
      [
        'INSERT',
        `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
         VALUES ($1, $2, 'Sin actor SAC', 'GENERAL', now(), now())`,
        [empresa.id, ruc],
      ],
    ] as const) {
      const error = await errorDe(
        comoApi(empresa.id, null, () => apiCliente.query(sql, [...parametros])),
      );
      expect(error.code, `${nombre}: ${error.message}`).toBe('42501');
      expect(error.message, nombre).toMatch(/contexto de actor ausente/);
    }
    expect(
      (await plataformaCliente.query('SELECT direccion FROM sucursal WHERE id = $1', [sucursalId]))
        .rows[0],
    ).toEqual(antes);
    expect(
      (await plataformaCliente.query('SELECT 1 FROM emisor WHERE ruc = $1', [ruc])).rows,
    ).toHaveLength(0);
  });

  it('[C0] sin actor, un UPDATE o un INSERT como restaurante_plataforma falla con 42501 "contexto de actor ausente"', async () => {
    const empresa = await empresaSql();
    const nombre = (
      await plataformaCliente.query('SELECT nombre FROM empresa WHERE id = $1', [empresa.id])
    ).rows[0].nombre;
    for (const [etiqueta, sql, parametros] of [
      ['UPDATE', "UPDATE empresa SET nombre = 'sin actor' WHERE id = $1", [empresa.id]],
      [
        'INSERT',
        'INSERT INTO empresa (nombre, creado_en, actualizado_en) VALUES ($1, now(), now())',
        [textoUnico('Sin actor')],
      ],
    ] as const) {
      await plataformaCliente.query('BEGIN');
      try {
        const error = await errorDe(plataformaCliente.query(sql, [...parametros]));
        expect(error.code, `${etiqueta}: ${error.message}`).toBe('42501');
        expect(error.message, etiqueta).toMatch(/contexto de actor ausente/);
      } finally {
        await plataformaCliente.query('ROLLBACK');
      }
    }
    expect(
      (await plataformaCliente.query('SELECT nombre FROM empresa WHERE id = $1', [empresa.id]))
        .rows[0].nombre,
    ).toBe(nombre);
  });

  it('[C0] los valores enviados en las columnas de trazabilidad se ignoran al insertar: manda el actor de la transacción', async () => {
    const empresa = await empresaSql();
    const ruc = rucAleatorio();
    const impostor = randomUUID();
    const id = await comoApi(
      empresa.id,
      'actor-real-114',
      async () => {
        const { rows } = await apiCliente.query<{ id: string }>(
          `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en,
                               creado_por_usuario_id, creado_por_sistema, actualizado_por_usuario_id, actualizado_por_sistema)
           VALUES ($1, $2, 'Con impostor SAC', 'GENERAL', now(), now(), $3, 'impostor', $3, 'impostor') RETURNING id`,
          [empresa.id, ruc, impostor],
        );
        return rows[0]!.id;
      },
      true,
    );
    const fila = (await plataformaCliente.query('SELECT * FROM emisor WHERE id = $1', [id]))
      .rows[0];
    expect(fila).toMatchObject({
      creado_por_sistema: 'actor-real-114',
      creado_por_usuario_id: null,
      creado_por_equipo_id: null,
      creado_por_superadministrador_id: null,
      actualizado_por_sistema: 'actor-real-114',
      actualizado_por_usuario_id: null,
      actualizado_por_equipo_id: null,
      actualizado_por_superadministrador_id: null,
    });
  });

  it('[C0] insertar con todas las columnas de trazabilidad en NULL tampoco falla: las llena el actor', async () => {
    const empresa = await empresaSql();
    const ruc = rucAleatorio();
    const id = await comoApi(
      empresa.id,
      'actor-nulos-114',
      async () => {
        const { rows } = await apiCliente.query<{ id: string }>(
          `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en,
                               creado_por_usuario_id, creado_por_sistema, actualizado_por_usuario_id, actualizado_por_sistema)
           VALUES ($1, $2, 'Con nulos SAC', 'GENERAL', now(), now(), NULL, NULL, NULL, NULL) RETURNING id`,
          [empresa.id, ruc],
        );
        return rows[0]!.id;
      },
      true,
    );
    const fila = (
      await plataformaCliente.query(
        'SELECT creado_por_sistema, actualizado_por_sistema FROM emisor WHERE id = $1',
        [id],
      )
    ).rows[0];
    expect(fila).toEqual({
      creado_por_sistema: 'actor-nulos-114',
      actualizado_por_sistema: 'actor-nulos-114',
    });
  });

  it('[C0] al actualizar, actualizado_por_* pasa al actor y creado_por_* no cambia, aunque se intente cambiarlo', async () => {
    const empresa = await empresaSql();
    const sucursalId = empresa.sucursales[0]!.id;
    const antes = (
      await plataformaCliente.query(
        'SELECT creado_por_sistema, creado_por_usuario_id FROM sucursal WHERE id = $1',
        [sucursalId],
      )
    ).rows[0];
    await comoApi(
      empresa.id,
      'actor-actualiza-114',
      () =>
        apiCliente.query(
          `UPDATE sucursal SET direccion = 'Cambiada 114', creado_por_sistema = 'impostor', creado_por_usuario_id = $2,
                  actualizado_por_sistema = 'impostor'
            WHERE id = $1`,
          [sucursalId, randomUUID()],
        ),
      true,
    );
    const despues = (
      await plataformaCliente.query('SELECT * FROM sucursal WHERE id = $1', [sucursalId])
    ).rows[0];
    expect(despues.direccion).toBe('Cambiada 114');
    expect(despues.creado_por_sistema).toBe(antes.creado_por_sistema);
    expect(despues.creado_por_usuario_id).toBe(antes.creado_por_usuario_id);
    expect(despues).toMatchObject({
      actualizado_por_sistema: 'actor-actualiza-114',
      actualizado_por_usuario_id: null,
      actualizado_por_superadministrador_id: null,
    });
  });
});

// ------------------------------------------------------------------------------------------------
// 116 · Usuario o equipo de otra empresa como actor
// ------------------------------------------------------------------------------------------------
describe('criterio 116 · un usuario o un equipo de B como actor con el contexto de A falla por la llave foránea compuesta', () => {
  let ctx: AppDePrueba;
  let apiCliente: Client;
  let plataformaCliente: Client;
  let A: EmpresaDePrueba;
  let B: EmpresaDePrueba;
  let sembradoPendiente: Promise<void> | undefined;
  let equipoDeB: string | undefined;

  beforeAll(async () => {
    ctx = await arrancar();
    apiCliente = await abrirCliente('api');
    plataformaCliente = await abrirCliente('plataforma');
  });
  afterAll(async () => {
    await apiCliente?.end();
    await plataformaCliente?.end();
    await ctx?.cerrar();
  });

  function sembrar() {
    sembradoPendiente ??= (async () => {
      const sa = await nuevoSuperadmin(ctx);
      A = await altaEmpresa(ctx, sa);
      B = await altaEmpresa(ctx, sa);
    })();
    return sembradoPendiente;
  }

  async function actualizarComo(
    actor: [string | null, string | null],
    empresaId: string,
    sucursalId: string,
  ) {
    await apiCliente.query('BEGIN');
    try {
      await apiCliente.query('SELECT fijar_contexto_actor($1, $2, NULL, NULL)', actor);
      await apiCliente.query('SELECT fijar_contexto_empresa($1)', [empresaId]);
      return await errorDe(
        apiCliente.query("UPDATE sucursal SET direccion = 'cruzada' WHERE id = $1", [sucursalId]),
      );
    } finally {
      await apiCliente.query('ROLLBACK');
    }
  }

  it('[C0] con un usuario de B como actor, la escritura en A falla con 23503', async () => {
    await sembrar();
    const error = await actualizarComo([B.admin.id, null], A.empresaId, A.sucursales[0]!.id);
    expect(error.code, error.message).toBe('23503');
    const antes = (
      await plataformaCliente.query('SELECT direccion FROM sucursal WHERE id = $1', [
        A.sucursales[0]!.id,
      ])
    ).rows[0];
    expect(antes.direccion).not.toBe('cruzada');
  });

  it('[C0] con un usuario de A como actor la misma escritura funciona y queda a su nombre', async () => {
    await sembrar();
    await apiCliente.query('BEGIN');
    try {
      await apiCliente.query('SELECT fijar_contexto_actor($1, NULL, NULL, NULL)', [A.admin.id]);
      await apiCliente.query('SELECT fijar_contexto_empresa($1)', [A.empresaId]);
      await apiCliente.query("UPDATE sucursal SET direccion = 'propia 116' WHERE id = $1", [
        A.sucursales[0]!.id,
      ]);
      const { rows } = await apiCliente.query(
        'SELECT actualizado_por_usuario_id, actualizado_por_equipo_id, actualizado_por_sistema FROM sucursal WHERE id = $1',
        [A.sucursales[0]!.id],
      );
      expect(rows[0]).toEqual({
        actualizado_por_usuario_id: A.admin.id,
        actualizado_por_equipo_id: null,
        actualizado_por_sistema: null,
      });
    } finally {
      await apiCliente.query('ROLLBACK');
    }
  });

  it('[C2] con un equipo de B (aunque el usuario sea de A) como actor, la escritura en A falla con 23503', async () => {
    await sembrar();
    equipoDeB ??= (await recordarEquipo(ctx, B.admin.token)).equipo.id;
    const error = await actualizarComo([A.admin.id, equipoDeB], A.empresaId, A.sucursales[0]!.id);
    expect(error.code, error.message).toBe('23503');
  });
});

// ------------------------------------------------------------------------------------------------
// 118 · Las tablas de 001 y la reversión
// ------------------------------------------------------------------------------------------------
describe('criterio 118 · la migración de trazabilidad sobre empresa, emisor y sucursal', () => {
  let base: Awaited<ReturnType<typeof crearBaseNueva>>;
  let plataformaCliente: Client;
  let adminCliente: Client;
  const ids = { empresa: '', emisor: '', sucursal: '' };
  let fotoOriginal: Record<string, unknown> = {};

  const sinTrazabilidad = (tabla: string, id: string) =>
    adminCliente
      .query(`SELECT to_jsonb(t) - $2::text[] AS fila FROM ${tabla} t WHERE id = $1`, [
        id,
        COLUMNAS,
      ])
      .then((r) => r.rows[0]!.fila);

  afterAll(async () => {
    await plataformaCliente?.end().catch(() => undefined);
    await adminCliente?.end().catch(() => undefined);
    await base?.eliminar();
  });

  it('prepara una base con las migraciones de 001 y filas de empresa, emisor y sucursal', async () => {
    base = await crearBaseNueva('traza');
    await migrarHasta(base.base, PREFIJO_CONTEXTO_UNICO);
    plataformaCliente = await abrirCliente('plataforma', base.base);
    adminCliente = await abrirCliente('admin', base.base);
    ids.empresa = (
      await plataformaCliente.query(
        'INSERT INTO empresa (nombre, creado_en, actualizado_en) VALUES ($1, now(), now()) RETURNING id',
        [textoUnico('Empresa-001')],
      )
    ).rows[0].id;
    ids.emisor = (
      await plataformaCliente.query(
        `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
         VALUES ($1, $2, 'Emisor 001 SAC', 'GENERAL', now(), now()) RETURNING id`,
        [ids.empresa, rucAleatorio()],
      )
    ).rows[0].id;
    ids.sucursal = (
      await plataformaCliente.query(
        `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
         VALUES ($1, $2, $3, '0001', 'Av. 001 123', now(), now()) RETURNING id`,
        [ids.empresa, ids.emisor, textoUnico('Sucursal-001')],
      )
    ).rows[0].id;
    fotoOriginal = {
      empresa: await sinTrazabilidad('empresa', ids.empresa),
      emisor: await sinTrazabilidad('emisor', ids.emisor),
      sucursal: await sinTrazabilidad('sucursal', ids.sucursal),
    };
  });

  it('[C0] al migrar, las filas existentes quedan con creado_por_sistema y actualizado_por_sistema = migracion:trazabilidad y sus demás datos intactos', async () => {
    await migrarHasta(base.base, PREFIJO_TRAZABILIDAD);
    for (const [tabla, id] of [
      ['empresa', ids.empresa],
      ['emisor', ids.emisor],
      ['sucursal', ids.sucursal],
    ] as const) {
      const { rows } = await adminCliente.query(`SELECT * FROM ${tabla} WHERE id = $1`, [id]);
      expect(rows[0], tabla).toMatchObject({
        creado_por_sistema: 'migracion:trazabilidad',
        actualizado_por_sistema: 'migracion:trazabilidad',
        creado_por_usuario_id: null,
        creado_por_equipo_id: null,
        creado_por_superadministrador_id: null,
        actualizado_por_usuario_id: null,
        actualizado_por_equipo_id: null,
        actualizado_por_superadministrador_id: null,
      });
      expect(await sinTrazabilidad(tabla, id), `${tabla}: las columnas de 001 no cambian`).toEqual(
        fotoOriginal[tabla],
      );
      expect(await tieneTriggerDeTrazabilidad(tabla, adminCliente), `${tabla}: trigger`).toBe(true);
    }
  });

  it('[C0] revertir la migración quita columnas, restricciones y trigger sin tocar los demás datos', async () => {
    await revertirHasta(base.base, PREFIJO_TRAZABILIDAD);
    for (const [tabla, id] of [
      ['empresa', ids.empresa],
      ['emisor', ids.emisor],
      ['sucursal', ids.sucursal],
    ] as const) {
      const columnas = await adminCliente.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = ('public.' || $1::text)::regclass
            AND attnum > 0 AND NOT attisdropped AND attname = ANY($2::text[])`,
        [tabla, COLUMNAS],
      );
      expect(columnas.rows, `${tabla}: columnas`).toEqual([]);
      expect(await tieneTriggerDeTrazabilidad(tabla, adminCliente), `${tabla}: trigger`).toBe(
        false,
      );
      const restricciones = await adminCliente.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = ('public.' || $1::text)::regclass
            AND (conname ILIKE '%creado_por%' OR conname ILIKE '%actualizado_por%')`,
        [tabla],
      );
      expect(restricciones.rows, `${tabla}: restricciones`).toEqual([]);
      const { rows } = await adminCliente.query(
        `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.fila, `${tabla}: datos`).toEqual(fotoOriginal[tabla]);
    }
  });

  it('[C0] volver a migrar deja otra vez las filas con migracion:trazabilidad', async () => {
    await migrarHasta(base.base);
    const { rows } = await adminCliente.query(
      'SELECT creado_por_sistema, actualizado_por_sistema FROM sucursal WHERE id = $1',
      [ids.sucursal],
    );
    expect(rows).toEqual([
      {
        creado_por_sistema: 'migracion:trazabilidad',
        actualizado_por_sistema: 'migracion:trazabilidad',
      },
    ]);
  });
});
