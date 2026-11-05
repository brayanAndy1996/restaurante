// spec: 006-caja-cobro (pruebas protegidas)
//
// P2 · Cobro (ruta crítica), criterios 47 a 53 y 61 a 63:
// - 47: la forma de la entrada y de la respuesta; Mozo y Cocina/Barra reciben 403; la entrada es estricta;
// - 48: el turno debe ser ABIERTO, de la sucursal activa y de quien cobra (o cobra un Supervisor/Administrador);
// - 49: el servidor recalcula con lo guardado (un cambio de precio en la carta no cuenta) y compara `version` y `total`;
// - 50: pagos por medio, `operacion`, un solo efectivo, vuelto, redondeo exacto y la cuenta de cero con `pagos: []`;
// - 51: reglas del comprobante (factura con RUC y dirección, boleta de 700.00 y de 700.01, Nuevo RUS, sin tasa, sin serie);
// - 52 y 53: cobrar todo cierra la orden y libera la mesa; un cobro parcial no cierra ni invalida la pre-cuenta;
// - 61: orden que no se puede cobrar; 62: topes; 63: eventos solo después de confirmar.
// Las empresas se dan de alta por la API real; cajas, series y tasa por sus rutas de 6a; la carta por las rutas de 003.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { cobroRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  cobrar,
  cobrarCrudo,
  CLIENTE_DNI,
  CLIENTE_RUC,
  cobrosDeLaOrden,
  conteo,
  crearEscenario,
  cuentaC,
  cuentaCon,
  cuerpoDeCobro,
  efectivo,
  esperarError,
  escribir,
  estadoDeMesa,
  estadoDeOrden,
  eventosDe,
  exigirEstado,
  filas,
  tarjeta,
  versionDe,
  yape,
  type AppP5,
  type Escenario,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

// Un turno de trabajo del Cajero en la Caja 1 y otro del Supervisor en la Caja 3 (S1), abiertos al primer uso.
let turnoCajero: Promise<string> | undefined;
const turno = () =>
  (turnoCajero ??= (async () =>
    abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1))());
let turnoSupervisor: Promise<string> | undefined;
const turnoCaja3 = () =>
  (turnoSupervisor ??= (async () =>
    abrirTurno(ctx, A().token.supervisor!, (await A().cajas()).S1!.caja3))());
// El turno del Supervisor de S2 en su Caja 1: lo comparten las pruebas que lo necesitan (criterio 26: un turno por
// persona y por caja).
let turnoSupervisorS2: Promise<string> | undefined;
const turnoS2Caja1 = () =>
  (turnoSupervisorS2 ??= (async () =>
    abrirTurno(ctx, A().token.supervisorS2!, (await A().cajas()).S2!.caja1))());

/** Comprueba que no se guardó ningún cobro ni comprobante de la orden y que sigue como estaba. */
async function sinCobro(ordenId: string, estado = 'ABIERTA'): Promise<void> {
  expect(await cobrosDeLaOrden(ordenId)).toEqual([]);
  expect(await filas('SELECT 1 FROM comprobante WHERE orden_id = $1', [ordenId])).toEqual([]);
  expect(await estadoDeOrden(ordenId)).toBe(estado);
}

