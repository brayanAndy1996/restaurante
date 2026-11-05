// spec: 006-caja-cobro (pruebas protegidas)
//
// P6 (parte 1) · Aislamiento entre empresas de las tablas nuevas de 6a, por SQL (ruta crítica), criterios 103 y 104:
// - 103: las trece tablas existen (las pruebas de catálogo de 001 y 002 las recorren solas cuando existen);
// - 104: para `caja`, `turno`, `turno_conteo`, `movimiento_caja`, `cobro`, `pago`, `serie`, `comprobante`,
//   `comprobante_linea`, `emisor_tasa_igv`, `descuento`, `cortesia` y `contador_llamado`, con el contexto de A y un
//   actor de A fijado, no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, y no se insertan filas con el
//   `empresa_id` de B. El rechazo tiene que ser el de la política RLS ("row-level security"), no el de "contexto de
//   actor ausente", que también es 42501. Donde la tabla "Permisos" de `spec.md` no da un privilegio a
//   `restaurante_api` (ninguna tiene DELETE; varias tampoco UPDATE), la sentencia se rechaza por permisos; en
//   `comprobante` el UPDATE es por columna (solo `estado` y `actualizado_*`).
// Las empresas se dan de alta por la API real (`POST /plataforma/empresas`), su carta se siembra por las rutas de 003 y
// las filas de 6a se siembran por SQL como `restaurante_api` con el contexto y el actor fijados.
// Hoy falla porque las tablas todavía no existen: la primera prueba lista las que faltan y las demás fallan por eso.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { altaEmpresa, nuevoSuperadmin, type EmpresaDePrueba } from '../acceso/fabrica-plataforma';
import { sembrarCarta } from '../carta-critica/fabrica-permisos-carta';
import { arrancarP5, type AppP5 } from '../impresion-critica/fabrica-p5';
import { abrirCliente } from '../utilidades';
import {
  impresoraDeSiembra,
  PRIVILEGIOS_CAJA,
  sembrarFilasCaja,
  TABLAS_CAJA,
  type BaseCaja,
  type FilasCaja,
  type Privilegio,
} from './fabrica-aislamiento-caja';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP5;
let admin: Client;
let apiCliente: Client;

beforeAll(async () => {
  ctx = await arrancarP5({ poolMax: 2 });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});
afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

interface Sembrada {
  base: BaseCaja;
  filas: FilasCaja;
}

async function sembrarEmpresa(empresa: EmpresaDePrueba): Promise<Sembrada> {
  const carta = await sembrarCarta(ctx, empresa.admin.token);
  const base: BaseCaja = {
    empresaId: empresa.empresaId,
    sucursal1: empresa.sucursales[0]!.id,
    sucursal2: empresa.sucursales[1]!.id,
    usuarioId: empresa.admin.id,
    estacionId: carta.estacionId,
    productoId: carta.productoId,
    emisorId: empresa.emisores[0]!.id,
    impresoraId: await impresoraDeSiembra(ctx, empresa.admin.token, empresa.sucursales[0]!.id),
  };
  return { base, filas: await sembrarFilasCaja(apiCliente, base) };
}

let sembradoPendiente: Promise<{ A: Sembrada; B: Sembrada }> | undefined;
function sembrado() {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    const A = await altaEmpresa(ctx, sa);
    const B = await altaEmpresa(ctx, sa);
    return { A: await sembrarEmpresa(A), B: await sembrarEmpresa(B) };
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

const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

describe('criterio 103 · las trece tablas existen', () => {
  it('caja, turno, turno_conteo, movimiento_caja, cobro, pago, serie, comprobante, comprobante_linea, emisor_tasa_igv, descuento, cortesia y contador_llamado', async () => {
    const faltan: string[] = [];
    for (const tabla of TABLAS_CAJA) {
      const r = await admin.query<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [
        `public.${tabla}`,
      ]);
      if (r.rows[0]!.t === null) faltan.push(tabla);
    }
    expect(faltan, `faltan estas tablas de 6a: ${faltan.join(', ')}`).toEqual([]);
  });
});

