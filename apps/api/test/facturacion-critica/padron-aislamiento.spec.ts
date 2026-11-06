// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P9 · El padrón de RUC como información compartida sin canal lateral entre empresas (ruta crítica), criterios 138, 139, 142 y 164,
// con el padrón de ejemplo `test/soporte/padron-ejemplo.zip` (`PADRON_RUC_URL=file://…`, formato del archivo reducido de
// SUNAT: ZIP con un texto ISO-8859-1 separado por `|`, con encabezado, líneas que no son RUC y marcas `-` por vacío):
// - sin ninguna carga, `GET /padron/ruc/:ruc` responde 503 `PADRON_NO_DISPONIBLE`; tras `CargaPadron.cargar()` se
//   autocompleta (razón social, dirección compuesta, estado, condición, `activo` y `habido`), 404 `RUC_NO_ENCONTRADO` y
//   400 con `campos.ruc` para un RUC mal formado; se descartan las líneas cuyo RUC no tiene 11 dígitos;
// - una carga con menos del 90 % de las filas de la anterior (o dañada) no cambia la tabla activa: las búsquedas siguen
//   igual, `GET /plataforma/padron` guarda el error y se registra `padron.carga_fallida`;
// - `restaurante_api` y `restaurante_plataforma` no leen ni escriben `referencia.*` (42501); las columnas de `referencia`
//   son exactamente las del modelo de datos; solo `restaurante_referencia` tiene política RLS; sus privilegios son los de
//   «Permisos»;
// - `padron_buscar_ruc` es `STABLE` y `SECURITY DEFINER`, devuelve 0 o 1 fila, solo por un RUC exacto de 11 dígitos (un
//   patrón, un texto vacío o 10 dígitos no devuelven nada), no escribe nada y da la misma respuesta desde A y desde B;
// - ninguna tabla compartida guarda lo que escriben los cajeros.
// Hoy falla porque el esquema `referencia`, la función y la carga no existen (la carga y el servicio responden «No implementado»).
import { padronEstadoRespuestaSchema, padronRucRespuestaSchema } from '@restaurante/contratos';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  api,
  arrancarFact,
  capturarRegistros,
  cerrarAdmin,
  cobrarFactura,
  crearEscenarioFact,
  esperarError,
  exigirEstado,
  filas,
  turnoDe,
  type AppFact,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let admin: Client;
let apiCliente: Client;
const abiertas: AppFact[] = [];
const A = () => esc.A;
const B = () => esc.B;

const RUC_CON_DIRECCION = '20100070970';
const RUC_SUNAT = '20131312955';
const RUC_TILDES = '20601234565';
const RUC_BAJA = '20512345671';
const RUC_SUSPENDIDO = '20498765433';
const RUC_NO_HABIDO = '20605555552';
const RUC_PERSONA = '10456789124';
const RUC_VALIDO_AUSENTE = '20123456786';
const FILAS_VALIDAS = 7;
const INCOMPLETO = resolve(__dirname, '..', 'soporte', 'padron-incompleto.zip');

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx, { conPse: false });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});
afterAll(async () => {
  for (const otra of abiertas) await otra.cerrar().catch(() => undefined);
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
  await cerrarAdmin();
});
beforeEach(() => {
  ctx.cola.vaciar();
});

const buscar = (ruc: string, token: string | undefined = A().token.supervisor) =>
  api(ctx, token, 'get', `/padron/ruc/${ruc}`);
/** Busca un RUC (exige 200) y valida la forma de la respuesta. */
const ficha = async (ruc: string, token: string | undefined = A().token.supervisor) => {
  const res = await buscar(ruc, token);
  exigirEstado(res, 200, `GET /padron/ruc/${ruc} (006, criterio 139)`);
  return padronRucRespuestaSchema.parse(res.body);
};
const estadoDelPadron = async () => {
  const res = await api(ctx, esc.sa.token, 'get', '/plataforma/padron');
  exigirEstado(res, 200, 'GET /plataforma/padron (006, criterio 138)');
  return padronEstadoRespuestaSchema.parse(res.body);
};
const estadoSql = async (): Promise<Libre> =>
  (await filas('SELECT * FROM referencia.padron_estado'))[0] ?? {};
