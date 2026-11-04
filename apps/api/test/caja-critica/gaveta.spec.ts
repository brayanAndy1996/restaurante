// spec: 006-caja-cobro (pruebas protegidas)
//
// P2 · Gaveta de dinero (ruta crítica), criterios 92 a 94, con el simulador del puente y el emulador de impresora de 3b:
// - 92: un cobro con un pago en efectivo abre la gaveta de la impresora de su caja si tiene `gaveta: true`: el pulso va
//   antes del texto del ticket; sin efectivo, sin pulso;
// - 93: abrir un turno con fondo mayor que 0.00 y registrar un ingreso o un egreso encolan un trabajo `GAVETA` (solo el
//   pulso, sin papel ni corte);
// - 94: el pulso sale solo en la primera entrega y solo si se entrega a menos de 120 segundos de creado: una
//   reimpresión, una réplica del cobro o un trabajo entregado tarde no abren la gaveta.
// La sucursal S3 de A tiene una impresora de caja con gaveta (el emulador) y el puente vinculado (el simulador).
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  Cierres,
  cobrar,
  cobrarCrudo,
  crearEscenario,
  cuentaCon,
  cuerpoDeCobro,
  efectivo,
  escribir,
  esperarHasta,
  exigirEstado,
  impresoraDeCaja,
  pulsosRecibidos,
  sesionContrasena,
  tarjeta,
  trabajosDe,
  versionDe,
  vincularPuente,
  yape,
  type AppP5,
  type Escenario,
  type ImpresoraDePrueba,
} from './fabrica-caja';
import type { SimuladorPuente } from '../soporte/puente';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const cierres = new Cierres();
const A = () => esc.A;
let impresora: ImpresoraDePrueba;
let puente: SimuladorPuente;
let tokenCajero: string;
let caja1: string;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
});

// La configuración de las cajas, la impresora y el puente se arma antes de cada prueba (una sola vez): si falla, falla
// cada prueba con el mismo motivo en lugar de quedar omitidas.
let preparado: Promise<void> | undefined;
beforeEach(async () => {
  preparado ??= (async () => {
    caja1 = (await A().cajas()).S3!.caja1;
    impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S3, 'Caja de S3', {
      cajaId: caja1,
    });
    puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S3);
    await puente.iniciar();
    tokenCajero = A().token.cajeroS3!;
  })();
  await preparado;
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});

const emulador = () => impresora.emulador;
let turnoAbierto: Promise<string> | undefined;
const turno = () =>
  (turnoAbierto ??= (async () => {
    const id = await abrirTurno(ctx, tokenCajero, caja1, '100.00');
    return id;
  })());

/** Espera a que el emulador reciba `n` pulsos en total desde el último `limpiar`. */
const esperarPulsos = (n: number) =>
  esperarHasta(() => pulsosRecibidos(emulador()) >= n, 5_000, `${n} pulso(s) de la gaveta`);

async function cuentaDeS3(lineas: Array<['lomo' | 'gaseosa', number]>) {
  return cuentaCon(ctx, A(), 'S3', lineas);
}

describe('criterio 93 · gaveta en la apertura y en los movimientos', () => {
  it('abrir el turno con fondo mayor que 0.00 encola un trabajo GAVETA y abre la gaveta, sin papel ni corte', async () => {
    emulador().limpiar();
    const antes = (await trabajosDe(A().S3, 'GAVETA')).length;
    const turnoId = await turno();
    const trabajos = await trabajosDe(A().S3, 'GAVETA');
    expect(trabajos).toHaveLength(antes + 1);
    expect(trabajos.at(-1)).toMatchObject({ turno_id: turnoId, impresora_id: impresora.id });
    await esperarPulsos(1);
    const solos = [...emulador().tickets, ...emulador().parciales].filter(
      (t) => t.pulsosGaveta > 0,
    );
    expect(solos).toHaveLength(1);
    expect(solos[0]!.lineas).toEqual([]);
    expect(solos[0]!.corte).toBeNull();
  });

  it('un fondo de 0.00 no encola trabajo GAVETA', async () => {
    const otro = await abrirTurno(
      ctx,
      A().token.supervisorS3!,
      (await A().cajas()).S3!.caja2,
      '0.00',
    );
    expect(otro).toBeTruthy();
    const delTurno = (await trabajosDe(A().S3, 'GAVETA')).filter((t) => t.turno_id === otro);
    expect(delTurno).toEqual([]);
  });

  it('un ingreso y un egreso encolan un trabajo GAVETA cada uno', async () => {
    const turnoId = await turno();
    emulador().limpiar();
    const antes = (await trabajosDe(A().S3, 'GAVETA')).length;
    for (const tipo of ['INGRESO', 'EGRESO'] as const) {
      const res = await escribir(ctx, tokenCajero, 'post', `/turnos/${turnoId}/movimientos`, {
        id: randomUUID(),
        tipo,
        monto: '20.00',
        motivo: 'Cambio de billetes',
      });
      exigirEstado(res, 201, `Movimiento ${tipo} (006, criterio 28)`);
    }
    expect(await trabajosDe(A().S3, 'GAVETA')).toHaveLength(antes + 2);
    await esperarPulsos(2);
  });
});

