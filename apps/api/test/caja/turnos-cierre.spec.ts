// Historia 006 · caja, cobro y comprobantes, grupo C2 (T9) · pruebas del desarrollador (no protegidas) del turno: lo que
// las protegidas de `caja-critica/turno.spec.ts` y `cierre.spec.ts` no pueden ejercitar todavía porque arman sus turnos
// con cobros (grupo C4). Aquí el reporte X suma los comprobantes que emite `EmisionService` directamente y el cierre
// trabaja con movimientos: el arqueo a ciegas, el motivo de cada diferencia, el conteo guardado, la auditoría, el evento,
// la réplica con la misma clave y quién cierra. Las pruebas protegidas ponen en verde el resto cuando exista el cobro.
import { randomUUID } from 'node:crypto';
import { reporteCajaSchema, turnoRespuestaSchema } from '@restaurante/contratos';
import {
  calcularParte,
  type CuentaEntrada,
  type FormatoComprobante,
  type ParteCalculada,
} from '@restaurante/dominio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { EmisionService, type DatosDeEmision } from '../../src/modulos/facturacion';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { filasAuditoria } from '../acceso/fabrica-equipos';
import { enTransaccion } from '../aislamiento/fabrica';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  conteo,
  crearEscenario,
  cuentaC,
  escribir,
  esperarError,
  eventosDe,
  exigirEstado,
  filas,
  MEDIOS,
  type AppP5,
  type Cuenta,
  type Escenario,
} from '../caja-critica/fabrica-caja';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
let cuenta: Cuenta;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 8 });
  esc = await crearEscenario(ctx);
  await A().cajas();
  cuenta = await cuentaC(ctx, A(), 'S1');
  // La cuenta solo presta sus ítems a los comprobantes: se anula para que no bloquee el cierre del último turno.
  exigirEstado(
    await escribir(ctx, A().token.supervisor!, 'post', `/ordenes/${cuenta.ordenId}/anulacion`, {
      motivo: 'Solo se usan sus ítems',
      destinoStock: 'VUELVE',
    }),
    200,
    'Anular la cuenta de apoyo (004)',
  );
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

const movimiento = (
  token: string,
  turnoId: string,
  tipo: 'INGRESO' | 'EGRESO',
  monto: string,
  motivo = 'Prueba',
) =>
  escribir(ctx, token, 'post', `/turnos/${turnoId}/movimientos`, {
    id: randomUUID(),
    tipo,
    monto,
    motivo,
  });

/** Cierra con el efectivo contado y los demás medios en cero; con `motivos` para toda diferencia. */
const cerrar = (token: string, turnoId: string, contado: Record<string, string>, clave?: string) =>
  cerrarTurnoCrudo(
    ctx,
    token,
    turnoId,
    conteo(contado, Object.fromEntries(MEDIOS.map((m) => [m, 'Se contó distinto']))),
    clave,
  );

// ------------------------------------------------------------------------------------------------
// Emisión directa: un comprobante en un turno real (el cobro llega en C4)
// ------------------------------------------------------------------------------------------------

const entradaC = (cantidadCortesiaGaseosa = 0): CuentaEntrada => {
  const base = {
    afectacion: 'GRAVADO' as const,
    cantidadCortesia: 0,
    aplicaIcbper: false,
    descuento: null,
  };
  return {
    lineas: [
      { ...base, itemId: cuenta.item.lomo!, precioUnitario: '28.00', cantidad: 2 },
      {
        ...base,
        itemId: cuenta.item.gaseosa!,
        precioUnitario: '9.00',
        cantidad: 1,
        cantidadCortesia: cantidadCortesiaGaseosa,
      },
      {
        ...base,
        itemId: cuenta.item.bolsa!,
        precioUnitario: '0.10',
        cantidad: 2,
        aplicaIcbper: true,
      },
      {
        ...base,
        itemId: cuenta.item.mandarina!,
        precioUnitario: '3.00',
        cantidad: 1,
        afectacion: 'EXONERADO',
      },
    ],
    descuentoCuenta: null,
    tasaIgv: '18.00',
    montoIcbper: '0.50',
  };
};

