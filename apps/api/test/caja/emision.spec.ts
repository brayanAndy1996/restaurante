// Historia 006 · caja, cobro y comprobantes, grupo C1 (T6) · pruebas del desarrollador (no protegidas) de
// `EmisionService` y `SeriesService.tomarNumero`: la numeración sin saltos ni duplicados dentro de la transacción del
// cobro (criterios 70 a 73), lo que guarda el comprobante y sus líneas (69), la fecha de emisión y el día operativo (74),
// el estado `POR_ENVIAR` (75), la cuota del plan (76), la inmutabilidad en la base (78) y la regla de las tasas con
// comprobantes emitidos (6). Llaman al servicio directamente dentro de `ContextoEmpresa.ejecutar`, como lo hará el cobro
// (T15): el turno se siembra por SQL (su ruta llega en T9) y la parte se calcula con `calcularParte` de `packages/dominio`
// sobre los ítems reales de la cuenta C de 004. El ticket llega con T21.
import { randomUUID } from 'node:crypto';
import {
  calcularCuenta,
  calcularParte,
  type CuentaEntrada,
  type FormatoComprobante,
  type ParteCalculada,
  type TipoComprobante,
} from '@restaurante/dominio';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EmisionService, type DatosDeEmision } from '../../src/modulos/facturacion';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import {
  api,
  arrancarCaja,
  cerrarAdmin,
  crearCaja,
  crearEscenario,
  cuentaC,
  esperarError,
  exigirEstado,
  filas,
  ponerSerie,
  ponerTasa,
  type AppP5,
  type Cuenta,
  type Escenario,
} from '../caja-critica/fabrica-caja';
import { abrirCliente } from '../utilidades';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
let apiCliente: Client;
let cuentaS1: Cuenta;
let cuentaS2: Cuenta;

const A = () => esc.A;
const admin = () => A().token.admin!;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 5 });
  esc = await crearEscenario(ctx);
  apiCliente = await abrirCliente('api');
  await A().cajas();
  cuentaS1 = await cuentaC(ctx, A(), 'S1');
  cuentaS2 = await cuentaC(ctx, A(), 'S2');
});
afterAll(async () => {
  await ctx?.cerrar();
  await apiCliente?.end();
  await cerrarAdmin();
});

// ------------------------------------------------------------------------------------------------
// Ayudantes
// ------------------------------------------------------------------------------------------------

type Sucursal = 'S1' | 'S2';
const sucursalId = (s: Sucursal) => (s === 'S1' ? A().S1 : A().S2);
const responsable = (s: Sucursal) =>
  s === 'S1' ? A().personas.cajero! : A().personas.supervisorS2!;

/** Una caja nueva con sus series y un turno ya cerrado (la emisión no mira el estado del turno: lo mira el cobro). */
async function cajaNueva(
  s: Sucursal,
  series: { boleta?: [string, number?]; factura?: [string, number?] },
): Promise<{ cajaId: string; turnoId: string }> {
  const caja = await crearCaja(ctx, admin(), sucursalId(s), `Caja ${randomUUID().slice(0, 8)}`);
  const cajaId = caja.id as string;
  for (const [tipo, par] of [
    ['BOLETA', series.boleta],
    ['FACTURA', series.factura],
  ] as const) {
    if (par === undefined) continue;
    exigirEstado(
      await ponerSerie(ctx, admin(), sucursalId(s), cajaId, tipo, par[0], par[1]),
      200,
      `Serie ${par[0]}`,
    );
  }
  const turnoId = randomUUID();
  await enTransaccion(
    apiCliente,
    A().id,
    async () => {
      await apiCliente.query(
        `INSERT INTO turno (id, empresa_id, caja_id, sucursal_id, responsable_id, estado, abierto_en, dia_operativo,
                            fondo, cerrado_en, cerrado_por_id, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, 'CERRADO', now(), '2026-11-02', '0.00', now(), $5,
                 decode(repeat('cd', 32), 'hex'), now(), now())`,
        [turnoId, A().id, cajaId, sucursalId(s), responsable(s).id],
      );
    },
    { confirmar: true },
  );
  // Se apaga: la emisión no mira si la caja está activa y la sucursal admite solo diez cajas activas.
  exigirEstado(
    await api(ctx, admin(), 'patch', `/sucursales/${sucursalId(s)}/cajas/${cajaId}`, {
      activa: false,
    }),
    200,
    'Apagar la caja de la prueba',
  );
  return { cajaId, turnoId };
}

