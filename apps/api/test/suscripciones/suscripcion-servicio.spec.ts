// Pruebas del desarrollador (no protegidas) de la tarea T26 · criterios 71, 78 y 79: `SuscripcionService`
// con contexto de empresa: estado calculado con el reloj, consumo de comprobantes por mes de Lima sin
// perder incrementos y sin bloquear nunca, y módulos del plan vigente.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SuscripcionService } from '../../src/modulos/plataforma';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente } from '../utilidades';
import { textoUnico } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  bearer,
  exigirEstado,
  nuevoSuperadmin,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';

/** Viernes 15 de marzo de 2030, 10:00 en Lima. */
const INICIO = '2030-03-15T10:00:00-05:00';

let ctx: AppDePrueba;
let admin: Client;
let sa: SuperadminDePrueba;
let A: EmpresaDePrueba;
let B: EmpresaDePrueba;

beforeAll(async () => {
  // Pool de 2: los incrementos concurrentes compiten por las mismas conexiones.
  ctx = await arrancar({ inicio: INICIO, poolMax: 2 });
  admin = await abrirCliente('admin');
  sa = await nuevoSuperadmin(ctx);
  A = await altaEmpresa(ctx, sa, { conSesion: false, sucursalesPorEmisor: 3 });
  B = await altaEmpresa(ctx, sa, { conSesion: false });
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const enContexto = <T>(empresa: EmpresaDePrueba, fn: (s: SuscripcionService) => Promise<T>) =>
  ctx.app
    .get(ContextoEmpresa)
    .ejecutar(empresa.empresaId, () => fn(ctx.app.get(SuscripcionService)), {
      actor: { sistema: 'prueba' },
    });

const cambiarSuscripcion = async (e: EmpresaDePrueba, sucursalId: string, cuerpo: object) =>
  exigirEstado(
    await ctx
      .http()
      .patch(`/plataforma/suscripciones/${e.suscripciones[sucursalId]!.id}`)
      .set(bearer(sa.token))
      .send({ motivo: textoUnico('motivo'), ...cuerpo }),
    200,
    'cambiar la suscripción',
  );

const crearPlan = async (extra: Record<string, unknown>) => {
  const res = await ctx
    .http()
    .post('/plataforma/planes')
    .set(bearer(sa.token))
    .send({
      codigo: `C-${randomUUID().slice(0, 8)}`,
      nombre: 'Plan del servicio',
      diasGracia: 7,
      modulos: ['SALON'],
      porDefecto: false,
      activo: true,
      motivo: 'Plan de prueba',
      ...extra,
    });
  exigirEstado(res, 201, 'crear plan');
  return res.body.id as string;
};

describe('registrarComprobanteEmitido (criterio 78)', () => {
  it('suma 1 por llamada en el mes de Lima de `instante` y devuelve periodo, emitidos, cuota y excedente', async () => {
    const sucursalId = A.sucursales[0]!.id;
    const uno = await enContexto(A, (s) =>
      s.registrarComprobanteEmitido(sucursalId, new Date('2030-03-15T10:00:00-05:00')),
    );
    expect(uno).toEqual({ periodo: '2030-03', emitidos: 1, cuota: null, excedente: 0 });
    const dos = await enContexto(A, (s) =>
      s.registrarComprobanteEmitido(sucursalId, new Date('2030-03-20T12:00:00-05:00')),
    );
    expect(dos).toMatchObject({ periodo: '2030-03', emitidos: 2 });
  });

  it('el mes es el de Lima: el último segundo de marzo en Lima ya es abril en UTC, y la medianoche de Lima abre abril', async () => {
    const sucursalId = A.sucursales[1]!.id;
    const fin = await enContexto(A, (s) =>
      s.registrarComprobanteEmitido(sucursalId, new Date('2030-04-01T04:59:59.999Z')),
    );
    expect(fin.periodo).toBe('2030-03');
    const inicio = await enContexto(A, (s) =>
      s.registrarComprobanteEmitido(sucursalId, new Date('2030-04-01T05:00:00Z')),
    );
    expect(inicio).toMatchObject({ periodo: '2030-04', emitidos: 1 });
    const { rows } = await admin.query(
      'SELECT periodo, emitidos FROM consumo_comprobantes WHERE sucursal_id = $1 ORDER BY periodo',
      [sucursalId],
    );
    expect(rows).toEqual([
      { periodo: '2030-03', emitidos: 1 },
      { periodo: '2030-04', emitidos: 1 },
    ]);
  });

  it('nunca lanza por superar la cuota: sigue contando y el excedente es max(0, emitidos − cuota)', async () => {
    const sucursalId = A.sucursales[2]!.id;
    await cambiarSuscripcion(A, sucursalId, {
      planId: await crearPlan({ cuotaComprobantesMes: 2 }),
    });
    const resultados = [];
    for (let i = 0; i < 5; i++) {
      resultados.push(
        await enContexto(A, (s) =>
          s.registrarComprobanteEmitido(sucursalId, new Date('2030-03-15T11:00:00-05:00')),
        ),
      );
    }
    expect(resultados.map((r) => [r.emitidos, r.cuota, r.excedente])).toEqual([
      [1, 2, 0],
      [2, 2, 0],
      [3, 2, 1],
      [4, 2, 2],
      [5, 2, 3],
    ]);
  });

  it('una cuota de 0 deja todo como excedente; con la cuota sin definir el excedente es 0 (criterio 79)', async () => {
    const sucursalId = B.sucursales[0]!.id;
    const plan = await crearPlan({ cuotaComprobantesMes: 0 });
    await cambiarSuscripcion(B, sucursalId, { planId: plan });
    const cero = await enContexto(B, (s) =>
      s.registrarComprobanteEmitido(sucursalId, new Date('2030-03-15T11:00:00-05:00')),
    );
    expect(cero).toEqual({ periodo: '2030-03', emitidos: 1, cuota: 0, excedente: 1 });
    // El plan cambia: la cuota que cuenta es la del plan que tiene la suscripción en este momento.
    exigirEstado(
      await ctx
        .http()
        .patch(`/plataforma/planes/${plan}`)
        .set(bearer(sa.token))
        .send({ cuotaComprobantesMes: null, motivo: 'Sin cuota' }),
      200,
      'quitar la cuota',
    );
    const sinCuota = await enContexto(B, (s) =>
      s.registrarComprobanteEmitido(sucursalId, new Date('2030-03-15T11:00:00-05:00')),
    );
    expect(sinCuota).toEqual({ periodo: '2030-03', emitidos: 2, cuota: null, excedente: 0 });
  });

  it('dos o más llamadas concurrentes no pierden incrementos (pool de 2)', async () => {
    const sucursalId = B.sucursales[0]!.id;
    const antes =
      (
        await admin.query<{ emitidos: number }>(
          `SELECT emitidos FROM consumo_comprobantes WHERE sucursal_id = $1 AND periodo = '2030-06'`,
          [sucursalId],
        )
      ).rows[0]?.emitidos ?? 0;
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () =>
        enContexto(B, (s) =>
          s.registrarComprobanteEmitido(sucursalId, new Date('2030-06-10T12:00:00-05:00')),
        ),
      ),
    );
    expect(resultados.map((r) => r.emitidos).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => antes + i + 1),
    );
    const { rows } = await admin.query(
      `SELECT emitidos FROM consumo_comprobantes WHERE sucursal_id = $1 AND periodo = '2030-06'`,
      [sucursalId],
    );
    expect(rows).toEqual([{ emitidos: antes + 20 }]);
  });

  it('la fila queda con el actor de la transacción y no se puede contar en la sucursal de otra empresa', async () => {
    const ajena = B.sucursales[1]!.id;
    await expect(
      enContexto(A, (s) =>
        s.registrarComprobanteEmitido(ajena, new Date('2030-03-15T10:00:00-05:00')),
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(
      (await admin.query('SELECT 1 FROM consumo_comprobantes WHERE sucursal_id = $1', [ajena]))
        .rows,
    ).toEqual([]);
    const { rows } = await admin.query(
      'SELECT creado_por_sistema, actualizado_por_sistema FROM consumo_comprobantes WHERE sucursal_id = $1 LIMIT 1',
      [A.sucursales[0]!.id],
    );
    expect(rows[0]).toEqual({ creado_por_sistema: 'prueba', actualizado_por_sistema: 'prueba' });
  });
});

describe('estadoDeSucursal (criterio 71)', () => {
  it('se calcula con el reloj de la API, día a día, con la fecha de Lima', async () => {
    const sucursalId = A.sucursales[0]!.id;
    await cambiarSuscripcion(A, sucursalId, { vencimiento: '2030-11-10' });
    const estadoEn = async (instante: string) => {
      ctx.reloj.fijar(instante);
      try {
        return await enContexto(A, (s) => s.estadoDeSucursal(sucursalId));
      } finally {
        ctx.reloj.fijar(INICIO);
      }
    };
    expect(await estadoEn('2030-11-10T23:59:00-05:00')).toMatchObject({
      sucursalId,
      vencimiento: '2030-11-10',
      estado: 'ACTIVA',
      suspensionDesde: '2030-11-18',
      diasRestantesGracia: null,
    });
    expect(await estadoEn('2030-11-11T00:00:00-05:00')).toMatchObject({
      estado: 'EN_GRACIA',
      diasRestantesGracia: 7,
    });
    expect(await estadoEn('2030-11-17T12:00:00-05:00')).toMatchObject({
      estado: 'EN_GRACIA',
      diasRestantesGracia: 1,
    });
    expect(await estadoEn('2030-11-18T00:00:00-05:00')).toMatchObject({ estado: 'SUSPENDIDA' });
  });

  it('usa los días de gracia del plan vigente y una sucursal ajena o sin suscripción responde 404', async () => {
    const sucursalId = A.sucursales[1]!.id;
    await cambiarSuscripcion(A, sucursalId, {
      planId: await crearPlan({ diasGracia: 0 }),
      vencimiento: '2030-03-14',
    });
    expect(await enContexto(A, (s) => s.estadoDeSucursal(sucursalId))).toMatchObject({
      estado: 'SUSPENDIDA',
      suspensionDesde: '2030-03-15',
    });
    await expect(
      enContexto(A, (s) => s.estadoDeSucursal(B.sucursales[0]!.id)),
    ).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    });
  });
});

describe('modulosDeSucursal (criterio 77)', () => {
  it('devuelve los módulos del plan vigente (en el orden del catálogo) y vacío sin suscripción', async () => {
    const sucursalId = B.sucursales[1]!.id;
    expect((await enContexto(B, (s) => s.modulosDeSucursal(sucursalId))).length).toBe(7);
    await cambiarSuscripcion(B, sucursalId, {
      planId: await crearPlan({ modulos: ['REPORTES', 'CAJA', 'SALON'] }),
    });
    expect(await enContexto(B, (s) => s.modulosDeSucursal(sucursalId))).toEqual([
      'SALON',
      'CAJA',
      'REPORTES',
    ]);
    // Una sucursal de otra empresa no se ve: sin suscripción para esta empresa.
    expect(await enContexto(A, (s) => s.modulosDeSucursal(sucursalId))).toEqual([]);
  });
});
