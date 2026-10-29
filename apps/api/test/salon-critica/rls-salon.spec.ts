// spec: 004-salon-cocina (pruebas protegidas)
//
// P4 (parte 1) · Aislamiento entre empresas de las tablas nuevas de 3a, por SQL (ruta crítica), criterios 82 a 84:
// - 82: las once tablas existen (las pruebas de catálogo de 001 y 002 las recorren solas cuando existen);
// - 83: para `zona`, `mesa`, `orden`, `orden_mesa`, `envio`, `marcha`, `item`, `comanda`, `comanda_linea`,
//   `anulacion_item` y `precuenta`, con el contexto de A y un actor de A fijado, no se leen, actualizan ni
//   borran filas de B por id ni sin `WHERE`, y no se insertan filas con el `empresa_id` de B. El rechazo tiene
//   que ser el de la política RLS ("row-level security"), no el de "contexto de actor ausente", que también es
//   42501. Donde la tabla "Permisos" de `spec.md` no da un privilegio a `restaurante_api` (ninguna tiene
//   DELETE; `envio`, `marcha` y `anulacion_item` tampoco UPDATE), la sentencia se rechaza por permisos;
// - 84: con el contexto de A, insertar o actualizar una fila de A que apunte a una de B (mesa con zona de B, orden
//   con sucursal o mozo de B, orden_mesa con mesa de B, ítem con producto de B, comanda con estación de B, línea
//   con ítem de B, y cada llave foránea compuesta de las tablas) falla por la llave foránea compuesta, igual que
//   con un id inexistente: mismo código 23503 y misma restricción, y nunca un error de unicidad (que revelaría
//   que la fila de B existe). Cada caso tiene un control: la misma copia sin la referencia cruzada se inserta.
// Los nombres de tabla y de columna salen de "Cambios al modelo de datos" de `spec.md`. Las tablas todavía no
// existen: la primera prueba lista las que faltan y las demás fallan por eso. Las empresas se dan de alta por
// la API real (`POST /plataforma/empresas`), su carta se siembra por las rutas de 003 y las filas de 3a se
// siembran por SQL como `restaurante_api` con el contexto y el actor fijados.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { altaEmpresa, nuevoSuperadmin, type EmpresaDePrueba } from '../acceso/fabrica-plataforma';
import { sembrarCarta } from '../carta-critica/fabrica-permisos-carta';
import {
  PRIVILEGIOS_SALON,
  TABLAS_SALON,
  arrancarP4,
  sembrarFilasSalon,
  unico,
  type AppP4,
  type BaseSql,
  type FilasSalon,
  type Privilegio,
  type TablaSalon,
} from './fabrica-p4';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP4;
let admin: Client;
let apiCliente: Client;