let partes = 0;
async function emitirEn(turnoId: string, cajaId: string, cortesias = 0): Promise<void> {
  const r = calcularParte(entradaC(cortesias), [], { tipo: 'TOTAL' }, 'DETALLADO');
  if (!r.valida) throw new Error(r.codigo);
  const { valida: _valida, ...parte } = r;
  const formato: FormatoComprobante = 'DETALLADO';
  const datos: DatosDeEmision = {
    sucursalId: A().S1,
    cajaId,
    turnoId,
    turnoResponsableId: A().personas.cajero!.id,
    cobroId: randomUUID(),
    numeroParte: ++partes,
    impresora: null,
    tipo: 'BOLETA',
    formato,
    cliente: null,
    parte: parte as ParteCalculada,
    tasaIgv: '18.00',
    descripciones: new Map([
      [cuenta.item.lomo!, 'Lomo saltado [3/4]'],
      [cuenta.item.gaseosa!, 'Gaseosa 1 L'],
      [cuenta.item.bolsa!, 'Bolsa plástica'],
      [cuenta.item.mandarina!, 'Mandarina'],
    ]),
    orden: { id: cuenta.ordenId, mesas: ['Mesa'], mozo: null, numeroLlamado: null },
    pagos: [],
    redondeo: '0.00',
    vuelto: '0.00',
    instante: ctx.reloj.ahora(),
  };
  await ctx.app
    .get(ContextoEmpresa)
    .ejecutar(A().id, () => ctx.app.get(EmisionService).emitir(datos), {
      actor: { sistema: 'prueba' },
    });
}

// ------------------------------------------------------------------------------------------------
describe('criterio 29 · reporte X con comprobantes', () => {
  it('suma los comprobantes del turno (total, tipos, IGV, ICBPER, cortesías) y los movimientos; el esperado en efectivo es fondo + ingresos − egresos', async () => {
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1, '200.00');
    await emitirEn(turnoId, cajas.S1!.caja1);
    await emitirEn(turnoId, cajas.S1!.caja1, 1);
    exigirEstado(await movimiento(A().token.cajero!, turnoId, 'INGRESO', '20.00'), 201, 'Ingreso');
    ctx.reloj.avanzar(60_000);
    exigirEstado(await movimiento(A().token.cajero!, turnoId, 'EGRESO', '15.50'), 201, 'Egreso');
    const res = await api(ctx, A().token.cajero, 'get', `/turnos/${turnoId}/reporte`);
    exigirEstado(res, 200, 'X');
    const x = reporteCajaSchema.parse(res.body);
    expect(x.ventas).toMatchObject({
      total: '129.40',
      cantidad: 2,
      porTipo: [{ tipo: 'BOLETA', cantidad: 2, total: '129.40' }],
      descuentos: '0.00',
      cortesias: '9.00',
      igv: '18.51',
      icbper: '2.00',
      redondeos: '0.00',
      vueltos: '0.00',
    });
    expect(x.movimientos).toMatchObject({ ingresos: '20.00', egresos: '15.50' });
    expect(x.movimientos.lista.map((m) => [m.tipo, m.monto, m.creadoPor?.nombre])).toEqual([
      ['INGRESO', '20.00', expect.any(String)],
      ['EGRESO', '15.50', expect.any(String)],
    ]);
    expect(x.esperado).toEqual([
      { medio: 'EFECTIVO', monto: '204.50' },
      { medio: 'TARJETA_CREDITO', monto: '0.00' },
      { medio: 'TARJETA_DEBITO', monto: '0.00' },
      { medio: 'YAPE', monto: '0.00' },
      { medio: 'PLIN', monto: '0.00' },
    ]);
    expect(x.turno).toMatchObject({ id: turnoId, estado: 'ABIERTO' });
    expect(x.cierre).toBeUndefined();
    // Los comprobantes de otro turno no entran.
    const otro = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2, '10.00');
    const vacio = reporteCajaSchema.parse(
      (await api(ctx, A().token.cajero2, 'get', `/turnos/${otro}/reporte`)).body,
    );
    expect(vacio.ventas).toMatchObject({ total: '0.00', cantidad: 0, porTipo: [] });
    exigirEstado(await cerrar(A().token.cajero2!, otro, { EFECTIVO: '10.00' }), 200, 'Cerrar');
    exigirEstado(await cerrar(A().token.cajero!, turnoId, { EFECTIVO: '204.50' }), 200, 'Cerrar');
  });
});

