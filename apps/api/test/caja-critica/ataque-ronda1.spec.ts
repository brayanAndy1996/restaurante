// spec: 006-caja-cobro (pruebas protegidas)
//
// Ataque adversarial, ronda 1 (T25): cuatro fallas reproducibles convertidas en pruebas.
// - F4 (alta) · criterios 47, 51, 69, 79 y 80, y la decisión del criterio 90: la descripción de una línea del comprobante
//   (nombre con modificadores) que pase de 250 caracteres se recorta a 250 con «…» al final; nunca 500. Vale para el
//   cobro DETALLADO, la venta de mostrador DETALLADO y las líneas gratuitas (cortesía) de un cobro CONSUMO o IGUALES.
// - F1 (media) · criterios 22, 29 y 31 (y 45a, ninguna ruta responde 500): el X y la Z suman por medio montos que pasan de
//   99 999 999.99 sin fallar.
// - F2 (media) · criterios 6 y 74 y la decisión del criterio 90: nunca dos tasas de IGV para la misma fecha de emisión
//   del mismo emisor. Con un cobro de hoy en curso, el `PUT` de una tasa «desde hoy» espera y responde 409 (ya hay un
//   comprobante de hoy) o el cobro usa la tasa nueva; lo incorrecto es que el cobro salga con la vieja y el siguiente
//   del mismo día con la nueva.
// - F3 (media) · criterios 90, 98, 99 y 100: la reimpresión de 004 (`POST /impresion/trabajos/:id/reimpresion`) de un
//   trabajo COMPROBANTE, REPORTE_X o REPORTE_Z aplica el permiso y el alcance de caja (Mozo 403; Cajero solo los de sus
//   turnos; Supervisor y Administrador, los de cualquier turno); la de GAVETA responde 409.
// Hoy fallan con los 500 de las descripciones largas y de las sumas grandes, con la tasa vieja y la nueva el mismo día,
// y con los 201 de la reimpresión ajena.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  admin,
  api,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  Cierres,
  CLIENTE_DNI,
  cobrar,
  cobrarCrudo,
  conteo,
  crearEscenario,
  cuentaC,
  cuentaConLineas,
  cuerpoDeCobro,
  efectivo,
  escribir,
  esperarError,
  esperar,
  exigirEstado,
  filas,
  impresoraDeCaja,
  ponerTasa,
  sesionContrasena,
  tarjeta,
  trabajosDe,
  versionDe,
  type AppP5,
  type Escenario,
  type Libre,
  type Res,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const cierres = new Cierres();
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
  await A().cajas();
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});