const tablaActiva = async (): Promise<string> =>
  `referencia.padron_ruc_${(await estadoSql()).tabla_activa}`;

async function conAplicacionCon(url: string): Promise<AppFact> {
  const otra = await arrancarFact({ extraEntorno: { PADRON_RUC_URL: url } });
  abiertas.push(otra);
  return otra;
}

describe('criterio 139 · sin ninguna carga todavía', () => {
  it('GET /padron/ruc/:ruc responde 503 PADRON_NO_DISPONIBLE y GET /plataforma/padron dice que no hay carga', async () => {
    esperarError(await buscar(RUC_CON_DIRECCION), 503, 'PADRON_NO_DISPONIBLE');
    expect(await estadoDelPadron()).toEqual({
      cargadoEn: null,
      filas: null,
      fechaArchivo: null,
      ultimoIntentoEn: null,
      ultimoError: null,
    });
  });
});

describe('criterio 138 · la carga del padrón de ejemplo', () => {
  it('descarta las líneas que no son RUC de 11 dígitos, decodifica ISO-8859-1 y llena la tabla activa', async () => {
    const registros = capturarRegistros();
    try {
      const resultado = await ctx.carga.cargar();
      expect(resultado).toEqual({ filas: FILAS_VALIDAS, activada: true });
      // Se registran tiempos y filas, nunca contenidos.
      for (const dato of ['SUPERMERCADOS', RUC_CON_DIRECCION, 'PANADER']) {
        expect(registros.texto()).not.toContain(dato);
      }
    } finally {
      registros.restaurar();
    }
    const estado = await estadoSql();
    expect(['a', 'b']).toContain(estado.tabla_activa);
    expect(estado).toMatchObject({ filas: FILAS_VALIDAS, ultimo_error: null });
    expect(estado.cargado_en).not.toBeNull();

    const tabla = await tablaActiva();
    const todas = await filas(`SELECT * FROM ${tabla} ORDER BY ruc`);
    expect(todas.map((f) => (f.ruc as string).trim()).sort()).toEqual(
      [
        RUC_PERSONA,
        RUC_CON_DIRECCION,
        RUC_SUNAT,
        RUC_BAJA,
        RUC_SUSPENDIDO,
        RUC_TILDES,
        RUC_NO_HABIDO,
      ].sort(),
    );
    const de = (ruc: string) => todas.find((f) => (f.ruc as string).trim() === ruc)!;
    expect(de(RUC_TILDES)).toMatchObject({
      razon_social: 'PANADERÍA EL PIÑÓN S.A.C.',
      estado: 'ACTIVO',
      condicion: 'HABIDO',
    });
    expect(de(RUC_BAJA)).toMatchObject({
      razon_social: 'COMERCIAL FANTASMA E.I.R.L.',
      estado: 'BAJA DE OFICIO',
      condicion: 'NO HABIDO',
      direccion: null,
    });
    // Las marcas `-` son vacío: el ubigeo ausente no queda guardado como «-».
    expect(((de(RUC_BAJA).ubigeo as string | null) ?? '').trim()).toBe('');
    expect(de(RUC_CON_DIRECCION).ubigeo).toBe('150140');
    // Ninguna fila lleva guiones sueltos ni líneas del encabezado.
    expect(todas.some((f) => f.razon_social === 'NOMBRE O RAZÓN SOCIAL')).toBe(false);
    expect(todas.some((f) => /^-$/.test(String(f.direccion ?? '')))).toBe(false);
  });

  it('carga el catálogo de ubigeo y compone la dirección con distrito, provincia y departamento cuando el ubigeo está en él', async () => {
    const ubigeo = await filas(
      "SELECT * FROM referencia.ubigeo WHERE codigo IN ('150140', '150101') ORDER BY codigo",
    );
    expect(ubigeo.map((u) => (u.codigo as string).trim())).toEqual(['150101', '150140']);
    const surco = ubigeo.find((u) => (u.codigo as string).trim() === '150140')!;
    const res = await buscar(RUC_CON_DIRECCION);
    exigirEstado(res, 200, 'Buscar un RUC del padrón de ejemplo (006, criterio 139)');
    expect(res.body.direccion).toBe(
      `AV. PRIMAVERA NRO. 1234 - ${surco.distrito} - ${surco.provincia} - ${surco.departamento}`,
    );
  });

  it('GET /plataforma/padron dice cuándo se cargó, cuántas filas y que no hubo error', async () => {
    const estado = await estadoDelPadron();
    expect(estado).toMatchObject({ filas: FILAS_VALIDAS, ultimoError: null });
    expect(estado.cargadoEn).not.toBeNull();
    expect(estado.ultimoIntentoEn).not.toBeNull();
  });
});