/** La cuenta C como `CuentaEntrada` con los ítems reales de la cuenta de 004; `ajustar` cambia lo que haga falta. */
function entradaC(
  cuenta: Cuenta,
  tasaIgv: string | null,
  ajustar: (e: CuentaEntrada) => CuentaEntrada = (e) => e,
): CuentaEntrada {
  const base = {
    afectacion: 'GRAVADO' as const,
    cantidadCortesia: 0,
    aplicaIcbper: false,
    descuento: null,
  };
  return ajustar({
    lineas: [
      { ...base, itemId: cuenta.item.lomo!, precioUnitario: '28.00', cantidad: 2 },
      { ...base, itemId: cuenta.item.gaseosa!, precioUnitario: '9.00', cantidad: 1 },
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
    tasaIgv,
    montoIcbper: '0.50',
  });
}

function parteDe(entrada: CuentaEntrada, formato: FormatoComprobante): ParteCalculada {
  const r = calcularParte(entrada, [], { tipo: 'TOTAL' }, formato);
  if (!r.valida) throw new Error(`parte inválida: ${r.codigo}`);
  const { valida: _valida, ...parte } = r;
  return parte;
}

function descripciones(cuenta: Cuenta): Map<string, string> {
  return new Map([
    [cuenta.item.lomo!, 'Lomo saltado [3/4]'],
    [cuenta.item.gaseosa!, 'Gaseosa 1 L'],
    [cuenta.item.bolsa!, 'Bolsa plástica'],
    [cuenta.item.mandarina!, 'Mandarina'],
  ]);
}

interface Opciones {
  s?: Sucursal;
  tipo?: TipoComprobante;
  formato?: FormatoComprobante;
  tasaIgv?: string | null;
  cuenta?: Cuenta;
  instante?: Date;
  parte?: ParteCalculada;
}

/** Cada emisión de la misma orden necesita un lugar distinto entre las partes (índice único). */
let partes = 0;

function datosDe(caja: { cajaId: string; turnoId: string }, o: Opciones = {}): DatosDeEmision {
  const s = o.s ?? 'S1';
  const cuenta = o.cuenta ?? (s === 'S1' ? cuentaS1 : cuentaS2);
  const tasaIgv = o.tasaIgv === undefined ? '18.00' : o.tasaIgv;
  const formato = o.formato ?? 'DETALLADO';
  return {
    sucursalId: sucursalId(s),
    cajaId: caja.cajaId,
    turnoId: caja.turnoId,
    turnoResponsableId: responsable(s).id,
    cobroId: randomUUID(),
    numeroParte: ++partes,
    impresora: null,
    tipo: o.tipo ?? 'BOLETA',
    formato,
    cliente: null,
    parte: o.parte ?? parteDe(entradaC(cuenta, tasaIgv), formato),
    tasaIgv,
    descripciones: descripciones(cuenta),
    orden: { id: cuenta.ordenId, mesas: ['Mesa 4'], mozo: 'Mozo de la mesa', numeroLlamado: null },
    pagos: [],
    redondeo: '0.00',
    vuelto: '0.00',
    instante: o.instante ?? ctx.reloj.ahora(),
  };
}

const emitir = (datos: DatosDeEmision) =>
  ctx.app.get(ContextoEmpresa).ejecutar(A().id, () => ctx.app.get(EmisionService).emitir(datos), {
    actor: { sistema: 'prueba' },
  });

/** Emite y después falla a propósito: todo debe revertirse. */
const emitirYFallar = (datos: DatosDeEmision) =>
  ctx.app.get(ContextoEmpresa).ejecutar(
    A().id,
    async () => {
      await ctx.app.get(EmisionService).emitir(datos);
      throw new Error('falla a propósito después de numerar');
    },
    { actor: { sistema: 'prueba' } },
  );

async function ultimoNumero(cajaId: string, tipo: TipoComprobante = 'BOLETA'): Promise<number> {
  return (
    await filas<{ ultimo_numero: number }>(
      'SELECT ultimo_numero FROM serie WHERE caja_id = $1 AND tipo = $2 AND activa',
      [cajaId, tipo],
    )
  )[0]!.ultimo_numero;
}

const consumoDe = async (s: Sucursal, periodo: string): Promise<number> =>
  Number(
    (
      await filas<{ emitidos: number }>(
        'SELECT emitidos FROM consumo_comprobantes WHERE sucursal_id = $1 AND periodo = $2',
        [sucursalId(s), periodo],
      )
    )[0]?.emitidos ?? 0,
  );

async function rechazo(promesa: Promise<unknown>): Promise<ErrorAplicacion> {
  try {
    await promesa;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorAplicacion);
    return e as ErrorAplicacion;
  }
  throw new Error('Se esperaba un rechazo');
}