describe('criterio 28 · réplica de un movimiento y dueño del turno (M11)', () => {
  it('otro Cajero que repite el id de un movimiento ajeno recibe 409 TURNO_AJENO; el Supervisor recibe lo guardado', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1, '10.00');
    const cuerpo = { id: randomUUID(), tipo: 'INGRESO', monto: '5.00', motivo: 'Prueba' };
    const ruta = `/turnos/${t}/movimientos`;
    const hecho = await escribir(ctx, A().token.cajero!, 'post', ruta, cuerpo);
    exigirEstado(hecho, 201, 'Ingreso');
    esperarError(await escribir(ctx, A().token.cajero2!, 'post', ruta, cuerpo), 409, 'TURNO_AJENO');
    const replica = await escribir(ctx, A().token.supervisor!, 'post', ruta, cuerpo);
    exigirEstado(replica, 201, 'Réplica del Supervisor');
    expect(replica.body).toEqual(hecho.body);
    exigirEstado(await cerrar(A().token.cajero!, t, { EFECTIVO: '15.00' }), 200, 'Cerrar');
  });
});

describe('criterio 29 · el reporte X sale de una sola instantánea (M10)', () => {
  it('con un cobro en curso (el turno tomado con FOR SHARE) el reporte espera a que termine y lee después de él', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja2, '10.00');
    const cliente = await abrirCliente('api');
    try {
      let terminado = false;
      let reporte: ReturnType<typeof api> | undefined;
      await enTransaccion(cliente, A().id, async () => {
        await cliente.query('SELECT id FROM turno WHERE id = $1 FOR SHARE', [t]);
        reporte = api(ctx, A().token.cajero, 'get', `/turnos/${t}/reporte`);
        void reporte.then(() => {
          terminado = true;
        });
        await new Promise((resolver) => setTimeout(resolver, 800));
        expect(terminado).toBe(false);
      });
      const res = await reporte!;
      exigirEstado(res, 200, 'El reporte después del cobro en curso');
      expect(terminado).toBe(true);
    } finally {
      await cliente.end();
    }
    exigirEstado(await cerrar(A().token.cajero!, t, { EFECTIVO: '10.00' }), 200, 'Cerrar');
  });
});

