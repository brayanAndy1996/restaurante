// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P1 (parte 1) · Resolución pública de la empresa (ruta crítica), criterios 11 a 14 y 17:
// - 12: `public.empresa_de_carta(text)` y `public.empresa_de_codigo_mesa(text)` son `SECURITY DEFINER` de
//   `restaurante_migrador`, con `search_path = pg_catalog, pg_temp`, `EXECUTE` solo para `restaurante_api` (ni
//   plataforma, ni tiempo real, ni `PUBLIC`), devuelven `uuid` por coincidencia exacta o `null` (`%` y `_` no son
//   comodines; el código distingue mayúsculas) y leen un espejo (`carta_publica`) que ningún rol de la aplicación
//   puede leer ni escribir (`42501`);
// - 13: la API las llama fuera de toda transacción y de todo contexto con una consulta fija (motivos
//   `carta-publica` y `codigo-mesa`, un parámetro de texto) y después corre toda la petición en una sola
//   `ContextoEmpresa.ejecutar`, con un solo `fijar_contexto_empresa`; una consulta marcada con esos motivos y otro
//   texto falla como sin contexto; dentro de un contexto la guarda rechaza cualquier mención de las dos funciones;
// - 14: el mismo 404 `{ codigo: 'NO_ENCONTRADO', mensaje: 'La carta no está disponible' }` para todo lo que no se
//   ve (código desconocido, de una mesa inactiva o reemplazado; dirección de empresa o de sucursal inexistente;
//   sucursal sin publicar o sin `PEDIDOS_WEB`; llamado de otra mesa) y, con formas inválidas, sin consultar la base;
//   una suscripción suspendida no cambia nada;
// - 11: las rutas públicas ignoran `Authorization` y la cabecera `x-empresa-id` del modo de prueba;
// - 17: un `POST` público de más de 16 KB responde 413 `CUERPO_DEMASIADO_GRANDE` sin consultar la base.
// Hoy las funciones, el espejo y las tablas no existen y `buscarEmpresaDeCarta` y `buscarEmpresaDeCodigoMesa`
// lanzan "No implementado": las pruebas fallan por eso.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Client, DatabaseError as ErrorDePg } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API, ConsultaProhibidaError } from '../../src/nucleo/base-de-datos';
import {
  buscarEmpresaDeCarta,
  buscarEmpresaDeCodigoMesa,
} from '../../src/nucleo/base-de-datos/consultas-sin-empresa';
import { ContextoEmpresa, ContextoEmpresaAusenteError } from '../../src/nucleo/contexto-empresa';
import { RelojManual } from '../../src/nucleo/reloj';
import { bearer } from '../acceso/fabrica-plataforma';
import { variantes, type EntradaProhibida } from '../aislamiento/nombres-prohibidos';
import { NOMBRES_DE_ROLES, abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { ROL_TIEMPO_REAL } from '../../scripts/lib/roles';
import {
  BUSCA_EMPRESA,
  CARTA_WEB_URL,
  CUERPO_404_PUBLICO,
  ES_CONTROL_DE_TRANSACCION,
  FIJA_CONTEXTO,
  INICIO_TARDE,
  ClientePublico,
  arrancarAislamiento,
  clientePublico,
  codigoInexistente,
  crearLlamadoOk,
  crearMundo,
  exigirEstado,
  exigirSinFallos,
  invertirCaja,
  llamarAlMozo,
  mesasNuevas,
  pedidoDeLomo,
  registrarConsultas,
  rutaDeLlamados,
  unico,
  llamar,
  type AppP4,
  type ConsultaRegistrada,
  type Mundo,
} from './fabrica-aislamiento';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP4;
let admin: Client;
let apiCliente: Client;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let mundoPendiente: Promise<Mundo> | undefined;
const mundo = () => (mundoPendiente ??= crearMundo(ctx));

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2 });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
  sequelize = ctx.app.get<Sequelize>(CONEXION_API);
  contexto = ctx.app.get(ContextoEmpresa);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

const migrador = NOMBRES_DE_ROLES.migrador;
const rolApi = NOMBRES_DE_ROLES.api;
const rolPlataforma = NOMBRES_DE_ROLES.plataforma;

const FUNCIONES = ['empresa_de_carta', 'empresa_de_codigo_mesa'] as const;

/** La misma respuesta de "no está disponible" en cualquier ruta pública (criterio 14). */
function exigir404(res: { status: number; body: unknown; text: string }, donde: string): void {
  expect({ donde, estado: res.status, cuerpo: res.body }).toEqual({
    donde,
    estado: 404,
    cuerpo: CUERPO_404_PUBLICO,
  });
}

// ------------------------------------------------------------------------------------------------
// 12 · Las dos funciones de búsqueda
// ------------------------------------------------------------------------------------------------
describe.each(FUNCIONES)('criterio 12 · public.%s(text) en el catálogo', (nombre) => {
  it('es SECURITY DEFINER de restaurante_migrador, con search_path fijo, y devuelve uuid', async () => {
    const { rows } = await admin.query<{
      definer: boolean;
      dueno: string;
      config: string[] | null;
      retorno: string;
    }>(
      `SELECT p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS dueno, p.proconfig AS config,
              pg_get_function_result(p.oid) AS retorno
         FROM pg_proc p WHERE p.oid = 'public.${nombre}(text)'::regprocedure`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.definer).toBe(true);
    expect(rows[0]!.dueno).toBe(migrador);
    expect(rows[0]!.retorno).toBe('uuid');
    const searchPath = (rows[0]!.config ?? []).find((c) => c.startsWith('search_path='));
    expect(searchPath, `proconfig: ${JSON.stringify(rows[0]!.config)}`).toBeDefined();
    expect(searchPath!.replace(/\s+/g, '')).toBe('search_path=pg_catalog,pg_temp');
  });

  it('EXECUTE solo para restaurante_api: ni plataforma, ni tiempo real, ni PUBLIC', async () => {
    const { rows } = await admin.query<{
      api: boolean;
      plataforma: boolean;
      tiempo_real: boolean;
      publico: number;
    }>(
      `SELECT has_function_privilege($1, f.oid, 'EXECUTE') AS api,
              has_function_privilege($2, f.oid, 'EXECUTE') AS plataforma,
              has_function_privilege($3, f.oid, 'EXECUTE') AS tiempo_real,
              (SELECT count(*)::int FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc f WHERE f.oid = 'public.${nombre}(text)'::regprocedure`,
      [rolApi, rolPlataforma, ROL_TIEMPO_REAL],
    );
    expect(rows).toEqual([{ api: true, plataforma: false, tiempo_real: false, publico: 0 }]);
  });

  it('el rol de plataforma recibe 42501 al llamarla', async () => {
    const cliente = await abrirCliente('plataforma');
    try {
      await cliente.query('BEGIN');
      const intento = await cliente.query(`SELECT public.${nombre}('cualquiera')`).then(
        () => undefined,
        (e: unknown) => e as ErrorDePg,
      );
      await cliente.query('ROLLBACK');
      expect(intento, 'la función debía rechazarse').toBeDefined();
      expect(intento!.code, intento!.message).toBe('42501');
    } finally {
      await cliente.end();
    }
  });
});