// ------------------------------------------------------------------------------------------------
describe('criterio 47 · cobrar', () => {
  it('cobra la cuenta C en efectivo con vuelto: 201 con la forma de cobroRespuesta', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '69.20',
      pagos: [efectivo('69.20', '100.00')],
    });
    cobroRespuestaSchema.parse(cobro);
    expect(cobro).toMatchObject({
      ordenId: cuenta.ordenId,
      turnoId,
      parte: { tipo: 'TOTAL' },
      total: '69.20',
      redondeo: '0.00',
      vuelto: '30.80',
      pagos: [{ medio: 'EFECTIVO', monto: '69.20', recibido: '100.00', operacion: null }],
      cuenta: { estado: 'CERRADA', saldo: '0.00' },
    });
    expect(cobro.comprobante).toMatchObject({
      tipo: 'BOLETA',
      estado: 'POR_ENVIAR',
      moneda: 'PEN',
      totales: { total: '69.20', igv: '9.94', icbper: '1.00', subtotal: '68.20' },
    });
    expect(cobro.comprobante.numero).toMatch(/^B001-\d{8}$/);
    // Sin impresora de caja ni de la sucursal el cobro se hace igual (criterio 96).
    expect(cobro).toMatchObject({ impresion: 'SIN_IMPRESORA', trabajoId: null });
  });

  it('Mozo y Cocina/Barra reciben 403 PROHIBIDO y no se cobra nada', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    for (const token of [A().token.mozo!, A().token.cocina!]) {
      const res = await cobrarCrudo(
        ctx,
        token,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId, version, total: '69.20' }),
      );
      esperarError(res, 403, 'PROHIBIDO');
    }
    await sinCobro(cuenta.ordenId);
  });

  it('la entrada es estricta: un campo desconocido o empresaId es 400 DATOS_INVALIDOS', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    for (const extra of [
      { empresaId: A().id },
      { creadoPorUsuarioId: randomUUID() },
      { otro: 1 },
    ]) {
      const cuerpo = { ...cuerpoDeCobro({ turnoId, version, total: '69.20' }), ...extra };
      esperarError(
        await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo),
        400,
        'DATOS_INVALIDOS',
      );
    }
    await sinCobro(cuenta.ordenId);
  });

  it('sin Idempotency-Key es 400 y no se cobra', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const res = await api(
      ctx,
      A().token.cajero!,
      'post',
      `/cuentas/${cuenta.ordenId}/cobros`,
      cuerpoDeCobro({ turnoId, version, total: '69.20' }),
    );
    expect(res.status).toBe(400);
    await sinCobro(cuenta.ordenId);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 48 · el turno', () => {
  it('otro Cajero no cobra en el turno ajeno: 409 TURNO_AJENO', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero2!,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version: await versionDe(cuenta.ordenId), total: '69.20' }),
    );
    esperarError(res, 409, 'TURNO_AJENO');
    await sinCobro(cuenta.ordenId);
  });

  it('un Supervisor sí cobra en el turno de un Cajero', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cobro = await cobrar(ctx, A().token.supervisor!, cuenta, {
      turnoId: await turno(),
      total: '69.20',
    });
    expect(cobro.turnoId).toBe(await turno());
    expect(cobro.cuenta.estado).toBe('CERRADA');
  });

  it('un turno cerrado responde 409 TURNO_CERRADO sin cambios', async () => {
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2);
    // El turno del Cajero sigue abierto: este no es el último y se cierra aunque haya mesas abiertas.
    await turno();
    const cierre = await cerrarTurnoCrudo(
      ctx,
      A().token.cajero2!,
      turnoId,
      conteo({ EFECTIVO: '200.00' }),
    );
    exigirEstado(cierre, 200, 'Cerrar el turno del Cajero 2 (006, criterio 31)');
    const cuenta = await cuentaC(ctx, A());
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero2!,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version: await versionDe(cuenta.ordenId), total: '69.20' }),
    );
    esperarError(res, 409, 'TURNO_CERRADO');
    await sinCobro(cuenta.ordenId);
  });

  it('un turno de otra sucursal, de B o inexistente responde 404', async () => {
    const cajasB = await esc.B.cajas();
    const turnoS2 = await turnoS2Caja1();
    const turnoB = await abrirTurno(ctx, esc.B.token.cajero!, cajasB.S1!.caja1);
    const cuenta = await cuentaC(ctx, A());
    const version = await versionDe(cuenta.ordenId);
    for (const turnoId of [turnoS2, turnoB, randomUUID()]) {
      const res = await cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId, version, total: '69.20' }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
    await sinCobro(cuenta.ordenId);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 49 · el servidor recalcula', () => {
  it('un cambio de precio en la carta después del envío no cambia lo que se cobra', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['tostada', 1],
      ['lomo', 1],
    ]);
    const patch = (precio: string) =>
      api(ctx, A().token.admin, 'patch', `/carta/productos/${A().carta.tostada}`, { precio });
    exigirEstado(await patch('6.00'), 200, 'Cambiar el precio de la Tostada (003)');
    try {
      const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
        turnoId: await turno(),
        total: '33.34',
        pagos: [efectivo('33.30', '50.00')],
        redondeo: '0.04',
      });
      expect(cobro).toMatchObject({ total: '33.34', redondeo: '0.04', vuelto: '16.70' });
    } finally {
      exigirEstado(await patch('5.34'), 200, 'Restaurar el precio de la Tostada');
    }
  });

  it('una version que no es la de la cuenta responde 409 CUENTA_CAMBIO con la version actual', async () => {
    const cuenta = await cuentaC(ctx, A());
    const version = await versionDe(cuenta.ordenId);
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId: await turno(), version: version + 3, total: '69.20' }),
    );
    esperarError(res, 409, 'CUENTA_CAMBIO');
    expect(res.body.version).toBe(version);
    await sinCobro(cuenta.ordenId);
  });

  it('un total que no es el calculado responde 409 CUENTA_CAMBIO y no se cobra', async () => {
    const cuenta = await cuentaC(ctx, A());
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId: await turno(),
        version: await versionDe(cuenta.ordenId),
        total: '69.10',
      }),
    );
    esperarError(res, 409, 'CUENTA_CAMBIO');
    await sinCobro(cuenta.ordenId);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 50 · pagos', () => {
  it('varios medios sin efectivo: tarjeta, Yape y Plin con su operación, sin vuelto', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '69.20',
      pagos: [
        { medio: 'TARJETA_DEBITO', monto: '29.20', operacion: 'VCH-77' },
        { medio: 'PLIN', monto: '20.00', operacion: 'PLN-1' },
        yape('20.00', 'YPE-2'),
      ],
    });
    expect(cobro.vuelto).toBe('0.00');
    expect(cobro.redondeo).toBe('0.00');
    expect(cobro.pagos).toHaveLength(3);
    expect(cobro.pagos.map((p: { medio: string }) => p.medio).sort()).toEqual([
      'PLIN',
      'TARJETA_DEBITO',
      'YAPE',
    ]);
    expect(cobro.pagos.find((p: { medio: string }) => p.medio === 'YAPE')).toMatchObject({
      operacion: 'YPE-2',
      recibido: null,
    });
  });

  it('el efectivo se redondea hacia abajo a la décima a favor del cliente: 33.34 → 33.30, vuelto 16.70', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['tostada', 1],
      ['lomo', 1],
    ]);
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '33.34',
      pagos: [efectivo('33.30', '50.00')],
      redondeo: '0.04',
    });
    expect(cobro).toMatchObject({ total: '33.34', redondeo: '0.04', vuelto: '16.70' });
    expect(cobro.comprobante.totales.total).toBe('33.34');
  });

  it('el redondeo solo toca el efectivo: Yape 20.00 y efectivo 13.30 con redondeo 0.04', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['tostada', 1],
      ['lomo', 1],
    ]);
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '33.34',
      pagos: [yape('20.00'), efectivo('13.30')],
      redondeo: '0.04',
    });
    expect(cobro).toMatchObject({ redondeo: '0.04', vuelto: '0.00' });
  });

  it('los pagos que no cuadran responden 422 PAGOS_NO_CUADRAN y no se cobra', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const casos: Array<[string, Parameters<typeof cuerpoDeCobro>[0]]> = [
      ['un céntimo menos', { turnoId, version, total: '69.20', pagos: [efectivo('69.19')] }],
      ['un céntimo más', { turnoId, version, total: '69.20', pagos: [efectivo('69.21')] }],
      [
        'redondeo inventado',
        { turnoId, version, total: '69.20', pagos: [efectivo('69.16')], redondeo: '0.04' },
      ],
      [
        'dos efectivos',
        { turnoId, version, total: '69.20', pagos: [efectivo('30.00'), efectivo('39.20')] },
      ],
      [
        'recibido menor que el monto',
        { turnoId, version, total: '69.20', pagos: [efectivo('69.20', '50.00')] },
      ],
      ['sin ningún pago', { turnoId, version, total: '69.20', pagos: [] }],
      [
        'redondeo sin efectivo',
        { turnoId, version, total: '69.20', pagos: [yape('69.16')], redondeo: '0.04' },
      ],
    ];
    for (const [que, o] of casos) {
      const res = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpoDeCobro(o));
      expect(res.status, `${que}: ${res.text}`).toBe(422);
      expect(res.body.codigo, que).toBe('PAGOS_NO_CUADRAN');
    }
    await sinCobro(cuenta.ordenId);
  });

  it('la operación es obligatoria fuera del efectivo y prohibida en el efectivo: 400 con campos', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const casos: Array<Parameters<typeof cuerpoDeCobro>[0]> = [
      { turnoId, version, total: '69.20', pagos: [{ medio: 'YAPE', monto: '69.20' }] },
      { turnoId, version, total: '69.20', pagos: [{ medio: 'TARJETA_CREDITO', monto: '69.20' }] },
      { turnoId, version, total: '69.20', pagos: [{ ...efectivo('69.20'), operacion: 'OP-1' }] },
      {
        turnoId,
        version,
        total: '69.20',
        pagos: [{ medio: 'YAPE', monto: '69.20', operacion: 'con espacio' }],
      },
      {
        turnoId,
        version,
        total: '69.20',
        pagos: [{ medio: 'YAPE', monto: '69.20', operacion: 'A'.repeat(31) }],
      },
    ];
    for (const o of casos) {
      const res = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpoDeCobro(o));
      expect(res.status, res.text).toBe(400);
      expect(res.body.codigo).toBe('DATOS_INVALIDOS');
      expect(res.body.campos).toBeDefined();
    }
    await sinCobro(cuenta.ordenId);
  });

  it('una cuenta toda en cortesía se cobra con pagos [] y sale una boleta de 0.00 con operaciones gratuitas', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['gaseosa', 1]]);
    const c = await api(
      ctx,
      A().token.supervisor!,
      'post',
      `/cuentas/${cuenta.ordenId}/cortesias`,
      {
        id: randomUUID(),
        itemId: cuenta.item.gaseosa,
        cantidad: 1,
        motivo: 'Atención de la casa',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    exigirEstado(c, 201, 'Cortesía de la Gaseosa (006, criterio 43)');
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '0.00',
      pagos: [],
    });
    expect(cobro).toMatchObject({ total: '0.00', pagos: [], vuelto: '0.00', redondeo: '0.00' });
    expect(cobro.comprobante.totales).toMatchObject({
      total: '0.00',
      operaciones: { gratuitas: '7.63' },
      igvGratuitas: '1.37',
    });
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 51 · el comprobante', () => {
  it('una factura exige cliente con RUC y dirección: 422 CLIENTE_REQUERIDO', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const sinRuc = [undefined, CLIENTE_DNI, { ...CLIENTE_RUC, direccion: undefined }];
    for (const cliente of sinRuc) {
      const cuerpo = cuerpoDeCobro({
        turnoId,
        version,
        total: '69.20',
        tipo: 'FACTURA',
        ...(cliente ? { cliente: JSON.parse(JSON.stringify(cliente)) } : {}),
      });
      esperarError(
        await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo),
        422,
        'CLIENTE_REQUERIDO',
      );
    }
    await sinCobro(cuenta.ordenId);
  });

  it('una factura con RUC y dirección sale con la serie F001 y guarda al cliente', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '69.20',
      tipo: 'FACTURA',
      cliente: CLIENTE_RUC,
    });
    expect(cobro.comprobante.numero).toMatch(/^F001-\d{8}$/);
    expect(cobro.comprobante).toMatchObject({
      tipo: 'FACTURA',
      cliente: { tipoDocumento: 'RUC', numero: CLIENTE_RUC.numero, nombre: CLIENTE_RUC.nombre },
    });
  });

  it('una boleta de 700.00 exactos no exige documento; una de 700.01 sí', async () => {
    const turnoId = await turno();
    const exacta = await cuentaCon(ctx, A(), 'S1', [['lomo', 25]]);
    const cobro = await cobrar(ctx, A().token.cajero!, exacta, {
      turnoId,
      total: '700.00',
      pagos: [yape('700.00')],
    });
    expect(cobro.comprobante.totales.total).toBe('700.00');

    const pasada = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 25],
      ['dulce', 1],
    ]);
    const version = await versionDe(pasada.ordenId);
    const sin = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      pasada.ordenId,
      cuerpoDeCobro({ turnoId, version, total: '700.01', pagos: [yape('700.01')] }),
    );
    esperarError(sin, 422, 'CLIENTE_REQUERIDO');
    await sinCobro(pasada.ordenId);
    const con = await cobrar(ctx, A().token.cajero!, pasada, {
      turnoId,
      total: '700.01',
      pagos: [yape('700.01')],
      cliente: CLIENTE_DNI,
    });
    expect(con.comprobante.cliente).toMatchObject({
      tipoDocumento: 'DNI',
      numero: CLIENTE_DNI.numero,
    });
  });

  it('un emisor Nuevo RUS solo emite boletas y sin IGV (el ICBPER se suma igual)', async () => {
    const turnoId = await turnoS2Caja1();
    const cuenta = await cuentaC(ctx, A(), 'S2');
    const factura = await cobrarCrudo(
      ctx,
      A().token.supervisorS2!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId,
        version: await versionDe(cuenta.ordenId),
        total: '69.20',
        tipo: 'FACTURA',
        cliente: CLIENTE_RUC,
      }),
    );
    esperarError(factura, 422, 'COMPROBANTE_NO_PERMITIDO');
    await sinCobro(cuenta.ordenId);
    const cobro = await cobrar(ctx, A().token.supervisorS2!, cuenta, { turnoId, total: '69.20' });
    expect(cobro.comprobante).toMatchObject({ tipo: 'BOLETA', tasaIgv: null });
    expect(cobro.comprobante.totales).toMatchObject({
      total: '69.20',
      igv: '0.00',
      operaciones: null,
    });
  });

  it('un emisor sin tasa de IGV vigente responde 409 TASA_IGV_NO_CONFIGURADA', async () => {
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, A().token.supervisorS4!, cajas.S4!.caja1);
    const cuenta = await cuentaC(ctx, A(), 'S4');
    const res = await cobrarCrudo(
      ctx,
      A().token.supervisorS4!,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version: await versionDe(cuenta.ordenId), total: '69.20' }),
    );
    esperarError(res, 409, 'TASA_IGV_NO_CONFIGURADA');
    await sinCobro(cuenta.ordenId);
  });

  it('una caja sin serie activa del tipo responde 409 SIN_SERIE y no consume número', async () => {
    const cajas = await A().cajas();
    const turnoId = await turnoCaja3(); // la Caja 3 solo tiene serie de boletas
    const cuenta = await cuentaC(ctx, A());
    const res = await cobrarCrudo(
      ctx,
      A().token.supervisor!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId,
        version: await versionDe(cuenta.ordenId),
        total: '69.20',
        tipo: 'FACTURA',
        cliente: CLIENTE_RUC,
      }),
    );
    esperarError(res, 409, 'SIN_SERIE');
    await sinCobro(cuenta.ordenId);
    expect(
      await filas('SELECT 1 FROM serie WHERE caja_id = $1 AND tipo = $2', [
        cajas.S1!.caja3,
        'FACTURA',
      ]),
    ).toEqual([]);
  });

  it('en partes iguales solo vale el formato CONSUMO: DETALLADO es 422 COMPROBANTE_NO_PERMITIDO', async () => {
    const cuenta = await cuentaC(ctx, A());
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId: await turno(),
        version: await versionDe(cuenta.ordenId),
        total: '34.60',
        parte: { tipo: 'IGUALES', partesRestantes: 2 },
        formato: 'DETALLADO',
        pagos: [efectivo('34.60')],
      }),
    );
    esperarError(res, 422, 'COMPROBANTE_NO_PERMITIDO');
    await sinCobro(cuenta.ordenId);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterios 52 y 53 · cerrar la cuenta y cobrar una parte', () => {
  it('cobrar todo cierra la orden, cierra sus relaciones con las mesas y deja la mesa en verde', async () => {
    const cuenta = await cuentaC(ctx, A());
    expect(await estadoDeMesa(ctx, A().token.mozo!, cuenta.mesaId)).toBe('OCUPADA');
    const antes = await versionDe(cuenta.ordenId);
    await cobrar(ctx, A().token.cajero!, cuenta, { turnoId: await turno(), total: '69.20' });
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('CERRADA');
    const [orden] = await filas('SELECT cerrada_en, version FROM orden WHERE id = $1', [
      cuenta.ordenId,
    ]);
    expect(orden!.cerrada_en).not.toBeNull();
    expect(Number(orden!.version)).toBeGreaterThan(antes);
    expect(
      await filas('SELECT 1 FROM orden_mesa WHERE orden_id = $1 AND hasta IS NULL', [
        cuenta.ordenId,
      ]),
    ).toEqual([]);
    expect(await estadoDeMesa(ctx, A().token.mozo!, cuenta.mesaId)).toBe('LIBRE');
  });

  it('un cobro parcial no cierra la orden, sube la versión y la mesa sigue ocupada', async () => {
    const cuenta = await cuentaC(ctx, A());
    const antes = await versionDe(cuenta.ordenId);
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '37.00',
      parte: {
        tipo: 'ITEMS',
        items: [
          { itemId: cuenta.item.lomo!, cantidad: 1 },
          { itemId: cuenta.item.gaseosa!, cantidad: 1 },
        ],
      },
    });
    expect(cobro.cuenta).toMatchObject({ estado: 'ABIERTA', saldo: '32.20' });
    expect(cobro.cuenta.version).toBeGreaterThan(antes);
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
    expect(await estadoDeMesa(ctx, A().token.mozo!, cuenta.mesaId)).toBe('OCUPADA');
  });

  it('un cobro parcial de una cuenta con pre-cuenta no la invalida', async () => {
    const cuenta = await cuentaC(ctx, A());
    const pre = await escribir(
      ctx,
      A().token.mozo!,
      'post',
      `/ordenes/${cuenta.ordenId}/precuentas`,
      {
        id: randomUUID(),
      },
    );
    exigirEstado(pre, 201, 'Pedir la pre-cuenta (004)');
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('EN_PRECUENTA');
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '37.00',
      parte: {
        tipo: 'ITEMS',
        items: [
          { itemId: cuenta.item.lomo!, cantidad: 1 },
          { itemId: cuenta.item.gaseosa!, cantidad: 1 },
        ],
      },
    });
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('EN_PRECUENTA');
    const vigentes = await filas('SELECT invalidada_en FROM precuenta WHERE orden_id = $1', [
      cuenta.ordenId,
    ]);
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0]!.invalidada_en).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 61 · una orden que no se puede cobrar', () => {
  it('una orden CERRADA responde 409 ORDEN_NO_ABIERTA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    await cobrar(ctx, A().token.cajero!, cuenta, { turnoId, total: '69.20' });
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version: await versionDe(cuenta.ordenId), total: '69.20' }),
    );
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
  });

  it('una orden ANULADA responde 409 ORDEN_NO_ABIERTA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const anular = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/ordenes/${cuenta.ordenId}/anulacion`,
      {
        motivo: 'Se fue el cliente',
        destinoStock: 'VUELVE',
      },
    );
    exigirEstado(anular, 200, 'Anular la orden (004)');
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId: await turno(),
        version: await versionDe(cuenta.ordenId),
        total: '69.20',
      }),
    );
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    await sinCobro(cuenta.ordenId, 'ANULADA');
  });

  it('una orden UNIDA responde 409 ORDEN_NO_ABIERTA con el ordenId de la principal', async () => {
    const principal = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const absorbida = await cuentaCon(ctx, A(), 'S1', [['gaseosa', 1]]);
    const unir = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/ordenes/${principal.ordenId}/union`,
      {
        mesaIds: [absorbida.mesaId],
      },
    );
    exigirEstado(unir, 200, 'Unir las mesas (004)');
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      absorbida.ordenId,
      cuerpoDeCobro({
        turnoId: await turno(),
        version: await versionDe(absorbida.ordenId),
        total: '9.00',
      }),
    );
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(principal.ordenId);
    expect(await cobrosDeLaOrden(absorbida.ordenId)).toEqual([]);
  });

  it('una orden de otra sucursal o de B responde 404', async () => {
    const deS2 = await cuentaC(ctx, A(), 'S2');
    const deB = await cuentaC(ctx, esc.B, 'S1');
    for (const ordenId of [deS2.ordenId, deB.ordenId]) {
      const res = await cobrarCrudo(
        ctx,
        A().token.cajero!,
        ordenId,
        cuerpoDeCobro({
          turnoId: await turno(),
          version: await versionDe(ordenId),
          total: '69.20',
        }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await cobrosDeLaOrden(ordenId)).toEqual([]);
    }
  });

  it('una orden sin ítems vigentes responde 409 NADA_QUE_COBRAR', async () => {
    const vacia = await cuentaCon(ctx, A(), 'S1', []);
    const res = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      vacia.ordenId,
      cuerpoDeCobro({
        turnoId: await turno(),
        version: await versionDe(vacia.ordenId),
        total: '0.00',
        pagos: [],
      }),
    );
    esperarError(res, 409, 'NADA_QUE_COBRAR');
    await sinCobro(vacia.ordenId);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 62 · topes', () => {
  it('un total, un pago o un recibido que pase de 99999999.99 es 422 MONTO_FUERA_DE_RANGO', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const casos: Array<Parameters<typeof cuerpoDeCobro>[0]> = [
      { turnoId, version, total: '100000000.00', pagos: [yape('100000000.00')] },
      { turnoId, version, total: '69.20', pagos: [yape('100000000.00')] },
      { turnoId, version, total: '69.20', pagos: [efectivo('69.20', '100000000.00')] },
    ];
    for (const o of casos) {
      const res = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpoDeCobro(o));
      esperarError(res, 422, 'MONTO_FUERA_DE_RANGO');
    }
    await sinCobro(cuenta.ordenId);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 63 · eventos', () => {
  it('un cobro publica orden.cambio, turno.cambio y salon.cambio solo después de confirmar', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    ctx.publicador.limpiar();
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, { turnoId, total: '69.20' });
    const vistos = ctx.publicador.eventos();
    for (const nombre of ['orden.cambio', 'turno.cambio', 'salon.cambio']) {
      const ev = vistos.filter((x) => x.nombre === nombre);
      expect(ev.length, nombre).toBeGreaterThan(0);
      for (const e of ev) {
        expect(e.empresaId).toBe(A().id);
        expect(e.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
      }
    }
    expect(eventosDe(ctx, 'turno.cambio')[0]!.datos).toMatchObject({ turnoId });
    expect(eventosDe(ctx, 'orden.cambio')[0]!.datos).toMatchObject({ ordenId: cuenta.ordenId });
    expect(cobro.cuenta.estado).toBe('CERRADA');
  });

  it('una réplica con la misma clave y un rechazo no publican nada', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '69.20',
    });
    const clave = randomUUID();
    exigirEstado(
      await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo, clave),
      201,
      'Cobrar',
    );
    ctx.publicador.limpiar();
    const replica = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo, clave);
    expect(replica.status).toBe(201);
    const rechazo = await cobrarCrudo(
      ctx,
      A().token.cajero2!,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version: 1, total: '69.20' }),
    );
    expect(rechazo.status).toBeGreaterThanOrEqual(400);
    expect(ctx.publicador.eventos()).toEqual([]);
    // Un cierre sin efecto de la caja tampoco: la lista de turnos no cambió.
    expect(
      await filas('SELECT 1 FROM comprobante WHERE orden_id = $1', [cuenta.ordenId]),
    ).toHaveLength(1);
    void tarjeta;
  });
});