describe('criterio 92 · gaveta al cobrar en efectivo', () => {
  it('un cobro con efectivo abre la gaveta una vez y el pulso va antes del texto del ticket', async () => {
    const turnoId = await turno();
    const cuenta = await cuentaDeS3([['lomo', 1]]);
    emulador().limpiar();
    await cobrar(ctx, tokenCajero, cuenta, {
      turnoId,
      total: '28.00',
      pagos: [efectivo('28.00', '50.00')],
    });
    const ticket = await emulador().esperarTicket(5_000);
    expect(ticket.pulsosGaveta).toBe(1);
    const lineas = ticket.marcado.split('\n');
    const pulso = lineas.findIndex((l) => l.includes('[GAVETA]'));
    const primerTexto = ticket.lineas[0]!.texto.trim();
    expect(pulso).toBeGreaterThanOrEqual(0);
    const textoAntes = lineas.slice(0, pulso).join('\n');
    expect(primerTexto.length).toBeGreaterThan(0);
    expect(textoAntes).not.toContain(primerTexto);
  });

  it('un cobro mixto con una parte en efectivo también la abre; uno sin efectivo no', async () => {
    const turnoId = await turno();
    const mixta = await cuentaDeS3([
      ['lomo', 1],
      ['gaseosa', 1],
    ]);
    emulador().limpiar();
    await cobrar(ctx, tokenCajero, mixta, {
      turnoId,
      total: '37.00',
      pagos: [yape('20.00'), efectivo('17.00')],
    });
    expect((await emulador().esperarTicket(5_000)).pulsosGaveta).toBe(1);

    const sinEfectivo = await cuentaDeS3([['lomo', 1]]);
    await cobrar(ctx, tokenCajero, sinEfectivo, {
      turnoId,
      total: '28.00',
      pagos: [tarjeta('28.00')],
    });
    const ticket = await emulador().esperarTicket(5_000);
    expect(ticket.pulsosGaveta).toBe(0);
    expect(ticket.marcado).not.toContain('[GAVETA]');
  });

  it('una cuenta toda en cortesía (sin pagos) no abre la gaveta', async () => {
    const turnoId = await turno();
    const cuenta = await cuentaDeS3([['gaseosa', 1]]);
    const cortesia = await escribir(
      ctx,
      A().token.supervisorS3!,
      'post',
      `/cuentas/${cuenta.ordenId}/cortesias`,
      {
        id: randomUUID(),
        itemId: cuenta.item.gaseosa,
        cantidad: 1,
        motivo: 'Atención de la casa',
      },
    );
    exigirEstado(cortesia, 201, 'Cortesía (006, criterio 43)');
    emulador().limpiar();
    await cobrar(ctx, tokenCajero, cuenta, { turnoId, total: '0.00', pagos: [] });
    expect((await emulador().esperarTicket(5_000)).pulsosGaveta).toBe(0);
  });
});

describe('criterio 94 · el pulso no se repite', () => {
  it('una reimpresión del comprobante y una réplica del cobro no abren la gaveta', async () => {
    const turnoId = await turno();
    const cuenta = await cuentaDeS3([['lomo', 1]]);
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '28.00',
    });
    const clave = randomUUID();
    emulador().limpiar();
    const primera = await cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, cuerpo, clave);
    exigirEstado(primera, 201, 'Cobrar');
    expect((await emulador().esperarTicket(5_000)).pulsosGaveta).toBe(1);

    const replica = await cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, cuerpo, clave);
    expect(replica.status).toBe(201);
    await emulador().noRecibe(500);

    const reimpresion = await escribir(
      ctx,
      tokenCajero,
      'post',
      `/comprobantes/${primera.body.comprobante.id}/impresiones`,
    );
    exigirEstado(reimpresion, 201, 'Reimprimir el comprobante (006, criterio 90)');
    const ticket = await emulador().esperarTicket(5_000);
    expect(ticket.pulsosGaveta).toBe(0);
    expect(ticket.texto).toContain('REIMPRESIÓN');
  });

  it('un trabajo entregado a los 121 segundos (el puente estuvo desconectado) sale sin pulso', async () => {
    const turnoId = await turno();
    const cuenta = await cuentaDeS3([['lomo', 1]]);
    await puente.detener();
    emulador().limpiar();
    await cobrar(ctx, tokenCajero, cuenta, { turnoId, total: '28.00', pagos: [efectivo('28.00')] });
    ctx.reloj.avanzar(121_000);
    await puente.iniciar();
    await puente.pedirTrabajosAhora();
    const ticket = await emulador().esperarTicket(5_000);
    expect(ticket.pulsosGaveta).toBe(0);
    expect(ticket.marcado).not.toContain('[GAVETA]');
    void sesionContrasena;
    void api;
  });

  it('entregado a tiempo (a los 119 segundos) sí lleva el pulso', async () => {
    const turnoId = await turno();
    const cuenta = await cuentaDeS3([['lomo', 1]]);
    await puente.detener();
    emulador().limpiar();
    await cobrar(ctx, tokenCajero, cuenta, { turnoId, total: '28.00', pagos: [efectivo('28.00')] });
    ctx.reloj.avanzar(119_000);
    await puente.iniciar();
    await puente.pedirTrabajosAhora();
    const ticket = await emulador().esperarTicket(5_000);
    expect(ticket.pulsosGaveta).toBe(1);
  });
});
