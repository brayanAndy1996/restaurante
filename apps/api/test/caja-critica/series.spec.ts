// spec: 006-caja-cobro (pruebas protegidas)
//
// P4 · Series de comprobantes (ruta crítica), criterios 4 y 5:
// - 4: una serie pertenece al emisor de la sucursal de la caja al crearla y no puede existir dos veces para un emisor
//   (ninguna caja ni sucursal, activa o inactiva): 409 CONFLICTO con `campos` de `serie`; otra empresa (otro RUC) y otro
//   emisor de la misma empresa sí pueden usar `B001`; dos `PUT` simultáneos con la misma serie en dos cajas del mismo
//   emisor: uno 200 y el otro 409;
// - 5: una serie usada no cambia: reactivar una serie inactiva la deja en su `ultimoNumero`; si la sucursal cambia de
//   emisor, las series del emisor anterior ya no emiten (409 SIN_SERIE) hasta configurar series del emisor nuevo.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { cajaRespuestaSchema } from '@restaurante/contratos';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cobrar,
  cobrarCrudo,
  crearCaja,
  crearEscenario,
  cuentaC,
  cuerpoDeCobro,
  esperarError,
  exigirEstado,
  filas,
  ponerSerie,
  versionDe,
  type AppP5,
  type Escenario,
  type Res,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;
const admin = () => A().token.admin!;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 8 });
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

/** El conflicto de unicidad: 409 CONFLICTO con `campos` que nombra la serie. */
function esperarConflictoDeSerie(res: Res): void {
  esperarError(res, 409, 'CONFLICTO');
  expect((res.body.campos as Array<{ campo: string }>).map((c) => c.campo)).toContain('serie');
}

describe('criterio 4 · series únicas por emisor', () => {
  it('la misma serie no se repite en otra caja ni en otra sucursal del mismo emisor (B001 ya es de S1)', async () => {
    const cajas = await A().cajas();
    // Otra caja de la misma sucursal.
    esperarConflictoDeSerie(
      await ponerSerie(ctx, admin(), A().S1, cajas.S1!.caja3, 'BOLETA', 'B001'),
    );
    // Otra sucursal (S3) del mismo emisor E1.
    esperarConflictoDeSerie(
      await ponerSerie(ctx, admin(), A().S3, cajas.S3!.caja3, 'BOLETA', 'B001'),
    );
    esperarConflictoDeSerie(
      await ponerSerie(ctx, admin(), A().S3, cajas.S3!.caja3, 'FACTURA', 'F001'),
    );
    // La caja 3 de S3 conserva su serie.
    const lista = await api(ctx, admin(), 'get', `/sucursales/${A().S3}/cajas`);
    exigirEstado(lista, 200, 'GET /sucursales/:id/cajas');
    const c3 = (
      lista.body as Array<{ id: string; series: Array<{ serie: string; activa: boolean }> }>
    ).find((c) => c.id === cajas.S3!.caja3)!;
    expect(c3.series.filter((s) => s.activa).map((s) => s.serie)).toEqual(['B303']);
  });

  it('otra empresa (otro RUC) y otro emisor de la misma empresa sí pueden usar B001', async () => {
    const cajasA = await A().cajas();
    const cajasB = await esc.B.cajas();
    const lista = await api(ctx, esc.B.token.admin, 'get', `/sucursales/${esc.B.S1}/cajas`);
    exigirEstado(lista, 200, 'GET /sucursales/:id/cajas de B');
    expect(JSON.stringify(lista.body)).toContain('B001');
    expect(cajasB.S1).toBeTruthy();
    // E2 (Nuevo RUS, S2) usa B001 y F001 igual que E1 (S1).
    const s2 = await api(ctx, admin(), 'get', `/sucursales/${A().S2}/cajas`);
    expect(JSON.stringify(s2.body)).toContain('B001');
    expect(cajasA.S2).toBeTruthy();
  });

  it('una serie inactiva sigue reservada: no la puede tomar otra caja del emisor', async () => {
    const cajas = await A().cajas();
    // S1/Caja 2 deja B002 (queda inactiva) y toma B902; después S3/Caja 2 no puede tomar B002.
    exigirEstado(
      await ponerSerie(ctx, admin(), A().S1, cajas.S1!.caja2, 'BOLETA', 'B902'),
      200,
      'Cambiar la serie de boletas',
    );
    esperarConflictoDeSerie(
      await ponerSerie(ctx, admin(), A().S3, cajas.S3!.caja2, 'BOLETA', 'B002'),
    );
  });

  it('dos PUT simultáneos con la misma serie en dos cajas del mismo emisor: uno 200 y el otro 409', async () => {
    const cajas = await A().cajas();
    const [a, b] = await Promise.all([
      ponerSerie(ctx, admin(), A().S1, cajas.S1!.caja3, 'BOLETA', 'B777'),
      ponerSerie(ctx, admin(), A().S3, cajas.S3!.caja3, 'BOLETA', 'B777'),
    ]);
    expect([a.status, b.status].sort(), `${a.text} | ${b.text}`).toEqual([200, 409]);
    esperarConflictoDeSerie(a.status === 409 ? a : b);
    const usos = await filas(
      `SELECT 1 FROM serie WHERE serie = 'B777' AND tipo = 'BOLETA' AND emisor_id = $1`,
      [A().emisor1],
    );
    expect(usos).toHaveLength(1);
  });

  it('la serie debe empezar con B para boletas y con F para facturas (400 con campos)', async () => {
    const cajas = await A().cajas();
    for (const [tipo, serie] of [
      ['BOLETA', 'F123'],
      ['FACTURA', 'B123'],
      ['BOLETA', 'b123'],
      ['BOLETA', 'B12'],
    ] as const) {
      const res = await ponerSerie(ctx, admin(), A().S1, cajas.S1!.caja3, tipo, serie);
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(res.body.campos).toBeDefined();
    }
  });
});