describe('criterio 139 · GET /padron/ruc/:ruc', () => {
  it('autocompleta un RUC activo y habido: razón social, dirección, estado, condición, activo, habido y la fecha del padrón', async () => {
    const r = await ficha(RUC_CON_DIRECCION, A().token.cajero);
    expect(r).toMatchObject({
      ruc: RUC_CON_DIRECCION,
      razonSocial: "SUPERMERCADOS PERUANOS SOCIEDAD ANONIMA 'A'",
      estado: 'ACTIVO',
      condicion: 'HABIDO',
      activo: true,
      habido: true,
    });
    expect(r.direccion!.startsWith('AV. PRIMAVERA NRO. 1234')).toBe(true);
    expect(r.padronAl).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('respeta las tildes y la eñe del archivo ISO-8859-1, y compone la dirección sin ubigeo', async () => {
    const r = await ficha(RUC_TILDES);
    expect(r.razonSocial).toBe('PANADERÍA EL PIÑÓN S.A.C.');
    expect(r.direccion).toBe('CAL. LAS ÑANDÚES NRO. 25');
  });

  it('compone la dirección con todos sus componentes y sus prefijos, en orden', async () => {
    const r = await ficha(RUC_PERSONA);
    expect(r.razonSocial).toBe('QUISPE MAMANI JUAN CARLOS');
    expect(r.direccion).toBe('JR. LOS ALAMOS NRO. 450 INT. 2 LOTE 5 MZA. B KM. 3 URB. LAS FLORES');
  });

  it('dice `activo` y `habido` por separado y deja la dirección en null si no tiene ningún componente', async () => {
    const baja = await ficha(RUC_BAJA);
    expect(baja).toMatchObject({
      estado: 'BAJA DE OFICIO',
      condicion: 'NO HABIDO',
      activo: false,
      habido: false,
      direccion: null,
    });
    const suspendido = await ficha(RUC_SUSPENDIDO);
    expect(suspendido).toMatchObject({
      estado: 'SUSPENSION TEMPORAL',
      condicion: 'HABIDO',
      activo: false,
      habido: true,
      direccion: 'AV. LOS INCAS',
    });
    const noHabido = await ficha(RUC_NO_HABIDO);
    expect(noHabido).toMatchObject({ activo: true, habido: false, direccion: null });
  });

  it('un RUC válido que no está en el padrón responde 404 RUC_NO_ENCONTRADO', async () => {
    esperarError(await buscar(RUC_VALIDO_AUSENTE), 404, 'RUC_NO_ENCONTRADO');
  });

  it('un RUC mal formado responde 400 con campos.ruc, también el de 10 o 12 dígitos del archivo', async () => {
    for (const ruc of ['12345678901', '123', 'abcdefghijk', '2010007097', '201000709701']) {
      const res = await buscar(ruc);
      expect(res.status, ruc).toBe(400);
      expect(
        (res.body.campos as Array<{ campo: string }>).map((c) => c.campo),
        ruc,
      ).toContain('ruc');
    }
  });

  it('la respuesta para el mismo RUC es idéntica desde A y desde B', async () => {
    for (const ruc of [RUC_CON_DIRECCION, RUC_TILDES, RUC_BAJA, RUC_VALIDO_AUSENTE]) {
      const deA = await buscar(ruc, A().token.supervisor);
      const deB = await buscar(ruc, B().token.supervisor);
      expect(deA.status, ruc).toBe(deB.status);
      expect(deA.body, ruc).toEqual(deB.body);
    }
  });

  it('sin sesión no responde (401)', async () => {
    expect((await buscar(RUC_CON_DIRECCION, undefined)).status).toBe(401);
  });
});

describe('criterio 142 · padron_buscar_ruc', () => {
  const buscarSql = async (empresaId: string, texto: string) => {
    let filasDevueltas: Libre[] = [];
    await enTransaccion(apiCliente, empresaId, async () => {
      filasDevueltas = (await apiCliente.query('SELECT * FROM padron_buscar_ruc($1)', [texto]))
        .rows;
    });
    return filasDevueltas;
  };

  it('es STABLE y SECURITY DEFINER, del migrador, con search_path fijo y EXECUTE solo para restaurante_api', async () => {
    const encontradas = await filas(
      `SELECT p.provolatile, p.prosecdef, pg_get_userbyid(p.proowner) AS dueno, p.proconfig, p.proacl::text AS acl,
                n.nspname
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'padron_buscar_ruc'`,
    );
    expect(encontradas, 'la función public.padron_buscar_ruc existe').toHaveLength(1);
    const f = encontradas[0]!;
    expect(f.provolatile).toBe('s');
    expect(f.prosecdef).toBe(true);
    expect(f.dueno).toBe('restaurante_migrador');
    expect((f.proconfig as string[]).some((c) => c.startsWith('search_path='))).toBe(true);
    expect(f.acl as string).not.toMatch(/(^|,)=X\//);
    const puede = async (rol: string) =>
      (
        await filas(
          `SELECT has_function_privilege($1, 'public.padron_buscar_ruc(text)', 'EXECUTE') AS ok`,
          [rol],
        )
      )[0]!.ok as boolean;
    expect(await puede('restaurante_api')).toBe(true);
    for (const rol of [
      'restaurante_plataforma',
      'restaurante_colas',
      'restaurante_referencia',
      'restaurante_tiempo_real',
    ]) {
      expect(await puede(rol), rol).toBe(false);
    }
  });

  it('devuelve una fila por un RUC exacto de 11 dígitos y la misma desde A y desde B', async () => {
    const deA = await buscarSql(A().id, RUC_CON_DIRECCION);
    const deB = await buscarSql(B().id, RUC_CON_DIRECCION);
    expect(deA).toHaveLength(1);
    expect(String(deA[0]!.ruc).trim()).toBe(RUC_CON_DIRECCION);
    expect(deB).toEqual(deA);
    expect(await buscarSql(A().id, RUC_VALIDO_AUSENTE)).toEqual([]);
  });

  it('un patrón, un texto vacío, 10 o 12 dígitos o un RUC con basura no devuelven nada', async () => {
    // Antes de probar lo que no devuelve, un RUC exacto sí devuelve (la prueba no es vacía).
    expect(await buscarSql(A().id, RUC_SUNAT)).toHaveLength(1);
    for (const texto of [
      '2010%',
      '20100070970%',
      '%',
      '_0100070970',
      '%0100070970',
      '',
      ' ',
      '2010007097',
      '201000709700',
      '20100070970 ',
      ' 20100070970',
      "20100070970' OR '1'='1",
      '20100070970\n',
      '2010007097_',
      '.*',
      '^20.*$',
    ]) {
      expect(await buscarSql(A().id, texto), JSON.stringify(texto)).toEqual([]);
    }
  });

  it('no escribe nada ni guarda quién consultó qué: ni las tablas de referencia ni la auditoría cambian', async () => {
    const huella = async () => ({
      referencia: (
        await filas(
          `SELECT (SELECT md5(coalesce(string_agg(to_jsonb(a)::text, ',' ORDER BY ruc), '')) FROM referencia.padron_ruc_a a) AS a,
                  (SELECT md5(coalesce(string_agg(to_jsonb(b)::text, ',' ORDER BY ruc), '')) FROM referencia.padron_ruc_b b) AS b,
                  (SELECT to_jsonb(e)::text FROM referencia.padron_estado e) AS estado`,
        )
      )[0],
      auditoria: (
        await filas('SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ANY($1::uuid[])', [
          [A().id, B().id],
        ])
      )[0]!.n as number,
    });
    const antes = await huella();
    for (const ruc of [RUC_CON_DIRECCION, RUC_TILDES, RUC_VALIDO_AUSENTE]) {
      await buscar(ruc, A().token.cajero);
      await buscar(ruc, B().token.supervisor);
    }
    await buscarSql(A().id, RUC_SUNAT);
    expect(await huella()).toEqual(antes);
  });
});

describe('criterios 142 y 164 · el esquema referencia', () => {
  const TABLAS = ['padron_ruc_a', 'padron_ruc_b', 'padron_estado', 'ubigeo'];
  const COLUMNA_DE_UPDATE: Record<string, string> = {
    padron_ruc_a: 'estado',
    padron_ruc_b: 'estado',
    padron_estado: 'filas',
    ubigeo: 'version',
  };

  it('restaurante_api y restaurante_plataforma no leen ni escriben referencia.* (42501)', async () => {
    const plataforma = await abrirCliente('plataforma');
    try {
      for (const [rol, cliente] of [
        ['restaurante_api', apiCliente],
        ['restaurante_plataforma', plataforma],
      ] as const) {
        for (const tabla of TABLAS) {
          for (const sentencia of [
            `SELECT * FROM referencia.${tabla}`,
            `SELECT count(*) FROM referencia.${tabla}`,
            `INSERT INTO referencia.${tabla} DEFAULT VALUES`,
            `UPDATE referencia.${tabla} SET ${COLUMNA_DE_UPDATE[tabla]} = NULL`,
            `DELETE FROM referencia.${tabla}`,
            `TRUNCATE referencia.${tabla}`,
          ]) {
            const error = await errorDe(
              enTransaccion(cliente, null, () => cliente.query(sentencia)),
            );
            expect(error.code, `${rol}: ${sentencia}: ${error.message}`).toBe('42501');
          }
        }
      }
    } finally {
      await plataforma.end();
    }
  });

  it('el esquema tiene exactamente las cuatro tablas y sus columnas son las del modelo de datos (sin empresa_id ni trazabilidad)', async () => {
    const tablas = (
      await filas(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'referencia' ORDER BY table_name`,
      )
    ).map((t) => t.table_name as string);
    expect(tablas).toEqual([...TABLAS].sort());
    const columnas = async (tabla: string) =>
      (
        await filas(
          `SELECT column_name, data_type, character_maximum_length, is_nullable
             FROM information_schema.columns
            WHERE table_schema = 'referencia' AND table_name = $1 ORDER BY column_name`,
          [tabla],
        )
      ).map((c) => [
        c.column_name as string,
        c.data_type as string,
        c.character_maximum_length as number | null,
        c.is_nullable as string,
      ]);
    const padron = [
      ['condicion', 'text', null, 'NO'],
      ['direccion', 'text', null, 'YES'],
      ['estado', 'text', null, 'NO'],
      ['razon_social', 'text', null, 'NO'],
      ['ruc', 'character', 11, 'NO'],
      ['ubigeo', 'character', 6, 'YES'],
    ];
    expect(await columnas('padron_ruc_a')).toEqual(padron);
    expect(await columnas('padron_ruc_b')).toEqual(padron);
    expect(await columnas('padron_estado')).toEqual([
      ['cargado_en', 'timestamp with time zone', null, 'YES'],
      ['fecha_archivo', 'date', null, 'YES'],
      ['filas', 'integer', null, 'YES'],
      ['tabla_activa', 'character', 1, 'YES'],
      ['ultimo_error', 'text', null, 'YES'],
      ['ultimo_intento_en', 'timestamp with time zone', null, 'YES'],
    ]);
    expect(await columnas('ubigeo')).toEqual([
      ['codigo', 'character', 6, 'NO'],
      ['departamento', 'text', null, 'NO'],
      ['distrito', 'text', null, 'NO'],
      ['provincia', 'text', null, 'NO'],
      ['version', 'text', null, 'NO'],
    ]);
    // El RUC es la clave primaria de las dos tablas del padrón.
    for (const tabla of ['padron_ruc_a', 'padron_ruc_b']) {
      const pk = await filas(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
          WHERE i.indrelid = ('referencia.' || $1)::regclass AND i.indisprimary`,
        [tabla],
      );
      expect(pk.map((c) => c.attname)).toEqual(['ruc']);
    }
  });

  it('cada tabla tiene la RLS activada con una sola política, carga_padron, para restaurante_referencia', async () => {
    for (const tabla of TABLAS) {
      const t = (
        await filas(
          `SELECT relrowsecurity FROM pg_class WHERE oid = ('referencia.' || $1)::regclass`,
          [tabla],
        )
      )[0]!;
      expect(t.relrowsecurity, tabla).toBe(true);
      const politicas = await filas(
        `SELECT policyname, roles::text AS roles, cmd FROM pg_policies WHERE schemaname = 'referencia' AND tablename = $1`,
        [tabla],
      );
      expect(politicas, tabla).toHaveLength(1);
      expect(politicas[0]).toMatchObject({ policyname: 'carga_padron', cmd: 'ALL' });
      expect(politicas[0]!.roles).toContain('restaurante_referencia');
    }
  });

  it('restaurante_referencia tiene los privilegios de «Permisos» y nada más', async () => {
    const puede = async (tabla: string, privilegio: string) =>
      (
        await filas(`SELECT has_table_privilege('restaurante_referencia', $1, $2) AS ok`, [
          `referencia.${tabla}`,
          privilegio,
        ])
      )[0]!.ok as boolean;
    expect(
      (
        await filas(
          `SELECT has_schema_privilege('restaurante_referencia', 'referencia', 'USAGE') AS ok`,
        )
      )[0]!.ok,
    ).toBe(true);
    for (const tabla of ['padron_ruc_a', 'padron_ruc_b', 'ubigeo']) {
      for (const [privilegio, esperado] of [
        ['SELECT', true],
        ['INSERT', true],
        ['TRUNCATE', true],
        ['UPDATE', false],
        ['DELETE', false],
      ] as const) {
        expect(await puede(tabla, privilegio), `${tabla} ${privilegio}`).toBe(esperado);
      }
    }
    for (const [privilegio, esperado] of [
      ['SELECT', true],
      ['INSERT', true],
      ['UPDATE', true],
      ['DELETE', false],
      ['TRUNCATE', false],
    ] as const) {
      expect(await puede('padron_estado', privilegio), `padron_estado ${privilegio}`).toBe(
        esperado,
      );
    }
  });

  it('ni la API ni plataforma tienen USAGE en el esquema referencia', async () => {
    for (const rol of ['restaurante_api', 'restaurante_plataforma', 'restaurante_colas']) {
      expect(
        (await filas(`SELECT has_schema_privilege($1, 'referencia', 'USAGE') AS ok`, [rol]))[0]!.ok,
        rol,
      ).toBe(false);
    }
  });
});

describe('criterio 142 · ninguna tabla compartida guarda lo que escriben los cajeros', () => {
  it('el nombre y la dirección escritos al facturar quedan solo en el comprobante de su empresa', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const cliente = {
      tipoDocumento: 'RUC',
      numero: RUC_CON_DIRECCION,
      nombre: 'Nombre Escrito Por El Cajero 55aa',
      direccion: 'Direccion Escrita Por El Cajero 77bb',
    };
    const c = await cobrarFactura(ctx, A(), { turnoId, cliente });
    const guardado = await filas(
      'SELECT cliente_nombre, cliente_direccion FROM comprobante WHERE id = $1',
      [c.comprobanteId],
    );
    expect(guardado[0]).toMatchObject({
      cliente_nombre: cliente.nombre,
      cliente_direccion: cliente.direccion,
    });
    for (const tabla of ['padron_ruc_a', 'padron_ruc_b', 'ubigeo', 'padron_estado']) {
      const texto = (
        await filas(
          `SELECT coalesce(string_agg(to_jsonb(t)::text, ' '), '') AS t FROM referencia.${tabla} t`,
        )
      )[0]!.t as string;
      expect(texto, tabla).not.toContain('55aa');
      expect(texto, tabla).not.toContain('77bb');
    }
    // Y la búsqueda sigue dando lo que dice SUNAT, no lo que escribió el cajero.
    const r = await ficha(RUC_CON_DIRECCION);
    expect(r.razonSocial).not.toContain('55aa');
    // B no ve nada de A.
    expect(
      await filas('SELECT 1 FROM comprobante WHERE empresa_id = $1 AND cliente_nombre LIKE $2', [
        B().id,
        '%55aa%',
      ]),
    ).toEqual([]);
  });
});

describe('criterio 138 · una nueva carga cambia de tabla y una carga mala deja la anterior', () => {
  it('una segunda carga buena activa la otra tabla y las búsquedas siguen igual', async () => {
    const antes = await estadoSql();
    const resultado = await ctx.carga.cargar();
    expect(resultado).toEqual({ filas: FILAS_VALIDAS, activada: true });
    const despues = await estadoSql();
    expect(despues.tabla_activa).not.toBe(antes.tabla_activa);
    expect(despues.filas).toBe(FILAS_VALIDAS);
    const r = await ficha(RUC_TILDES);
    expect(r.razonSocial).toBe('PANADERÍA EL PIÑÓN S.A.C.');
  });

  it('una carga con menos del 90 % de las filas de la anterior no se activa: la tabla anterior sigue, se guarda el error y se avisa', async () => {
    const antes = await estadoSql();
    const aplicacion = await conAplicacionCon(pathToFileURL(INCOMPLETO).href);
    const registros = capturarRegistros();
    try {
      const resultado = await aplicacion.carga.cargar();
      expect(resultado.activada).toBe(false);
      expect(registros.texto()).toContain('padron.carga_fallida');
      expect(registros.texto()).not.toContain('SUPERMERCADOS');
    } finally {
      registros.restaurar();
    }
    const despues = await estadoSql();
    expect(despues.tabla_activa).toBe(antes.tabla_activa);
    expect(despues.filas).toBe(FILAS_VALIDAS);
    expect(despues.cargado_en).toEqual(antes.cargado_en);
    expect(String(despues.ultimo_error).length).toBeGreaterThan(0);
    expect(despues.ultimo_intento_en).not.toBeNull();
    const estado = await estadoDelPadron();
    expect(estado).toMatchObject({ filas: FILAS_VALIDAS });
    expect(String(estado.ultimoError).length).toBeGreaterThan(0);
    // Las búsquedas no vieron la carga a medias: los siete RUC siguen.
    for (const ruc of [
      RUC_CON_DIRECCION,
      RUC_SUNAT,
      RUC_TILDES,
      RUC_BAJA,
      RUC_SUSPENDIDO,
      RUC_NO_HABIDO,
      RUC_PERSONA,
    ]) {
      exigirEstado(await buscar(ruc), 200, `Buscar ${ruc} después de una carga mala`);
    }
  });

  it('un archivo dañado tampoco cambia nada', async () => {
    const antes = await estadoSql();
    const dañado = join(mkdtempSync(join(tmpdir(), 'padron-')), 'dañado.zip');
    writeFileSync(dañado, 'esto no es un zip');
    const aplicacion = await conAplicacionCon(pathToFileURL(dañado).href);
    const resultado = await aplicacion.carga.cargar().catch(() => ({ activada: false }));
    expect(resultado.activada).toBe(false);
    const despues = await estadoSql();
    expect(despues.tabla_activa).toBe(antes.tabla_activa);
    expect(despues.filas).toBe(FILAS_VALIDAS);
    expect(String(despues.ultimo_error).length).toBeGreaterThan(0);
    exigirEstado(await buscar(RUC_CON_DIRECCION), 200, 'Buscar después de un archivo dañado');
  });

  it('POST /plataforma/padron/carga responde 202 solo al superadministrador', async () => {
    const res = await api(ctx, esc.sa.token, 'post', '/plataforma/padron/carga');
    expect(res.status, res.text).toBe(202);
    const intruso = await api(ctx, A().token.admin, 'post', '/plataforma/padron/carga');
    expect([401, 403]).toContain(intruso.status);
  });
});
