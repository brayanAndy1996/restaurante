// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P1 (parte 3) · Aislamiento entre empresas de las tablas nuevas de 005, por SQL (ruta crítica), criterios 62, 63 y
// 65:
// - 62: `carta_web`, `carta_web_sucursal`, `mesa_qr` y `llamado` existen (las pruebas de catálogo de 001 y 002 las
//   recorren solas cuando existen);
// - 63: con el contexto de A y un actor de A fijado, no se leen, actualizan ni borran filas de B por id ni sin
//   `WHERE`, y no se insertan filas con el `empresa_id` de B. El rechazo es el de la política RLS ("row-level
//   security"), no el de "contexto de actor ausente", que también es 42501. La tabla "Permisos" de `spec.md` da a
//   `restaurante_api` SELECT, INSERT y UPDATE (no DELETE): el borrado se rechaza por permisos, sin tocar a B;
// - 65: el espejo `carta_publica`: insertar, cambiar o borrar en `carta_web` o `mesa_qr` de una empresa cambia solo
//   la fila del espejo de esa empresa; una dirección o un código que ya usa B, puesto por A, falla (409 en HTTP,
//   23505 en SQL) sin cambiar lo de B ni revelarlo; el trigger toma la empresa de la fila nueva, que la RLS ya
//   obligó a ser la del contexto.
// Las filas se siembran por las rutas de la historia (la carta web y los QR por sus rutas, los llamados por la API
// pública y por la PWA), nunca por SQL. Hoy las tablas, el espejo y las rutas no existen: las pruebas fallan por eso.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { altaEmpresa, type EmpresaDePrueba } from '../acceso/fabrica-plataforma';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  arrancarAislamiento,
  clientePublico,
  crearMundo,
  exigirEstado,
  existeTabla,
  llamar,
  sembrarLlamados,
  type AppP4,
  type Mundo,
} from './fabrica-aislamiento';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP4;
let admin: Client;
let apiCliente: Client;

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2 });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

const TABLAS = ['carta_web', 'carta_web_sucursal', 'mesa_qr', 'llamado'] as const;
type Tabla = (typeof TABLAS)[number];

/** Privilegios de `restaurante_api` según la tabla "Permisos" de `spec.md`: ninguna tabla tiene DELETE. */
const PRIVILEGIOS: Record<Tabla, string[]> = {
  carta_web: ['SELECT', 'INSERT', 'UPDATE'],
  carta_web_sucursal: ['SELECT', 'INSERT', 'UPDATE'],
  mesa_qr: ['SELECT', 'INSERT', 'UPDATE'],
  llamado: ['SELECT', 'INSERT', 'UPDATE'],
};

/** Columnas únicas que hay que cambiar en una copia para que no choque con la fila de la que sale. */
const SIN_CHOCAR: Record<Tabla, () => Record<string, unknown>> = {
  carta_web: () => ({ slug: `copia-${randomBytes(4).toString('hex')}` }),
  carta_web_sucursal: () => ({ slug: `copia-${randomBytes(4).toString('hex')}` }),
  mesa_qr: () => ({ codigo: randomBytes(16).toString('base64url') }),
  llamado: () => ({}),
};

/** La copia se inserta con el actor `prueba`: los demás actores de la fila de origen no cuentan. */
const ACTOR_DE_LA_COPIA = {
  creado_por_usuario_id: null,
  creado_por_equipo_id: null,
  creado_por_superadministrador_id: null,
  creado_por_sistema: 'prueba',
  actualizado_por_usuario_id: null,
  actualizado_por_equipo_id: null,
  actualizado_por_superadministrador_id: null,
  actualizado_por_sistema: 'prueba',
};

interface Sembrada {
  empresaId: string;
}

let sembradoPendiente: Promise<{ m: Mundo; A: Sembrada; B: Sembrada }> | undefined;
function sembrado() {
  sembradoPendiente ??= (async () => {
    const m = await crearMundo(ctx);
    await sembrarLlamados(ctx, m.A, clientePublico(ctx), m.e.mozo2);
    await sembrarLlamados(ctx, m.B, clientePublico(ctx));
    return { m, A: { empresaId: m.A.empresaId }, B: { empresaId: m.B.empresaId } };
  })();
  return sembradoPendiente;
}