// ------------------------------------------------------------------------------------------------
describe('criterio 69 · lo que guarda el comprobante', () => {
  it('la cuenta C detallada: serie, número, emisor, sucursal, totales, monto en letras y cada línea con sus 10 decimales', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B610'] });
    const antes = await consumoDe('S1', '2026-11');
    const { comprobante: c, trabajoId, impresion } = await emitir(datosDe(caja));
    expect(c).toMatchObject({
      tipo: 'BOLETA',
      serie: 'B610',
      correlativo: 1,
      numero: 'B610-00000001',
      formato: 'DETALLADO',
      estado: 'POR_ENVIAR',
      fechaEmision: '2026-11-02',
      diaOperativo: '2026-11-02',
      cajaId: caja.cajaId,
      turnoId: caja.turnoId,
      turnoResponsableId: A().personas.cajero!.id,
      numeroParte: 1,
      cliente: null,
      moneda: 'PEN',
      tasaIgv: '18.00',
      montoEnLetras: 'SESENTA Y NUEVE CON 20/100 SOLES',
      orden: {
        id: cuentaS1.ordenId,
        mesas: ['Mesa 4'],
        mozo: 'Mozo de la mesa',
        numeroLlamado: null,
      },
    });
    expect(c.emisor).toEqual({
      ruc: A().base.emisores[0]!.ruc,
      razonSocial: expect.any(String),
      regimen: 'GENERAL',
    });
    expect(c.sucursal.codigoEstablecimiento).toMatch(/^\d{4}$/);
    expect(c.totales).toEqual({
      subtotal: '68.20',
      descuentos: '0.00',
      operaciones: { gravadas: '55.26', exoneradas: '3.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '9.94',
      igvGratuitas: '0.00',
      icbper: '1.00',
      total: '69.20',
    });
    expect(c.lineas.map((l) => [l.posicion, l.descripcion, l.cantidad, l.unidad])).toEqual([
      [1, 'Lomo saltado [3/4]', 2, 'NIU'],
      [2, 'Gaseosa 1 L', 1, 'NIU'],
      [3, 'Bolsa plástica', 2, 'NIU'],
      [4, 'Mandarina', 1, 'NIU'],
    ]);
    expect(c.lineas.map((l) => [l.precioUnitario, l.valorUnitario])).toEqual([
      ['28.00', '23.7288135593'],
      ['9.00', '7.6271186441'],
      ['0.10', '0.0847457627'],
      ['3.00', '3.0000000000'],
    ]);
    expect(c.lineas[0]).toMatchObject({
      bruto: '56.00',
      descuento: '0.00',
      neto: '56.00',
      base: '47.46',
      igv: '8.54',
      bolsas: 0,
      icbper: '0.00',
      afectacion: 'GRAVADO',
      gratuita: false,
      valorReferencial: null,
    });
    expect(c.lineas[2]).toMatchObject({ bolsas: 2, icbper: '1.00', base: '0.17', igv: '0.03' });
    expect(c.lineas[3]).toMatchObject({ afectacion: 'EXONERADO', base: '3.00', igv: '0.00' });
    // Sin ticket todavía (T21): ni trabajo ni impresión.
    expect(trabajoId).toBeNull();
    expect(impresion).toBe('SIN_IMPRESORA');
    // El detalle de la parte queda tal cual para las partes siguientes, y la cuota cuenta el comprobante.
    const fila = (
      await filas('SELECT detalle_parte, cobro_id, estado FROM comprobante WHERE id = $1', [c.id])
    )[0]!;
    expect(fila.detalle_parte).toEqual(JSON.parse(JSON.stringify(datosDe(caja).parte)));
    expect(fila.estado).toBe('POR_ENVIAR');
    expect(await consumoDe('S1', '2026-11')).toBe(antes + 1);
  });

  it('Nuevo RUS por consumo: sin tasa ni operaciones, IGV en cero, una línea por afectación en unidad ZZ', async () => {
    const caja = await cajaNueva('S2', { boleta: ['B620'] });
    const datos = datosDe(caja, { s: 'S2', formato: 'CONSUMO', tasaIgv: null });
    const { comprobante: c } = await emitir(datos);
    expect(c.emisor.regimen).toBe('NUEVO_RUS');
    expect(c.tasaIgv).toBeNull();
    expect(c.totales.operaciones).toBeNull();
    expect(c.totales).toMatchObject({ igv: '0.00', icbper: '1.00', total: '69.20' });
    const porConsumo = c.lineas.filter((l) => l.itemId === null);
    expect(porConsumo.length).toBeGreaterThan(0);
    for (const l of porConsumo) {
      expect(l).toMatchObject({
        descripcion: 'Por consumo',
        unidad: 'ZZ',
        cantidad: 1,
        igv: '0.00',
      });
      expect(l.valorUnitario).toMatch(/^\d+\.\d{10}$/);
      expect(l.precioUnitario).toBe(l.bruto);
    }
    // Con tasa nula ninguna línea divide por 1.18: el valor unitario es el precio.
    for (const l of c.lineas) expect(Number(l.valorUnitario)).toBe(Number(l.precioUnitario));
  });

  it('una cortesía va en una línea gratuita aparte, con su valor referencial, y no entra en el total', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B630'] });
    const entrada = entradaC(cuentaS1, '18.00', (e) => ({
      ...e,
      lineas: e.lineas.map((l) =>
        l.itemId === cuentaS1.item.gaseosa ? { ...l, cantidadCortesia: 1 } : l,
      ),
    }));
    const { comprobante: c } = await emitir(
      datosDe(caja, { parte: parteDe(entrada, 'DETALLADO') }),
    );
    expect(c.totales.total).toBe('60.20');
    expect(c.totales.operaciones?.gratuitas).toBe('7.63');
    expect(c.totales.igvGratuitas).toBe('1.37');
    const gratuita = c.lineas.find((l) => l.gratuita)!;
    expect(gratuita).toMatchObject({
      descripcion: 'Gaseosa 1 L',
      cantidad: 1,
      precioUnitario: '9.00',
      valorUnitario: '7.6271186441',
      bruto: '0.00',
      neto: '0.00',
      base: '0.00',
      igv: '0.00',
      valorReferencial: '9.00',
    });
    expect(calcularCuenta(entrada).totales.total).toBe('60.20');
  });

  it('un ítem sin descripción es un error de quien arma los datos: no se emite ni se consume el número', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B640'] });
    const datos = { ...datosDe(caja), descripciones: new Map<string, string>() };
    await expect(emitir(datos)).rejects.toThrow(/Falta la descripción/);
    expect(await ultimoNumero(caja.cajaId)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterios 70 y 71 · numeración sin saltos', () => {
  it('toma el número siguiente de la serie de la caja; una reversión después de numerar no pierde el número', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B650', 40] });
    const consumo = await consumoDe('S1', '2026-11');
    // Solo los de esta caja: otros archivos de prueba cobran a la vez en la misma base.
    const delaCaja = async () =>
      (
        await filas('SELECT count(*)::int AS n FROM comprobante WHERE caja_id = $1', [caja.cajaId])
      )[0]!.n;
    const antes = await delaCaja();
    await expect(emitirYFallar(datosDe(caja))).rejects.toThrow('falla a propósito');
    expect(await ultimoNumero(caja.cajaId), 'la serie sigue donde estaba').toBe(39);
    expect(await delaCaja()).toBe(antes);
    expect(await consumoDe('S1', '2026-11'), 'la cuota también se revierte').toBe(consumo);
    const primero = await emitir(datosDe(caja));
    expect(primero.comprobante.numero).toBe('B650-00000040');
    const segundo = await emitir(datosDe(caja));
    expect(segundo.comprobante.numero).toBe('B650-00000041');
    expect(await consumoDe('S1', '2026-11')).toBe(consumo + 2);
  });

  it('sin serie activa del tipo: 409 SIN_SERIE y nada queda; con la de otro emisor tampoco emite', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B660'] });
    const sinFactura = await rechazo(emitir(datosDe(caja, { tipo: 'FACTURA' })));
    expect([sinFactura.getStatus(), sinFactura.codigo]).toEqual([409, 'SIN_SERIE']);
    expect(await ultimoNumero(caja.cajaId)).toBe(0);
    // La serie de la caja es de E1: si la sucursal fuera de otro emisor, esta serie no emitiría. Se comprueba con la
    // sucursal S2 (emisor E2): la caja de S1 no tiene serie de E2.
    const deOtroEmisor = await rechazo(emitir({ ...datosDe(caja), sucursalId: A().S2 }));
    expect([deOtroEmisor.getStatus(), deOtroEmisor.codigo]).toEqual([409, 'SIN_SERIE']);
    expect(await ultimoNumero(caja.cajaId)).toBe(0);
  });

  it('el correlativo llega hasta 99999999: el siguiente es 409 SERIE_AGOTADA y la serie no se pasa', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B670', 99_999_999] });
    const ultimo = await emitir(datosDe(caja));
    expect(ultimo.comprobante.numero).toBe('B670-99999999');
    const agotada = await rechazo(emitir(datosDe(caja)));
    expect([agotada.getStatus(), agotada.codigo]).toEqual([409, 'SERIE_AGOTADA']);
    expect(await ultimoNumero(caja.cajaId)).toBe(99_999_999);
  });
});

