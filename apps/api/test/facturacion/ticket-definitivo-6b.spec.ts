// spec: 006-caja-cobro (criterios 157 y 162; el ticket definitivo y la reimpresión de una nota, T43)
//
// Con la base real, el simulador del PSE y el emulador de impresora: el ticket del cobro lleva la leyenda de 6b y la marca de
// simulado (el emisor está en SIMULADO) sin el hash en el QR; el de una nota de crédito lleva el documento que modifica, el
// motivo y la devolución por medio; reimprimir una nota que se emitió sin impresora (no hay ticket guardado) arma el ticket
// con los egresos de la nota por el puerto de caja; la reemisión de una nota rechazada conserva su devolución. El puerto
// falla cerrado sin registro.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevolucionDeNotaParaTicket } from '../../src/modulos/facturacion/devolucion-de-nota';
import { RegistroDevolucionDeNota } from '../../src/modulos/facturacion/impresora-de-caja';
import {
  Cierres,
  api,
  escribir,
  exigirEstado,
  filas,
  impresoraDeCaja,
  vincularPuente,
  type ImpresoraDePrueba,
} from '../caja-critica/fabrica-caja';
import {
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  crearEscenarioFact,
  exigirPse,
  limitarBarrido,
  procesar,
  seriesDeNotas,
  turnoDe,
  type AppFact,
  type Escenario,
} from '../facturacion-critica/fabrica-facturacion';
import { efectivo, emitirNota, type Libre } from '../facturacion-critica/fabrica-notas';
import type { TicketEmulado } from '../soporte/puente/interprete-escpos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppFact;
let esc: Escenario;
let restaurarBarrido: () => void;
const cierres = new Cierres();
const A = () => esc.A;
const MARCA = 'SIMULADO · SIN VALOR TRIBUTARIO';
const sinEspacios = (texto: string): string => texto.replace(/\s+/g, '');

/**
 * El ticket que lleva `numero`, descartando los demás que lleguen antes. El puente entrega los tickets de forma asíncrona y
 * cada cobro o nota deja el suyo en la cola de la impresora: «el primero que llegue» puede ser el de la operación anterior
 * (la raíz de una falla intermitente de la reemisión), así que cada prueba espera el ticket de su propio número.
 */
async function ticketDe(
  impresora: ImpresoraDePrueba,
  numero: string,
  ms = 10_000,
): Promise<TicketEmulado> {
  const limite = Date.now() + ms;
  const buscado = sinEspacios(numero);
  for (;;) {
    const restante = limite - Date.now();
    if (restante <= 0) throw new Error(`No llegó el ticket de ${numero} en ${ms} ms`);
    const ticket = await impresora.emulador.esperarTicket(restante);
    if (sinEspacios(ticket.texto).includes(buscado)) return ticket;
  }
}

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  restaurarBarrido = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurarBarrido?.();
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  await seriesDeNotas(ctx, A());
  ctx.pse.reglas.limpiar();
});