describe('criterio 12 · el esquema carta_publica no es accesible para la aplicación', () => {
  it('es de restaurante_migrador y ningún rol de la aplicación, ni PUBLIC, tiene USAGE ni CREATE', async () => {
    const dueno = await admin.query<{ dueno: string }>(
      `SELECT pg_get_userbyid(nspowner) AS dueno FROM pg_namespace WHERE nspname = 'carta_publica'`,
    );
    expect(dueno.rows, 'el esquema carta_publica existe').toEqual([{ dueno: migrador }]);
    const { rows } = await admin.query<{ rol: string; usage: boolean; crear: boolean }>(
      `SELECT r AS rol, has_schema_privilege(r, 'carta_publica', 'USAGE') AS usage,
              has_schema_privilege(r, 'carta_publica', 'CREATE') AS crear
         FROM unnest($1::text[]) AS r`,
      [[rolApi, rolPlataforma, ROL_TIEMPO_REAL]],
    );
    expect(rows).toEqual([
      { rol: rolApi, usage: false, crear: false },
      { rol: rolPlataforma, usage: false, crear: false },
      { rol: ROL_TIEMPO_REAL, usage: false, crear: false },
    ]);
    const publico = await admin.query(
      `SELECT a.privilege_type FROM pg_namespace n,
              aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE n.nspname = 'carta_publica' AND a.grantee = 0`,
    );
    expect(publico.rows, 'privilegios de PUBLIC sobre carta_publica').toEqual([]);
  });

  it('empresa_slug y codigo_mesa existen con la forma de spec.md y la RLS activada', async () => {
    const columnas = async (tabla: string) =>
      (
        await admin.query<{ nombre: string }>(
          `SELECT a.attname::text AS nombre FROM pg_attribute a
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attname`,
          [`carta_publica.${tabla}`],
        )
      ).rows.map((c) => c.nombre);
    expect(await columnas('empresa_slug')).toEqual(['empresa_id', 'slug']);
    expect(await columnas('codigo_mesa')).toEqual(['codigo', 'empresa_id']);
    const rls = await admin.query<{ tabla: string; rls: boolean }>(
      `SELECT c.relname::text AS tabla, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'carta_publica' AND c.relname IN ('empresa_slug', 'codigo_mesa')
        ORDER BY c.relname`,
    );
    expect(rls.rows).toEqual([
      { tabla: 'codigo_mesa', rls: true },
      { tabla: 'empresa_slug', rls: true },
    ]);
  });

  it.each([
    ['restaurante_api', 'api' as const],
    ['restaurante_plataforma', 'plataforma' as const],
    ['restaurante_tiempo_real', 'tiempoReal' as const],
  ])('%s recibe 42501 al leer o escribir carta_publica.*', async (_nombre, rol) => {
    const cliente = await abrirCliente(rol);
    try {
      const sentencias = [
        'SELECT * FROM carta_publica.empresa_slug',
        'SELECT * FROM carta_publica.codigo_mesa',
        "INSERT INTO carta_publica.empresa_slug (slug, empresa_id) VALUES ('x-xx', gen_random_uuid())",
        "INSERT INTO carta_publica.codigo_mesa (codigo, empresa_id) VALUES ('x', gen_random_uuid())",
        "UPDATE carta_publica.empresa_slug SET slug = 'otro-slug'",
        "UPDATE carta_publica.codigo_mesa SET codigo = 'otro'",
        'DELETE FROM carta_publica.empresa_slug',
        'DELETE FROM carta_publica.codigo_mesa',
      ];
      const fallos: string[] = [];
      for (const sql of sentencias) {
        await cliente.query('BEGIN');
        const error = await cliente.query(sql).then(
          () => undefined,
          (e: unknown) => e as ErrorDePg,
        );
        await cliente.query('ROLLBACK');
        if (error === undefined) fallos.push(`${sql}: tuvo éxito`);
        else if (error.code !== '42501') fallos.push(`${sql}: ${error.code} ${error.message}`);
      }
      exigirSinFallos(fallos);
    } finally {
      await cliente.end();
    }
  });
});