const idsDe = async (tabla: string, empresaId: string): Promise<string[]> =>
  (
    await admin.query<{ id: string }>(`SELECT id FROM ${tabla} WHERE empresa_id = $1 ORDER BY id`, [
      empresaId,
    ])
  ).rows.map((f) => f.id);

const fotoDe = async (tabla: string, empresaId: string) =>
  (
    await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    )
  ).rows.map((f) => f.fila);

/** Transacción de `restaurante_api` con el actor `prueba` y el contexto de `empresaId`; siempre se revierte. */
const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

// ------------------------------------------------------------------------------------------------
// 62 · Las tablas existen
// ------------------------------------------------------------------------------------------------
describe('criterio 62 · las cuatro tablas nuevas de 005 existen', () => {
  it('carta_web, carta_web_sucursal, mesa_qr y llamado', async () => {
    const faltan: string[] = [];
    for (const tabla of TABLAS) if (!(await existeTabla(admin, tabla))) faltan.push(tabla);
    expect(faltan, `faltan estas tablas de 005: ${faltan.join(', ')}`).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// 63 · Por tabla
// ------------------------------------------------------------------------------------------------
describe.each(TABLAS.map((tabla) => ({ tabla, api: PRIVILEGIOS[tabla] })))(
  'criterio 63 · $tabla',
  ({ tabla, api }) => {
    const puede = (privilegio: string) => api.includes(privilegio);

    /** Si la API no tiene el privilegio, la sentencia se rechaza por permisos (42501), no por RLS. */
    async function exigirSinPermiso(sentencia: Promise<unknown>): Promise<void> {
      const error = await errorDe(sentencia);
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/permission denied/i);
    }

    it('la siembra dejó filas de A y de B en la tabla (la prueba no es vacía)', async () => {
      const { A, B } = await sembrado();
      expect((await idsDe(tabla, A.empresaId)).length, `filas de A en ${tabla}`).toBeGreaterThan(0);
      expect((await idsDe(tabla, B.empresaId)).length, `filas de B en ${tabla}`).toBeGreaterThan(0);
    });

    it('lectura: con el contexto de A no se leen filas de B por id ni sin WHERE, y sí las de A', async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.empresaId);
      const idsA = await idsDe(tabla, A.empresaId);
      await comoApi(A.empresaId, async () => {
        const todas = await apiCliente.query<{ id: string; empresa_id: string }>(
          `SELECT id, empresa_id FROM ${tabla}`,
        );
        expect(todas.rows.map((f) => f.id).sort()).toEqual(idsA);
        expect(todas.rows.every((f) => f.empresa_id === A.empresaId)).toBe(true);
        const porId = await apiCliente.query(`SELECT id FROM ${tabla} WHERE id = ANY($1::uuid[])`, [
          idsB,
        ]);
        expect(porId.rows).toEqual([]);
        const deB = await apiCliente.query(`SELECT id FROM ${tabla} WHERE empresa_id = $1`, [
          B.empresaId,
        ]);
        expect(deB.rows).toEqual([]);
      });
      // Control: con el contexto de B se ven sus propias filas.
      await comoApi(B.empresaId, async () => {
        const propias = await apiCliente.query<{ id: string }>(`SELECT id FROM ${tabla}`);
        expect(propias.rows.map((f) => f.id).sort()).toEqual(idsB);
      });
    });

    it('actualización: el UPDATE por id y sin WHERE no toca filas de B, y cambiar el dueño a B falla por la política', async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.empresaId);
      const idsA = await idsDe(tabla, A.empresaId);
      const antesB = await fotoDe(tabla, B.empresaId);
      await comoApi(A.empresaId, async () => {
        if (!puede('UPDATE')) {
          await exigirSinPermiso(apiCliente.query(`UPDATE ${tabla} SET empresa_id = empresa_id`));
          return;
        }
        const porId = await apiCliente.query(
          `UPDATE ${tabla} SET empresa_id = empresa_id WHERE id = ANY($1::uuid[]) RETURNING id`,
          [idsB],
        );
        expect(porId.rowCount).toBe(0);
        const sinWhere = await apiCliente.query<{ id: string; empresa_id: string }>(
          `UPDATE ${tabla} SET empresa_id = empresa_id RETURNING id, empresa_id`,
        );
        expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
        expect(sinWhere.rows.every((f) => f.empresa_id === A.empresaId)).toBe(true);
        await apiCliente.query('SAVEPOINT dueno');
        const cambio = await errorDe(
          apiCliente.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [
            B.empresaId,
            idsA[0],
          ]),
        );
        expect(cambio.code, cambio.message).toBe('42501');
        expect(cambio.message).toMatch(/row-level security/);
        await apiCliente.query('ROLLBACK TO SAVEPOINT dueno');
      });
      expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
    });

    it('borrado: la API no tiene DELETE en la tabla y el intento se rechaza por permisos, sin tocar a B', async () => {
      const { A, B } = await sembrado();
      const idsA = await idsDe(tabla, A.empresaId);
      const antesB = await fotoDe(tabla, B.empresaId);
      expect(puede('DELETE'), 'la tabla "Permisos" de spec.md no da DELETE en ninguna tabla').toBe(
        false,
      );
      const idsB = await idsDe(tabla, B.empresaId);
      await comoApi(A.empresaId, async () => {
        await apiCliente.query('SAVEPOINT sin_where');
        await exigirSinPermiso(apiCliente.query(`DELETE FROM ${tabla}`));
        await apiCliente.query('ROLLBACK TO SAVEPOINT sin_where');
        await exigirSinPermiso(
          apiCliente.query(`DELETE FROM ${tabla} WHERE id = ANY($1::uuid[])`, [idsB]),
        );
      });
      expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
      expect(await idsDe(tabla, A.empresaId), 'A conserva sus filas').toEqual(idsA);
    });

    it('inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado) y no se crea', async () => {
      const { A, B } = await sembrado();
      const antesB = await fotoDe(tabla, B.empresaId);
      const idsAntes = await idsDe(tabla, B.empresaId);
      // Copia de una fila de A con otro id y empresa_id = B (jsonb_populate_record sirve para cualquier tabla).
      const cambios = {
        id: randomUUID(),
        empresa_id: B.empresaId,
        ...SIN_CHOCAR[tabla](),
        ...ACTOR_DE_LA_COPIA,
      };
      const copiar = `INSERT INTO ${tabla}
        SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
          FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`;
      await comoApi(A.empresaId, async () => {
        const error = await errorDe(
          apiCliente.query(copiar, [JSON.stringify(cambios), A.empresaId]),
        );
        expect(error.code, error.message).toBe('42501');
        expect(error.message).toMatch(/row-level security/);
        expect(error.message).not.toMatch(/contexto de actor ausente/);
      });
      expect(await idsDe(tabla, B.empresaId)).toEqual(idsAntes);
      expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
    });
  },
);