describe('criterios 31 a 35 · cierre con movimientos', () => {
  it('arqueo a ciegas: sin motivo es 422 con solo los medios que no cuadran y sin ningún monto; con motivo cierra y guarda el conteo', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1, '100.00');
    exigirEstado(await movimiento(A().token.cajero!, t, 'INGRESO', '20.00'), 201, 'Ingreso');
    // Esperado: 120.00 en efectivo. Se cuentan 118.50 y S/ 5.00 de Yape que no se esperaban.
    const sinMotivo = await cerrarTurnoCrudo(
      ctx,
      A().token.cajero!,
      t,
      conteo({ EFECTIVO: '118.50', YAPE: '5.00' }),
    );
    esperarError(sinMotivo, 422, 'DIFERENCIA_SIN_MOTIVO');
    // Solo los medios que no cuadran, en el orden de MEDIOS_PAGO y sin ningún monto.
    expect(sinMotivo.body.diferencias).toEqual([{ medio: 'EFECTIVO' }, { medio: 'YAPE' }]);
    expect(sinMotivo.text).not.toMatch(/118\.50|-1\.50|5\.00/);
    expect(sinMotivo.body.campos.map((c: { campo: string }) => c.campo)).toEqual([
      'conteo.0.motivo',
      'conteo.3.motivo',
    ]);
    expect(sinMotivo.text).not.toMatch(/esperado|120\.00/i);
    expect((await filas('SELECT estado FROM turno WHERE id = $1', [t]))[0]!.estado).toBe('ABIERTO');

    // Solo el motivo de una de las dos: sigue siendo 422 y señala la que falta.
    const faltaUno = await cerrarTurnoCrudo(
      ctx,
      A().token.cajero!,
      t,
      conteo({ EFECTIVO: '118.50', YAPE: '5.00' }, { EFECTIVO: 'Faltó sencillo' }),
    );
    esperarError(faltaUno, 422, 'DIFERENCIA_SIN_MOTIVO');
    expect(faltaUno.body.campos.map((c: { campo: string }) => c.campo)).toEqual([
      'conteo.3.motivo',
    ]);

    const clave = randomUUID();
    ctx.publicador.limpiar();
    const cuerpo = conteo(
      { EFECTIVO: '118.50', YAPE: '5.00', PLIN: '0' },
      { EFECTIVO: 'Faltó sencillo', YAPE: 'Pagó de más', PLIN: 'se ignora' },
    );
    const res = await cerrarTurnoCrudo(ctx, A().token.cajero!, t, cuerpo, clave);
    exigirEstado(res, 200, 'Cerrar');
    const z = reporteCajaSchema.parse(res.body);
    expect(z.turno).toMatchObject({
      estado: 'CERRADO',
      cerradoPor: { id: A().personas.cajero!.id },
    });
    expect(z.cierre!.conteo).toEqual([
      {
        medio: 'EFECTIVO',
        esperado: '120.00',
        contado: '118.50',
        diferencia: '-1.50',
        motivo: 'Faltó sencillo',
      },
      {
        medio: 'TARJETA_CREDITO',
        esperado: '0.00',
        contado: '0.00',
        diferencia: '0.00',
        motivo: null,
      },
      {
        medio: 'TARJETA_DEBITO',
        esperado: '0.00',
        contado: '0.00',
        diferencia: '0.00',
        motivo: null,
      },
      {
        medio: 'YAPE',
        esperado: '0.00',
        contado: '5.00',
        diferencia: '5.00',
        motivo: 'Pagó de más',
      },
      { medio: 'PLIN', esperado: '0.00', contado: '0.00', diferencia: '0.00', motivo: null },
    ]);
    expect(await filas('SELECT 1 FROM turno_conteo WHERE turno_id = $1', [t])).toHaveLength(5);
    // La réplica con la misma clave devuelve lo guardado y no publica ni audita otra vez.
    const replica = await cerrarTurnoCrudo(ctx, A().token.cajero!, t, cuerpo, clave);
    expect(replica.status).toBe(200);
    expect(replica.body).toEqual(res.body);
    expect(eventosDe(ctx, 'turno.cambio')).toHaveLength(1);
    expect(eventosDe(ctx, 'turno.cambio')[0]!.datos).toEqual({
      turnoId: t,
      cajaId: cajas.S1!.caja1,
    });
    const auditoria = (await filasAuditoria(A().id, 'cerrar_turno')).filter((f) =>
      f.texto.includes(t),
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]!.texto).toContain('Faltó sencillo');
    expect(auditoria[0]!.texto).toContain('Pagó de más');
    // Otra clave: la Z es definitiva.
    esperarError(await cerrar(A().token.cajero!, t, { EFECTIVO: '120.00' }), 409, 'TURNO_CERRADO');
    // El X del turno cerrado trae el cierre.
    const x = reporteCajaSchema.parse(
      (await api(ctx, A().token.supervisor, 'get', `/turnos/${t}/reporte`)).body,
    );
    expect(x.cierre!.conteo[0]).toMatchObject({ medio: 'EFECTIVO', diferencia: '-1.50' });
    expect(x.turno.cerradoEn).toBe(z.cierre!.cerradoEn);
  });

  it('un egreso mayor que el efectivo deja el esperado negativo y el cierre lo muestra como diferencia', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2, '50.00');
    exigirEstado(await movimiento(A().token.cajero2!, t, 'EGRESO', '70.00'), 201, 'Egreso mayor');
    const x = reporteCajaSchema.parse(
      (await api(ctx, A().token.cajero2, 'get', `/turnos/${t}/reporte`)).body,
    );
    expect(x.esperado[0]).toEqual({ medio: 'EFECTIVO', monto: '-20.00' });
    const z = await cerrar(A().token.cajero2!, t, { EFECTIVO: '0.00' });
    exigirEstado(z, 200, 'Cerrar');
    expect(z.body.cierre.conteo[0]).toMatchObject({
      esperado: '-20.00',
      contado: '0.00',
      diferencia: '20.00',
    });
  });

  it('el Supervisor cierra el turno de un Cajero (cerradoPor es el Supervisor); otro Cajero recibe 409 TURNO_AJENO', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2, '10.00');
    esperarError(await cerrar(A().token.cajero!, t, { EFECTIVO: '10.00' }), 409, 'TURNO_AJENO');
    const res = await cerrar(A().token.supervisor!, t, { EFECTIVO: '10.00' });
    exigirEstado(res, 200, 'El Supervisor cierra');
    expect(res.body.turno.cerradoPor.id).toBe(A().personas.supervisor!.id);
    expect(res.body.turno.responsable.id).toBe(A().personas.cajero2!.id);
  });

  it('el conteo debe traer los cinco medios una vez cada uno y montos válidos (400)', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1, '10.00');
    const casos: unknown[] = [
      { conteo: [] },
      { conteo: MEDIOS.slice(0, 4).map((medio) => ({ medio, contado: '0.00' })) },
      { conteo: MEDIOS.map(() => ({ medio: 'EFECTIVO', contado: '0.00' })) },
      { conteo: MEDIOS.map((medio) => ({ medio, contado: '-1.00' })) },
      { conteo: MEDIOS.map((medio) => ({ medio, contado: '100000000.00' })) },
      { conteo: MEDIOS.map((medio) => ({ medio, contado: '0.00', esperado: '1.00' })) },
    ];
    for (const cuerpo of casos) {
      esperarError(
        await escribir(ctx, A().token.cajero!, 'post', `/turnos/${t}/cierre`, cuerpo),
        400,
        'DATOS_INVALIDOS',
      );
    }
    exigirEstado(await cerrar(A().token.cajero!, t, { EFECTIVO: '10.00' }), 200, 'Cerrar');
  });
});