describe('criterio 12 · coincidencia exacta, sin comodines', () => {
  const empresaDe = async (funcion: (typeof FUNCIONES)[number], texto: string | null) =>
    (await apiCliente.query<{ id: string | null }>(`SELECT public.${funcion}($1) AS id`, [texto]))
      .rows[0]!.id;

  it('empresa_de_carta devuelve la empresa de la dirección exacta y null para textos parecidos', async () => {
    const { A, B } = await mundo();
    expect(await empresaDe('empresa_de_carta', A.slug)).toBe(A.empresaId);
    expect(await empresaDe('empresa_de_carta', B.slug)).toBe(B.empresaId);
    const parecidos = [
      '%',
      '_',
      '%%',
      `${A.slug.slice(0, 5)}%`,
      `%${A.slug.slice(3)}`,
      A.slug.replace('-', '_'), // `_` coincidiría con `-` si fuera un LIKE
      A.slug.replace(/[a-z]/, '_'),
      A.slug.slice(0, -1),
      `${A.slug}x`,
      ` ${A.slug}`,
      `${A.slug} `,
      `${A.slug}\n`,
      '',
      ' ',
      'x'.repeat(10_000),
    ];
    for (const texto of parecidos) {
      expect(
        await empresaDe('empresa_de_carta', texto),
        JSON.stringify(texto.slice(0, 60)),
      ).toBeNull();
    }
    expect(await empresaDe('empresa_de_carta', null)).toBeNull();
  });

  it('empresa_de_codigo_mesa devuelve la empresa del código exacto, distingue mayúsculas y null para textos parecidos', async () => {
    const { A, B } = await mundo();
    const codigo = A.mesa4.codigo;
    expect(await empresaDe('empresa_de_codigo_mesa', codigo)).toBe(A.empresaId);
    expect(await empresaDe('empresa_de_codigo_mesa', B.mesa4.codigo)).toBe(B.empresaId);
    expect(await empresaDe('empresa_de_codigo_mesa', A.mesa12.codigo)).toBe(A.empresaId);
    expect(await empresaDe('empresa_de_codigo_mesa', A.mesaS2.codigo)).toBe(A.empresaId);
    const otraCaja = invertirCaja(codigo);
    expect(otraCaja, 'el código tiene letras').not.toBe(codigo);
    const parecidos = [
      otraCaja,
      codigo.toLowerCase() === codigo ? codigo.toUpperCase() : codigo.toLowerCase(),
      '%',
      '_',
      '%%',
      `${codigo.slice(0, 8)}%`,
      `%${codigo.slice(8)}`,
      '_'.repeat(22),
      codigo.replace(/[A-Za-z]/, '_'),
      codigo.slice(0, -1),
      `${codigo}x`,
      ` ${codigo}`,
      `${codigo} `,
      `${codigo}\n`,
      '',
      'x'.repeat(10_000),
    ];
    for (const texto of parecidos) {
      expect(
        await empresaDe('empresa_de_codigo_mesa', texto),
        JSON.stringify(texto.slice(0, 60)),
      ).toBeNull();
    }
    expect(await empresaDe('empresa_de_codigo_mesa', null)).toBeNull();
    // Un código es un código y una dirección es una dirección: no se cruzan.
    expect(await empresaDe('empresa_de_carta', codigo)).toBeNull();
    expect(await empresaDe('empresa_de_codigo_mesa', A.slug)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// 13 · Las funciones de búsqueda de la API: consulta fija, sin transacción, sin contexto
// ------------------------------------------------------------------------------------------------
describe('criterio 13 · buscarEmpresaDeCarta y buscarEmpresaDeCodigoMesa', () => {
  it('devuelven la empresa por coincidencia exacta (la dirección en minúsculas, el código con su caja) y null si no hay', async () => {
    const { A, B } = await mundo();
    expect(await buscarEmpresaDeCarta(sequelize, A.slug)).toBe(A.empresaId);
    expect(await buscarEmpresaDeCarta(sequelize, B.slug)).toBe(B.empresaId);
    expect(await buscarEmpresaDeCodigoMesa(sequelize, A.mesa4.codigo)).toBe(A.empresaId);
    expect(await buscarEmpresaDeCodigoMesa(sequelize, B.mesa12.codigo)).toBe(B.empresaId);
    for (const texto of ['%', '_', `${A.slug}%`, 'no-existe-esta-direccion', '']) {
      expect(await buscarEmpresaDeCarta(sequelize, texto), texto).toBeNull();
    }
    for (const texto of [
      '%',
      '_'.repeat(22),
      invertirCaja(A.mesa4.codigo),
      codigoInexistente(),
      '',
    ]) {
      expect(await buscarEmpresaDeCodigoMesa(sequelize, texto), texto).toBeNull();
    }
  });

  type Buscar = (texto: string) => Promise<string | null>;
  const CASOS: [string, 'carta-publica' | 'codigo-mesa', 'autenticacion' | 'salud', Buscar][] = [
    [
      'buscarEmpresaDeCarta',
      'carta-publica',
      'autenticacion',
      (t) => buscarEmpresaDeCarta(sequelize, t),
    ],
    [
      'buscarEmpresaDeCodigoMesa',
      'codigo-mesa',
      'salud',
      (t) => buscarEmpresaDeCodigoMesa(sequelize, t),
    ],
  ];

  /** Corre la búsqueda y devuelve la única consulta que hizo a la base. */
  async function consultaDe(buscar: Buscar, texto: string): Promise<ConsultaRegistrada> {
    const registro = registrarConsultas(ctx.app);
    try {
      await buscar(texto);
      const datos = registro.consultas.filter((c) => !ES_CONTROL_DE_TRANSACCION.test(c.sql));
      expect(datos, 'la búsqueda hace una sola consulta').toHaveLength(1);
      return datos[0]!;
    } finally {
      registro.detener();
    }
  }

  it.each(CASOS)(
    '%s corre una consulta fija marcada con su motivo, con un parámetro de texto y sin transacción',
    async (_nombre, motivo, _otro, buscar) => {
      const { A } = await mundo();
      const texto = motivo === 'carta-publica' ? A.slug : A.mesa4.codigo;
      const consulta = await consultaDe(buscar, texto);
      expect(consulta.opciones?.sinEmpresa).toBe(motivo);
      expect(consulta.opciones?.bind).toEqual([texto]);
      expect(consulta.opciones?.transaction ?? null).toBeNull();
      expect(consulta.sql).toMatch(
        motivo === 'carta-publica' ? /empresa_de_carta/i : /empresa_de_codigo_mesa/i,
      );
    },
  );

  it.each(CASOS)(
    '%s: la marca solo vale para su texto exacto, con un parámetro de texto, sin transacción y fuera de todo contexto',
    async (_nombre, motivo, otroMotivo, buscar) => {
      const { A } = await mundo();
      const texto = motivo === 'carta-publica' ? A.slug : A.mesa4.codigo;
      const { sql } = await consultaDe(buscar, texto);
      const marcada = (consulta: string, opciones: Record<string, unknown>) =>
        sequelize.query(consulta, { sinEmpresa: motivo, ...opciones } as never).then(
          () => undefined,
          (e: unknown) => e,
        );
      // Otro texto con la marca.
      expect(await marcada('SELECT nombre FROM sucursal', { bind: ['x'] })).toBeInstanceOf(
        ContextoEmpresaAusenteError,
      );
      expect(await marcada('SELECT 1 AS ok', {})).toBeInstanceOf(ContextoEmpresaAusenteError);
      // El texto correcto sin parámetro, con dos, con uno que no es de texto o con `replacements`.
      expect(await marcada(sql, {})).toBeInstanceOf(ContextoEmpresaAusenteError);
      expect(await marcada(sql, { bind: ['a', 'b'] })).toBeInstanceOf(ContextoEmpresaAusenteError);
      expect(await marcada(sql, { bind: [1] })).toBeInstanceOf(ContextoEmpresaAusenteError);
      expect(await marcada(sql, { replacements: ['a'] })).toBeInstanceOf(
        ContextoEmpresaAusenteError,
      );
      // El texto de una función con el motivo de la otra o con otro motivo.
      const conOtroMotivo = (m: string) =>
        sequelize.query(sql, { sinEmpresa: m, bind: ['x'] } as never).then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(await conOtroMotivo(otroMotivo)).toBeInstanceOf(ContextoEmpresaAusenteError);
      expect(
        await conOtroMotivo(motivo === 'carta-publica' ? 'codigo-mesa' : 'carta-publica'),
      ).toBeInstanceOf(ContextoEmpresaAusenteError);
      expect(await conOtroMotivo('inventado')).toBeInstanceOf(ContextoEmpresaAusenteError);
      // Dentro de una transacción.
      const transaccion = await sequelize.transaction();
      try {
        expect(await marcada(sql, { bind: ['x'], transaction: transaccion })).toBeInstanceOf(
          ContextoEmpresaAusenteError,
        );
      } finally {
        await transaccion.rollback();
      }
      // Sin la marca, la misma consulta fuera de un contexto no sale a la base.
      const sinMarca = await sequelize.query(sql, { bind: ['x'] }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(sinMarca).toBeInstanceOf(ContextoEmpresaAusenteError);
      // Dentro de un contexto de empresa la marca no vale (se rechaza antes de la base).
      const dentro = await contexto
        .ejecutar(A.empresaId, () => marcada(sql, { bind: ['x'] }), {
          actor: { sistema: 'prueba' },
        })
        .catch((e: unknown) => e);
      expect(dentro).toBeInstanceOf(Error);
      expect(dentro).not.toBeInstanceOf(DatabaseError);
      // Control: con su texto exacto y un parámetro de texto sí funciona.
      expect(await marcada(sql, { bind: [texto], type: QueryTypes.SELECT })).toBeUndefined();
    },
  );
});

describe('criterio 13 · dentro de un contexto, la guarda rechaza las dos funciones por nombre', () => {
  const ENTRADAS: EntradaProhibida[] = FUNCIONES.map((nombre) => ({
    nombre,
    grupo: '22e',
    sql: (n) => `SELECT ${n}('algo')`,
    esquema: 'public',
  }));

  it.each(ENTRADAS.map((e) => [e.nombre, e] as const))(
    '%s se rechaza en todas sus variantes antes de la base, y la transacción sigue sana',
    async (_nombre, entrada) => {
      const { A } = await mundo();
      const problemas: string[] = [];
      for (const [descripcion, sql] of variantes(entrada)) {
        const visto = await contexto.ejecutar(
          A.empresaId,
          async () => {
            const error = await sequelize.query(sql).then(
              () => undefined,
              (e: unknown) => e,
            );
            const lectura = await sequelize
              .query<{ id: string }>('SELECT id FROM sucursal', { type: QueryTypes.SELECT })
              .then(
                (filas) => filas.map((f) => f.id).sort(),
                (e: unknown) => String(e),
              );
            return { error, lectura };
          },
          { actor: { sistema: 'prueba' } },
        );
        if (visto.error === undefined) problemas.push(`[${descripcion}] tuvo éxito`);
        else if (visto.error instanceof DatabaseError) {
          problemas.push(`[${descripcion}] llegó a la base: ${(visto.error as Error).message}`);
        } else if (!(visto.error instanceof ConsultaProhibidaError)) {
          problemas.push(`[${descripcion}] se rechazó con ${String(visto.error)}`);
        }
        if (!Array.isArray(visto.lectura) || visto.lectura.length < 2) {
          problemas.push(`[${descripcion}] el SELECT posterior falló: ${String(visto.lectura)}`);
        }
      }
      expect(problemas, problemas.join('\n')).toEqual([]);
    },
  );

  it('un literal con esos nombres no cuenta como mención', async () => {
    const { A } = await mundo();
    const filas = await contexto.ejecutar(A.empresaId, () =>
      sequelize.query<{ t: string }>(
        "SELECT 'empresa_de_carta empresa_de_codigo_mesa' AS t, $$empresa_de_carta$$ AS u",
        { type: QueryTypes.SELECT },
      ),
    );
    expect(filas[0]!.t).toBe('empresa_de_carta empresa_de_codigo_mesa');
  });

  it('un alias que solo contiene el nombre dentro de otro identificador se ejecuta', async () => {
    const { A } = await mundo();
    const filas = await contexto.ejecutar(A.empresaId, () =>
      sequelize.query('SELECT 1 AS mi_empresa_de_carta, 2 AS empresa_de_carta_x', {
        type: QueryTypes.SELECT,
      }),
    );
    expect(filas).toHaveLength(1);
  });
});

describe('criterio 13 · una sola fijación de contexto por petición pública', () => {
  async function conRegistro(
    peticion: () => Promise<{ status: number; body: unknown; text: string }>,
  ) {
    const registro = registrarConsultas(ctx.app);
    try {
      const res = await peticion();
      return { res, consultas: [...registro.consultas] };
    } finally {
      registro.detener();
    }
  }

  /** Las rutas públicas de la sección con una petición válida cada una. */
  async function rutasPublicas() {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const llamadoPrevio = randomUUID();
    await crearLlamadoOk(cliente, A.mesaS2.codigo, llamarAlMozo(llamadoPrevio));
    const nueva = (await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1))[0]!;
    const base = `/publico/cartas/${A.slug}`;
    return [
      ['GET /publico/cartas/:empresaSlug', () => cliente.get(base)],
      ['GET /publico/cartas/:empresaSlug/:sucursalSlug', () => cliente.get(`${base}/${A.slugS1}`)],
      [
        'GET /publico/cartas/:empresaSlug/:sucursalSlug/disponibilidad',
        () => cliente.get(`${base}/${A.slugS1}/disponibilidad`),
      ],
      ['GET /publico/mesas/:codigo', () => cliente.get(`/publico/mesas/${A.mesa12.codigo}`)],
      [
        'POST /publico/mesas/:codigo/llamados',
        () => cliente.post(rutaDeLlamados(nueva.codigo), pedidoDeLomo(A.carta)),
      ],
      [
        'GET /publico/mesas/:codigo/llamados/:id',
        () => cliente.get(`/publico/mesas/${A.mesaS2.codigo}/llamados/${llamadoPrevio}`),
      ],
    ] as const;
  }

  it('cada ruta pública busca la empresa una vez, fuera de toda transacción, y fija el contexto una sola vez', async () => {
    const fallos: string[] = [];
    for (const [nombre, pedir] of await rutasPublicas()) {
      const { res, consultas } = await conRegistro(pedir);
      if (res.status !== 200 && res.status !== 201) {
        fallos.push(`${nombre}: se esperaba 200 o 201 y fue ${res.status} ${res.text}`);
        continue;
      }
      const busquedas = consultas
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => BUSCA_EMPRESA.test(c.sql));
      const fijaciones = consultas
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => FIJA_CONTEXTO.test(c.sql));
      if (busquedas.length !== 1)
        fallos.push(`${nombre}: ${busquedas.length} búsquedas de la empresa`);
      if (fijaciones.length !== 1) {
        fallos.push(`${nombre}: ${fijaciones.length} llamadas a fijar_contexto_empresa`);
      }
      const b = busquedas[0];
      const f = fijaciones[0];
      if (b !== undefined) {
        if (b.c.opciones?.transaction !== undefined && b.c.opciones.transaction !== null) {
          fallos.push(`${nombre}: la búsqueda corrió dentro de una transacción`);
        }
        const antes = consultas.slice(0, b.i).filter((c) => /^START TRANSACTION/i.test(c.sql));
        if (antes.length > 0) fallos.push(`${nombre}: había una transacción abierta al buscar`);
        if (f !== undefined && f.i < b.i) {
          fallos.push(`${nombre}: se fijó el contexto antes de buscar la empresa`);
        }
      }
    }
    exigirSinFallos(fallos);
  });

  it('con un código o una dirección que no existen, busca una vez y no fija ningún contexto', async () => {
    const cliente = clientePublico(ctx);
    const casos: [string, () => Promise<{ status: number; body: unknown; text: string }>][] = [
      ['mesa', () => cliente.get(`/publico/mesas/${codigoInexistente()}`)],
      [
        'llamado',
        () => cliente.post(rutaDeLlamados(codigoInexistente()), llamarAlMozo(randomUUID())),
      ],
      [
        'estado',
        () => cliente.get(`/publico/mesas/${codigoInexistente()}/llamados/${randomUUID()}`),
      ],
      ['empresa', () => cliente.get('/publico/cartas/no-existe-esta-empresa')],
      ['carta', () => cliente.get('/publico/cartas/no-existe-esta-empresa/miraflores')],
    ];
    for (const [nombre, pedir] of casos) {
      const { res, consultas } = await conRegistro(pedir);
      exigir404(res, nombre);
      expect(consultas.filter((c) => BUSCA_EMPRESA.test(c.sql)).length, nombre).toBe(1);
      expect(consultas.filter((c) => FIJA_CONTEXTO.test(c.sql)).length, nombre).toBe(0);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 14 · El mismo 404 para todo lo que no se ve
// ------------------------------------------------------------------------------------------------
describe('criterio 14 · formas inválidas: el mismo 404 sin consultar la base', () => {
  const CODIGOS_MAL_FORMADOS = [
    'abc',
    'A'.repeat(21),
    'A'.repeat(23),
    `${'A'.repeat(21)}=`,
    `${'A'.repeat(21)}+`,
    `${'A'.repeat(21)}.`,
    `${'A'.repeat(21)}%20`,
    `${'A'.repeat(21)}%C3%B1`,
    `${'A'.repeat(20)}%2F%2E`,
    '_'.repeat(22).replace('_', '*'),
  ];
  const SLUGS_MAL_FORMADOS = [
    'ab',
    'a'.repeat(41),
    'con_guion_bajo',
    '-inicio',
    'fin-',
    'doble--guion',
    'con%20espacio',
    'ñandu',
    'a%2Fb',
    'x*y',
  ];

  it('un código con otra forma responde el mismo 404 en las tres rutas de la mesa, sin tocar la base', async () => {
    const cliente = clientePublico(ctx);
    const registro = registrarConsultas(ctx.app);
    try {
      for (const codigo of CODIGOS_MAL_FORMADOS) {
        exigir404(await cliente.get(`/publico/mesas/${codigo}`), `GET mesa ${codigo}`);
        exigir404(
          await cliente.post(rutaDeLlamados(codigo), llamarAlMozo()),
          `POST llamado ${codigo}`,
        );
        exigir404(
          await cliente.get(`/publico/mesas/${codigo}/llamados/${randomUUID()}`),
          `GET estado ${codigo}`,
        );
      }
      expect(registro.consultas.map((c) => c.sql)).toEqual([]);
    } finally {
      registro.detener();
    }
  });

  it('una dirección de empresa o de sucursal fuera de forma responde el mismo 404 en las tres rutas de la carta, sin tocar la base', async () => {
    const cliente = clientePublico(ctx);
    const registro = registrarConsultas(ctx.app);
    try {
      for (const slug of SLUGS_MAL_FORMADOS) {
        exigir404(await cliente.get(`/publico/cartas/${slug}`), `empresa ${slug}`);
        exigir404(
          await cliente.get(`/publico/cartas/${slug}/miraflores`),
          `empresa/sucursal ${slug}`,
        );
        exigir404(
          await cliente.get(`/publico/cartas/una-empresa-valida/${slug}`),
          `sucursal ${slug} de una empresa bien formada`,
        );
        exigir404(
          await cliente.get(`/publico/cartas/una-empresa-valida/${slug}/disponibilidad`),
          `disponibilidad de ${slug}`,
        );
      }
      expect(registro.consultas.map((c) => c.sql)).toEqual([]);
    } finally {
      registro.detener();
    }
  });
});

describe('criterio 14 · lo que no existe o no se ve responde el mismo 404', () => {
  it('un código y direcciones bien formados pero desconocidos, también las reservadas', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const fallos: string[] = [];
    const respuestas: [string, { status: number; body: unknown }][] = [];
    respuestas.push([
      'código desconocido',
      await cliente.get(`/publico/mesas/${codigoInexistente()}`),
    ]);
    respuestas.push([
      'código con otra caja',
      await cliente.get(`/publico/mesas/${invertirCaja(A.mesa4.codigo)}`),
    ]);
    respuestas.push(['empresa desconocida', await cliente.get('/publico/cartas/no-existe-xyz')]);
    for (const reservada of ['api', 'admin', 'carta', 'publico']) {
      respuestas.push([
        `dirección reservada ${reservada}`,
        await cliente.get(`/publico/cartas/${reservada}`),
      ]);
    }
    respuestas.push([
      'sucursal desconocida',
      await cliente.get(`/publico/cartas/${A.slug}/no-existe-xyz`),
    ]);
    respuestas.push([
      'disponibilidad de una sucursal desconocida',
      await cliente.get(`/publico/cartas/${A.slug}/no-existe-xyz/disponibilidad`),
    ]);
    respuestas.push([
      'la sucursal de otra empresa bajo esta dirección',
      await cliente.get(`/publico/cartas/${A.slug}/${(await mundo()).B.slugS1}x`),
    ]);
    for (const [nombre, res] of respuestas) {
      if (res.status !== 404 || JSON.stringify(res.body) !== JSON.stringify(CUERPO_404_PUBLICO)) {
        fallos.push(`${nombre}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    exigirSinFallos(fallos);
  });

  it('la dirección de la empresa en mayúsculas se busca en minúsculas: responde lo mismo que en minúsculas', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const minusculas = await cliente.get(`/publico/cartas/${A.slug}/${A.slugS1}`);
    exigirEstado(minusculas, 200, 'la carta en minúsculas');
    const mayusculas = await cliente.get(
      `/publico/cartas/${A.slug.toUpperCase()}/${A.slugS1.toUpperCase()}`,
    );
    exigirEstado(mayusculas, 200, 'la carta con la dirección en mayúsculas');
    expect(mayusculas.body).toEqual(minusculas.body);
    const empresa = await cliente.get(`/publico/cartas/${A.slug.toUpperCase()}`);
    exigirEstado(empresa, 200, 'la empresa con la dirección en mayúsculas');
  });

  it('un código reemplazado y el de una mesa inactiva responden 404 en las tres rutas; el código nuevo y el reactivado funcionan', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [reemplazada, inactiva] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 2);
    const llamadoViejo = randomUUID();
    // Control: los dos códigos funcionan antes de tocar nada.
    exigirEstado(await cliente.get(`/publico/mesas/${reemplazada!.codigo}`), 200, 'la mesa antes');
    await crearLlamadoOk(cliente, reemplazada!.codigo, llamarAlMozo(llamadoViejo));
    exigirEstado(
      await cliente.get(`/publico/mesas/${inactiva!.codigo}`),
      200,
      'la otra mesa antes',
    );

    // Se cambia el QR de una mesa.
    const cambio = await llamar(ctx, A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${A.S1}/mesas/${reemplazada!.id}/qr`,
      cabeceras: { 'Idempotency-Key': randomUUID() },
    });
    exigirEstado(cambio, 201, 'cambiar el QR');
    const codigoNuevo = cambio.body.codigo as string;
    expect(codigoNuevo).not.toBe(reemplazada!.codigo);
    exigir404(
      await cliente.get(`/publico/mesas/${reemplazada!.codigo}`),
      'mesa con el código viejo',
    );
    exigir404(
      await cliente.post(rutaDeLlamados(reemplazada!.codigo), llamarAlMozo(randomUUID())),
      'llamado con el código viejo',
    );
    exigir404(
      await cliente.get(`/publico/mesas/${reemplazada!.codigo}/llamados/${llamadoViejo}`),
      'estado con el código viejo',
    );
    exigirEstado(
      await cliente.get(`/publico/mesas/${codigoNuevo}`),
      200,
      'la mesa con el código nuevo',
    );

    // Se desactiva otra mesa y después se reactiva.
    const desactivar = await llamar(ctx, A.tokenAdmin, {
      metodo: 'patch',
      ruta: `/sucursales/${A.S1}/mesas/${inactiva!.id}`,
      cuerpo: { activa: false },
    });
    exigirEstado(desactivar, 200, 'desactivar la mesa');
    exigir404(await cliente.get(`/publico/mesas/${inactiva!.codigo}`), 'mesa inactiva');
    exigir404(
      await cliente.post(rutaDeLlamados(inactiva!.codigo), llamarAlMozo(randomUUID())),
      'llamado a una mesa inactiva',
    );
    exigir404(
      await cliente.get(`/publico/mesas/${inactiva!.codigo}/llamados/${randomUUID()}`),
      'estado de una mesa inactiva',
    );
    exigirEstado(
      await llamar(ctx, A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${A.S1}/mesas/${inactiva!.id}`,
        cuerpo: { activa: true },
      }),
      200,
      'reactivar la mesa',
    );
    exigirEstado(
      await cliente.get(`/publico/mesas/${inactiva!.codigo}`),
      200,
      'la mesa reactivada',
    );
  });

  it('un llamado de otra mesa de la misma sucursal, o de otra empresa, responde 404 con el código de esta mesa', async () => {
    const { A, B } = await mundo();
    const cliente = clientePublico(ctx);
    const [mesaPropia, mesaAjena] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 2);
    const delaAjena = randomUUID();
    await crearLlamadoOk(cliente, mesaAjena!.codigo, llamarAlMozo(delaAjena));
    const deB = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), B.mesa4.codigo, llamarAlMozo(deB));
    exigirEstado(
      await cliente.get(`/publico/mesas/${mesaAjena!.codigo}/llamados/${delaAjena}`),
      200,
      'control: el estado con su propia mesa',
    );
    exigir404(
      await cliente.get(`/publico/mesas/${mesaPropia!.codigo}/llamados/${delaAjena}`),
      'llamado de otra mesa de la misma sucursal',
    );
    exigir404(
      await cliente.get(`/publico/mesas/${mesaPropia!.codigo}/llamados/${deB}`),
      'llamado de otra empresa',
    );
    exigir404(
      await cliente.get(`/publico/mesas/${mesaPropia!.codigo}/llamados/${randomUUID()}`),
      'llamado inexistente',
    );
  });

  it('una sucursal sin publicar responde 404 en la carta, la disponibilidad, la mesa, un llamado nuevo y el estado; al publicarla vuelve', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S2, 1);
    const previo = randomUUID();
    await crearLlamadoOk(cliente, mesa!.codigo, llamarAlMozo(previo));
    const base = `/publico/cartas/${A.slug}/${A.slugS2}`;
    exigirEstado(await cliente.get(base), 200, 'control: la carta de S2 publicada');
    const cambiar = (publicada: boolean) =>
      llamar(ctx, A.tokenAdmin, {
        metodo: 'put',
        ruta: `/carta-web/sucursales/${A.S2}`,
        cuerpo: { slug: A.slugS2, publicada },
      });
    exigirEstado(await cambiar(false), 200, 'despublicar S2');
    try {
      exigir404(await cliente.get(base), 'carta de una sucursal sin publicar');
      exigir404(await cliente.get(`${base}/disponibilidad`), 'disponibilidad sin publicar');
      exigir404(await cliente.get(`/publico/mesas/${mesa!.codigo}`), 'mesa sin publicar');
      exigir404(
        await cliente.post(rutaDeLlamados(mesa!.codigo), llamarAlMozo(randomUUID())),
        'llamado nuevo sin publicar',
      );
      exigir404(
        await cliente.get(`/publico/mesas/${mesa!.codigo}/llamados/${previo}`),
        'estado sin publicar',
      );
      // La otra sucursal sigue publicada.
      exigirEstado(
        await cliente.get(`/publico/cartas/${A.slug}/${A.slugS1}`),
        200,
        'la carta de S1 sigue',
      );
    } finally {
      exigirEstado(await cambiar(true), 200, 'volver a publicar S2');
    }
    exigirEstado(await cliente.get(base), 200, 'la carta de S2 vuelve');
    exigirEstado(await cliente.get(`/publico/mesas/${mesa!.codigo}`), 200, 'la mesa de S2 vuelve');
  });

  it('una suscripción suspendida no cambia nada; una sucursal cuyo plan no incluye PEDIDOS_WEB responde 404 en todas las rutas', async () => {
    const { e, A } = await mundo();
    const cliente = clientePublico(ctx);
    const S3 = A.S3!;
    const slugS3 = 'sucursal-tres';
    // S3 con su zona, su mesa y su carta publicada.
    const zona = await llamar(ctx, A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${S3}/zonas`,
      cuerpo: { nombre: unico('Zona S3'), columnas: 4, filas: 4 },
    });
    exigirEstado(zona, 201, 'crear la zona de S3');
    const mesa = await llamar(ctx, A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${S3}/zonas/${zona.body.id as string}/mesas`,
      cuerpo: { nombre: 'S3-1', capacidad: 4, forma: 'CUADRADA', columna: 1, fila: 1 },
    });
    exigirEstado(mesa, 201, 'crear la mesa de S3');
    exigirEstado(
      await llamar(ctx, A.tokenAdmin, {
        metodo: 'put',
        ruta: `/carta-web/sucursales/${S3}`,
        cuerpo: { slug: slugS3, publicada: true },
      }),
      200,
      'publicar S3',
    );
    const qr = await llamar(ctx, A.tokenAdmin, {
      metodo: 'get',
      ruta: `/sucursales/${S3}/qr-mesas`,
    });
    exigirEstado(qr, 200, 'la hoja de QR de S3');
    const codigo = (qr.body.mesas as { codigo: string }[])[0]!.codigo;
    const previo = randomUUID();
    const base = `/publico/cartas/${A.slug}/${slugS3}`;
    const rutas = (): [string, () => ReturnType<ClientePublico['get']>][] => [
      ['carta', () => cliente.get(base)],
      ['disponibilidad', () => cliente.get(`${base}/disponibilidad`)],
      ['mesa', () => cliente.get(`/publico/mesas/${codigo}`)],
      ['llamado', () => cliente.post(rutaDeLlamados(codigo), llamarAlMozo(randomUUID()))],
      ['estado', () => cliente.get(`/publico/mesas/${codigo}/llamados/${previo}`)],
    ];
    exigirEstado(await cliente.get(base), 200, 'control: la carta de S3');
    await crearLlamadoOk(cliente, codigo, llamarAlMozo(previo));

    // Suspendida: se pasa la fecha de vencimiento y la gracia.
    const suspender = await ctx
      .http()
      .patch(`/plataforma/suscripciones/${e.A.base.suscripciones[S3]!.id}`)
      .set(bearer(e.sa.token))
      .send({ vencimiento: '2026-01-01', motivo: 'Suspender para la prueba pública' });
    exigirEstado(suspender, 200, 'suspender la suscripción de S3');
    const fallos: string[] = [];
    for (const [nombre, pedir] of rutas().filter(([n]) => n !== 'llamado')) {
      const res = await pedir();
      if (res.status !== 200) fallos.push(`suspendida, ${nombre}: ${res.status} ${res.text}`);
    }
    const nuevo = await cliente.post(rutaDeLlamados(codigo), llamarAlMozo(randomUUID()));
    if (nuevo.status === 404) fallos.push('suspendida, llamado nuevo: 404');
    exigirSinFallos(fallos);

    // Un plan sin PEDIDOS_WEB.
    const plan = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(e.sa.token))
      .send({
        codigo: `P-${randomUUID().slice(0, 8)}`,
        nombre: 'Plan sin pedidos web',
        diasGracia: 7,
        modulos: ['SALON', 'COCINA', 'CAJA', 'REPORTES'],
        porDefecto: false,
        activo: true,
        motivo: unico('plan'),
      });
    exigirEstado(plan, 201, 'crear el plan sin PEDIDOS_WEB');
    const cambio = await ctx
      .http()
      .patch(`/plataforma/suscripciones/${e.A.base.suscripciones[S3]!.id}`)
      .set(bearer(e.sa.token))
      .send({
        planId: plan.body.id as string,
        vencimiento: '2027-01-01',
        motivo: 'Sin pedidos web',
      });
    exigirEstado(cambio, 200, 'cambiar el plan de S3');
    for (const [nombre, pedir] of rutas()) {
      exigir404(await pedir(), `sin PEDIDOS_WEB, ${nombre}`);
    }
    // La empresa y las demás sucursales no se ven afectadas; la lista de la empresa ya no trae S3.
    exigirEstado(await cliente.get(`/publico/cartas/${A.slug}/${A.slugS1}`), 200, 'S1 sigue');
    const lista = await cliente.get(`/publico/cartas/${A.slug}`);
    exigirEstado(lista, 200, 'la empresa sigue');
    expect((lista.body.sucursales as { slug: string }[]).map((s) => s.slug)).not.toContain(slugS3);
  });
});

// ------------------------------------------------------------------------------------------------
// 11 · Authorization y x-empresa-id se ignoran
// ------------------------------------------------------------------------------------------------
describe('criterio 11 · las rutas públicas ignoran Authorization y x-empresa-id', () => {
  it('un token de sesión válido (de A o de B), uno falso y ninguno dan la misma respuesta', async () => {
    const { A, B, e } = await mundo();
    const cliente = clientePublico(ctx);
    const rutas = [
      `/publico/cartas/${B.slug}`,
      `/publico/cartas/${B.slug}/${B.slugS1}`,
      `/publico/cartas/${B.slug}/${B.slugS1}/disponibilidad`,
      `/publico/mesas/${B.mesa4.codigo}`,
      `/publico/cartas/no-existe-esta-empresa`,
    ];
    const tokens = [
      e.A.tokenAdmin,
      A.tokenAdminS1,
      B.tokenAdmin,
      'Bearer-basura',
      'se.no-es-uuid.x.y',
    ];
    for (const ruta of rutas) {
      const sin = await cliente.get(ruta);
      for (const token of tokens) {
        const con = await cliente.get(ruta).set(bearer(token));
        expect({ ruta, estado: con.status, cuerpo: con.body }).toEqual({
          ruta,
          estado: sin.status,
          cuerpo: sin.body,
        });
      }
      const basic = await cliente.get(ruta).set('Authorization', 'Basic dXN1YXJpbzpjbGF2ZQ==');
      expect(basic.status, `${ruta} con Basic`).toBe(sin.status);
    }
    // Con la sesión de A, el código de B es el de B (no hay un 404 por ser "otra empresa").
    const mesaDeB = await cliente
      .get(`/publico/mesas/${B.mesa4.codigo}`)
      .set(bearer(A.tokenAdminS1));
    exigirEstado(mesaDeB, 200, 'la mesa de B con la sesión de A');
  });

  it('un POST público con la sesión de A crea el llamado en la empresa del código, no en la de la sesión', async () => {
    const { A, B } = await mundo();
    const cliente = clientePublico(ctx);
    const id = randomUUID();
    const res = await cliente
      .post(rutaDeLlamados(B.mesa12.codigo), llamarAlMozo(id))
      .set(bearer(A.tokenAdminS1));
    exigirEstado(res, 201, 'crear un llamado en B con la sesión de A');
    const { rows } = await admin.query<{ empresa_id: string }>(
      `SELECT empresa_id FROM llamado WHERE id = $1`,
      [id],
    );
    expect(rows).toEqual([{ empresa_id: B.empresaId }]);
  });

  describe('con EMPRESA_POR_HEADER habilitado (modo de prueba)', () => {
    let aparte: INestApplication;
    let publico: ClientePublico;

    beforeAll(async () => {
      fijarEntornoDePrueba({ empresaPorHeader: true, poolMax: 2 });
      try {
        aparte = await crearAplicacion({ reloj: new RelojManual(INICIO_TARDE), logger: false });
        await aparte.listen(0, '127.0.0.1');
      } finally {
        fijarEntornoDePrueba({ empresaPorHeader: false });
      }
      publico = new ClientePublico(aparte);
    });

    afterAll(async () => {
      await aparte?.close();
    });

    it('la cabecera x-empresa-id con otra empresa no cambia lo que responden las rutas públicas', async () => {
      const { A, B } = await mundo();
      // Control: la aplicación sí usa la cabecera en una ruta con empresa por cabecera.
      const control = await ctx.http().get('/health');
      expect(control.status).toBe(200);
      const rutas = [
        `/publico/cartas/${A.slug}`,
        `/publico/cartas/${A.slug}/${A.slugS1}`,
        `/publico/cartas/${A.slug}/${A.slugS1}/disponibilidad`,
        `/publico/mesas/${A.mesa4.codigo}`,
      ];
      for (const ruta of rutas) {
        const sin = await publico.get(ruta);
        expect(sin.status, ruta).toBe(200);
        for (const otra of [B.empresaId, A.empresaId, randomUUID(), 'no-es-uuid']) {
          const con = await publico.get(ruta).set('x-empresa-id', otra);
          expect({ ruta, otra, estado: con.status, cuerpo: con.body }).toEqual({
            ruta,
            otra,
            estado: 200,
            cuerpo: sin.body,
          });
        }
      }
      // El 404 tampoco cambia.
      const ruta404 = `/publico/mesas/${codigoInexistente()}`;
      const con = await publico.get(ruta404).set('x-empresa-id', A.empresaId);
      exigir404(con, 'código desconocido con x-empresa-id');
    });

    it('un llamado creado con x-empresa-id de B en el código de A queda en A', async () => {
      const { A, B } = await mundo();
      const id = randomUUID();
      const res = await publico
        .post(rutaDeLlamados(A.mesa12.codigo), llamarAlMozo(id))
        .set('x-empresa-id', B.empresaId);
      exigirEstado(res, 201, 'crear el llamado');
      const { rows } = await admin.query<{ empresa_id: string }>(
        `SELECT empresa_id FROM llamado WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ empresa_id: A.empresaId }]);
    });
  });
});

// ------------------------------------------------------------------------------------------------
// 17 · Tamaño del cuerpo
// ------------------------------------------------------------------------------------------------
describe('criterio 17 · un POST público de más de 16 KB responde 413 sin consultar la base', () => {
  const rellenoDe = (bytes: number) => ({
    id: randomUUID(),
    tipo: 'LLAMAR_MOZO',
    relleno: 'x'.repeat(bytes),
  });

  it('responde 413 CUERPO_DEMASIADO_GRANDE con un código desconocido (antes que el 404), sin consultar la base', async () => {
    const cliente = clientePublico(ctx);
    const registro = registrarConsultas(ctx.app);
    try {
      for (const bytes of [16 * 1024 + 1, 20 * 1024, 200 * 1024]) {
        const res = await cliente.post(rutaDeLlamados(codigoInexistente()), rellenoDe(bytes));
        expect({ bytes, estado: res.status, codigo: res.body?.codigo }).toEqual({
          bytes,
          estado: 413,
          codigo: 'CUERPO_DEMASIADO_GRANDE',
        });
      }
      expect(registro.consultas.map((c) => c.sql)).toEqual([]);
    } finally {
      registro.detener();
    }
  });

  it('responde 413 también con el código de una mesa que existe, sin consultar la base', async () => {
    const { A } = await mundo();
    const cliente = clientePublico(ctx);
    const registro = registrarConsultas(ctx.app);
    try {
      for (const bytes of [16 * 1024 + 1, 64 * 1024]) {
        const res = await cliente.post(rutaDeLlamados(A.mesa12.codigo), rellenoDe(bytes));
        expect({ bytes, estado: res.status, codigo: res.body?.codigo }).toEqual({
          bytes,
          estado: 413,
          codigo: 'CUERPO_DEMASIADO_GRANDE',
        });
      }
      expect(registro.consultas.map((c) => c.sql)).toEqual([]);
    } finally {
      registro.detener();
    }
  });

  it('un cuerpo de 16 KB o menos no es 413: pasa al validador (400 por el campo de más, antes que el 404) sin tocar la base', async () => {
    const cliente = clientePublico(ctx);
    const registro = registrarConsultas(ctx.app);
    try {
      for (const bytes of [1000, 8 * 1024, 16 * 1024 - 200]) {
        const res = await cliente.post(rutaDeLlamados(codigoInexistente()), rellenoDe(bytes));
        expect({ bytes, estado: res.status, codigo: res.body?.codigo }).toEqual({
          bytes,
          estado: 400,
          codigo: 'DATOS_INVALIDOS',
        });
      }
      expect(registro.consultas.map((c) => c.sql)).toEqual([]);
    } finally {
      registro.detener();
    }
  });

  it('un pedido válido grande pero dentro del límite se acepta (control: el 413 no es por el tamaño normal)', async () => {
    const { A } = await mundo();
    const [mesa] = await mesasNuevas(ctx, A.tokenAdmin, A.S1, 1);
    const cliente = clientePublico(ctx);
    const lineas = Array.from({ length: 30 }, (_, i) => ({
      productoId: A.carta.gaseosaId,
      modificadorIds: [],
      cantidad: 1,
      observacion: `Sin hielo ${i}`.padEnd(100, '.'),
    }));
    const cuerpo = { id: randomUUID(), tipo: 'PEDIDO', lineas, nota: 'n'.repeat(140) };
    expect(Buffer.byteLength(JSON.stringify(cuerpo))).toBeLessThan(16 * 1024);
    exigirEstado(await cliente.post(rutaDeLlamados(mesa!.codigo), cuerpo), 201, 'el pedido grande');
  });
});

void CARTA_WEB_URL;