beforeAll(async () => {
  ctx = await arrancarP4({ poolMax: 2 });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

// ------------------------------------------------------------------------------------------------
// Siembra de las dos empresas
// ------------------------------------------------------------------------------------------------
interface Sembrada {
  base: BaseSql;
  filas: FilasSalon;
}

async function sembrarEmpresa(empresa: EmpresaDePrueba): Promise<Sembrada> {
  const carta = await sembrarCarta(ctx, empresa.admin.token);
  const base: BaseSql = {
    empresaId: empresa.empresaId,
    sucursal1: empresa.sucursales[0]!.id,
    sucursal2: empresa.sucursales[1]!.id,
    usuarioId: empresa.admin.id,
    estacionId: carta.estacionId,
    productoId: carta.productoId,
  };
  return { base, filas: await sembrarFilasSalon(apiCliente, base) };
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

/** Transacción de `restaurante_api` con el actor `prueba` y el contexto de `empresaId`; siempre se revierte. */
const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

// ------------------------------------------------------------------------------------------------
// 82 · Las tablas existen
// ------------------------------------------------------------------------------------------------
describe('criterios 82 y 83 · las once tablas nuevas de 3a existen', () => {
  it('zona, mesa, orden, orden_mesa, envio, marcha, item, comanda, comanda_linea, anulacion_item y precuenta', async () => {
    const faltan: string[] = [];
    for (const tabla of TABLAS_SALON) {
      const r = await admin.query<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [
        `public.${tabla}`,
      ]);
      if (r.rows[0]!.t === null) faltan.push(tabla);
    }
    expect(faltan, `faltan estas tablas de 3a: ${faltan.join(', ')}`).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// 83 · Por tabla
// ------------------------------------------------------------------------------------------------
describe.each(TABLAS_SALON.map((tabla) => ({ tabla, api: PRIVILEGIOS_SALON[tabla] })))(
  'criterio 83 · $tabla',
  ({ tabla, api }) => {
    const puede = (privilegio: Privilegio) => api.includes(privilegio);

    /** Si la API no tiene el privilegio, la sentencia se rechaza por permisos (42501), no por RLS. */
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
      // Control: con el contexto de B se ven sus propias filas.
      await comoApi(B.base.empresaId, async () => {
        const propias = await apiCliente.query<{ id: string }>(`SELECT id FROM ${tabla}`);
        expect(propias.rows.map((f) => f.id).sort()).toEqual(idsB);
      });
    });

    it('actualización: el UPDATE por id y sin WHERE no toca filas de B, y cambiar el dueño a B falla por la política', async () => {
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
          `UPDATE ${tabla} SET empresa_id = empresa_id WHERE id = ANY($1::uuid[]) RETURNING id`,
          [idsB],
        );
        expect(porId.rowCount).toBe(0);
        const sinWhere = await apiCliente.query<{ id: string; empresa_id: string }>(
          `UPDATE ${tabla} SET empresa_id = empresa_id RETURNING id, empresa_id`,
        );
        expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
        expect(sinWhere.rows.every((f) => f.empresa_id === A.base.empresaId)).toBe(true);
        await apiCliente.query('SAVEPOINT dueno');
        const cambio = await errorDe(
          apiCliente.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [
            B.base.empresaId,
            idsA[0],
          ]),
        );
        expect(cambio.code, cambio.message).toBe('42501');
        expect(cambio.message).toMatch(/row-level security/);
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
        'la tabla "Permisos" de spec.md no da DELETE en ninguna tabla de 3a',
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
      // Copia de una fila de A con otro id y empresa_id = B (jsonb_populate_record sirve para cualquier tabla).
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

// ------------------------------------------------------------------------------------------------
// 84 · Referencias cruzadas en la base
// ------------------------------------------------------------------------------------------------
type Objetivo =
  | 'sucursal'
  | 'usuario'
  | 'estacion'
  | 'producto'
  | 'zona'
  | 'mesa'
  | 'orden'
  | 'envio'
  | 'item'
  | 'comanda';

interface Referencia {
  tabla: TablaSalon;
  columna: string;
  objetivo: Objetivo;
  /** Cambios que acompañan al de la columna para que la copia no choque con otra regla (un `CHECK`). */
  acompanan?: Record<string, unknown>;
  /** Cláusula `SET` extra del `UPDATE` (por ejemplo el estado `UNIDA` de una orden unida). */
  setExtra?: string;
}

/** Cada llave foránea compuesta de las tablas de 3a hacia otra tabla de empresa (y hacia `sucursal`). */
const REFERENCIAS: Referencia[] = [
  { tabla: 'zona', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'mesa', columna: 'zona_id', objetivo: 'zona' },
  { tabla: 'mesa', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'orden', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'orden', columna: 'mozo_id', objetivo: 'usuario' },
  {
    tabla: 'orden',
    columna: 'unida_a_orden_id',
    objetivo: 'orden',
    acompanan: { estado: 'UNIDA' },
    setExtra: `, estado = 'UNIDA'`,
  },
  { tabla: 'orden_mesa', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'orden_mesa', columna: 'mesa_id', objetivo: 'mesa' },
  { tabla: 'envio', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'item', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'item', columna: 'envio_id', objetivo: 'envio' },
  { tabla: 'item', columna: 'producto_id', objetivo: 'producto' },
  { tabla: 'comanda', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'comanda', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'comanda', columna: 'estacion_id', objetivo: 'estacion' },
  { tabla: 'comanda', columna: 'envio_id', objetivo: 'envio' },
  { tabla: 'comanda_linea', columna: 'comanda_id', objetivo: 'comanda' },
  { tabla: 'comanda_linea', columna: 'item_id', objetivo: 'item' },
  { tabla: 'marcha', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'anulacion_item', columna: 'item_id', objetivo: 'item' },
  { tabla: 'anulacion_item', columna: 'orden_id', objetivo: 'orden' },
  { tabla: 'precuenta', columna: 'orden_id', objetivo: 'orden' },
];

const deB = (b: Sembrada, objetivo: Objetivo): string =>
  ({
    sucursal: b.base.sucursal1,
    usuario: b.base.usuarioId,
    estacion: b.base.estacionId,
    producto: b.base.productoId,
    zona: b.filas.zona,
    mesa: b.filas.mesa,
    orden: b.filas.orden,
    envio: b.filas.envio,
    item: b.filas.item,
    comanda: b.filas.comanda,
  })[objetivo];

/**
 * Cambios que evitan que la copia choque con la fila de A de la que sale (un nombre o una celda únicos, la mesa
 * de la relación vigente). Nunca tocan la columna que se prueba ni los valores que compartiría con la fila de B:
 * si un índice único dejara ver la fila de B, el error sería 23505 y no 23503, y la prueba lo señala.
 */
function sinChocarConA(
  tabla: TablaSalon,
  columna: string,
  a: Sembrada,
  control: boolean,
): Record<string, unknown> {
  switch (tabla) {
    case 'zona':
      return { nombre: unico('Zona copia') };
    case 'mesa':
      return { nombre: unico('M copia'), columna: 3, fila: 2 };
    case 'orden_mesa':
      return control || columna === 'orden_id' ? { mesa_id: a.filas.mesaLibre } : {};
    // En el control la copia comparte la orden con la fila de A: otro número, y sin ser la vigente.
    case 'envio':
      return control ? { numero: 2 } : {};
    case 'precuenta':
      return control ? { numero: 2, invalidada_en: new Date().toISOString() } : {};
    default:
      return {};
  }
}

describe.each(REFERENCIAS)(
  'criterio 84 · $tabla · $columna apunta a otra empresa',
  ({ tabla, columna, objetivo, acompanan, setExtra }) => {
    /** Copia una fila de A cambiando `columna` (y el id) y la inserta con el contexto de A. */
    const insertarCopia = (a: Sembrada, valor: string | null) => {
      const cambios: Record<string, unknown> = {
        id: randomUUID(),
        ...sinChocarConA(tabla, columna, a, valor === null),
        ...(valor === null ? {} : { [columna]: valor, ...acompanan }),
      };
      return apiCliente.query(
        `INSERT INTO ${tabla}
           SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
             FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`,
        [JSON.stringify(cambios), a.base.empresaId],
      );
    };

    it('control: la copia de la fila de A con otro id y sin la referencia cruzada se inserta', async () => {
      const { A } = await sembrado();
      const resultado = await comoApi(A.base.empresaId, () => insertarCopia(A, null));
      expect(resultado.rowCount).toBe(1);
    });

    it('insertar una fila de A que apunta a una de B falla por la llave foránea, igual que con un id inexistente', async () => {
      const { A, B } = await sembrado();
      const cruzada = await comoApi(A.base.empresaId, () =>
        errorDe(insertarCopia(A, deB(B, objetivo))),
      );
      const inexistente = await comoApi(A.base.empresaId, () =>
        errorDe(insertarCopia(A, randomUUID())),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint, 'llave foránea nombrada').toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
    });

    if (PRIVILEGIOS_SALON[tabla].includes('UPDATE')) {
      it('actualizar una fila de A para que apunte a una de B falla por la llave foránea y no cambia la fila', async () => {
        const { A, B } = await sembrado();
        const antes = await fotoDe(tabla, A.base.empresaId);
        const actualizar = (valor: string) =>
          apiCliente.query(
            `UPDATE ${tabla} SET ${columna} = $1${setExtra ?? ''} WHERE empresa_id = $2`,
            [valor, A.base.empresaId],
          );
        const cruzada = await comoApi(A.base.empresaId, () =>
          errorDe(actualizar(deB(B, objetivo))),
        );
        const inexistente = await comoApi(A.base.empresaId, () =>
          errorDe(actualizar(randomUUID())),
        );
        expect(cruzada.code, cruzada.message).toBe('23503');
        expect(inexistente.code, inexistente.message).toBe('23503');
        expect(cruzada.constraint).toBe(inexistente.constraint);
        expect(await fotoDe(tabla, A.base.empresaId)).toEqual(antes);
      });
    } else {
      it('la API no tiene UPDATE en la tabla: el intento de apuntar a otra empresa se rechaza por permisos', async () => {
        const { A, B } = await sembrado();
        const antes = await fotoDe(tabla, A.base.empresaId);
        const error = await comoApi(A.base.empresaId, () =>
          errorDe(
            apiCliente.query(`UPDATE ${tabla} SET ${columna} = $1 WHERE empresa_id = $2`, [
              deB(B, objetivo),
              A.base.empresaId,
            ]),
          ),
        );
        expect(error.code, error.message).toBe('42501');
        expect(error.message).toMatch(/permission denied/i);
        expect(await fotoDe(tabla, A.base.empresaId)).toEqual(antes);
      });
    }
  },
);
