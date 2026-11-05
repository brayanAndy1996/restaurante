// spec: 006-caja-cobro (pruebas protegidas)
//
// P2 · Cambios en la cuenta después de cobrar una parte (ruta crítica), criterios 20 y 86 a 89:
// - 86: una anulación de ítem de una cuenta con cobros se acepta solo si lo cobrado sigue cuadrando; si no, 409
//   CUENTA_COBRADA_EN_PARTE sin anular ni consumir la clave de supervisor;
// - 87: un envío a una cuenta con cobros se acepta si lo cobrado sigue cuadrando (con un descuento por cuenta y una
//   parte cobrada, no); la parte siguiente se calcula sobre el saldo nuevo y la mesa sigue ocupada;
// - 88: unir (la principal o una absorbida) y anular una orden con cobros responden 409 CUENTA_EN_COBRO; mover se permite;
// - 89: la pre-cuenta de una cuenta con cobros muestra "Pagado" y "Por pagar".
// Ejemplos del criterio 20: cuenta C sin descuento y 1 Lomo cobrado por ítems: enviar 1 Gaseosa más se permite, anular el
// Lomo que falta se permite, anular los 2 Lomos no; con el descuento por cuenta de S/ 5.00 y un Lomo cobrado, enviar
// cualquier ítem no.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { precuentaRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  agregar,
  api,
  arrancarCaja,
  autorizar,
  cerrarAdmin,
  cobrar,
  cobrosDeLaOrden,
  crearEscenario,
  cuentaC,
  cuentaCon,
  enviarLineas,
  escribir,
  esperarError,
  estadoDeMesa,
  estadoDeOrden,
  exigirEstado,
  filas,
  versionDe,
  type AppP5,
  type Cuenta,
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

let turnoCajero: Promise<string> | undefined;
const turno = () =>
  (turnoCajero ??= (async () =>
    abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1))());

/** Cuenta C con 1 Lomo ya cobrado por ítems (28.00). */
async function conUnLomoCobrado(): Promise<Cuenta> {
  const cuenta = await cuentaC(ctx, A());
  await cobrar(ctx, A().token.cajero!, cuenta, {
    turnoId: await turno(),
    total: '28.00',
    parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] },
  });
  return cuenta;
}

const anular = (
  cuenta: Cuenta,
  itemId: string,
  cantidad: number,
  token: string,
  autorizacion?: string,
) =>
  escribir(
    ctx,
    token,
    'post',
    `/ordenes/${cuenta.ordenId}/items/${itemId}/anulaciones`,
    { id: randomUUID(), cantidad, motivo: 'Error de toma', destinoStock: 'VUELVE' },
    autorizacion ? { 'X-Autorizacion': autorizacion } : {},
  );

describe('criterio 86 · anular lo ya cobrado', () => {
  it('anular el Lomo que falta se permite; anular los 2 Lomos responde 409 CUENTA_COBRADA_EN_PARTE sin consumir la clave', async () => {
    const cuenta = await conUnLomoCobrado();
    const { autorizacionId } = await autorizar(
      ctx,
      A().token.cajero!,
      A().personas.supervisor!.pin,
      'ANULAR_ITEM_ENVIADO',
    );
    const antes = await versionDe(cuenta.ordenId);
    const dos = await anular(cuenta, cuenta.item.lomo!, 2, A().token.cajero!, autorizacionId);
    esperarError(dos, 409, 'CUENTA_COBRADA_EN_PARTE');
    expect(await versionDe(cuenta.ordenId)).toBe(antes);
    // La clave sigue sirviendo: se usa para la anulación que sí se permite (1 Lomo, el que falta).
    const uno = await anular(cuenta, cuenta.item.lomo!, 1, A().token.cajero!, autorizacionId);
    exigirEstado(uno, 201, 'Anular el Lomo que falta (006, criterio 86)');
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
  });

  it('anular un ítem que no se cobró siempre se permite', async () => {
    const cuenta = await conUnLomoCobrado();
    const res = await anular(cuenta, cuenta.item.gaseosa!, 1, A().token.supervisor!);
    exigirEstado(res, 201, 'Anular la Gaseosa sin cobrar');
  });

  it('tras anular lo permitido, la parte siguiente se calcula sobre lo que queda', async () => {
    const cuenta = await conUnLomoCobrado();
    exigirEstado(
      await anular(cuenta, cuenta.item.gaseosa!, 1, A().token.supervisor!),
      201,
      'Anular la Gaseosa',
    );
    // Quedan 1 Lomo (28.00), 2 Bolsas con su ICBPER (1.20) y la Mandarina (3.00): 32.20.
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '32.20',
      pagos: [{ medio: 'YAPE', monto: '32.20', operacion: 'Y-9' }],
    });
    expect(cobro.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
  });
});

