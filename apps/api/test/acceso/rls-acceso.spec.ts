// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P9 (parte 2) · Criterio 91 (prueba de aislamiento por cada tabla nueva con `empresa_id`, ruta crítica):
// `usuario`, `acceso_sucursal`, `equipo`, `equipo_recordado`, `sesion`, `autorizacion`, `bloqueo_intentos`,
// `sucursal_acceso`, `suscripcion`, `pago_suscripcion`, `consumo_comprobantes`, `idempotencia` y `auditoria`.
// Con el contexto de A (y un actor fijado) no se leen, actualizan ni borran filas de B por id ni sin
// `WHERE`, y no se insertan filas con el `empresa_id` de B. Las empresas A y B se siembran por la API real
// (alta por plataforma, usuarios, ingresos, equipos, autorizaciones, pagos, consumo) para que cada tabla tenga
// filas de las dos. Donde el criterio "Permisos" no da un privilegio a `restaurante_api`, la prueba comprueba
// que la sentencia se rechaza por permisos. Cuando la API sí tiene el privilegio, el rechazo tiene que ser
// el de la política RLS ("row-level security"), no el de "contexto de actor ausente", que también es 42501.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SuscripcionService } from '../../src/modulos/plataforma';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente } from '../utilidades';
import { enTransaccion, errorDe, rucAleatorio } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  bearer,
  contrasenaUnica,
  crearUsuario,
  crearUsuarioConSesion,
  elegirSucursal,
  exigirEstado,
  ingresar,
  nuevoSuperadmin,
  recordarEquipo,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from './fabrica-plataforma';

/** Lunes 11 de marzo de 2030, 10:00 en Lima. */
const INICIO = '2030-03-11T10:00:00-05:00';

type Priv = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
type Grupo = 'C0' | 'C1' | 'C2' | 'C3';

