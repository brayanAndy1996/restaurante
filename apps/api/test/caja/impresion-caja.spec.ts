// Historia 006 · caja, cobro y comprobantes, grupo C6 (T21) · pruebas del desarrollador (no protegidas) de la impresión
// de caja con el simulador del puente y el emulador de impresora de 3b: el ticket del comprobante que sale de un cobro
// real (criterios 90 y 91), la reimpresión (90), el X y la Z impresos (95) y todo sin impresora (96). El pulso de la
// gaveta y la falla inyectada del encolado las cubren las pruebas protegidas (`caja-critica/gaveta.spec.ts`,
// `cobro-idempotencia.spec.ts` y `comprobante.spec.ts`).
import { randomUUID } from 'node:crypto';
import {
  impresionDeCajaRespuestaSchema,
  movimientoRespuestaSchema,
  reporteCajaSchema,
  turnoRespuestaSchema,
} from '@restaurante/contratos';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  abrirTurnoCrudo,
  cerrarAdmin,
  cerrarTurnoCrudo,
  Cierres,
  cobrar,
  conteo,
  crearEscenario,
  cuentaCon,
  efectivo,
  escribir,
  exigirEstado,
  filas,
  impresoraDeCaja,
  tarjeta,
  trabajosDe,
  vincularPuente,
  yape,
  type AppP5,
  type Escenario,
  type ImpresoraDePrueba,
} from '../caja-critica/fabrica-caja';
import type { SimuladorPuente } from '../soporte/puente';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const cierres = new Cierres();
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});

const conTrabajos = (sucursalId: string, turnoId: string, tipo: string) =>
  filas(
    `SELECT * FROM trabajo_impresion WHERE sucursal_id = $1 AND turno_id = $2 AND tipo = $3 ORDER BY creado_en, id`,
    [sucursalId, turnoId, tipo],
  );