describe('criterio 72 · sin duplicados con cobros concurrentes', () => {
  it('veinte emisiones a la vez en dos cajas y diez en la misma caja dejan números consecutivos desde el primero, sin repetidos ni huecos', async () => {
    const [uno, dos] = [
      await cajaNueva('S1', { boleta: ['B680'] }),
      await cajaNueva('S1', { boleta: ['B681', 5] }),
    ];
    const emisiones = Array.from({ length: 20 }, (_, i) =>
      emitir(datosDe(i % 2 === 0 ? uno : dos)),
    );
    const resultados = await Promise.all(emisiones);
    const numeros = (serie: string) =>
      resultados
        .map((r) => r.comprobante)
        .filter((c) => c.serie === serie)
        .map((c) => c.correlativo)
        .sort((a, b) => a - b);
    expect(numeros('B680')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(numeros('B681')).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // Cada comprobante lleva la serie de su caja.
    for (const r of resultados) {
      expect(r.comprobante.cajaId === uno.cajaId ? 'B680' : 'B681').toBe(r.comprobante.serie);
    }
    expect(await ultimoNumero(uno.cajaId)).toBe(10);
    expect(await ultimoNumero(dos.cajaId)).toBe(14);
    // Diez más en la misma caja, con algunas que fallan después de numerar.
    const mezcla = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        i % 3 === 0 ? emitirYFallar(datosDe(uno)) : emitir(datosDe(uno)),
      ),
    );
    const buenos = mezcla.filter((r) => r.status === 'fulfilled').length;
    expect(buenos).toBe(6);
    expect(await ultimoNumero(uno.cajaId)).toBe(10 + buenos);
    const guardados = await filas<{ numero: number }>(
      `SELECT c.numero FROM comprobante c JOIN serie s ON s.id = c.serie_id
        WHERE s.caja_id = $1 ORDER BY c.numero`,
      [uno.cajaId],
    );
    expect(guardados.map((f) => f.numero)).toEqual(
      Array.from({ length: 10 + buenos }, (_, i) => i + 1),
    );
  });
});