/** Las 13 tablas del criterio 91 con los privilegios de `restaurante_api` de la tabla "Permisos". */
const TABLAS: { tabla: string; grupo: Grupo; api: Priv[] }[] = [
  { tabla: 'usuario', grupo: 'C0', api: ['SELECT', 'INSERT', 'UPDATE'] },
  { tabla: 'acceso_sucursal', grupo: 'C0', api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  { tabla: 'sesion', grupo: 'C0', api: ['SELECT', 'INSERT', 'UPDATE'] },
  { tabla: 'bloqueo_intentos', grupo: 'C0', api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  { tabla: 'idempotencia', grupo: 'C0', api: ['SELECT', 'INSERT', 'DELETE'] },
  { tabla: 'auditoria', grupo: 'C0', api: ['SELECT', 'INSERT'] },
  { tabla: 'suscripcion', grupo: 'C1', api: ['SELECT', 'INSERT'] },
  { tabla: 'pago_suscripcion', grupo: 'C1', api: [] },
  { tabla: 'consumo_comprobantes', grupo: 'C1', api: ['SELECT', 'INSERT', 'UPDATE'] },
  { tabla: 'equipo', grupo: 'C2', api: ['SELECT', 'INSERT', 'UPDATE'] },
  { tabla: 'equipo_recordado', grupo: 'C2', api: ['SELECT', 'INSERT', 'UPDATE'] },
  { tabla: 'sucursal_acceso', grupo: 'C2', api: ['SELECT', 'INSERT', 'UPDATE'] },
  { tabla: 'autorizacion', grupo: 'C3', api: ['SELECT', 'INSERT', 'UPDATE'] },
];

let ctx: AppDePrueba;
let admin: Client;
let apiCliente: Client;
let sembradoPendiente: Promise<{ A: EmpresaDePrueba; B: EmpresaDePrueba }> | undefined;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

/**
 * Deja filas en todas las tablas del criterio 91 con la API real: usuarios (un Supervisor y un Cajero),
 * ingreso, equipo recordado, una autorización, un ingreso fallido (bloqueo), el acceso de la sucursal, una
 * escritura idempotente, un pago y un comprobante emitido (consumo).
 */
async function sembrarEmpresa(sa: SuperadminDePrueba): Promise<EmpresaDePrueba> {
  const empresa = await altaEmpresa(ctx, sa);
  const sucursalId = empresa.sucursales[0]!.id;
  const supervisor = await crearUsuario(ctx, empresa.admin.token, {
    accesos: [{ sucursalId, rol: 'SUPERVISOR' }],
  });
  const cajero = await crearUsuarioConSesion(ctx, empresa.admin.token, {
    accesos: [{ sucursalId, rol: 'CAJERO' }],
  });
  await elegirSucursal(ctx, cajero.token, sucursalId);
  await recordarEquipo(ctx, cajero.token);
  const autorizacion = await ctx
    .http()
    .post('/autorizaciones')
    .set(bearer(cajero.token))
    .send({ accion: 'ANULAR_ITEM_ENVIADO', motivo: 'Prueba de aislamiento', pin: supervisor.pin });
  exigirEstado(autorizacion, 201, 'autorización');
  const fallido = await ingresar(ctx, cajero.usuario, contrasenaUnica());
  expect(fallido.status).toBe(401);
  const acceso = await ctx
    .http()
    .patch(`/sucursales/${sucursalId}/acceso`)
    .set(bearer(empresa.admin.token))
    .send({ minutosInactividad: 7 });
  exigirEstado(acceso, 200, 'acceso de la sucursal');
  const idempotente = await ctx
    .http()
    .post('/emisores')
    .set(bearer(empresa.admin.token))
    .set('Idempotency-Key', randomUUID())
    .send({ ruc: rucAleatorio(), razonSocial: 'Emisor idempotente SAC', regimen: 'GENERAL' });
  exigirEstado(idempotente, 201, 'escritura idempotente');
  const pago = await ctx
    .http()
    .post(`/plataforma/suscripciones/${empresa.suscripciones[sucursalId]!.id}/pagos`)
    .set(bearer(sa.token))
    .set('Idempotency-Key', randomUUID())
    .send({
      monto: '50.00',
      fechaPago: '2030-03-11',
      medio: 'TRANSFERENCIA',
      vencimientoNuevo: '2031-03-11',
      motivo: 'Pago de prueba de aislamiento',
    });
  exigirEstado(pago, 201, 'pago');
  await ctx.app
    .get(ContextoEmpresa)
    .ejecutar(
      empresa.empresaId,
      () =>
        ctx.app.get(SuscripcionService).registrarComprobanteEmitido(sucursalId, ctx.reloj.ahora()),
      { actor: { sistema: 'prueba' } },
    );
  return empresa;
}

function sembrado() {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    const A = await sembrarEmpresa(sa);
    const B = await sembrarEmpresa(sa);
    return { A, B };
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

/** Transacción de `restaurante_api` con el actor de sistema `prueba` y el contexto de `empresaId`; siempre se revierte. */
const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

const TIEMPO = 180_000;

describe.each(TABLAS)('criterio 91 · $tabla [$grupo]', ({ tabla, api }) => {
  const puede = (privilegio: Priv) => api.includes(privilegio);

  /** Si la API no tiene el privilegio, la sentencia se rechaza por permisos (42501), no por RLS. */
  async function exigirSinPermiso(sentencia: Promise<unknown>): Promise<void> {
    const error = await errorDe(sentencia);
    expect(error.code, error.message).toBe('42501');
    expect(error.message).toMatch(/permission denied/i);
  }

  it(
    'la siembra dejó filas de A y de B en la tabla (la prueba no es vacía)',
    async () => {
      const { A, B } = await sembrado();
      expect((await idsDe(tabla, A.empresaId)).length, `filas de A en ${tabla}`).toBeGreaterThan(0);
      expect((await idsDe(tabla, B.empresaId)).length, `filas de B en ${tabla}`).toBeGreaterThan(0);
    },
    TIEMPO,
  );

  it(
    'lectura: con el contexto de A no se leen filas de B por id ni sin WHERE, y sí las de A',
    async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.empresaId);
      const idsA = await idsDe(tabla, A.empresaId);
      await comoApi(A.empresaId, async () => {
        if (!puede('SELECT')) {
          await exigirSinPermiso(apiCliente.query(`SELECT id FROM ${tabla}`));
          return;
        }
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
      if (puede('SELECT')) {
        // Control: con el contexto de B se ven sus propias filas.
        await comoApi(B.empresaId, async () => {
          const propias = await apiCliente.query<{ id: string }>(`SELECT id FROM ${tabla}`);
          expect(propias.rows.map((f) => f.id).sort()).toEqual(idsB);
        });
      }
    },
    TIEMPO,
  );

  it(
    'actualización: el UPDATE por id y sin WHERE no toca filas de B, y cambiar el dueño a B falla por la política',
    async () => {
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
    },
    TIEMPO,
  );

  it(
    'borrado: el DELETE por id y sin WHERE solo alcanza filas de A',
    async () => {
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
    },
    TIEMPO,
  );

  it(
    'inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado) y no se crea',
    async () => {
      const { A, B } = await sembrado();
      const antesB = await fotoDe(tabla, B.empresaId);
      const idsAntes = await idsDe(tabla, B.empresaId);
      // Copia de una fila de A con otro id y empresa_id = B (jsonb_populate_record sirve para cualquier tabla).
      const copiar = `INSERT INTO ${tabla}
        SELECT (jsonb_populate_record(NULL::${tabla},
                 to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
          FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`;
      await comoApi(A.empresaId, async () => {
        if (!puede('INSERT')) {
          await exigirSinPermiso(apiCliente.query(copiar, [B.empresaId, A.empresaId]));
          return;
        }
        const error = await errorDe(apiCliente.query(copiar, [B.empresaId, A.empresaId]));
        expect(error.code, error.message).toBe('42501');
        expect(error.message).toMatch(/row-level security/);
        expect(error.message).not.toMatch(/contexto de actor ausente/);
      });
      expect(await idsDe(tabla, B.empresaId)).toEqual(idsAntes);
      expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
    },
    TIEMPO,
  );
});