describe('criterios 24 y 27 · apertura y consultas', () => {
  it('abre con la hora del reloj y el día operativo; GET /turnos/:id y /mio responden la forma de turnoRespuesta', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1, '25');
    const turno = turnoRespuestaSchema.parse(
      (await api(ctx, A().token.cajero, 'get', `/turnos/${t}`)).body,
    );
    expect(turno).toMatchObject({
      fondo: '25.00',
      estado: 'ABIERTO',
      responsable: { id: A().personas.cajero!.id },
    });
    expect(turno.responsable.nombre).not.toBe('');
    expect((await api(ctx, A().token.cajero, 'get', '/turnos/mio')).body.id).toBe(t);
    // Con la misma id y el fondo escrito de otra forma ("25" y "25.00") es la misma petición.
    const replica = await escribir(ctx, A().token.cajero!, 'post', '/turnos', {
      id: t,
      cajaId: cajas.S1!.caja1.toUpperCase(),
      fondo: '25.00',
    });
    expect(replica.status, replica.text).toBe(201);
    expect(replica.body.id).toBe(t);
    // Un turno de otra sucursal de la empresa se ve como inexistente.
    expect((await api(ctx, A().token.supervisor, 'get', `/turnos/${randomUUID()}`)).status).toBe(
      404,
    );
    exigirEstado(await cerrar(A().token.cajero!, t, { EFECTIVO: '25.00' }), 200, 'Cerrar');
  });
});