describe.each(TABLAS_CAJA.map((tabla) => ({ tabla, api: PRIVILEGIOS_CAJA[tabla] })))(
  'criterio 104 · $tabla',
  ({ tabla, api }) => {
    const puede = (privilegio: Privilegio) => api.includes(privilegio);
    /** `comprobante` solo da UPDATE sobre `estado`: una sentencia que toca `empresa_id` se rechaza por permisos. */
    const columnaDeUpdate = tabla === 'comprobante' ? 'estado' : 'empresa_id';

    async function exigirSinPermiso(sentencia: Promise<unknown>): Promise<void> {
      const error = await errorDe(sentencia);
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/permission denied/i);
    }

    it('la siembra dejó filas de A y de B en la tabla (la prueba no es vacía)', async () => {
      const { A, B } = await sembrado();
      expect(
        (await idsDe(tabla, A.base.empresaId)).length,
        `filas de A en ${tabla}`,
      ).toBeGreaterThan(0);
      expect(
        (await idsDe(tabla, B.base.empresaId)).length,
        `filas de B en ${tabla}`,
      ).toBeGreaterThan(0);
    });

    it('lectura: con el contexto de A no se leen filas de B por id ni sin WHERE, y sí las de A', async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.base.empresaId);
      const idsA = await idsDe(tabla, A.base.empresaId);
      await comoApi(A.base.empresaId, async () => {
        const todas = await apiCliente.query<{ id: string; empresa_id: string }>(
          `SELECT id, empresa_id FROM ${tabla}`,
        );
        expect(todas.rows.map((f) => f.id).sort()).toEqual(idsA);
        expect(todas.rows.every((f) => f.empresa_id === A.base.empresaId)).toBe(true);
        const porId = await apiCliente.query(`SELECT id FROM ${tabla} WHERE id = ANY($1::uuid[])`, [
          idsB,
        ]);
        expect(porId.rows).toEqual([]);
        const deB = await apiCliente.query(`SELECT id FROM ${tabla} WHERE empresa_id = $1`, [
          B.base.empresaId,
        ]);
        expect(deB.rows).toEqual([]);
      });
      await comoApi(B.base.empresaId, async () => {
        const propias = await apiCliente.query<{ id: string }>(`SELECT id FROM ${tabla}`);
        expect(propias.rows.map((f) => f.id).sort()).toEqual(idsB);
      });
    });

    it('actualización: el UPDATE por id y sin WHERE no toca filas de B, y cambiar el dueño a B falla', async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.base.empresaId);
      const idsA = await idsDe(tabla, A.base.empresaId);
      const antesB = await fotoDe(tabla, B.base.empresaId);
      await comoApi(A.base.empresaId, async () => {
        if (!puede('UPDATE')) {
          await exigirSinPermiso(apiCliente.query(`UPDATE ${tabla} SET empresa_id = empresa_id`));
          return;
        }
        const porId = await apiCliente.query(
          `UPDATE ${tabla} SET ${columnaDeUpdate} = ${columnaDeUpdate} WHERE id = ANY($1::uuid[]) RETURNING id`,
          [idsB],
        );
        expect(porId.rowCount).toBe(0);
        const sinWhere = await apiCliente.query<{ id: string }>(
          `UPDATE ${tabla} SET ${columnaDeUpdate} = ${columnaDeUpdate} RETURNING id`,
        );
        expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
        await apiCliente.query('SAVEPOINT dueno');
        const cambio = await errorDe(
          apiCliente.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [
            B.base.empresaId,
            idsA[0],
          ]),
        );
        expect(cambio.code, cambio.message).toBe('42501');
        if (tabla === 'comprobante') expect(cambio.message).toMatch(/permission denied/i);
        else expect(cambio.message).toMatch(/row-level security/);
        await apiCliente.query('ROLLBACK TO SAVEPOINT dueno');
      });
      expect(await fotoDe(tabla, B.base.empresaId)).toEqual(antesB);
    });

    it('borrado: la API no tiene DELETE en la tabla y el intento se rechaza por permisos, sin tocar a B', async () => {
      const { A, B } = await sembrado();
      const idsA = await idsDe(tabla, A.base.empresaId);
      const antesB = await fotoDe(tabla, B.base.empresaId);
      expect(
        puede('DELETE'),
        'la tabla "Permisos" de spec.md no da DELETE en ninguna tabla de 6a',
      ).toBe(false);
      const idsB = await idsDe(tabla, B.base.empresaId);
      await comoApi(A.base.empresaId, async () => {
        await apiCliente.query('SAVEPOINT sin_where');
        await exigirSinPermiso(apiCliente.query(`DELETE FROM ${tabla}`));
        await apiCliente.query('ROLLBACK TO SAVEPOINT sin_where');
        await exigirSinPermiso(
          apiCliente.query(`DELETE FROM ${tabla} WHERE id = ANY($1::uuid[])`, [idsB]),
        );
      });
      expect(await fotoDe(tabla, B.base.empresaId)).toEqual(antesB);
      expect(await idsDe(tabla, A.base.empresaId), 'A conserva sus filas').toEqual(idsA);
    });

    it('inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado) y no se crea', async () => {
      const { A, B } = await sembrado();
      const antesB = await fotoDe(tabla, B.base.empresaId);
      const idsAntes = await idsDe(tabla, B.base.empresaId);
      const copiar = `INSERT INTO ${tabla}
        SELECT (jsonb_populate_record(NULL::${tabla},
                 to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
          FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`;
      await comoApi(A.base.empresaId, async () => {
        const error = await errorDe(apiCliente.query(copiar, [B.base.empresaId, A.base.empresaId]));
        expect(error.code, error.message).toBe('42501');
        expect(error.message).toMatch(/row-level security/);
        expect(error.message).not.toMatch(/contexto de actor ausente/);
      });
      expect(await idsDe(tabla, B.base.empresaId)).toEqual(idsAntes);
      expect(await fotoDe(tabla, B.base.empresaId)).toEqual(antesB);
    });
  },
);
