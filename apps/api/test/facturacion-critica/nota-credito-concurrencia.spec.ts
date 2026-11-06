// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P8 · Notas de crédito simultáneas y réplicas (ruta crítica), criterios 148, 149, 150 y 153:
// - 148: dos notas simultáneas sobre el mismo original se turnan en la fila del original: nunca se acredita más que el
//   original en unidades ni en neto (una 201 y la otra 422 `NADA_QUE_ACREDITAR` o `NOTA_CREDITO_INVALIDA`);
// - 149: la numeración de las series de notas de crédito no salta con una nota que falla después de numerar (falla inyectada
//   en la impresión) y no repite con 50 notas simultáneas en dos cajas y en la misma;
// - 153: la misma IK con el mismo cuerpo devuelve la misma respuesta sin emitir, numerar, registrar egresos ni imprimir; con
//   otro cuerpo, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`; el mismo `id` con otra IK o desde otra sesión devuelve la nota ya
//   emitida aunque el turno ya esté cerrado; el mismo `id` con otro comprobante, tipo, líneas, devolución o cliente (huella
//   sin `total` ni `motivo`), 422; diez peticiones simultáneas con el mismo `id`: una nota, un número, sus egresos una vez,
//   un ticket y un pulso;
// - 150: una devolución y el cierre del mismo turno a la vez se turnan como un cobro (criterio 59).
// Hoy falla por "No implementado": `POST /notas-credito` y el worker lanzan `Error('No implementado')` y las series de notas de
// crédito todavía no existen.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Cierres,
  cerrarAdmin,
  cerrarTurnoCrudo,
  conteo,
  crearEscenario,
  esperar,
  esperarError,
  esperarHasta,
  exigir,
  filas,
  impresoraDeCaja,
  numeracionDeLaCaja,
  pulsosRecibidos,
  sesionContrasena,
  vincularPuente,
  CLIENTE_RUC,
  type Escenario,
  type ImpresoraDePrueba,
} from '../caja-critica/fabrica-caja';
import {
  arrancarNotas,
  comprobanteDe,
  contarFilas,
  cuerpoNota,
  efectivo,
  egresosDe,
  emitirAceptado,
  fallarElTicketDeLaNota,
  impresoraEnS1,
  notaCrudo,
  notasDelOriginal,
  prepararNotas,
  trabajosDeComprobante,
  turnoAbiertoDe,
  yape,
  type AppNotas,
  type Emitido,
  type Libre,
} from './fabrica-notas';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

let ctx: AppNotas;
let esc: Escenario;
const cierres = new Cierres();
const A = () => esc.A;
const sup = () => A().token.supervisor!;

beforeAll(async () => {
  ctx = await arrancarNotas({ poolMax: 10 });
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});

const boleta = async (o: Parameters<typeof emitirAceptado>[2] = {}) => {
  await prepararNotas(ctx, esc);
  return emitirAceptado(ctx, A(), o);
};

const posicionDe = (comprobante: Libre, descripcion: RegExp): number =>
  (comprobante.lineas as Libre[]).find((l) => descripcion.test(l.descripcion as string))!
    .posicion as number;

const ultimoDeSerie = async (cajaId: string, tipo = 'NOTA_CREDITO_BOLETA'): Promise<number> =>
  Number(
    (
      await filas('SELECT ultimo_numero FROM serie WHERE caja_id = $1 AND tipo = $2 AND activa', [
        cajaId,
        tipo,
      ])
    )[0]?.ultimo_numero,
  );