describe('criterio 5 · una serie usada no cambia', () => {
  it('el primer correlativo se fija al crear y reactivar una serie inactiva la deja en su último número', async () => {
    const cajas = await A().cajas();
    const nueva = (await crearCaja(ctx, admin(), A().S1, 'Caja de pruebas de serie')).id as string;
    exigirEstado(
      await ponerSerie(ctx, admin(), A().S1, nueva, 'BOLETA', 'B501', 500),
      200,
      'Serie con primer número',
    );
    // Se cambia a otra serie: B501 queda inactiva con su número; después se reactiva.
    const cambio = await ponerSerie(ctx, admin(), A().S1, nueva, 'BOLETA', 'B502');
    exigirEstado(cambio, 200, 'Cambiar la serie');
    const despues = cajaRespuestaSchema.parse(cambio.body);
    const vieja = despues.series.find((s) => s.serie === 'B501')!;
    expect(vieja).toMatchObject({ tipo: 'BOLETA', activa: false, ultimoNumero: 499 });
    expect(despues.series.find((s) => s.serie === 'B502')).toMatchObject({
      activa: true,
      ultimoNumero: 0,
    });
    const reactivar = await ponerSerie(ctx, admin(), A().S1, nueva, 'BOLETA', 'B501');
    exigirEstado(reactivar, 200, 'Reactivar la serie inactiva');
    const reactivada = cajaRespuestaSchema.parse(reactivar.body);
    expect(reactivada.series.find((s) => s.serie === 'B501')).toMatchObject({
      activa: true,
      ultimoNumero: 499,
    });
    expect(reactivada.series.find((s) => s.serie === 'B502')).toMatchObject({ activa: false });
    expect(cajas.S1).toBeTruthy();
  });

  it('si la sucursal cambia de emisor, las series del emisor anterior ya no emiten: 409 SIN_SERIE hasta configurar las nuevas', async () => {
    const cajas = await A().cajas();
    const t = A().token.supervisorS3!;
    const turnoId = await abrirTurno(ctx, t, cajas.S3!.caja1, '10.00');
    const cuenta = await cuentaC(ctx, A(), 'S3');
    // S3 pasa del emisor E1 al E2 (Nuevo RUS): las series B301/F301 eran de E1.
    exigirEstado(
      await api(ctx, admin(), 'patch', `/sucursales/${A().S3}`, { emisorId: A().emisor2 }),
      200,
      'Cambiar el emisor de la sucursal (002)',
    );
    const rechazado = await cobrarCrudo(
      ctx,
      t,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version: await versionDe(cuenta.ordenId), total: '69.20' }),
    );
    esperarError(rechazado, 409, 'SIN_SERIE');
    expect(await filas('SELECT 1 FROM comprobante WHERE orden_id = $1', [cuenta.ordenId])).toEqual(
      [],
    );
    // Con una serie del emisor nuevo se vuelve a emitir.
    exigirEstado(
      await ponerSerie(ctx, admin(), A().S3, cajas.S3!.caja1, 'BOLETA', 'B8E3'),
      200,
      'Serie del emisor nuevo',
    );
    const cobro = await cobrar(ctx, t, cuenta, { turnoId, total: '69.20' });
    expect(cobro.comprobante.numero).toBe('B8E3-00000001');
    expect(cobro.comprobante.emisor.regimen).toBe('NUEVO_RUS');
  });
});