// ------------------------------------------------------------------------------------------------
// 65 · El espejo carta_publica
// ------------------------------------------------------------------------------------------------
interface EmpresaDeEspejo {
  base: EmpresaDePrueba;
  empresaId: string;
  token: string;
  slug: string;
  mesaId: string;
  codigo: string;
}

/** Una tercera empresa (C) con carta web y una mesa con su QR, para cambiarla sin tocar a A ni a B. */
async function crearEmpresaC(m: Mundo): Promise<EmpresaDeEspejo> {
  const base = await altaEmpresa(ctx, m.e.sa);
  const token = base.admin.token;
  const sucursalId = base.sucursales[0]!.id;
  const slug = `espejo-${randomBytes(4).toString('hex')}`;
  exigirEstado(
    await llamar(ctx, token, {
      metodo: 'put',
      ruta: '/carta-web',
      cuerpo: { nombre: 'Empresa C', slug, colorPrincipal: '#1D4A9E' },
    }),
    200,
    'configurar la carta web de C',
  );
  const zona = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/zonas`,
    cuerpo: { nombre: 'Salón C', columnas: 4, filas: 4 },
  });
  exigirEstado(zona, 201, 'crear la zona de C');
  const mesa = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/zonas/${zona.body.id as string}/mesas`,
    cuerpo: { nombre: 'C1', capacidad: 4, forma: 'CUADRADA', columna: 1, fila: 1 },
  });
  exigirEstado(mesa, 201, 'crear la mesa de C');
  const qr = await llamar(ctx, token, {
    metodo: 'get',
    ruta: `/sucursales/${sucursalId}/qr-mesas`,
  });
  exigirEstado(qr, 200, 'la hoja de QR de C');
  const codigo = (qr.body.mesas as { codigo: string }[])[0]!.codigo;
  return { base, empresaId: base.empresaId, token, slug, mesaId: mesa.body.id as string, codigo };
}