/** Una devolución parcial de un Lomo en efectivo sobre un comprobante aceptado de la caja y el turno dados. */
async function devolverUnLomo(token: string, original: string, turnoId: string): Promise<Libre> {
  const detalle = (await api(ctx, token, 'get', `/comprobantes/${original}`)).body as Libre;
  const lomo = (detalle.lineas as Libre[]).find((l) => /Lomo/.test(l.descripcion))!
    .posicion as number;
  return emitirNota(ctx, token, {
    comprobanteId: original,
    tipo: 'DEVOLUCION',
    motivo: 'El cliente devolvió el plato',
    total: '28.00',
    lineas: [{ posicion: lomo, cantidad: 1 }],
    devolucion: { turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
  });
}

describe('con impresora de caja en S3 (emisor en SIMULADO)', () => {
  let impresora: ImpresoraDePrueba;
  let turnoId: string;

  beforeAll(async () => {
    await exigirPse(esc);
    const cajaS3 = (await A().cajas()).S3!.caja1;
    impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S3, 'Caja de S3', {
      cajaId: cajaS3,
    });
    const puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S3);
    await puente.iniciar();
    turnoId = await turnoDe(ctx, A(), 'cajeroS3', 'S3', 'caja1');
  });

  it('el ticket del cobro lleva la leyenda de 6b y la marca de simulado, y el QR sin el hash', async () => {
    impresora.emulador.limpiar();
    const c = await cobrarLomo(ctx, A(), { turnoId, sucursal: 'S3', token: A().token.cajeroS3! });
    const ticket = await ticketDe(impresora, (c.respuesta.comprobante as Libre).numero);
    const t = ticket.texto;
    expect(t.split(MARCA).length - 1).toBe(2);
    expect(t.trimStart().startsWith(MARCA)).toBe(true);
    expect(t.trimEnd().endsWith(MARCA)).toBe(true);
    expect(sinEspacios(t)).toContain(
      sinEspacios('Representación impresa de la BOLETA DE VENTA ELECTRÓNICA'),
    );
    expect(t).not.toContain('pendiente de envío');
    // El simulador no tiene dirección de consulta.
    expect(t).not.toContain('Consulte');
    expect(ticket.qrs).toHaveLength(1);
    expect(ticket.qrs[0]!.split('|')).toHaveLength(10);
    // Al aceptarse el comprobante no se imprime un segundo ticket (criterio 162).
    impresora.emulador.limpiar();
    await procesar(ctx, A().id, c.comprobanteId);
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await filas(
        `SELECT 1 FROM trabajo_impresion WHERE comprobante_id = $1 AND tipo = 'COMPROBANTE'`,
        [c.comprobanteId],
      ),
    ).toHaveLength(1);
  });

  it('el ticket de una devolución lleva el documento que modifica, el motivo y la devolución por medio', async () => {
    const c = await cobrarLomo(ctx, A(), {
      turnoId,
      sucursal: 'S3',
      token: A().token.cajeroS3!,
      lineas: [['lomo', 2]],
      total: '56.00',
    });
    await procesar(ctx, A().id, c.comprobanteId);
    const nota = await devolverUnLomo(A().token.supervisorS3!, c.comprobanteId, turnoId);
    const ticket = await ticketDe(impresora, nota.nota.numero);
    const t = sinEspacios(ticket.texto);
    for (const esperado of [
      'NOTA DE CRÉDITO ELECTRÓNICA',
      nota.nota.numero,
      `Modifica: BOLETA ${(c.respuesta.comprobante as Libre).numero}`,
      'Motivo: El cliente devolvió el plato',
      'DEVOLUCIÓN',
      'Efectivo28.00',
      'Representación impresa de la NOTA DE CRÉDITO ELECTRÓNICA',
    ]) {
      expect(t, esperado).toContain(sinEspacios(esperado));
    }
    expect(ticket.texto.split(MARCA).length - 1).toBe(2);
  });

  it('la reemisión de una nota rechazada lleva la devolución que se hizo con la rechazada', async () => {
    const c = await cobrarLomo(ctx, A(), {
      turnoId,
      sucursal: 'S3',
      token: A().token.cajeroS3!,
      lineas: [['lomo', 2]],
      total: '56.00',
    });
    await procesar(ctx, A().id, c.comprobanteId);
    const nota = await devolverUnLomo(A().token.supervisorS3!, c.comprobanteId, turnoId);
    ctx.pse.reglas.rechazarNumero(nota.nota.numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    await procesar(ctx, A().id, nota.nota.id);
    ctx.pse.reglas.limpiar();
    impresora.emulador.limpiar();
    const res = await escribir(
      ctx,
      A().token.supervisorS3!,
      'post',
      `/facturacion/comprobantes/${nota.nota.id}/reemision`,
      { tipo: 'NOTA_CREDITO_BOLETA' },
      { 'Idempotency-Key': randomUUID() },
    );
    exigirEstado(res, 201, 'Emitir otro de una nota rechazada (006, criterio 134)');
    const ticket = await ticketDe(impresora, res.body.comprobante.numero);
    const t = sinEspacios(ticket.texto);
    expect(t).toContain(sinEspacios(res.body.comprobante.numero));
    expect(t).toContain('DEVOLUCIÓN');
    expect(t).toContain('Efectivo28.00');
    expect(t).toContain(sinEspacios('Modifica: BOLETA'));
  });
});

