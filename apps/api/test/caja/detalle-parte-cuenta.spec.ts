// Historia 006 · caja, cobro y comprobantes, grupo C4 · prueba del desarrollador (no protegida): `GET /cuentas/:ordenId`
// trae en cada `cobros[]` el `detalleParte` (la `ParteCalculada` completa que facturación guardó en
// `comprobante.detalle_parte`), en orden de `numero_parte`. Con él, cualquier equipo calcula la parte siguiente con
// `calcularParte` sin haber cobrado las anteriores.
import { cuentaRespuestaSchema, type CuentaRespuesta } from '@restaurante/contratos';
import { calcularParte, type CuentaEntrada } from '@restaurante/dominio/caja';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cobrar,
  comprobantesDeLaOrden,
  crearEscenario,
  cuentaC,
  exigirEstado,
  type AppP5,
  type Escenario,
} from '../caja-critica/fabrica-caja';

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

/** Lo mismo que hace la PWA (`entradaDeCuenta`): la entrada de `calcularParte` armada con la cuenta de la API. */
const entradaDeCuenta = (cuenta: CuentaRespuesta): CuentaEntrada => ({
  lineas: cuenta.lineas.map((l) => ({
    itemId: l.itemId,
    precioUnitario: l.precioUnitario,
    cantidad: l.cantidad,
    cantidadCortesia: l.cantidadCortesia,
    afectacion: l.afectacion,
    aplicaIcbper: l.aplicaIcbper,
    descuento: l.descuento ? { tipo: l.descuento.tipo, valor: l.descuento.valor } : null,
  })),
  descuentoCuenta: cuenta.descuentoCuenta
    ? { tipo: cuenta.descuentoCuenta.tipo, valor: cuenta.descuentoCuenta.valor }
    : null,
  tasaIgv: cuenta.parametros.tasaIgv,
  montoIcbper: cuenta.parametros.montoIcbper,
});

/** Facturación guarda la `ParteCalculada` sin la marca `valida` de `calcularParte` (M7): la cuenta devuelve lo mismo. */
const sinValida = (detalle: unknown): unknown => {
  expect(detalle).not.toHaveProperty('valida');
  return detalle;
};

describe('la cuenta trae el detalle de cada parte cobrada', () => {
  it('dos cobros por ítems y uno en partes iguales: detalleParte es el del servidor y calcularParte da la misma parte siguiente', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cajero = A().token.cajero!;
    const turnoId = await abrirTurno(ctx, cajero, (await A().cajas()).S1!.caja1);

    // Lomo (28.00), Gaseosa (9.00) y la mitad de lo que falta (16.10), cada una desde la misma caja.
    await cobrar(ctx, cajero, cuenta, {
      turnoId,
      total: '28.00',
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] },
    });
    await cobrar(ctx, cajero, cuenta, {
      turnoId,
      total: '9.00',
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.gaseosa!, cantidad: 1 }] },
    });
    await cobrar(ctx, cajero, cuenta, {
      turnoId,
      total: '16.10',
      parte: { tipo: 'IGUALES', partesRestantes: 2 },
      formato: 'CONSUMO',
    });

    // Lo que guardó el servidor, en orden de numero_parte.
    const guardados = await comprobantesDeLaOrden(cuenta.ordenId);
    expect(guardados.map((c) => Number(c.numero_parte))).toEqual([1, 2, 3]);

    // Otro equipo (otro cajero que no cobró nada) lee la cuenta.
    const lectura = await api(ctx, A().token.cajero2!, 'get', `/cuentas/${cuenta.ordenId}`);
    exigirEstado(lectura, 200, 'La cuenta con tres cobros');
    const vista = cuentaRespuestaSchema.parse(lectura.body);
    expect(vista).toMatchObject({ estado: 'ABIERTA', cobrado: '53.10', saldo: '16.10' });
    expect(vista.cobros).toHaveLength(3);
    expect(vista.cobros.map((c) => c.comprobante.id)).toEqual(guardados.map((c) => c.id));
    expect(vista.cobros.map((c) => c.total)).toEqual(['28.00', '9.00', '16.10']);

    // El detalle de cada cobro es exactamente el que el servidor guardó y usa para las partes siguientes
    // (tanto el cuerpo crudo como lo que deja pasar el esquema).
    expect(lectura.body.cobros.map((c: { detalleParte: unknown }) => c.detalleParte)).toEqual(
      guardados.map((c) => sinValida(c.detalle_parte)),
    );
    expect(vista.cobros.map((c) => c.detalleParte)).toEqual(
      guardados.map((c) => sinValida(c.detalle_parte)),
    );
    expect(vista.cobros.map((c) => c.detalleParte.tipo)).toEqual(['ITEMS', 'ITEMS', 'IGUALES']);
    expect(vista.cobros.map((c) => c.detalleParte.totales.total)).toEqual([
      '28.00',
      '9.00',
      '16.10',
    ]);
    expect(vista.cobros[2]!.detalleParte).toMatchObject({
      formato: 'CONSUMO',
      cierraLaCuenta: false,
    });

    // El cliente calcula la parte siguiente solo con lo que dijo la API ...
    const anteriores = vista.cobros.map((c) => c.detalleParte);
    const delCliente = calcularParte(
      entradaDeCuenta(vista),
      anteriores,
      { tipo: 'IGUALES', partesRestantes: 1 },
      'CONSUMO',
    );
    expect(delCliente.valida).toBe(true);
    if (!delCliente.valida) return;
    const { valida: _valida, ...parteCliente } = delCliente;
    expect(parteCliente.totales.total).toBe('16.10');
    expect(parteCliente.cierraLaCuenta).toBe(true);

    // ... y es la misma que calcula y guarda el servidor al cobrarla.
    const ultima = await cobrar(ctx, A().token.cajero2!, cuenta, {
      turnoId: await abrirTurno(ctx, A().token.cajero2!, (await A().cajas()).S1!.caja2),
      total: parteCliente.totales.total,
      parte: { tipo: 'IGUALES', partesRestantes: 1 },
      formato: 'CONSUMO',
    });
    expect(ultima.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
    const todos = await comprobantesDeLaOrden(cuenta.ordenId);
    expect(todos).toHaveLength(4);
    expect(sinValida(todos[3]!.detalle_parte)).toEqual(parteCliente);

    // Con la cuenta cerrada la lectura sigue trayendo las cuatro partes, en orden.
    const cerrada = cuentaRespuestaSchema.parse(
      (await api(ctx, A().token.cajero!, 'get', `/cuentas/${cuenta.ordenId}`)).body,
    );
    expect(cerrada.cobros.map((c) => c.detalleParte)).toEqual(
      todos.map((c) => sinValida(c.detalle_parte)),
    );
  });

  it('una cuenta sin cobros trae cobros vacío', async () => {
    const cuenta = await cuentaC(ctx, A());
    const res = await api(ctx, A().token.cajero!, 'get', `/cuentas/${cuenta.ordenId}`);
    exigirEstado(res, 200, 'La cuenta sin cobros');
    expect(cuentaRespuestaSchema.parse(res.body).cobros).toEqual([]);
  });
});