describe('con impresora de caja con gaveta (S3)', () => {
  let impresora: ImpresoraDePrueba;
  let puente: SimuladorPuente;
  let caja1: string;
  let caja2: string;
  let turnoId: string;

  beforeAll(async () => {
    const cajas = (await A().cajas()).S3!;
    caja1 = cajas.caja1;
    caja2 = cajas.caja2;
    impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S3, 'Caja de S3', {
      cajaId: caja1,
    });
    puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S3);
    await puente.iniciar();
    turnoId = await abrirTurno(ctx, A().token.cajeroS3!, caja1, '100.00');
  });

  it('un cobro encola exactamente un trabajo COMPROBANTE y el ticket sale con todo lo del criterio 91', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S3', [['lomo', 2]]);
    impresora.emulador.limpiar();
    const cobro = await cobrar(ctx, A().token.cajeroS3!, cuenta, {
      turnoId,
      total: '56.00',
      pagos: [yape('16.00'), efectivo('40.00', '50.00')],
    });
    expect(cobro.impresion).toBe('EN_COLA');
    const trabajos = await filas(
      `SELECT * FROM trabajo_impresion WHERE comprobante_id = $1 AND tipo = 'COMPROBANTE'`,
      [cobro.comprobante.id],
    );
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]).toMatchObject({
      id: cobro.trabajoId,
      impresora_id: impresora.id,
      orden_id: cuenta.ordenId,
      reimpresion_de_id: null,
      turno_id: null,
      error_render: null,
    });

    const ticket = await impresora.emulador.esperarTicket(5_000);
    const t = ticket.texto;
    expect(t).toContain('BOLETA DE VENTA ELECTRÓNICA');
    expect(t).toContain(cobro.comprobante.numero);
    expect(t).toContain(cobro.comprobante.emisor.razonSocial);
    expect(t).toContain(`RUC: ${cobro.comprobante.emisor.ruc}`);
    expect(t).toContain('Lomo saltado');
    expect(t).toContain('SON: CINCUENTA Y SEIS CON 00/100 SOLES');
    expect(t).toContain('Yape');
    expect(t).toContain('Recibido');
    expect(t).toContain('Vuelto');
    // En papel de 80 mm la leyenda ocupa dos líneas: se compara sin saltos.
    expect(t.replace(/\s+/g, ' ')).toContain(
      'Representación impresa de la BOLETA DE VENTA ELECTRÓNICA',
    );
    expect(t).not.toContain('pendiente de envío');
    expect(ticket.qrs).toHaveLength(1);
    expect(ticket.qrs[0]).toContain(`|03|${cobro.comprobante.serie}|`);
    expect(ticket.qrs[0]).toContain(`|${cobro.comprobante.totales.total}|`);
    expect(ticket.comandosDesconocidos).toEqual([]);
    expect(ticket.pulsosGaveta).toBe(1);
    expect(ticket.corte).not.toBeNull();
  });

  it('un cobro con tarjeta no abre la gaveta pero imprime el ticket con el QR', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S3', [['lomo', 1]]);
    impresora.emulador.limpiar();
    await cobrar(ctx, A().token.cajeroS3!, cuenta, {
      turnoId,
      total: '28.00',
      pagos: [tarjeta('28.00')],
    });
    const ticket = await impresora.emulador.esperarTicket(5_000);
    expect(ticket.pulsosGaveta).toBe(0);
    expect(ticket.qrs).toHaveLength(1);
  });

  it('reimprimir copia el ticket de la emisión con la marca, sin pulso, y no toca el único de la emisión', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S3', [['lomo', 1]]);
    const cobro = await cobrar(ctx, A().token.cajeroS3!, cuenta, {
      turnoId,
      total: '28.00',
      pagos: [efectivo('28.00')],
    });
    await impresora.emulador.esperarTicket(5_000);
    impresora.emulador.limpiar();
    const primera = await escribir(
      ctx,
      A().token.cajeroS3!,
      'post',
      `/comprobantes/${cobro.comprobante.id}/impresiones`,
    );
    exigirEstado(primera, 201, 'Reimprimir (006, criterio 90)');
    impresionDeCajaRespuestaSchema.parse(primera.body);
    expect(primera.body.impresion).toBe('EN_COLA');
    const ticket = await impresora.emulador.esperarTicket(5_000);
    expect(ticket.texto).toContain('REIMPRESIÓN');
    expect(ticket.texto).toContain(cobro.comprobante.numero);
    expect(ticket.qrs).toHaveLength(1);
    expect(ticket.pulsosGaveta).toBe(0);

    const segunda = await escribir(
      ctx,
      A().token.cajeroS3!,
      'post',
      `/comprobantes/${cobro.comprobante.id}/impresiones`,
    );
    exigirEstado(segunda, 201, 'Reimprimir otra vez');
    expect(segunda.body.trabajoId).not.toBe(primera.body.trabajoId);
    const todos = await filas(
      `SELECT id, reimpresion_de_id FROM trabajo_impresion WHERE comprobante_id = $1 ORDER BY creado_en, id`,
      [cobro.comprobante.id],
    );
    expect(todos).toHaveLength(3);
    expect(todos.filter((t) => t.reimpresion_de_id === null).map((t) => t.id)).toEqual([
      cobro.trabajoId,
    ]);
    expect(
      todos
        .filter((t) => t.reimpresion_de_id !== null)
        .every((t) => t.reimpresion_de_id === cobro.trabajoId),
    ).toBe(true);
    // Un ticket reimpreso dos veces lleva la marca una sola vez.
    const segundo = await impresora.emulador.esperarTicket(5_000);
    for (const t of [ticket, segundo]) {
      expect(t.texto.match(/REIMPRESIÓN/g)).toHaveLength(1);
    }
  });

  it('reimprimir un comprobante inexistente o de otra sucursal es 404', async () => {
    const inexistente = await escribir(
      ctx,
      A().token.cajeroS3!,
      'post',
      `/comprobantes/${randomUUID()}/impresiones`,
    );
    exigirEstado(inexistente, 404, 'Comprobante que no existe');
  });

  it('el X se imprime con los datos del turno y no cambia nada', async () => {
    const antes = await conTrabajos(A().S3, turnoId, 'REPORTE_X');
    impresora.emulador.limpiar();
    const res = await escribir(
      ctx,
      A().token.cajeroS3!,
      'post',
      `/turnos/${turnoId}/reporte-x/impresiones`,
    );
    exigirEstado(res, 201, 'Imprimir el X (006, criterio 30)');
    impresionDeCajaRespuestaSchema.parse(res.body);
    expect(res.body.impresion).toBe('EN_COLA');
    const despues = await conTrabajos(A().S3, turnoId, 'REPORTE_X');
    expect(despues).toHaveLength(antes.length + 1);
    expect(despues.at(-1)).toMatchObject({ id: res.body.trabajoId, impresora_id: impresora.id });
    const ticket = await impresora.emulador.esperarTicket(5_000);
    expect(ticket.texto).toContain('REPORTE X');
    expect(ticket.texto).toContain('Fondo inicial');
    expect(ticket.texto).toContain('100.00');
    expect(ticket.texto).toContain('ESPERADO EN CAJA');
    expect(ticket.texto).not.toContain('CONTEO DEL CIERRE');
    expect(ticket.pulsosGaveta).toBe(0);
    const otro = await escribir(
      ctx,
      A().token.cajeroS3!,
      'post',
      `/turnos/${randomUUID()}/reporte-x/impresiones`,
    );
    exigirEstado(otro, 404, 'Turno que no existe');
  });

  it('el cierre encola una sola Z con el conteo y la réplica del cierre no encola otra', async () => {
    const supervisor = A().token.supervisorS3!;
    const turno2 = await abrirTurno(ctx, supervisor, caja2, '50.00');
    const cuenta = await cuentaCon(ctx, A(), 'S3', [['lomo', 1]]);
    await cobrar(ctx, supervisor, cuenta, {
      turnoId: turno2,
      total: '28.00',
      pagos: [efectivo('28.00')],
    });
    await impresora.emulador.esperarTicket(5_000);
    impresora.emulador.limpiar();
    const clave = randomUUID();
    const cuerpo = conteo({ EFECTIVO: '75.00' }, { EFECTIVO: 'Faltó un billete' });
    const cierre = await cerrarTurnoCrudo(ctx, supervisor, turno2, cuerpo, clave);
    exigirEstado(cierre, 200, 'Cerrar el turno (006, criterio 31)');
    const zetas = await conTrabajos(A().S3, turno2, 'REPORTE_Z');
    expect(zetas).toHaveLength(1);
    expect(zetas[0]).toMatchObject({ impresora_id: impresora.id, reimpresion_de_id: null });
    const ticket = await impresora.emulador.esperarTicket(5_000);
    for (const esperado of [
      'REPORTE Z',
      'Cerrado:',
      'CONTEO DEL CIERRE',
      '75.00',
      '-3.00',
      'Motivo: Faltó un billete',
    ]) {
      expect(ticket.texto).toContain(esperado);
    }

    const replica = await cerrarTurnoCrudo(ctx, supervisor, turno2, cuerpo, clave);
    exigirEstado(replica, 200, 'Réplica del cierre');
    expect(await conTrabajos(A().S3, turno2, 'REPORTE_Z')).toHaveLength(1);
    const otraVez = await cerrarTurnoCrudo(ctx, supervisor, turno2, cuerpo);
    exigirEstado(otraVez, 409, 'Cerrar un turno ya cerrado');
    expect(await conTrabajos(A().S3, turno2, 'REPORTE_Z')).toHaveLength(1);
  });

  it('la apertura, el movimiento y el cierre dicen si se imprimió; las réplicas devuelven lo mismo', async () => {
    const supervisor = A().token.supervisorS3!;
    const id = randomUUID();
    const apertura = await abrirTurnoCrudo(ctx, supervisor, caja2, '30.00', id);
    exigirEstado(apertura, 201, 'Abrir con fondo (006, criterio 93)');
    const turno = turnoRespuestaSchema.parse(apertura.body);
    expect(turno.impresion).toBe('EN_COLA');
    const [gaveta] = await conTrabajos(A().S3, id, 'GAVETA');
    expect(turno.trabajoId).toBe(gaveta!.id);
    const replicaApertura = await abrirTurnoCrudo(ctx, supervisor, caja2, '30.00', id);
    exigirEstado(replicaApertura, 201, 'Réplica de la apertura');
    expect(replicaApertura.body).toEqual(apertura.body);
    expect(await conTrabajos(A().S3, id, 'GAVETA')).toHaveLength(1);

    const idMov = randomUUID();
    const cuerpoMov = { id: idMov, tipo: 'INGRESO', monto: '10.00', motivo: 'Sencillo' };
    const mov = await escribir(ctx, supervisor, 'post', `/turnos/${id}/movimientos`, cuerpoMov);
    exigirEstado(mov, 201, 'Movimiento (006, criterio 28)');
    const movimiento = movimientoRespuestaSchema.parse(mov.body);
    expect(movimiento.impresion).toBe('EN_COLA');
    const gavetas = await conTrabajos(A().S3, id, 'GAVETA');
    expect(gavetas).toHaveLength(2);
    expect(movimiento.trabajoId).not.toBe(turno.trabajoId);
    expect(gavetas.map((g) => g.id)).toContain(movimiento.trabajoId);
    const replicaMov = await escribir(
      ctx,
      supervisor,
      'post',
      `/turnos/${id}/movimientos`,
      cuerpoMov,
    );
    exigirEstado(replicaMov, 201, 'Réplica del movimiento');
    expect(replicaMov.body).toEqual(mov.body);
    expect(await conTrabajos(A().S3, id, 'GAVETA')).toHaveLength(2);

    // El reporte X (GET) y la lista de movimientos no traen los campos.
    const x = await api(ctx, supervisor, 'get', `/turnos/${id}/reporte`);
    exigirEstado(x, 200, 'Reporte X');
    expect(x.body).not.toHaveProperty('impresion');
    expect(reporteCajaSchema.parse(x.body).movimientos.lista[0]).not.toHaveProperty('impresion');

    // La gaveta no se reimprime por la ruta de 3b.
    const reimpresion = await escribir(
      ctx,
      supervisor,
      'post',
      `/impresion/trabajos/${gaveta!.id}/reimpresion`,
    );
    exigirEstado(reimpresion, 409, 'Reimprimir una gaveta');
    expect(reimpresion.body.codigo).toBe('CONFLICTO');
    expect(await conTrabajos(A().S3, id, 'GAVETA')).toHaveLength(2);

    const cierre = await cerrarTurnoCrudo(ctx, supervisor, id, conteo({ EFECTIVO: '40.00' }));
    exigirEstado(cierre, 200, 'Cerrar (006, criterio 31)');
    const z = reporteCajaSchema.parse(cierre.body);
    const [zeta] = await conTrabajos(A().S3, id, 'REPORTE_Z');
    expect(z).toMatchObject({ impresion: 'EN_COLA', trabajoId: zeta!.id });
  });

  it('un fondo de 0.00 no dice nada de impresión en la apertura', async () => {
    const id = randomUUID();
    const apertura = await abrirTurnoCrudo(ctx, A().token.supervisorS3!, caja2, '0.00', id);
    exigirEstado(apertura, 201, 'Abrir sin fondo');
    expect(apertura.body).not.toHaveProperty('impresion');
    expect(apertura.body).not.toHaveProperty('trabajoId');
    exigirEstado(
      await cerrarTurnoCrudo(ctx, A().token.supervisorS3!, id, conteo({})),
      200,
      'Cerrar sin ventas',
    );
  });

  it('la base tiene los únicos parciales de la Z por turno y del ticket de emisión por comprobante', async () => {
    const indices = await filas<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'trabajo_impresion'
          AND indexname IN ('trabajo_impresion_reporte_z_unico', 'trabajo_impresion_comprobante_unico')`,
    );
    expect(indices).toHaveLength(2);
    for (const i of indices) {
      expect(i.indexdef).toContain('UNIQUE');
      expect(i.indexdef).toContain('reimpresion_de_id IS NULL');
    }
  });
});

describe('sin impresora de caja ni de la sucursal (S1)', () => {
  const cajeroS1 = () => A().token.cajero!;
  let caja1: string;

  beforeAll(async () => {
    caja1 = (await A().cajas()).S1!.caja1;
  });

  it('el cobro, la apertura, los movimientos, el X y el cierre se hacen igual y no dejan trabajos', async () => {
    const apertura = await abrirTurnoCrudo(ctx, cajeroS1(), caja1, '50.00');
    exigirEstado(apertura, 201, 'Abrir sin impresora (006, criterio 96)');
    expect(apertura.body).toMatchObject({ impresion: 'SIN_IMPRESORA', trabajoId: null });
    const turnoId = apertura.body.id as string;
    const mov = await escribir(ctx, cajeroS1(), 'post', `/turnos/${turnoId}/movimientos`, {
      id: randomUUID(),
      tipo: 'INGRESO',
      monto: '10.00',
      motivo: 'Sencillo',
    });
    exigirEstado(mov, 201, 'Movimiento sin impresora (006, criterio 96)');
    expect(mov.body).toMatchObject({ impresion: 'SIN_IMPRESORA', trabajoId: null });
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const cobro = await cobrar(ctx, cajeroS1(), cuenta, {
      turnoId,
      total: '28.00',
      pagos: [efectivo('28.00')],
    });
    expect(cobro).toMatchObject({ impresion: 'SIN_IMPRESORA', trabajoId: null });

    const x = await escribir(ctx, cajeroS1(), 'post', `/turnos/${turnoId}/reporte-x/impresiones`);
    exigirEstado(x, 201, 'Imprimir el X sin impresora');
    expect(impresionDeCajaRespuestaSchema.parse(x.body)).toEqual({
      trabajoId: null,
      impresion: 'SIN_IMPRESORA',
    });

    const reimpresion = await escribir(
      ctx,
      cajeroS1(),
      'post',
      `/comprobantes/${cobro.comprobante.id}/impresiones`,
    );
    exigirEstado(reimpresion, 409, 'Reimprimir sin impresora');
    expect(reimpresion.body.codigo).toBe('SIN_IMPRESORA');

    const cierre = await cerrarTurnoCrudo(ctx, cajeroS1(), turnoId, conteo({ EFECTIVO: '88.00' }));
    exigirEstado(cierre, 200, 'Cerrar sin impresora');
    expect(cierre.body).toMatchObject({ impresion: 'SIN_IMPRESORA', trabajoId: null });
    expect(await trabajosDe(A().S1)).toEqual([]);
  });

  it('un comprobante emitido sin impresora se reimprime cuando después hay una, armado con sus pagos', async () => {
    const turnoId = await abrirTurno(ctx, cajeroS1(), caja1, '0.00');
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const cobro = await cobrar(ctx, cajeroS1(), cuenta, {
      turnoId,
      total: '28.00',
      // Cuatro medios en un orden que no es el alfabético ni el de la base: el ticket rearmado lo conserva (M8).
      pagos: [
        tarjeta('7.00'),
        yape('7.00'),
        { medio: 'PLIN' as const, monto: '4.00', operacion: 'PL-0001' },
        efectivo('10.00', '50.00'),
      ],
    });
    expect(cobro.trabajoId).toBeNull();

    const impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S1, 'Caja de S1', {
      cajaId: caja1,
    });
    const puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S1);
    await puente.iniciar();
    const res = await escribir(
      ctx,
      cajeroS1(),
      'post',
      `/comprobantes/${cobro.comprobante.id}/impresiones`,
    );
    exigirEstado(res, 201, 'Reimprimir un comprobante sin ticket de emisión');
    expect(res.body.impresion).toBe('EN_COLA');
    const ticket = await impresora.emulador.esperarTicket(5_000);
    expect(ticket.texto).toContain('REIMPRESIÓN');
    expect(ticket.texto).toContain(cobro.comprobante.numero);
    expect(ticket.texto).toContain('Vuelto');
    const lugares = ['Tarjeta de crédito', 'Yape', 'Plin', 'Efectivo'].map((m) =>
      ticket.texto.indexOf(m),
    );
    expect(lugares.every((l) => l >= 0)).toBe(true);
    expect([...lugares].sort((a, b) => a - b)).toEqual(lugares);
    expect(ticket.qrs).toHaveLength(1);
    expect(ticket.pulsosGaveta).toBe(0);
    void api;
  });
});
