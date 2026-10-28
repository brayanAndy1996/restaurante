// spec: 003-carta (pruebas protegidas)
//
// P3 (parte 1) · Aislamiento entre empresas de las tablas nuevas de la carta (ruta crítica), criterios 65 y 66:
// - 65: para cada tabla nueva (`estacion`, `familia`, `producto`, `producto_sucursal`, `producto_agotado`,
//   `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo`, `menu_del_dia_opcion`), con el
//   contexto de A y un actor de A fijado, no se leen, actualizan ni borran filas de B por id ni sin `WHERE`, y
//   no se insertan filas con el `empresa_id` de B. El rechazo tiene que ser el de la política RLS ("row-level
//   security"), no el de "contexto de actor ausente", que también es 42501. Donde la tabla "Permisos" de
//   `spec.md` no da un privilegio a `restaurante_api`, la sentencia se rechaza por permisos;
// - 66: con el contexto de A, insertar o actualizar una fila de A que apunte a una fila de B (familia o estación
//   de un producto; componente, producto ligado, asignación de grupo, ajuste, agotado u opción del día con un
//   producto, grupo, modificador o sucursal de B) falla por la llave foránea compuesta, igual que con un id
//   inexistente.
// Los nombres de tabla y de columna salen de "Cambios al modelo de datos" de `spec.md`. Las tablas todavía no
// existen: la primera prueba lista las que faltan y las demás fallan por eso. Las empresas se dan de alta por
// la API real (`POST /plataforma/empresas`); las filas de la carta se siembran por SQL como `restaurante_api`
// con el contexto y el actor fijados.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  nuevoSuperadmin,
  type AppDePrueba,
  type EmpresaDePrueba,
} from '../acceso/fabrica-plataforma';
import { TABLAS_CARTA, type TablaCarta } from './fabrica-permisos-carta';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

type Priv = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/** Privilegios de `restaurante_api` (tabla "Permisos" de `spec.md`). */
const PRIVILEGIOS: Record<TablaCarta, Priv[]> = {
  estacion: ['SELECT', 'INSERT', 'UPDATE'],
  familia: ['SELECT', 'INSERT', 'UPDATE'],
  producto: ['SELECT', 'INSERT', 'UPDATE'],
  producto_sucursal: ['SELECT', 'INSERT', 'UPDATE'],
  grupo_modificadores: ['SELECT', 'INSERT', 'UPDATE'],
  modificador: ['SELECT', 'INSERT', 'UPDATE'],
  producto_grupo: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  componente_combo: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  menu_del_dia_opcion: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  producto_agotado: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
};

let ctx: AppDePrueba;
let admin: Client;
let apiCliente: Client;