describe('la reimpresión de una nota que se emitió sin impresora (no hay ticket guardado)', () => {
  it('arma el ticket con los egresos de la nota por medio y el redondeo, la leyenda de 6b y la marca de simulado', async () => {
    const turnoS1 = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const c = await cobrarLomo(ctx, A(), {
      turnoId: turnoS1,
      lineas: [['lomo', 2]],
      total: '56.00',
    });
    await procesar(ctx, A().id, c.comprobanteId);
    const nota = await devolverUnLomo(A().token.supervisor!, c.comprobanteId, turnoS1);
    const notaId = nota.nota.id as string;
    expect(
      await filas(`SELECT 1 FROM trabajo_impresion WHERE comprobante_id = $1`, [notaId]),
      'la nota se emitió sin impresora: no hay ticket guardado',
    ).toHaveLength(0);

    const impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S1, 'Caja de S1', {
      cajaId: (await A().cajas()).S1!.caja1,
    });
    const puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S1);
    await puente.iniciar();
    impresora.emulador.limpiar();

    const res = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/comprobantes/${notaId}/impresiones`,
    );
    exigirEstado(res, 201, 'Reimprimir una nota de crédito (006, criterio 157)');
    expect(res.body.impresion).toBe('EN_COLA');
    const ticket = await ticketDe(impresora, nota.nota.numero);
    const t = sinEspacios(ticket.texto);
    for (const esperado of [
      'REIMPRESIÓN',
      'NOTA DE CRÉDITO ELECTRÓNICA',
      nota.nota.numero,
      `Modifica: BOLETA ${(c.respuesta.comprobante as Libre).numero}`,
      'Motivo: El cliente devolvió el plato',
      'DEVOLUCIÓN',
      'Efectivo28.00',
      'Representación impresa de la NOTA DE CRÉDITO ELECTRÓNICA',
    ]) {
      expect(t, esperado).toContain(sinEspacios(esperado));
    }
    expect(ticket.texto).not.toContain('Redondeo');
    expect(ticket.texto.split(MARCA).length - 1).toBe(2);
    expect(ticket.pulsosGaveta).toBe(0);
  });
});

describe('el puerto de la devolución de una nota falla cerrado', () => {
  it('sin registro lanza (nunca imprime la nota como si no hubiera devuelto nada)', async () => {
    await expect(new RegistroDevolucionDeNota().deLaNota(randomUUID())).rejects.toThrow(
      /Nadie registró/,
    );
  });

  it('sigue la cadena de reemisiones hasta la primera nota con egresos y se detiene en la primera', async () => {
    const registro = new RegistroDevolucionDeNota();
    const egresos = new Map([
      ['n1', { pagos: [{ medio: 'EFECTIVO' as const, monto: '10.00' }], redondeo: '0.00' }],
    ]);
    registro.registrar((id) => Promise.resolve(egresos.get(id) ?? null));
    const enlaces: Record<string, string | null> = { n3: 'n2', n2: 'n1', n1: null, solo: null };
    const conexion = {
      query: (_sql: string, o: { bind: string[] }) =>
        Promise.resolve([{ reemplaza_a_id: enlaces[o.bind[0]!] ?? null }]),
    };
    const servicio = new DevolucionDeNotaParaTicket(conexion as never, registro);
    expect(await servicio.de('n1')).toEqual(egresos.get('n1'));
    expect(await servicio.de('n3')).toEqual(egresos.get('n1'));
    expect(await servicio.de('solo')).toBeNull();
  });
});