describe('criterios 73 y 74 · fecha de emisión y día operativo', () => {
  it('a las 02:00 del 5 la fecha de emisión es el 5 y el día operativo el 4; a las 23:30 del 31 de octubre cuenta en el mes de octubre', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B690'] });
    const madrugada = await emitir(
      datosDe(caja, { instante: new Date('2026-11-05T02:00:00-05:00') }),
    );
    expect(madrugada.comprobante).toMatchObject({
      fechaEmision: '2026-11-05',
      diaOperativo: '2026-11-04',
    });
    const octubre = await consumoDe('S1', '2026-10');
    const finDeMes = await emitir(
      datosDe(caja, { instante: new Date('2026-10-31T23:30:00-05:00') }),
    );
    expect(finDeMes.comprobante.fechaEmision).toBe('2026-10-31');
    expect(await consumoDe('S1', '2026-10')).toBe(octubre + 1);
    expect(
      (
        await filas<{ emitido_en: Date }>('SELECT emitido_en FROM comprobante WHERE id = $1', [
          finDeMes.comprobante.id,
        ])
      )[0]!.emitido_en.toISOString(),
    ).toBe('2026-11-01T04:30:00.000Z');
  });
});

describe('criterio 78 · inmutable en la base', () => {
  it('la API no actualiza montos ni borra: solo el estado cambia; el total tiene que cuadrar con sus partes', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B700'] });
    const { comprobante: c } = await emitir(datosDe(caja));
    const comoApi = <T>(fn: () => Promise<T>) => enTransaccion(apiCliente, A().id, fn);
    for (const sentencia of [
      `UPDATE comprobante SET total = '1.00' WHERE id = $1`,
      `UPDATE comprobante SET detalle_parte = '{}'::jsonb WHERE id = $1`,
      `UPDATE comprobante SET numero = 99 WHERE id = $1`,
      `DELETE FROM comprobante WHERE id = $1`,
      `UPDATE comprobante_linea SET neto = '1.00' WHERE comprobante_id = $1`,
      `DELETE FROM comprobante_linea WHERE comprobante_id = $1`,
    ]) {
      const error = await comoApi(() => errorDe(apiCliente.query(sentencia, [c.id])));
      expect(error.code, sentencia).toBe('42501');
    }
    const estado = await comoApi(() =>
      apiCliente.query(`UPDATE comprobante SET estado = 'ENVIADO' WHERE id = $1`, [c.id]),
    );
    expect(estado.rowCount).toBe(1);
    // Una fila que no cuadra (total distinto de subtotal - descuentos + ICBPER) no entra.
    const incoherente = await comoApi(() =>
      errorDe(
        apiCliente.query(
          `INSERT INTO comprobante
             SELECT (jsonb_populate_record(NULL::comprobante,
                      to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'numero', 77,
                                                         'numero_parte', 9, 'cobro_id', gen_random_uuid()::text,
                                                         'total', '1.00'))).*
               FROM comprobante x WHERE x.id = $1`,
          [c.id],
        ),
      ),
    );
    expect(incoherente.code).toBe('23514');
  });
});