describe('criterio 87 · agregar después de una parte', () => {
  it('enviar 1 Gaseosa más se permite, la mesa sigue ocupada y la parte siguiente usa el saldo nuevo', async () => {
    const cuenta = await conUnLomoCobrado();
    exigirEstado(
      await enviarLineas(ctx, A(), cuenta, [['gaseosa', 1]]),
      201,
      'Enviar una Gaseosa más',
    );
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
    expect(await estadoDeMesa(ctx, A().token.mozo!, cuenta.mesaId)).toBe('OCUPADA');
    // Saldo: 69.20 + 9.00 − 28.00 = 50.20.
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '50.20',
    });
    expect(cobro.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
  });

  it('con partes iguales también: el postre de los que se quedaron entra en las partes que faltan', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '34.60',
      parte: { tipo: 'IGUALES', partesRestantes: 2 },
      formato: 'CONSUMO',
    });
    exigirEstado(
      await enviarLineas(ctx, A(), cuenta, [['mandarina', 1]]),
      201,
      'Enviar una Mandarina más',
    );
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '37.60',
      parte: { tipo: 'IGUALES', partesRestantes: 1 },
      formato: 'CONSUMO',
      pagos: [{ medio: 'YAPE', monto: '37.60', operacion: 'Y-8' }],
    });
    expect(cobro.cuenta.estado).toBe('CERRADA');
  });

  it('con un descuento por cuenta de S/ 5.00 y un Lomo cobrado, enviar cualquier ítem responde 409 CUENTA_COBRADA_EN_PARTE', async () => {
    const cuenta = await cuentaC(ctx, A());
    const descuento = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/cuentas/${cuenta.ordenId}/descuentos`,
      {
        id: randomUUID(),
        itemId: null,
        tipo: 'MONTO',
        valor: '5.00',
        motivo: 'Cliente frecuente',
      },
    );
    exigirEstado(descuento, 201, 'Descuento por cuenta (006, criterio 39)');
    // El Lomo de la cuenta con el descuento prorrateado: 51.89 / 2 = 25.945 → 25.95; en efectivo 25.90 y redondeo 0.05.
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '25.95',
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] },
      pagos: [{ medio: 'EFECTIVO', monto: '25.90' }],
      redondeo: '0.05',
    });
    const antes = await versionDe(cuenta.ordenId);
    for (const linea of [
      ['gaseosa', 1],
      ['pisco', 1],
      ['lomo', 1],
    ] as const) {
      const res = await enviarLineas(ctx, A(), cuenta, [[linea[0], linea[1]]]);
      esperarError(res, 409, 'CUENTA_COBRADA_EN_PARTE');
    }
    expect(await versionDe(cuenta.ordenId)).toBe(antes);
    void agregar;
  });
});

describe('criterio 88 · unir y anular la orden con cobros', () => {
  it('unir una orden con cobros (la principal o la absorbida) responde 409 CUENTA_EN_COBRO sin cambios', async () => {
    const cobrada = await conUnLomoCobrado();
    const otra = await cuentaCon(ctx, A(), 'S1', [['gaseosa', 1]]);
    const supervisor = A().token.supervisor!;
    const comoPrincipal = await escribir(
      ctx,
      supervisor,
      'post',
      `/ordenes/${cobrada.ordenId}/union`,
      {
        mesaIds: [otra.mesaId],
      },
    );
    esperarError(comoPrincipal, 409, 'CUENTA_EN_COBRO');
    const comoAbsorbida = await escribir(
      ctx,
      supervisor,
      'post',
      `/ordenes/${otra.ordenId}/union`,
      {
        mesaIds: [cobrada.mesaId],
      },
    );
    esperarError(comoAbsorbida, 409, 'CUENTA_EN_COBRO');
    expect(await estadoDeOrden(cobrada.ordenId)).toBe('ABIERTA');
    expect(await estadoDeOrden(otra.ordenId)).toBe('ABIERTA');
  });

  it('anular la orden con cobros responde 409 CUENTA_EN_COBRO y la orden sigue abierta', async () => {
    const cuenta = await conUnLomoCobrado();
    const res = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/ordenes/${cuenta.ordenId}/anulacion`,
      {
        motivo: 'Se fue el cliente',
        destinoStock: 'VUELVE',
      },
    );
    esperarError(res, 409, 'CUENTA_EN_COBRO');
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
  });

  it('mover una cuenta con cobros a otra mesa se permite', async () => {
    const cuenta = await conUnLomoCobrado();
    const destino = await A().mesaNueva('S1');
    const res = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/ordenes/${cuenta.ordenId}/movimiento`,
      {
        mesaDestinoId: destino,
      },
    );
    exigirEstado(res, 200, 'Mover la cuenta (004, criterio 45)');
    expect(await estadoDeMesa(ctx, A().token.mozo!, destino)).toBe('OCUPADA');
    expect(await estadoDeMesa(ctx, A().token.mozo!, cuenta.mesaId)).toBe('LIBRE');
  });
});

describe('criterio 89 · la pre-cuenta con cobros', () => {
  it('muestra "Pagado" y "Por pagar" además del total', async () => {
    const cuenta = await conUnLomoCobrado();
    const res = await escribir(
      ctx,
      A().token.mozo!,
      'post',
      `/ordenes/${cuenta.ordenId}/precuentas`,
      {
        id: randomUUID(),
      },
    );
    exigirEstado(res, 201, 'Pedir la pre-cuenta (004, criterio 50)');
    const pre = precuentaRespuestaSchema.parse(res.body);
    // La pre-cuenta sigue sin ICBPER (pregunta 11): su total es el de 004 (68.20). Lo pagado es lo cobrado.
    expect(pre.total).toBe('68.20');
    expect(pre.pagado).toBe('28.00');
    // Por pagar es el saldo sin ICBPER: la caja cobrará 41.20 (40.20 más 1.00 de ICBPER).
    expect(pre.porPagar).toBe('40.20');
    // Una cuenta sin cobros no trae esos campos.
    const limpia = await cuentaC(ctx, A());
    const sin = await escribir(
      ctx,
      A().token.mozo!,
      'post',
      `/ordenes/${limpia.ordenId}/precuentas`,
      {
        id: randomUUID(),
      },
    );
    exigirEstado(sin, 201, 'Pedir la pre-cuenta');
    expect(sin.body.pagado).toBeUndefined();
    expect(sin.body.porPagar).toBeUndefined();
    void api;
    void filas;
  });

  it('con una de dos partes iguales cobrada: total 68.20, pagado 34.60 y por pagar 34.10 (la caja cobrará 34.60)', async () => {
    const cuenta = await cuentaC(ctx, A());
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '34.60',
      parte: { tipo: 'IGUALES', partesRestantes: 2 },
      formato: 'CONSUMO',
    });
    const res = await escribir(
      ctx,
      A().token.mozo!,
      'post',
      `/ordenes/${cuenta.ordenId}/precuentas`,
      {
        id: randomUUID(),
      },
    );
    exigirEstado(res, 201, 'Pedir la pre-cuenta');
    const pre = precuentaRespuestaSchema.parse(res.body);
    expect(pre).toMatchObject({ total: '68.20', pagado: '34.60', porPagar: '34.10' });
    expect(pre.nota).toContain('El ICBPER se suma al cobrar');
  });
});