// ------------------------------------------------------------------------------------------------
// F4 · descripción larga
// ------------------------------------------------------------------------------------------------
describe('F4 · la descripción de una línea del comprobante pasa de 250 caracteres', () => {
  const LARGO = 250;
  let turnoId: string;
  let bowl: string;
  let modificadores: string[];
  let primerModificador: string;

  const lineaBowl = (cantidad: number) => ({
    productoId: bowl,
    modificadorIds: modificadores.slice(0, 4),
    cantidad,
  });

  /** Las descripciones guardadas de un comprobante, con si la línea es gratuita. */
  const lineasDe = (comprobanteId: string) =>
    filas<{ descripcion: string; gratuita: boolean }>(
      'SELECT descripcion, gratuita FROM comprobante_linea WHERE comprobante_id = $1 ORDER BY posicion',
      [comprobanteId],
    );

  const exigirRecortada = (descripcion: string) => {
    expect(descripcion.length).toBe(LARGO);
    expect(descripcion.endsWith('…')).toBe(true);
    expect(descripcion.startsWith('Bowl arma tu plato [')).toBe(true);
    expect(descripcion).toContain(primerModificador);
  };

  beforeAll(async () => {
    const t = A().token.admin!;
    // Seis modificadores de 59 caracteres: con cuatro, "Bowl arma tu plato [m1, m2, m3, m4]" mide 263.
    const nombres = [1, 2, 3, 4, 5, 6].map((i) =>
      `Ingrediente adicional numero ${i} con nombre bastante largo xx`.slice(0, 59),
    );
    primerModificador = nombres[0]!;
    const grupo = await api(ctx, t, 'post', '/carta/grupos-modificadores', {
      nombre: 'Extras del bowl',
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 6,
      modificadores: nombres.map((nombre) => ({ nombre, precioExtra: '0.00', productoId: null })),
    });
    exigirEstado(grupo, 201, 'Grupo MULTIPLE de 6 modificadores de 59 caracteres (003)');
    modificadores = (grupo.body.modificadores as Libre[]).map((m) => m.id as string);
    const familia = await api(ctx, t, 'post', '/carta/familias', { nombre: 'Bowls' });
    exigirEstado(familia, 201, 'Familia (003)');
    const producto = await api(ctx, t, 'post', '/carta/productos', {
      familiaId: familia.body.id,
      tipo: 'SIMPLE',
      nombre: 'Bowl arma tu plato',
      precio: '20.00',
      estacionId: null,
      tipoControlStock: 'SIN_CONTROL',
      gruposModificadores: [grupo.body.id],
    });
    exigirEstado(producto, 201, 'Producto con el grupo (003)');
    bowl = producto.body.id as string;
    const cajas = await A().cajas();
    turnoId = await abrirTurno(ctx, A().token.supervisor!, cajas.S1!.caja3);
  });

  it('cobro TOTAL BOLETA DETALLADO: 201 y la línea guarda la descripción recortada a 250 con «…»', async () => {
    const cuenta = await cuentaConLineas(ctx, A(), 'S1', [lineaBowl(1)]);
    const res = await cobrarCrudo(
      ctx,
      A().token.supervisor!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId,
        version: await versionDe(cuenta.ordenId),
        total: '20.00',
        pagos: [tarjeta('20.00')],
      }),
    );
    exigirEstado(res, 201, 'Cobrar el bowl con 4 modificadores (criterios 47 y 69)');
    const lineas = await lineasDe(res.body.comprobante.id);
    expect(lineas).toHaveLength(1);
    exigirRecortada(lineas[0]!.descripcion);
  });

  it('venta de mostrador DETALLADO: 201 y la misma descripción recortada', async () => {
    const res = await escribir(ctx, A().token.supervisor!, 'post', '/ventas-mostrador', {
      id: randomUUID(),
      turnoId,
      lineas: [lineaBowl(1)],
      total: '20.00',
      comprobante: { tipo: 'BOLETA', formato: 'DETALLADO' },
      pagos: [tarjeta('20.00')],
      redondeo: '0.00',
    });
    exigirEstado(res, 201, 'Venta de mostrador DETALLADO (criterios 79 y 80)');
    const lineas = await lineasDe(res.body.cobro.comprobante.id);
    expect(lineas).toHaveLength(1);
    exigirRecortada(lineas[0]!.descripcion);
  });

  /** 2 bowls (con 4 modificadores) y una gaseosa, con la cortesía de 1 bowl dada por el supervisor: total 29.00. */
  async function cuentaConCortesiaLarga() {
    const cuenta = await cuentaConLineas(ctx, A(), 'S1', [
      lineaBowl(2),
      { productoId: A().carta.gaseosa, modificadorIds: [], cantidad: 1 },
    ]);
    const item = cuenta.items.find((i) => i.productoId === bowl)!.id as string;
    const cortesia = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/cuentas/${cuenta.ordenId}/cortesias`,
      { id: randomUUID(), itemId: item, cantidad: 1, motivo: 'Cliente frecuente' },
    );
    exigirEstado(cortesia, 201, 'Cortesía de 1 de 2 unidades (criterio 43)');
    return cuenta;
  }

  it('cortesía de 1 de 2 unidades del ítem largo, TOTAL CONSUMO: 201 (la línea gratuita va detallada y recortada)', async () => {
    const cuenta = await cuentaConCortesiaLarga();
    const res = await cobrarCrudo(
      ctx,
      A().token.supervisor!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId,
        version: await versionDe(cuenta.ordenId),
        total: '29.00',
        formato: 'CONSUMO',
        pagos: [tarjeta('29.00')],
      }),
    );
    exigirEstado(res, 201, 'Cobrar TOTAL en CONSUMO con la cortesía larga (criterios 47 y 51)');
    const gratuitas = (await lineasDe(res.body.comprobante.id)).filter((l) => l.gratuita);
    expect(gratuitas).toHaveLength(1);
    exigirRecortada(gratuitas[0]!.descripcion);
  });

  it('cortesía de 1 de 2 unidades del ítem largo, IGUALES con 2 partes restantes: 201', async () => {
    const cuenta = await cuentaConCortesiaLarga();
    const res = await cobrarCrudo(
      ctx,
      A().token.supervisor!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId,
        version: await versionDe(cuenta.ordenId),
        total: '14.50',
        parte: { tipo: 'IGUALES', partesRestantes: 2 },
        formato: 'CONSUMO',
        pagos: [tarjeta('14.50')],
      }),
    );
    exigirEstado(res, 201, 'Cobrar la primera de dos partes iguales con la cortesía larga');
    const gratuitas = (await lineasDe(res.body.comprobante.id)).filter((l) => l.gratuita);
    for (const g of gratuitas) exigirRecortada(g.descripcion);
  });
});

// ------------------------------------------------------------------------------------------------
// F1 · sumas de un medio que pasan de 99 999 999.99
// ------------------------------------------------------------------------------------------------
describe('F1 · el reporte X y el cierre Z con más de 99 999 999.99 en un medio', () => {
  it('dos cobros de 60 000 000.00 con tarjeta: el X responde 200 con el esperado 120 000 000.00 y la Z cierra con la diferencia', async () => {
    const t = A().token.admin!;
    const familia = await api(ctx, t, 'post', '/carta/familias', { nombre: 'Banquetes' });
    exigirEstado(familia, 201, 'Familia (003)');
    const producto = await api(ctx, t, 'post', '/carta/productos', {
      familiaId: familia.body.id,
      tipo: 'SIMPLE',
      nombre: 'Banquete',
      precio: '60000000.00',
      estacionId: null,
      tipoControlStock: 'SIN_CONTROL',
    });
    exigirEstado(producto, 201, 'Producto de 60 000 000.00 (003)');
    const cajas = await A().cajas();
    const cajero = A().token.cajeroS3!;
    const turnoId = await abrirTurno(ctx, cajero, cajas.S3!.caja1);
    for (let i = 0; i < 2; i++) {
      const cuenta = await cuentaConLineas(ctx, A(), 'S3', [
        { productoId: producto.body.id as string, modificadorIds: [], cantidad: 1 },
      ]);
      await cobrar(ctx, cajero, cuenta, {
        turnoId,
        total: '60000000.00',
        cliente: CLIENTE_DNI,
        pagos: [tarjeta('60000000.00')],
      });
    }

    const x = await api(ctx, cajero, 'get', `/turnos/${turnoId}/reporte`);
    exigirEstado(x, 200, 'Reporte X con 120 000 000.00 en tarjeta (criterios 22 y 29)');
    const esperado = (x.body.esperado as Libre[]).find((e) => e.medio === 'TARJETA_CREDITO');
    expect(esperado?.monto).toBe('120000000.00');
    expect(
      (x.body.ventas.porMedio as Libre[]).find((m) => m.medio === 'TARJETA_CREDITO'),
    ).toMatchObject({ cantidad: 2, monto: '120000000.00' });
    expect(x.body.ventas.total).toBe('120000000.00');

    // El campo `contado` llega a "99999999.99": la diferencia es -20000000.01 y exige su motivo.
    const cierre = await cerrarTurnoCrudo(
      ctx,
      cajero,
      turnoId,
      conteo(
        { EFECTIVO: '200.00', TARJETA_CREDITO: '99999999.99' },
        { TARJETA_CREDITO: 'El campo del conteo no alcanza para el total' },
      ),
    );
    exigirEstado(cierre, 200, 'Cierre Z con el esperado de 120 000 000.00 (criterios 31 y 45a)');
    const fila = (cierre.body.cierre.conteo as Libre[]).find((c) => c.medio === 'TARJETA_CREDITO');
    expect(fila).toMatchObject({
      esperado: '120000000.00',
      contado: '99999999.99',
      diferencia: '-20000000.01',
      motivo: 'El campo del conteo no alcanza para el total',
    });
    expect(
      (cierre.body.cierre.conteo as Libre[]).find((c) => c.medio === 'EFECTIVO'),
    ).toMatchObject({
      esperado: '200.00',
      diferencia: '0.00',
    });

    const cerrado = await api(ctx, cajero, 'get', `/turnos/${turnoId}/reporte`);
    exigirEstado(cerrado, 200, 'Reporte del turno cerrado (criterio 29)');
    expect(cerrado.body.cierre).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------
// F2 · tasa de IGV cambiada mientras se cobra
// ------------------------------------------------------------------------------------------------
describe('F2 · una tasa «desde hoy» y un cobro de hoy en curso', () => {
  it('nunca dos tasas para la misma fecha de emisión del mismo emisor', async () => {
    const HOY = '2026-11-02'; // la fecha de Lima del reloj inicial de la API
    const E3 = A().emisor3!;
    const token = A().token.supervisorS4!;
    exigirEstado(
      await ponerTasa(ctx, A().token.admin!, E3, '2026-01-01', '18.00'),
      200,
      'Tasa de 18.00 del emisor E3 (criterio 6)',
    );
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, token, cajas.S4!.caja2);
    const primera = await cuentaC(ctx, A(), 'S4');
    const segunda = await cuentaC(ctx, A(), 'S4');
    const cuerpo = async (ordenId: string) =>
      cuerpoDeCobro({
        turnoId,
        version: await versionDe(ordenId),
        total: '69.20',
        pagos: [tarjeta('69.20')],
      });
    expect(
      await filas('SELECT 1 FROM comprobante WHERE emisor_id = $1', [E3]),
      'el emisor E3 no tiene comprobantes antes de la prueba',
    ).toHaveLength(0);

    // Se ensancha la ventana: un administrador bloquea la fila de la serie de boletas de la caja, de modo que el cobro
    // queda en curso (con su transacción abierta) mientras llega el `PUT` de la tasa.
    const c = await admin();
    let cobro: Promise<Res> | undefined;
    let put: Promise<Res> | undefined;
    await c.query('BEGIN');
    try {
      await c.query(
        "SELECT id FROM serie WHERE caja_id = $1 AND tipo = 'BOLETA' AND activa FOR UPDATE",
        [cajas.S4!.caja2],
      );
      const cuerpoPrimero = await cuerpo(primera.ordenId);
      // supertest es perezoso: se fuerza el envío con `then` para que no espere al `await`.
      cobro = new Promise<Res>((resolver, rechazar) => {
        cobrarCrudo(ctx, token, primera.ordenId, cuerpoPrimero).then(resolver, rechazar);
      });
      await esperar(1_500);
      put = new Promise<Res>((resolver, rechazar) => {
        ponerTasa(ctx, A().token.admin!, E3, HOY, '10.00').then(resolver, rechazar);
      });
      await esperar(1_500);
    } finally {
      await c.query('COMMIT');
    }
    const resCobro = await cobro!;
    const resPut = await put!;

    exigirEstado(resCobro, 201, 'El cobro en curso termina bien');
    expect([200, 409], `PUT de la tasa: ${resPut.status} ${resPut.text}`).toContain(resPut.status);
    // Un cobro más del mismo día, después de que todo terminó.
    const resSegundo = await cobrarCrudo(
      ctx,
      token,
      segunda.ordenId,
      await cuerpo(segunda.ordenId),
    );
    exigirEstado(resSegundo, 201, 'El cobro siguiente del mismo día');

    const comprobantes = await filas<{ fecha: string; tasa: string }>(
      'SELECT fecha_emision::text AS fecha, tasa_igv::text AS tasa FROM comprobante WHERE emisor_id = $1 ORDER BY creado_en',
      [E3],
    );
    expect(comprobantes).toHaveLength(2);
    expect(comprobantes.every((k) => k.fecha === HOY)).toBe(true);
    // Los dos comprobantes de la misma fecha de emisión llevan la misma tasa.
    expect(comprobantes[0]!.tasa).toBe(comprobantes[1]!.tasa);
    // Y es la vigente para esa fecha (la última con `desde` menor o igual).
    const tasas = await api(ctx, A().token.admin!, 'get', `/emisores/${E3}/tasas-igv`);
    exigirEstado(tasas, 200, 'Tasas del emisor (criterio 6)');
    const vigente = (tasas.body as Libre[])
      .filter((t) => (t.desde as string) <= HOY)
      .sort((a, b) => (a.desde as string).localeCompare(b.desde as string))
      .at(-1)!;
    expect(comprobantes[0]!.tasa).toBe(vigente.tasa);
    // Coherencia con el PUT: 409 deja la tasa vieja; 200 es que el cobro vio la nueva.
    if (resPut.status === 409) {
      expect(vigente.tasa).toBe('18.00');
      esperarError(resPut, 409, 'CONFLICTO');
    } else {
      expect(vigente.tasa).toBe('10.00');
    }
  });
});

// ------------------------------------------------------------------------------------------------
// F3 · reimpresión de 004 de los trabajos de caja
// ------------------------------------------------------------------------------------------------
describe('F3 · la reimpresión de 004 respeta el permiso y el alcance de caja', () => {
  let turnoId: string;
  let tokenAdmin: string;
  let trabajoX: string;
  let trabajoZ: string;
  let trabajoComprobante: string;
  let trabajoGaveta: string;

  const reimprimir = (token: string, trabajoId: string) =>
    escribir(ctx, token, 'post', `/impresion/trabajos/${trabajoId}/reimpresion`);

  /** Los trabajos de la sucursal S1 (para comprobar que un 403 o un 409 no encola nada). */
  const totalTrabajos = async () => (await trabajosDe(A().S1)).length;

  beforeAll(async () => {
    const cajas = await A().cajas();
    await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S1, 'Caja F3', { gaveta: true });
    tokenAdmin = await sesionContrasena(ctx, A().base.admin, A().S1);
    const dueno = A().token.cajero!;
    turnoId = await abrirTurno(ctx, dueno, cajas.S1!.caja1);
    const cuenta = await cuentaC(ctx, A(), 'S1');
    const cobro = await cobrar(ctx, dueno, cuenta, {
      turnoId,
      total: '69.20',
      pagos: [efectivo('69.20')],
    });
    trabajoComprobante = cobro.trabajoId as string;
    const x = await escribir(ctx, dueno, 'post', `/turnos/${turnoId}/reporte-x/impresiones`);
    exigirEstado(x, 201, 'Imprimir el X del propio turno (criterio 30)');
    trabajoX = x.body.trabajoId as string;
    const z = await cerrarTurnoCrudo(ctx, dueno, turnoId, conteo({ EFECTIVO: '269.20' }));
    exigirEstado(z, 200, 'Cerrar el turno (criterio 31)');
    trabajoZ = z.body.trabajoId as string;
    const gavetas = await trabajosDe(A().S1, 'GAVETA');
    expect(gavetas.length).toBeGreaterThan(0);
    trabajoGaveta = gavetas[0]!.id as string;
    expect(trabajoX && trabajoZ && trabajoComprobante).toBeTruthy();
  });

  const casos = (): Array<[string, () => string]> => [
    ['REPORTE_X', () => trabajoX],
    ['REPORTE_Z', () => trabajoZ],
    ['COMPROBANTE', () => trabajoComprobante],
  ];

  it.each(casos())(
    'un Mozo no reimprime un trabajo %s: 403 PROHIBIDO y no encola nada',
    async (_tipo, trabajo) => {
      const antes = await totalTrabajos();
      esperarError(await reimprimir(A().token.mozo!, trabajo()), 403, 'PROHIBIDO');
      expect(await totalTrabajos()).toBe(antes);
    },
  );

  it.each(casos())(
    'un Cajero que no es el dueño del turno no reimprime un trabajo %s: 403 PROHIBIDO y no encola nada',
    async (_tipo, trabajo) => {
      const antes = await totalTrabajos();
      esperarError(await reimprimir(A().token.cajero2!, trabajo()), 403, 'PROHIBIDO');
      expect(await totalTrabajos()).toBe(antes);
    },
  );

  it.each(casos())(
    'el Cajero dueño del turno, el Supervisor y el Administrador reimprimen un trabajo %s: 201',
    async (_tipo, trabajo) => {
      for (const [quien, token] of [
        ['Cajero dueño', A().token.cajero!],
        ['Supervisor', A().token.supervisor!],
        ['Administrador', tokenAdmin],
      ] as const) {
        const antes = await totalTrabajos();
        const res = await reimprimir(token, trabajo());
        exigirEstado(res, 201, `${quien} reimprime (criterio 90)`);
        expect(typeof res.body.trabajoId).toBe('string');
        expect(await totalTrabajos()).toBe(antes + 1);
      }
    },
  );

  it('un trabajo GAVETA no se reimprime: 409 (regresión)', async () => {
    const antes = await totalTrabajos();
    exigirEstado(
      await reimprimir(A().token.supervisor!, trabajoGaveta),
      409,
      'Reimprimir una gaveta (criterio 90)',
    );
    expect(await totalTrabajos()).toBe(antes);
  });
});