beforeAll(async () => {
  ctx = await arrancar();
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

// ------------------------------------------------------------------------------------------------
// Siembra por SQL de las dos empresas
// ------------------------------------------------------------------------------------------------
interface Sembrada {
  empresaId: string;
  sucursal1: string;
  sucursal2: string;
  estacion: string;
  familia: string;
  producto: string;
  ligado: string;
  combo: string;
  menu: string;
  grupo: string;
  modificador: string;
}

const nombre = (prefijo: string) => `${prefijo} ${randomUUID().slice(0, 12)}`;
const DIA = '2026-11-02';

/** Siembra, con el contexto y el actor de la empresa, una fila como mínimo en cada tabla nueva. */
async function sembrarEmpresa(empresa: EmpresaDePrueba): Promise<Sembrada> {
  const s: Sembrada = {
    empresaId: empresa.empresaId,
    sucursal1: empresa.sucursales[0]!.id,
    sucursal2: empresa.sucursales[1]!.id,
    estacion: randomUUID(),
    familia: randomUUID(),
    producto: randomUUID(),
    ligado: randomUUID(),
    combo: randomUUID(),
    menu: randomUUID(),
    grupo: randomUUID(),
    modificador: randomUUID(),
  };
  const E = empresa.empresaId;
  const q = (sql: string, parametros: unknown[]) => apiCliente.query(sql, parametros);
  await enTransaccion(
    apiCliente,
    E,
    async () => {
      await q(
        `INSERT INTO estacion (id, empresa_id, nombre, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, true, now(), now())`,
        [s.estacion, E, nombre('Cocina')],
      );
      await q(
        `INSERT INTO familia (id, empresa_id, nombre, orden, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 1, true, now(), now())`,
        [s.familia, E, nombre('Fondos')],
      );
      const producto = (
        id: string,
        tipo: string,
        precio: string | null,
        estacion: string | null,
        control: string,
        orden: number,
      ) =>
        q(
          `INSERT INTO producto (id, empresa_id, familia_id, tipo, nombre, descripcion, precio,
                                 se_vende_solo, afectacion_igv, aplica_icbper, estacion_id,
                                 tipo_control_stock, foto_clave, orden, activo, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'GRAVADO', false, $8, $9, NULL, $10, true, now(), now())`,
          [id, E, s.familia, tipo, nombre(tipo), precio, precio !== null, estacion, control, orden],
        );
      await producto(s.producto, 'SIMPLE', '25.00', s.estacion, 'UNIDADES', 1);
      await producto(s.ligado, 'SIMPLE', null, s.estacion, 'PORCIONES', 2);
      await producto(s.combo, 'COMBO', '22.90', null, 'SIN_CONTROL', 3);
      await producto(s.menu, 'MENU_DEL_DIA', '12.00', null, 'PORCIONES', 4);
      await q(
        `INSERT INTO grupo_modificadores (id, empresa_id, nombre, seleccion, minimo, maximo, activo,
                                          creado_en, actualizado_en)
         VALUES ($1, $2, $3, 'UNICA', 1, 1, true, now(), now())`,
        [s.grupo, E, nombre('Bebida')],
      );
      await q(
        `INSERT INTO modificador (id, empresa_id, grupo_id, nombre, precio_extra, producto_id, orden,
                                  activo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, '0.00', $5, 1, true, now(), now())`,
        [s.modificador, E, s.grupo, nombre('Chicha'), s.ligado],
      );
      await q(
        `INSERT INTO producto_grupo (id, empresa_id, producto_id, grupo_id, orden, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, now(), now())`,
        [E, s.menu, s.grupo],
      );
      await q(
        `INSERT INTO componente_combo (id, empresa_id, combo_id, producto_id, cantidad, orden,
                                       creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, 1, now(), now())`,
        [E, s.combo, s.producto],
      );
      await q(
        `INSERT INTO producto_sucursal (id, empresa_id, producto_id, sucursal_id, precio, disponible,
                                        creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, '27.50', true, now(), now())`,
        [E, s.producto, s.sucursal1],
      );
      await q(
        `INSERT INTO producto_agotado (id, empresa_id, producto_id, sucursal_id, desde, dia_operativo,
                                       hasta, origen, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, now(), $4, 'FIN_DEL_DIA', 'MANUAL', now(), now())`,
        [E, s.producto, s.sucursal1, DIA],
      );
      await q(
        `INSERT INTO menu_del_dia_opcion (id, empresa_id, sucursal_id, producto_id, modificador_id,
                                          dia_operativo, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now())`,
        [E, s.sucursal1, s.menu, s.modificador, DIA],
      );
    },
    { confirmar: true },
  );
  return s;
}

let sembradoPendiente: Promise<{ A: Sembrada; B: Sembrada }> | undefined;
function sembrado() {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    const A = await altaEmpresa(ctx, sa, { conSesion: false });
    const B = await altaEmpresa(ctx, sa, { conSesion: false });
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
// Las tablas existen
// ------------------------------------------------------------------------------------------------
describe('criterios 64 y 65 · las diez tablas nuevas existen', () => {
  it('estacion, familia, producto, producto_sucursal, producto_agotado, grupo_modificadores, modificador, producto_grupo, componente_combo y menu_del_dia_opcion', async () => {
    const faltan: string[] = [];
    for (const tabla of TABLAS_CARTA) {
      const r = await admin.query<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [
        `public.${tabla}`,
      ]);
      if (r.rows[0]!.t === null) faltan.push(tabla);
    }
    expect(faltan, `faltan estas tablas de la carta: ${faltan.join(', ')}`).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// 65 · Por tabla
// ------------------------------------------------------------------------------------------------
describe.each(TABLAS_CARTA.map((tabla) => ({ tabla, api: PRIVILEGIOS[tabla] })))(
  'criterio 65 · $tabla',
  ({ tabla, api }) => {
    const puede = (privilegio: Priv) => api.includes(privilegio);

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

    it('borrado: el DELETE por id y sin WHERE solo alcanza filas de A (o se rechaza por permisos si la API no puede borrar)', async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.empresaId);
      const idsA = await idsDe(tabla, A.empresaId);
      const antesB = await fotoDe(tabla, B.empresaId);
      await comoApi(A.empresaId, async () => {
        if (!puede('DELETE')) {
          await exigirSinPermiso(apiCliente.query(`DELETE FROM ${tabla}`));
          return;
        }
        const porId = await apiCliente.query(
          `DELETE FROM ${tabla} WHERE id = ANY($1::uuid[]) RETURNING id`,
          [idsB],
        );
        expect(porId.rowCount).toBe(0);
        const sinWhere = await apiCliente.query<{ id: string; empresa_id: string }>(
          `DELETE FROM ${tabla} RETURNING id, empresa_id`,
        );
        expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
        expect(sinWhere.rows.every((f) => f.empresa_id === A.empresaId)).toBe(true);
      });
      expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
      expect(
        await idsDe(tabla, A.empresaId),
        'la transacción se revirtió: A conserva sus filas',
      ).toEqual(idsA);
    });

    it('inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado) y no se crea', async () => {
      const { A, B } = await sembrado();
      const antesB = await fotoDe(tabla, B.empresaId);
      const idsAntes = await idsDe(tabla, B.empresaId);
      // Copia de una fila de A con otro id y empresa_id = B (jsonb_populate_record sirve para cualquier tabla).
      const copiar = `INSERT INTO ${tabla}
        SELECT (jsonb_populate_record(NULL::${tabla},
                 to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
          FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`;
      await comoApi(A.empresaId, async () => {
        const error = await errorDe(apiCliente.query(copiar, [B.empresaId, A.empresaId]));
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
// 66 · Referencias cruzadas en la base
// ------------------------------------------------------------------------------------------------
type Objetivo =
  'familia' | 'estacion' | 'producto' | 'ligado' | 'grupo' | 'modificador' | 'sucursal';

/** Cada llave foránea entre tablas de empresa (y hacia `sucursal`) que el criterio 66 nombra. */
const REFERENCIAS: { tabla: TablaCarta; columna: string; objetivo: Objetivo }[] = [
  { tabla: 'producto', columna: 'familia_id', objetivo: 'familia' },
  { tabla: 'producto', columna: 'estacion_id', objetivo: 'estacion' },
  { tabla: 'componente_combo', columna: 'combo_id', objetivo: 'producto' },
  { tabla: 'componente_combo', columna: 'producto_id', objetivo: 'producto' },
  { tabla: 'modificador', columna: 'grupo_id', objetivo: 'grupo' },
  { tabla: 'modificador', columna: 'producto_id', objetivo: 'ligado' },
  { tabla: 'producto_grupo', columna: 'producto_id', objetivo: 'producto' },
  { tabla: 'producto_grupo', columna: 'grupo_id', objetivo: 'grupo' },
  { tabla: 'producto_sucursal', columna: 'producto_id', objetivo: 'producto' },
  { tabla: 'producto_sucursal', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'producto_agotado', columna: 'producto_id', objetivo: 'producto' },
  { tabla: 'producto_agotado', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'menu_del_dia_opcion', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'menu_del_dia_opcion', columna: 'producto_id', objetivo: 'producto' },
  { tabla: 'menu_del_dia_opcion', columna: 'modificador_id', objetivo: 'modificador' },
];

const deB = (b: Sembrada, objetivo: Objetivo): string =>
  ({
    familia: b.familia,
    estacion: b.estacion,
    producto: b.producto,
    ligado: b.ligado,
    grupo: b.grupo,
    modificador: b.modificador,
    sucursal: b.sucursal1,
  })[objetivo];

/** Las tablas con nombre único por empresa o por grupo: la copia lleva un nombre nuevo para no chocar. */
const CON_NOMBRE: TablaCarta[] = ['producto', 'modificador'];

/** Un combo o un menú no puede tener estación (`CHECK`): el `UPDATE` de la estación solo toca los simples. */
const SOLO_SIMPLES: TablaCarta[] = ['producto'];

describe.each(REFERENCIAS)(
  'criterio 66 · $tabla.$columna apunta a otra empresa',
  ({ tabla, columna, objetivo }) => {
    /** Copia una fila de A cambiando `columna` (y el id) y la inserta con el contexto de A. */
    const insertarCopia = (empresaId: string, valor: string) => {
      const cambios: Record<string, string> = { id: randomUUID(), [columna]: valor };
      if (CON_NOMBRE.includes(tabla)) cambios.nombre = nombre('Copia');
      return apiCliente.query(
        `INSERT INTO ${tabla}
           SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
             FROM ${tabla} x WHERE x.empresa_id = $2${SOLO_SIMPLES.includes(tabla) ? " AND x.tipo = 'SIMPLE'" : ''} LIMIT 1`,
        [JSON.stringify(cambios), empresaId],
      );
    };

    it('insertar una fila de A que apunta a una de B falla por la llave foránea, igual que con un id inexistente', async () => {
      const { A, B } = await sembrado();
      const cruzada = await comoApi(A.empresaId, () =>
        errorDe(insertarCopia(A.empresaId, deB(B, objetivo))),
      );
      const inexistente = await comoApi(A.empresaId, () =>
        errorDe(insertarCopia(A.empresaId, randomUUID())),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint, 'llave foránea nombrada').toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
    });

    it('actualizar una fila de A para que apunte a una de B falla por la llave foránea y no cambia la fila', async () => {
      const { A, B } = await sembrado();
      const antes = await fotoDe(tabla, A.empresaId);
      const actualizar = (valor: string) =>
        apiCliente.query(
          `UPDATE ${tabla} SET ${columna} = $1 WHERE empresa_id = $2${SOLO_SIMPLES.includes(tabla) ? " AND tipo = 'SIMPLE'" : ''}`,
          [valor, A.empresaId],
        );
      const cruzada = await comoApi(A.empresaId, () => errorDe(actualizar(deB(B, objetivo))));
      const inexistente = await comoApi(A.empresaId, () => errorDe(actualizar(randomUUID())));
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint).toBe(inexistente.constraint);
      expect(await fotoDe(tabla, A.empresaId)).toEqual(antes);
    });
  },
);