let empresaCPendiente: Promise<EmpresaDeEspejo> | undefined;
const empresaC = async () => (empresaCPendiente ??= sembrado().then(({ m }) => crearEmpresaC(m)));

const espejoSlugs = async () =>
  (
    await admin.query<{ slug: string; empresa_id: string }>(
      `SELECT slug, empresa_id FROM carta_publica.empresa_slug ORDER BY slug`,
    )
  ).rows;
const espejoCodigos = async () =>
  (
    await admin.query<{ codigo: string; empresa_id: string }>(
      `SELECT codigo, empresa_id FROM carta_publica.codigo_mesa ORDER BY codigo`,
    )
  ).rows;
const espejoDe = <T extends { empresa_id: string }>(filas: T[], empresaId: string): T[] =>
  filas.filter((f) => f.empresa_id === empresaId);
/** Solo las filas de las empresas de la prueba: otros archivos crean cartas web en paralelo en la misma base. */
const espejoDeVarias = <T extends { empresa_id: string }>(filas: T[], empresas: string[]): T[] =>
  filas.filter((f) => empresas.includes(f.empresa_id));

describe('criterio 65 · el espejo carta_publica refleja carta_web y mesa_qr', () => {
  it('tiene una fila de dirección por cada carta_web y una de código por cada mesa_qr, con su empresa', async () => {
    const { m, A, B } = await sembrado();
    const slugs = await espejoSlugs();
    expect(espejoDe(slugs, A.empresaId)).toEqual([{ slug: m.A.slug, empresa_id: A.empresaId }]);
    expect(espejoDe(slugs, B.empresaId)).toEqual([{ slug: m.B.slug, empresa_id: B.empresaId }]);
    const codigos = await espejoCodigos();
    for (const empresaId of [A.empresaId, B.empresaId]) {
      const { rows } = await admin.query<{ codigo: string }>(
        `SELECT codigo FROM mesa_qr WHERE empresa_id = $1 ORDER BY codigo`,
        [empresaId],
      );
      expect(
        espejoDe(codigos, empresaId).map((f) => f.codigo),
        'los códigos del espejo son los de mesa_qr',
      ).toEqual(rows.map((f) => f.codigo));
      expect(rows.length).toBeGreaterThan(2);
    }
  });

  it('cambiar la dirección de C cambia solo la fila de C: la anterior deja de buscarse y la de A y la de B no se tocan', async () => {
    const { A, B } = await sembrado();
    const c = await empresaC();
    const antes = await espejoSlugs();
    const otra = `espejo-nuevo-${randomBytes(4).toString('hex')}`;
    exigirEstado(
      await llamar(ctx, c.token, {
        metodo: 'put',
        ruta: '/carta-web',
        cuerpo: { nombre: 'Empresa C', slug: otra, colorPrincipal: '#1D4A9E' },
      }),
      200,
      'cambiar la dirección de C',
    );
    const despues = await espejoSlugs();
    expect(espejoDe(despues, c.empresaId)).toEqual([{ slug: otra, empresa_id: c.empresaId }]);
    expect(espejoDe(despues, A.empresaId)).toEqual(espejoDe(antes, A.empresaId));
    expect(espejoDe(despues, B.empresaId)).toEqual(espejoDe(antes, B.empresaId));
    expect(espejoDeVarias(despues, [A.empresaId, B.empresaId, c.empresaId]).length).toBe(
      espejoDeVarias(antes, [A.empresaId, B.empresaId, c.empresaId]).length,
    );
    const funcion = (slug: string) =>
      apiCliente.query<{ id: string | null }>('SELECT public.empresa_de_carta($1) AS id', [slug]);
    expect((await funcion(otra)).rows[0]!.id).toBe(c.empresaId);
    expect((await funcion(c.slug)).rows[0]!.id).toBeNull();
    c.slug = otra;
  });

  it('cambiar el QR de una mesa de C cambia solo su código en el espejo: el anterior ya no se busca', async () => {
    const { m, A, B } = await sembrado();
    const c = await empresaC();
    const antes = await espejoCodigos();
    const cambio = await llamar(ctx, c.token, {
      metodo: 'post',
      ruta: `/sucursales/${c.base.sucursales[0]!.id}/mesas/${c.mesaId}/qr`,
      cabeceras: { 'Idempotency-Key': randomUUID() },
    });
    exigirEstado(cambio, 201, 'cambiar el QR de C');
    const nuevo = cambio.body.codigo as string;
    const despues = await espejoCodigos();
    expect(espejoDe(despues, c.empresaId)).toEqual([{ codigo: nuevo, empresa_id: c.empresaId }]);
    expect(espejoDe(despues, A.empresaId)).toEqual(espejoDe(antes, A.empresaId));
    expect(espejoDe(despues, B.empresaId)).toEqual(espejoDe(antes, B.empresaId));
    const funcion = (codigo: string) =>
      apiCliente.query<{ id: string | null }>('SELECT public.empresa_de_codigo_mesa($1) AS id', [
        codigo,
      ]);
    expect((await funcion(nuevo)).rows[0]!.id).toBe(c.empresaId);
    expect((await funcion(c.codigo)).rows[0]!.id).toBeNull();
    expect((await funcion(m.A.mesa4.codigo)).rows[0]!.id).toBe(A.empresaId);
    c.codigo = nuevo;
  });

  it('borrar la carta_web o la mesa_qr de C quita solo su fila del espejo (el borrado lo hace el administrador de la base y se revierte)', async () => {
    const { A, B } = await sembrado();
    const c = await empresaC();
    const antesSlugs = await espejoSlugs();
    const antesCodigos = await espejoCodigos();
    await enTransaccion(admin, null, async () => {
      const slugs = await admin.query(`DELETE FROM carta_web WHERE empresa_id = $1`, [c.empresaId]);
      expect(slugs.rowCount).toBe(1);
      const codigos = await admin.query(`DELETE FROM mesa_qr WHERE empresa_id = $1`, [c.empresaId]);
      expect(codigos.rowCount).toBeGreaterThan(0);
      const sl = await espejoSlugs();
      const co = await espejoCodigos();
      expect(espejoDe(sl, c.empresaId)).toEqual([]);
      expect(espejoDe(co, c.empresaId)).toEqual([]);
      expect(espejoDe(sl, A.empresaId)).toEqual(espejoDe(antesSlugs, A.empresaId));
      expect(espejoDe(sl, B.empresaId)).toEqual(espejoDe(antesSlugs, B.empresaId));
      expect(espejoDe(co, A.empresaId)).toEqual(espejoDe(antesCodigos, A.empresaId));
      expect(espejoDe(co, B.empresaId)).toEqual(espejoDe(antesCodigos, B.empresaId));
    });
    // El ROLLBACK devolvió todo lo de las empresas de la prueba (las filas de C vuelven exactas; A y B no cambian).
    const propias = [A.empresaId, B.empresaId, c.empresaId];
    const slugsDespues = await espejoSlugs();
    const codigosDespues = await espejoCodigos();
    expect(espejoDe(slugsDespues, c.empresaId)).toEqual(espejoDe(antesSlugs, c.empresaId));
    expect(espejoDe(codigosDespues, c.empresaId)).toEqual(espejoDe(antesCodigos, c.empresaId));
    expect(espejoDe(slugsDespues, c.empresaId).length).toBe(1);
    expect(espejoDe(codigosDespues, c.empresaId).length).toBeGreaterThan(0);
    expect(espejoDe(slugsDespues, A.empresaId)).toEqual(espejoDe(antesSlugs, A.empresaId));
    expect(espejoDe(slugsDespues, B.empresaId)).toEqual(espejoDe(antesSlugs, B.empresaId));
    expect(espejoDe(codigosDespues, A.empresaId)).toEqual(espejoDe(antesCodigos, A.empresaId));
    expect(espejoDe(codigosDespues, B.empresaId)).toEqual(espejoDe(antesCodigos, B.empresaId));
    expect(espejoDeVarias(slugsDespues, propias)).toEqual(espejoDeVarias(antesSlugs, propias));
    expect(espejoDeVarias(codigosDespues, propias)).toEqual(espejoDeVarias(antesCodigos, propias));
  });

  it('A no puede quedarse con la dirección de B: PUT /carta-web responde 409 CONFLICTO sin revelar nada y sin cambiar la de B', async () => {
    const { m, A, B } = await sembrado();
    const c = await empresaC();
    const propias = [A.empresaId, B.empresaId, c.empresaId];
    const antesB = await fotoDe('carta_web', B.empresaId);
    const antesEspejo = espejoDeVarias(await espejoSlugs(), propias);
    const res = await llamar(ctx, c.token, {
      metodo: 'put',
      ruta: '/carta-web',
      cuerpo: { nombre: 'Empresa C', slug: m.B.slug, colorPrincipal: '#1D4A9E' },
    });
    expect(res.status, res.text).toBe(409);
    expect(res.body.codigo).toBe('CONFLICTO');
    for (const secreto of [B.empresaId, m.B.nombreCarta, m.B.S1, m.B.S2]) {
      expect(res.text).not.toContain(secreto);
    }
    expect(await fotoDe('carta_web', B.empresaId)).toEqual(antesB);
    expect(espejoDeVarias(await espejoSlugs(), propias)).toEqual(antesEspejo);
    // La configuración de C no cambió.
    const mia = await llamar(ctx, c.token, { metodo: 'get', ruta: '/carta-web' });
    exigirEstado(mia, 200, 'la carta web de C');
    expect(mia.body.slug).toBe(c.slug);
  });

  it('lo mismo por SQL: poner la dirección de B (o el código de una mesa de B) falla con unicidad (23505) sin revelar la empresa de B', async () => {
    const { m, A, B } = await sembrado();
    const c = await empresaC();
    const propias = [A.empresaId, B.empresaId, c.empresaId];
    const antesB = await fotoDe('carta_web', B.empresaId);
    const antesQrB = await fotoDe('mesa_qr', B.empresaId);
    const antesSlugs = espejoDeVarias(await espejoSlugs(), propias);
    const antesCodigos = espejoDeVarias(await espejoCodigos(), propias);
    const sinRevelar = (e: { message: string; detail?: string; table?: string }) => {
      const texto = JSON.stringify([e.message, e.detail]);
      expect(texto).not.toContain(B.empresaId);
      expect(texto).not.toContain(m.B.S1);
    };
    await comoApi(c.empresaId, async () => {
      await apiCliente.query('SAVEPOINT uno');
      const dir = await errorDe(
        apiCliente.query(`UPDATE carta_web SET slug = $1 WHERE empresa_id = $2`, [
          m.B.slug,
          c.empresaId,
        ]),
      );
      expect(dir.code, dir.message).toBe('23505');
      sinRevelar(dir);
      await apiCliente.query('ROLLBACK TO SAVEPOINT uno');
      const cod = await errorDe(
        apiCliente.query(`UPDATE mesa_qr SET codigo = $1 WHERE empresa_id = $2`, [
          m.B.mesa4.codigo,
          c.empresaId,
        ]),
      );
      expect(cod.code, cod.message).toBe('23505');
      sinRevelar(cod);
    });
    expect(await fotoDe('carta_web', B.empresaId)).toEqual(antesB);
    expect(await fotoDe('mesa_qr', B.empresaId)).toEqual(antesQrB);
    expect(espejoDeVarias(await espejoSlugs(), propias)).toEqual(antesSlugs);
    expect(espejoDeVarias(await espejoCodigos(), propias)).toEqual(antesCodigos);
  });

  it('el trigger toma la empresa de la fila nueva: una fila de mesa_qr con la empresa de B puesta desde A no entra ni deja nada en el espejo', async () => {
    const { m, A, B } = await sembrado();
    const propias = [A.empresaId, B.empresaId];
    const antes = espejoDeVarias(await espejoCodigos(), propias);
    const nuevo = randomBytes(16).toString('base64url');
    const cambios = {
      id: randomUUID(),
      empresa_id: B.empresaId,
      codigo: nuevo,
      ...ACTOR_DE_LA_COPIA,
    };
    await comoApi(A.empresaId, async () => {
      const error = await errorDe(
        apiCliente.query(
          `INSERT INTO mesa_qr
             SELECT (jsonb_populate_record(NULL::mesa_qr, to_jsonb(x) || $1::jsonb)).*
               FROM mesa_qr x WHERE x.mesa_id = $2`,
          [JSON.stringify(cambios), m.A.mesa12.id],
        ),
      );
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/row-level security/);
    });
    expect(espejoDeVarias(await espejoCodigos(), propias)).toEqual(antes);
    expect((await espejoCodigos()).some((f) => f.codigo === nuevo)).toBe(false);
  });
});