describe('criterio 6 · una tasa no cambia las ventas pasadas', () => {
  it('con comprobantes emitidos hasta el 5 de noviembre no se crea ni se cambia una tasa desde esa fecha o antes; sí una posterior', async () => {
    const caja = await cajaNueva('S1', { boleta: ['B710'] });
    await emitir(datosDe(caja));
    const emisor = A().emisor1;
    // La tasa de 2026-01-01 ya existe con 18.00: repetirla es 200; cambiarla, 409.
    exigirEstado(await ponerTasa(ctx, admin(), emisor, '2026-01-01', '18.00'), 200, 'Repetir');
    for (const desde of ['2026-01-01', '2026-11-01', '2026-11-02', '2026-11-05']) {
      esperarError(await ponerTasa(ctx, admin(), emisor, desde, '10.00'), 409, 'CONFLICTO');
    }
    exigirEstado(await ponerTasa(ctx, admin(), emisor, '2026-11-06', '10.00'), 200, 'Posterior');
    const lista = await api(ctx, admin(), 'get', `/emisores/${emisor}/tasas-igv`);
    expect(lista.body).toEqual([
      { desde: '2026-01-01', tasa: '18.00' },
      { desde: '2026-11-06', tasa: '10.00' },
    ]);
    // Un emisor que no emitió nada (E3) acepta cualquier fecha.
    exigirEstado(await ponerTasa(ctx, admin(), A().emisor3!, '2020-01-01', '18.00'), 200, 'E3');
  });
});