// ------------------------------------------------------------------------------------------------
describe('criterio 148 · lo que queda por acreditar con notas simultáneas', () => {
  it('dos devoluciones de los 2 Lomos a la vez: una 201 y la otra 422; el original queda acreditado una sola vez', async () => {
    const o = await boleta();
    const lomo = posicionDe(o.cobro.comprobante, /Lomo/);
    const admin = await sesionContrasena(ctx, A().base.admin, A().S1);
    const pedir = (token: string) =>
      notaCrudo(
        ctx,
        token,
        cuerpoNota({
          comprobanteId: o.comprobanteId,
          tipo: 'DEVOLUCION',
          total: '56.00',
          lineas: [{ posicion: lomo, cantidad: 2 }],
        }),
      );
    const respuestas = await Promise.all([pedir(sup()), pedir(admin)]);
    const estados = respuestas.map((r) => r.status).sort();
    expect(estados, respuestas.map((r) => r.text).join('\n')).toEqual([201, 422]);
    const rechazada = respuestas.find((r) => r.status === 422)!;
    expect(['NADA_QUE_ACREDITAR', 'NOTA_CREDITO_INVALIDA']).toContain(rechazada.body.codigo);
    expect(rechazada.text).not.toMatch(/SQLSTATE|violates|deadlock/i);
    expect(await notasDelOriginal(o.comprobanteId)).toHaveLength(1);
    const detalle = await comprobanteDe(ctx, sup(), o.comprobanteId);
    expect(detalle.acreditado).toEqual([
      {
        posicion: lomo,
        cantidad: 2,
        neto: '56.00',
        base: '47.46',
        igv: '8.54',
        bolsas: 0,
        icbper: '0.00',
      },
    ]);
  });

  it('cuatro devoluciones de 1 Lomo a la vez: exactamente dos pasan y nunca se acredita más de 2 unidades ni 56.00', async () => {
    const o = await boleta();
    const lomo = posicionDe(o.cobro.comprobante, /Lomo/);
    const respuestas = await Promise.all(
      Array.from({ length: 4 }, () =>
        notaCrudo(
          ctx,
          sup(),
          cuerpoNota({
            comprobanteId: o.comprobanteId,
            tipo: 'DEVOLUCION',
            total: '28.00',
            lineas: [{ posicion: lomo, cantidad: 1 }],
          }),
        ),
      ),
    );
    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(2);
    for (const r of respuestas.filter((x) => x.status !== 201)) {
      expect(r.status, r.text).toBe(422);
      expect(['NADA_QUE_ACREDITAR', 'NOTA_CREDITO_INVALIDA']).toContain(r.body.codigo);
    }
    const notas = await notasDelOriginal(o.comprobanteId);
    expect(notas).toHaveLength(2);
    expect(notas.reduce((s, n) => s + Number(n.total), 0)).toBe(56);
  });

  it('una anulación y una devolución a la vez sobre el mismo original: solo una pasa', async () => {
    const o = await boleta();
    const lomo = posicionDe(o.cobro.comprobante, /Lomo/);
    const [anulacion, devolucion] = await Promise.all([
      notaCrudo(
        ctx,
        sup(),
        cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      ),
      notaCrudo(
        ctx,
        sup(),
        cuerpoNota({
          comprobanteId: o.comprobanteId,
          tipo: 'DEVOLUCION',
          total: '28.00',
          lineas: [{ posicion: lomo, cantidad: 1 }],
        }),
      ),
    ]);
    // O gana la anulación (y la devolución ve todo acreditado) o gana la devolución (y la anulación ve algo acreditado).
    const gano = [anulacion, devolucion].filter((r) => r.status === 201);
    expect(gano.length, `${anulacion.text}\n${devolucion.text}`).toBeGreaterThanOrEqual(1);
    if (anulacion.status === 201) {
      expect(devolucion.status).toBe(422);
    } else {
      expect(anulacion.status).toBe(422);
      expect(devolucion.status).toBe(201);
    }
    expect(await notasDelOriginal(o.comprobanteId)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 149 · sin saltos ni duplicados', () => {
  it('una nota que falla después de numerar no deja hueco: el número vuelve y la siguiente usa el mismo', async () => {
    // La falla inyectada salta al encolar el ticket, así que las cajas de S1 necesitan su impresora.
    await impresoraEnS1(ctx, esc, cierres);
    const mala = await boleta({ quien: 'cajero2', caja: 'caja2' });
    const buena = await boleta({ quien: 'cajero2', caja: 'caja2' });
    const antes = await ultimoDeSerie(mala.cajaId);
    const quitar = await fallarElTicketDeLaNota(mala.comprobanteId);
    try {
      const res = await notaCrudo(
        ctx,
        sup(),
        cuerpoNota({ comprobanteId: mala.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      );
      expect(res.status, res.text).toBeGreaterThanOrEqual(500);
      expect(res.text).not.toMatch(/falla inyectada|trigger|violates/i);
    } finally {
      await quitar();
    }
    expect(await ultimoDeSerie(mala.cajaId)).toBe(antes);
    expect(await notasDelOriginal(mala.comprobanteId)).toEqual([]);
    const exitosa = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({ comprobanteId: buena.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
    );
    expect(exitosa.status, exitosa.text).toBe(201);
    expect(exitosa.body.nota.correlativo).toBe(antes + 1);
    // El mismo cobro fallido, reintentado ya sin la falla, sale con el siguiente número sin hueco.
    const reintento = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({ comprobanteId: mala.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
    );
    expect(reintento.status, reintento.text).toBe(201);
    expect(reintento.body.nota.correlativo).toBe(antes + 2);
    const numeracion = (await numeracionDeLaCaja(mala.cajaId)).find((s) => s.serie === 'BC02')!;
    expect(numeracion.consecutivos).toBe(true);
  });

  it('50 notas simultáneas en dos cajas (25 en cada una) no repiten ni saltan números, y cada una usa la serie de su caja', async () => {
    const porCaja: Record<'caja1' | 'caja2', Emitido[]> = { caja1: [], caja2: [] };
    // Las cuentas se arman una a una (compartir mesas en paralelo no es el objeto de esta prueba).
    for (let i = 0; i < 25; i++) {
      for (const [caja, quien] of [
        ['caja1', 'cajero'],
        ['caja2', 'cajero2'],
      ] as const) {
        porCaja[caja].push(
          await boleta({
            quien,
            caja,
            lineas: [['dulce', 1]],
            total: '0.01',
            pagos: [yape('0.01', `OP-${caja}-${i}`)],
          }),
        );
      }
    }
    const cajas = await A().cajas();
    const antes1 = await ultimoDeSerie(cajas.S1!.caja1);
    const antes2 = await ultimoDeSerie(cajas.S1!.caja2);
    const todas = [...porCaja.caja1, ...porCaja.caja2];
    // Las emiten el Supervisor y el Administrador a la vez.
    const admin = await sesionContrasena(ctx, A().base.admin, A().S1);
    const respuestas = await Promise.all(
      todas.map((o, i) =>
        notaCrudo(
          ctx,
          i % 2 === 0 ? sup() : admin,
          cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '0.01' }),
        ),
      ),
    );
    for (const r of respuestas) expect(r.status, r.text).toBe(201);
    const numeros = (serie: string) =>
      respuestas
        .map((r) => r.body.nota as Libre)
        .filter((n) => n.serie === serie)
        .map((n) => n.correlativo as number)
        .sort((a, b) => a - b);
    expect(numeros('BC01')).toEqual(Array.from({ length: 25 }, (_, i) => antes1 + 1 + i));
    expect(numeros('BC02')).toEqual(Array.from({ length: 25 }, (_, i) => antes2 + 1 + i));
    for (const caja of ['caja1', 'caja2'] as const) {
      const numeracion = await numeracionDeLaCaja(cajas.S1![caja]);
      const nc = numeracion.find((s) => s.tipo === 'NOTA_CREDITO_BOLETA')!;
      expect(nc.consecutivos, JSON.stringify(nc)).toBe(true);
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 153 · réplicas', () => {
  it('la misma IK con el mismo cuerpo devuelve la misma respuesta sin emitir, numerar ni registrar egresos otra vez; con otro cuerpo, 422', async () => {
    const o = await boleta();
    const cuerpo = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    const ik = randomUUID();
    const primera = await notaCrudo(ctx, sup(), cuerpo, { ik });
    expect(primera.status, primera.text).toBe(201);
    const serieDespues = await ultimoDeSerie(o.cajaId);
    const consumoNotas = await contarFilas('SELECT 1 FROM comprobante WHERE afecta_a_id = $1', [
      o.comprobanteId,
    ]);
    const trabajosAntes = (await trabajosDeComprobante(primera.body.nota.id)).length;
    const replica = await notaCrudo(ctx, sup(), cuerpo, { ik });
    expect(replica.status, replica.text).toBe(201);
    expect(replica.body).toEqual(primera.body);
    expect(await ultimoDeSerie(o.cajaId)).toBe(serieDespues);
    expect(
      await contarFilas('SELECT 1 FROM comprobante WHERE afecta_a_id = $1', [o.comprobanteId]),
    ).toBe(consumoNotas);
    expect(await egresosDe(primera.body.nota.id)).toHaveLength(1);
    expect(await trabajosDeComprobante(primera.body.nota.id)).toHaveLength(trabajosAntes);
    const otroCuerpo = await notaCrudo(
      ctx,
      sup(),
      { ...cuerpo, total: '27.00', id: randomUUID() },
      { ik },
    );
    esperarError(otroCuerpo, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  });

  it('el mismo id con otra IK o desde otra sesión devuelve la nota ya emitida, aunque el turno ya esté cerrado; con otro motivo o total, también', async () => {
    const o = await boleta();
    const cajas = await A().cajas();
    // La devolución se hace en un turno propio del Supervisor, que luego se cierra.
    const turnoPropio = await turnoAbiertoDe(ctx, sup(), cajas.S1!.caja3, '50.00');
    const cuerpo = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '9.00',
      lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Gaseosa/), cantidad: 1 }],
      devolucion: { turnoId: turnoPropio, pagos: [efectivo('9.00')], redondeo: '0.00' },
    });
    const primera = await notaCrudo(ctx, sup(), cuerpo);
    expect(primera.status, primera.text).toBe(201);
    exigir(
      await cerrarTurnoCrudo(
        ctx,
        sup(),
        turnoPropio,
        conteo({ EFECTIVO: '41.00' }, { EFECTIVO: 'Diferencia de prueba' }),
      ),
      200,
      'Cerrar el turno de la devolución',
    );
    const admin = await sesionContrasena(ctx, A().base.admin, A().S1);
    for (const token of [sup(), admin]) {
      const replica = await notaCrudo(ctx, token, cuerpo);
      expect(replica.status, replica.text).toBe(201);
      expect(replica.body).toEqual(primera.body);
    }
    // El motivo y el total no entran en la huella: la misma nota.
    const distinto = await notaCrudo(ctx, sup(), {
      ...cuerpo,
      motivo: 'Otro motivo',
      total: '1.00',
    });
    expect(distinto.status, distinto.text).toBe(201);
    expect(distinto.body.nota.id).toBe(primera.body.nota.id);
    expect(await notasDelOriginal(o.comprobanteId)).toHaveLength(1);
    expect(await egresosDe(primera.body.nota.id)).toHaveLength(1);
  });

  it('el mismo id con otro comprobante, tipo, líneas, devolución o cliente es 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const o = await boleta();
    const otro = await boleta();
    const lomo = posicionDe(o.cobro.comprobante, /Lomo/);
    const id = randomUUID();
    const base = cuerpoNota({
      id,
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: lomo, cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    const primera = await notaCrudo(ctx, sup(), base);
    expect(primera.status, primera.text).toBe(201);
    const variantes: Array<[string, Libre]> = [
      ['otro comprobante', { ...base, comprobanteId: otro.comprobanteId }],
      [
        'otro tipo',
        {
          ...cuerpoNota({ id, comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
        },
      ],
      ['otras líneas', { ...base, lineas: [{ posicion: lomo, cantidad: 2 }], total: '56.00' }],
      [
        'otra devolución',
        { ...base, devolucion: { ...base.devolucion, pagos: [yape('28.00', 'OP-R-1')] } },
      ],
      ['sin devolución', { ...base, devolucion: null }],
    ];
    const fallos: string[] = [];
    for (const [que, cuerpo] of variantes) {
      const res = await notaCrudo(ctx, sup(), cuerpo);
      if (res.status !== 422 || res.body?.codigo !== 'CLAVE_IDEMPOTENCIA_REUTILIZADA') {
        fallos.push(`${que}: ${res.status} ${res.body?.codigo ?? res.text.slice(0, 80)}`);
      }
    }
    // El cliente también entra en la huella (en un cambio a factura).
    const idCambio = randomUUID();
    const cambio = cuerpoNota({
      id: idCambio,
      comprobanteId: otro.comprobanteId,
      tipo: 'CAMBIO_A_FACTURA',
      total: '69.20',
      cliente: CLIENTE_RUC,
    });
    expect((await notaCrudo(ctx, sup(), cambio)).status).toBe(201);
    const otroCliente = await notaCrudo(ctx, sup(), {
      ...cambio,
      cliente: { ...CLIENTE_RUC, nombre: 'Otra Razón Social S.A.' },
    });
    if (
      otroCliente.status !== 422 ||
      otroCliente.body?.codigo !== 'CLAVE_IDEMPOTENCIA_REUTILIZADA'
    ) {
      fallos.push(`otro cliente: ${otroCliente.status} ${otroCliente.body?.codigo}`);
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await notasDelOriginal(o.comprobanteId)).toHaveLength(1);
  });

  it('ni una réplica ni un rechazo consumen un número', async () => {
    const o = await boleta();
    const antes = await ultimoDeSerie(o.cajaId);
    const cuerpo = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    expect((await notaCrudo(ctx, sup(), cuerpo)).status).toBe(201);
    expect(await ultimoDeSerie(o.cajaId)).toBe(antes + 1);
    // Réplica por id (otra IK), nota sobre un anulado, total que no coincide, forma incorrecta y rol sin permiso.
    expect((await notaCrudo(ctx, sup(), cuerpo)).status).toBe(201);
    await notaCrudo(ctx, sup(), { ...cuerpo, id: randomUUID() });
    await notaCrudo(ctx, sup(), { ...cuerpo, id: randomUUID(), total: '1.00' });
    await notaCrudo(ctx, sup(), { ...cuerpo, id: 'no-es-uuid' });
    await notaCrudo(ctx, A().token.mozo!, { ...cuerpo, id: randomUUID() });
    expect(await ultimoDeSerie(o.cajaId)).toBe(antes + 1);
  });

  describe('diez peticiones simultáneas con el mismo id (con impresora de caja)', () => {
    let impresora: ImpresoraDePrueba;
    let preparada: Promise<void> | undefined;
    const preparar = () =>
      (preparada ??= (async () => {
        await prepararNotas(ctx, esc);
        const caja1 = (await A().cajas()).S3!.caja1;
        impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S3, 'Caja de S3', {
          cajaId: caja1,
        });
        const puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S3);
        await puente.iniciar();
        await turnoAbiertoDe(ctx, A().token.cajeroS3!, caja1);
        await esperarHasta(
          () => pulsosRecibidos(impresora.emulador) >= 1,
          8_000,
          'el pulso del fondo',
        );
      })());

    it('dejan una nota, un número, sus egresos una vez, un ticket y un pulso', async () => {
      await preparar();
      impresora.emulador.limpiar();
      const o = await emitirAceptado(ctx, A(), {
        sucursal: 'S3',
        caja: 'caja1',
        quien: 'cajeroS3',
      });
      await impresora.emulador.esperarTickets(1, 8_000);
      impresora.emulador.limpiar();
      const cuerpo = cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1 }],
        devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
      });
      const antes = await ultimoDeSerie(o.cajaId);
      const compartida = randomUUID();
      const supervisor = A().token.supervisorS3!;
      const respuestas = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          notaCrudo(ctx, supervisor, cuerpo, { ik: i < 5 ? compartida : randomUUID() }),
        ),
      );
      for (const r of respuestas) {
        expect([201, 409], `${r.status} ${r.text}`).toContain(r.status);
        if (r.status === 409) expect(r.body.codigo).toBe('CONFLICTO');
      }
      const creadas = respuestas.filter((r) => r.status === 201);
      expect(creadas.length).toBeGreaterThan(0);
      for (const r of creadas) expect(r.body).toEqual(creadas[0]!.body);
      const conflictos = respuestas.filter((x) => x.status === 409).length;
      for (let i = 0; i < conflictos; i++) {
        const repetida = await notaCrudo(ctx, supervisor, cuerpo);
        expect(repetida.status, repetida.text).toBe(201);
        expect(repetida.body).toEqual(creadas[0]!.body);
      }
      const notaId = creadas[0]!.body.nota.id as string;
      expect(await notasDelOriginal(o.comprobanteId)).toHaveLength(1);
      expect(await ultimoDeSerie(o.cajaId)).toBe(antes + 1);
      expect(await egresosDe(notaId)).toHaveLength(1);
      const tickets = (await trabajosDeComprobante(notaId)).filter((t) => t.tipo === 'COMPROBANTE');
      expect(tickets).toHaveLength(1);
      await impresora.emulador.esperarTickets(1, 8_000);
      await esperar(1_500);
      expect(impresora.emulador.tickets).toHaveLength(1);
      expect(pulsosRecibidos(impresora.emulador)).toBe(1);
    });
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 150 · una devolución y el cierre del mismo turno', () => {
  it('se turnan como un cobro: si la devolución entra, el cierre la cuenta en su esperado; si el cierre gana, la devolución es 409 TURNO_CERRADO', async () => {
    const cajas = await A().cajas();
    const resultados: string[] = [];
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const o = await boleta();
      const turnoId = await turnoAbiertoDe(ctx, sup(), cajas.S1!.caja3, '100.00');
      const todosLosMotivos = Object.fromEntries(
        ['EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'].map((m) => [
          m,
          'Conteo de prueba',
        ]),
      );
      const [nota, cierre] = await Promise.all([
        notaCrudo(
          ctx,
          sup(),
          cuerpoNota({
            comprobanteId: o.comprobanteId,
            tipo: 'DEVOLUCION',
            total: '9.00',
            lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Gaseosa/), cantidad: 1 }],
            devolucion: { turnoId, pagos: [efectivo('9.00')], redondeo: '0.00' },
          }),
        ),
        cerrarTurnoCrudo(ctx, sup(), turnoId, conteo({ EFECTIVO: '100.00' }, todosLosMotivos)),
      ]);
      expect(cierre.status, cierre.text).toBe(200);
      const esperadoDelCierre = (cierre.body.cierre.conteo as Libre[]).find(
        (c) => c.medio === 'EFECTIVO',
      )!.esperado as string;
      if (nota.status === 201) {
        // La devolución entró antes del cierre: el egreso de 9.00 está en el esperado.
        expect(esperadoDelCierre).toBe('91.00');
        resultados.push('devolución primero');
      } else {
        esperarError(nota, 409, 'TURNO_CERRADO');
        expect(esperadoDelCierre).toBe('100.00');
        expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
        resultados.push('cierre primero');
      }
      // Sea cual sea el orden, no queda un egreso en un turno cerrado que el cierre no haya contado.
      const egresos = await filas(
        `SELECT coalesce(sum(monto), 0)::text AS n FROM movimiento_caja WHERE turno_id = $1 AND tipo = 'EGRESO' AND medio = 'EFECTIVO'`,
        [turnoId],
      );
      expect(Number(egresos[0]!.n)).toBe(nota.status === 201 ? 9 : 0);
    }
    expect(resultados).toHaveLength(3);
  });
});
