// spec: 006-caja-cobro (pruebas protegidas)
//
// P5 · Descuentos y cortesías con clave atada (ruta crítica), criterios 38 a 46:
// - 38 y 39: descuento por ítem y por cuenta (a lo más uno vigente por ítem y por cuenta); 42: quitar (204, repetir sin efecto);
//   43: cortesía (a lo más una por ítem; sin ICBPER; sin descuento);
// - 40: el Mozo y el Cajero necesitan una autorización de supervisor atada al objetivo exacto (cuenta, ítem y descuento
//   o cantidad): sin ella 403 CLAVE_REQUERIDA; de otra acción, de otro objetivo, sin objetivo o vencida, 403
//   AUTORIZACION_INVALIDA y nada cambia; la autorización se consume y se devuelve si la acción falla después;
// - 41: validación con `validarDescuento` (422 DESCUENTO_INVALIDO); 44: efectos en la versión, la pre-cuenta, la mesa y
//   los eventos; 45: solo antes de cobrar (409 CUENTA_EN_COBRO) y en una orden abierta (409 ORDEN_NO_ABIERTA);
//   46: una fila de auditoría por acción con el autorizador y el consumo de 002.
// Ejemplos: cuenta C con 10 % en el Lomo (descuento 5.60, total 63.60) y con S/ 5.00 por cuenta (total 64.20).
// Hoy falla por "No implementado": las rutas de caja y de descuentos responden 500 sin `@Permiso`.
import { precuentaRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  autorizar,
  cerrarAdmin,
  cobrar,
  crearEscenario,
  cuentaC,
  cuentaCon,
  escribir,
  esperarError,
  estadoDeMesa,
  estadoDeOrden,
  eventosDe,
  exigirEstado,
  filas,
  versionDe,
  type AppP5,
  type Cuenta,
  type Escenario,
  type Libre,
  type Res,
} from './fabrica-caja';
import { filasAuditoria } from '../acceso/fabrica-equipos';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
  // La cuenta de un emisor GENERAL solo desglosa el IGV con la tasa vigente (criterio 10, pregunta 6): se
  // configuran cajas, series y tasa de IGV antes de cualquier prueba, sin depender del orden del archivo.
  await A().cajas();
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

let turnoCajero: Promise<string> | undefined;
const turno = () =>
  (turnoCajero ??= (async () =>
    abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1))());

const pin = () => A().personas.supervisor!.pin;

const descuento = (
  token: string,
  cuenta: Pick<Cuenta, 'ordenId'>,
  o: {
    itemId: string | null;
    tipo?: 'PORCENTAJE' | 'MONTO';
    valor?: string;
    motivo?: string;
    id?: string;
  },
  autorizacion?: string,
): Promise<Res> =>
  escribir(
    ctx,
    token,
    'post',
    `/cuentas/${cuenta.ordenId}/descuentos`,
    {
      id: o.id ?? randomUUID(),
      itemId: o.itemId,
      tipo: o.tipo ?? 'PORCENTAJE',
      valor: o.valor ?? '10.00',
      motivo: o.motivo ?? 'Cliente frecuente',
    },
    autorizacion ? { 'X-Autorizacion': autorizacion } : {},
  );

const cortesia = (
  token: string,
  cuenta: Pick<Cuenta, 'ordenId'>,
  o: { itemId: string; cantidad?: number; motivo?: string; id?: string },
  autorizacion?: string,
): Promise<Res> =>
  escribir(
    ctx,
    token,
    'post',
    `/cuentas/${cuenta.ordenId}/cortesias`,
    {
      id: o.id ?? randomUUID(),
      itemId: o.itemId,
      cantidad: o.cantidad ?? 1,
      motivo: o.motivo ?? 'Atención de la casa',
    },
    autorizacion ? { 'X-Autorizacion': autorizacion } : {},
  );

const objetivoDescuento = (
  cuenta: Cuenta,
  itemId: string | null,
  tipo = 'PORCENTAJE',
  valor = '10.00',
) => ({
  tipo: 'DESCUENTO',
  ordenId: cuenta.ordenId,
  itemId,
  descuento: { tipo, valor },
});

const quitar = (token: string, ruta: string): Promise<Res> => api(ctx, token, 'delete', ruta);

const filasDeDescuento = (ordenId: string) =>
  filas('SELECT * FROM descuento WHERE orden_id = $1 ORDER BY creado_en', [ordenId]);

describe('criterios 38, 39 y 42 · descuentos', () => {
  it('descuento por ítem: 10 % al Lomo da 5.60 y la cuenta queda en 63.60', async () => {
    const cuenta = await cuentaC(ctx, A());
    const antes = await versionDe(cuenta.ordenId);
    const res = await descuento(A().token.supervisor!, cuenta, { itemId: cuenta.item.lomo! });
    exigirEstado(res, 201, 'Descuento por ítem (006, criterio 38)');
    expect(res.body).toMatchObject({
      itemId: cuenta.item.lomo,
      tipo: 'PORCENTAJE',
      valor: '10.00',
      monto: '5.60',
      motivo: 'Cliente frecuente',
      autorizadoPor: null,
      creadoPor: { id: A().personas.supervisor!.id },
    });
    expect(await versionDe(cuenta.ordenId)).toBeGreaterThan(antes);
    const vista = await api(ctx, A().token.cajero, 'get', `/cuentas/${cuenta.ordenId}`);
    exigirEstado(vista, 200, 'GET /cuentas/:ordenId (006, criterio 36)');
    expect(vista.body.totales).toMatchObject({ descuentos: '5.60', total: '63.60' });
    // `version` de la cuenta es `orden.version` (criterio 36).
    expect(vista.body.version).toBe(await versionDe(cuenta.ordenId));
    expect(vista.body.lineas.find((l: Libre) => l.itemId === cuenta.item.lomo)).toMatchObject({
      neto: '50.40',
      descuento: { monto: '5.60' },
    });
  });

  it('un ítem tiene a lo más un descuento vigente; uno anulado o todo en cortesía responde 409 CONFLICTO', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    exigirEstado(await descuento(sup, cuenta, { itemId: cuenta.item.lomo! }), 201, 'Descuento');
    esperarError(
      await descuento(sup, cuenta, { itemId: cuenta.item.lomo!, valor: '15.00' }),
      409,
      'CONFLICTO',
    );
    // Un ítem con toda su cantidad en cortesía.
    exigirEstado(await cortesia(sup, cuenta, { itemId: cuenta.item.gaseosa! }), 201, 'Cortesía');
    esperarError(
      await descuento(sup, cuenta, { itemId: cuenta.item.gaseosa!, valor: '10.00' }),
      409,
      'CONFLICTO',
    );
    // Un ítem anulado.
    exigirEstado(
      await escribir(
        ctx,
        sup,
        'post',
        `/ordenes/${cuenta.ordenId}/items/${cuenta.item.mandarina}/anulaciones`,
        {
          id: randomUUID(),
          cantidad: 1,
          motivo: 'Error de toma',
          destinoStock: 'VUELVE',
        },
      ),
      201,
      'Anular la Mandarina',
    );
    esperarError(
      await descuento(sup, cuenta, { itemId: cuenta.item.mandarina! }),
      409,
      'CONFLICTO',
    );
  });

  it('descuento por cuenta: S/ 5.00 deja la cuenta C en 64.20; a lo más uno vigente por cuenta', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    const res = await descuento(sup, cuenta, { itemId: null, tipo: 'MONTO', valor: '5.00' });
    exigirEstado(res, 201, 'Descuento por cuenta (006, criterio 39)');
    expect(res.body).toMatchObject({ itemId: null, tipo: 'MONTO', valor: '5.00', monto: '5.00' });
    esperarError(
      await descuento(sup, cuenta, { itemId: null, tipo: 'MONTO', valor: '1.00' }),
      409,
      'CONFLICTO',
    );
    const vista = await api(ctx, A().token.cajero, 'get', `/cuentas/${cuenta.ordenId}`);
    expect(vista.body.totales).toMatchObject({ descuentos: '5.00', total: '64.20' });
  });

  it('quitar un descuento responde 204, deja quién y cuándo, sube la versión; repetirlo es 204 sin efecto', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    const creado = await descuento(sup, cuenta, { itemId: cuenta.item.lomo! });
    exigirEstado(creado, 201, 'Descuento');
    const ruta = `/cuentas/${cuenta.ordenId}/descuentos/${creado.body.id}`;
    const antes = await versionDe(cuenta.ordenId);
    expect((await quitar(A().token.mozo!, ruta)).status).toBe(204); // ATENDER_MESA, sin clave
    const [fila] = await filasDeDescuento(cuenta.ordenId);
    expect(fila!.quitado_en).not.toBeNull();
    expect(fila!.quitado_por_id).toBeTruthy();
    const quitada = await versionDe(cuenta.ordenId);
    expect(quitada).toBeGreaterThan(antes);
    expect((await quitar(sup, ruta)).status).toBe(204);
    expect(await versionDe(cuenta.ordenId)).toBe(quitada);
    // Quitado, se puede aplicar otro.
    exigirEstado(
      await descuento(sup, cuenta, { itemId: cuenta.item.lomo!, valor: '20.00' }),
      201,
      'Otro descuento',
    );
    // Cocina/Barra no quita.
    esperarError(await quitar(A().token.cocina!, ruta), 403, 'PROHIBIDO');
  });
});

describe('criterio 43 · cortesías', () => {
  it('una cortesía de la Gaseosa vale 9.00 de referencia y se puede quitar', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    const res = await cortesia(sup, cuenta, { itemId: cuenta.item.gaseosa! });
    exigirEstado(res, 201, 'Cortesía (006, criterio 43)');
    expect(res.body).toMatchObject({
      itemId: cuenta.item.gaseosa,
      cantidad: 1,
      valorReferencial: '9.00',
      autorizadoPor: null,
    });
    const vista = await api(ctx, A().token.cajero, 'get', `/cuentas/${cuenta.ordenId}`);
    expect(vista.body.totales).toMatchObject({
      total: '60.20',
      operaciones: { gratuitas: '7.63' },
      igvGratuitas: '1.37',
    });
    esperarError(await cortesia(sup, cuenta, { itemId: cuenta.item.gaseosa! }), 409, 'CONFLICTO');
    expect((await quitar(sup, `/cuentas/${cuenta.ordenId}/cortesias/${res.body.id}`)).status).toBe(
      204,
    );
    const [fila] = await filas('SELECT quitada_en, quitada_por_id FROM cortesia WHERE id = $1', [
      res.body.id,
    ]);
    expect(fila!.quitada_en).not.toBeNull();
    expect(fila!.quitada_por_id).toBeTruthy();
  });

  it('un ítem con ICBPER no admite cortesía (422 CORTESIA_INVALIDA) y uno con descuento tampoco (409 CONFLICTO)', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    esperarError(
      await cortesia(sup, cuenta, { itemId: cuenta.item.bolsa!, cantidad: 1 }),
      422,
      'CORTESIA_INVALIDA',
    );
    exigirEstado(await descuento(sup, cuenta, { itemId: cuenta.item.lomo! }), 201, 'Descuento');
    esperarError(
      await cortesia(sup, cuenta, { itemId: cuenta.item.lomo!, cantidad: 1 }),
      409,
      'CONFLICTO',
    );
  });
});

describe('criterio 40 · la clave queda atada a lo autorizado', () => {
  it('el Supervisor aplica sin clave; el Mozo y el Cajero sin clave reciben 403 CLAVE_REQUERIDA; Cocina/Barra, 403 PROHIBIDO', async () => {
    const cuenta = await cuentaC(ctx, A());
    for (const token of [A().token.mozo!, A().token.cajero!]) {
      esperarError(
        await descuento(token, cuenta, { itemId: cuenta.item.lomo! }),
        403,
        'CLAVE_REQUERIDA',
      );
      esperarError(
        await cortesia(token, cuenta, { itemId: cuenta.item.gaseosa! }),
        403,
        'CLAVE_REQUERIDA',
      );
    }
    esperarError(
      await descuento(A().token.cocina!, cuenta, { itemId: cuenta.item.lomo! }),
      403,
      'PROHIBIDO',
    );
    expect(await filasDeDescuento(cuenta.ordenId)).toEqual([]);
    exigirEstado(
      await descuento(A().token.supervisor!, cuenta, { itemId: cuenta.item.lomo! }),
      201,
      'El Supervisor aplica',
    );
  });

  it('el motivo es obligatorio para todos', async () => {
    const cuenta = await cuentaC(ctx, A());
    esperarError(
      await descuento(A().token.supervisor!, cuenta, { itemId: cuenta.item.lomo!, motivo: '' }),
      400,
      'DATOS_INVALIDOS',
    );
    expect(await filasDeDescuento(cuenta.ordenId)).toEqual([]);
  });

  it('con la autorización del objetivo exacto el Cajero aplica y queda el autorizador', async () => {
    const cuenta = await cuentaC(ctx, A());
    // El valor se normaliza a 2 decimales: "10" en el objetivo equivale a "10.00" en el cuerpo.
    const auth = await autorizar(
      ctx,
      A().token.cajero!,
      pin(),
      'APLICAR_DESCUENTO',
      objetivoDescuento(cuenta, cuenta.item.lomo!, 'PORCENTAJE', '10'),
    );
    const res = await descuento(
      A().token.cajero!,
      cuenta,
      { itemId: cuenta.item.lomo! },
      auth.autorizacionId,
    );
    exigirEstado(res, 201, 'Descuento con clave (006, criterio 40)');
    expect(res.body.autorizadoPor).toMatchObject({ id: A().personas.supervisor!.id });
    expect(res.body.creadoPor).toMatchObject({ id: A().personas.cajero!.id });
  });

  it('otro valor, otro ítem, otra orden, sin objetivo o de otra acción: 403 AUTORIZACION_INVALIDA y nada cambia', async () => {
    const cuenta = await cuentaC(ctx, A());
    const otra = await cuentaC(ctx, A());
    const cajero = A().token.cajero!;
    const casos: Array<[string, () => Promise<{ autorizacionId: string }>]> = [
      [
        'otro valor',
        () =>
          autorizar(
            ctx,
            cajero,
            pin(),
            'APLICAR_DESCUENTO',
            objetivoDescuento(cuenta, cuenta.item.lomo!, 'PORCENTAJE', '5.00'),
          ),
      ],
      [
        'otro tipo',
        () =>
          autorizar(
            ctx,
            cajero,
            pin(),
            'APLICAR_DESCUENTO',
            objetivoDescuento(cuenta, cuenta.item.lomo!, 'MONTO', '10.00'),
          ),
      ],
      [
        'otro ítem',
        () =>
          autorizar(
            ctx,
            cajero,
            pin(),
            'APLICAR_DESCUENTO',
            objetivoDescuento(cuenta, cuenta.item.gaseosa!),
          ),
      ],
      [
        'otra orden',
        () =>
          autorizar(
            ctx,
            cajero,
            pin(),
            'APLICAR_DESCUENTO',
            objetivoDescuento(otra, cuenta.item.lomo!),
          ),
      ],
      ['sin objetivo', () => autorizar(ctx, cajero, pin(), 'APLICAR_DESCUENTO')],
      ['otra acción', () => autorizar(ctx, cajero, pin(), 'ANULAR_ITEM_ENVIADO')],
      [
        'objetivo de cortesía',
        () =>
          autorizar(ctx, cajero, pin(), 'APLICAR_DESCUENTO', {
            tipo: 'CORTESIA',
            ordenId: cuenta.ordenId,
            itemId: cuenta.item.lomo!,
            cantidad: 1,
          }),
      ],
    ];
    for (const [que, pedir] of casos) {
      let auth: { autorizacionId: string };
      try {
        auth = await pedir();
      } catch {
        continue; // La API pudo rechazar de entrada una autorización incoherente: tampoco sirve.
      }
      const res = await descuento(
        cajero,
        cuenta,
        { itemId: cuenta.item.lomo! },
        auth.autorizacionId,
      );
      expect(res.status, `${que}: ${res.text}`).toBe(403);
      expect(res.body.codigo, que).toBe('AUTORIZACION_INVALIDA');
    }
    expect(await filasDeDescuento(cuenta.ordenId)).toEqual([]);
  });

  it('una autorización vencida (ahora ≥ expiraEn, 2 minutos) responde 403 AUTORIZACION_INVALIDA; un instante antes todavía sirve', async () => {
    const cuenta = await cuentaC(ctx, A());
    const objetivo = objetivoDescuento(cuenta, cuenta.item.lomo!);
    const auth = await autorizar(ctx, A().token.cajero!, pin(), 'APLICAR_DESCUENTO', objetivo);
    ctx.reloj.avanzar(2 * 60_000);
    const exacta = await descuento(
      A().token.cajero!,
      cuenta,
      { itemId: cuenta.item.lomo! },
      auth.autorizacionId,
    );
    esperarError(exacta, 403, 'AUTORIZACION_INVALIDA');
    expect(await filasDeDescuento(cuenta.ordenId)).toEqual([]);
    const justa = await autorizar(ctx, A().token.cajero!, pin(), 'APLICAR_DESCUENTO', objetivo);
    ctx.reloj.avanzar(2 * 60_000 - 1_000);
    exigirEstado(
      await descuento(
        A().token.cajero!,
        cuenta,
        { itemId: cuenta.item.lomo! },
        justa.autorizacionId,
      ),
      201,
      'Un segundo antes de vencer',
    );
  });

  it('la autorización se consume una vez; si la acción falla después se devuelve y se puede usar de nuevo', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    const cajero = A().token.cajero!;
    const previo = await descuento(sup, cuenta, { itemId: cuenta.item.lomo! });
    exigirEstado(previo, 201, 'Descuento previo');
    const auth = await autorizar(
      ctx,
      cajero,
      pin(),
      'APLICAR_DESCUENTO',
      objetivoDescuento(cuenta, cuenta.item.lomo!),
    );
    // Falla por el 409 de estado (ya hay un descuento): la reversión devuelve la autorización.
    esperarError(
      await descuento(cajero, cuenta, { itemId: cuenta.item.lomo! }, auth.autorizacionId),
      409,
      'CONFLICTO',
    );
    expect(
      (await quitar(sup, `/cuentas/${cuenta.ordenId}/descuentos/${previo.body.id}`)).status,
    ).toBe(204);
    const segunda = await descuento(
      cajero,
      cuenta,
      { itemId: cuenta.item.lomo! },
      auth.autorizacionId,
    );
    exigirEstado(segunda, 201, 'Con la misma autorización');
    // Ya consumida: no sirve otra vez.
    exigirEstado(
      await quitar(sup, `/cuentas/${cuenta.ordenId}/descuentos/${segunda.body.id}`),
      204,
      'Quitar',
    );
    esperarError(
      await descuento(cajero, cuenta, { itemId: cuenta.item.lomo! }, auth.autorizacionId),
      403,
      'AUTORIZACION_INVALIDA',
    );
  });

  it('la cortesía lleva su clave atada a la cantidad: otra cantidad es 403 AUTORIZACION_INVALIDA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cajero = A().token.cajero!;
    const objetivo = (cantidad: number) => ({
      tipo: 'CORTESIA',
      ordenId: cuenta.ordenId,
      itemId: cuenta.item.lomo!,
      cantidad,
    });
    const mala = await autorizar(ctx, cajero, pin(), 'APLICAR_CORTESIA', objetivo(2));
    esperarError(
      await cortesia(
        cajero,
        cuenta,
        { itemId: cuenta.item.lomo!, cantidad: 1 },
        mala.autorizacionId,
      ),
      403,
      'AUTORIZACION_INVALIDA',
    );
    const buena = await autorizar(ctx, cajero, pin(), 'APLICAR_CORTESIA', objetivo(1));
    const res = await cortesia(
      cajero,
      cuenta,
      { itemId: cuenta.item.lomo!, cantidad: 1 },
      buena.autorizacionId,
    );
    exigirEstado(res, 201, 'Cortesía con clave');
    expect(res.body.autorizadoPor).toMatchObject({ id: A().personas.supervisor!.id });
  });
});

describe('criterio 41 · validación', () => {
  it('100 %, un monto igual al bruto o un porcentaje que redondea a cero responden 422 DESCUENTO_INVALIDO con campos.valor', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    const casos: Array<Parameters<typeof descuento>[2]> = [
      { itemId: cuenta.item.lomo!, tipo: 'PORCENTAJE', valor: '100.00' },
      { itemId: cuenta.item.lomo!, tipo: 'MONTO', valor: '56.00' },
      { itemId: cuenta.item.gaseosa!, tipo: 'PORCENTAJE', valor: '0.01' },
      { itemId: null, tipo: 'MONTO', valor: '999.00' },
    ];
    for (const caso of casos) {
      const res = await descuento(sup, cuenta, caso);
      esperarError(res, 422, 'DESCUENTO_INVALIDO');
      expect((res.body.campos as Array<{ campo: string }>).map((c) => c.campo)).toContain('valor');
    }
    expect(await filasDeDescuento(cuenta.ordenId)).toEqual([]);
  });

  it('un ítem de otra orden o inexistente responde 404', async () => {
    const cuenta = await cuentaC(ctx, A());
    const otra = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    expect((await descuento(sup, cuenta, { itemId: otra.item.lomo! })).status).toBe(404);
    expect((await descuento(sup, cuenta, { itemId: randomUUID() })).status).toBe(404);
  });
});

describe('criterio 44 · efectos en la cuenta', () => {
  it('con la pre-cuenta pedida, un descuento la invalida, la orden vuelve a ABIERTA, la mesa a ocupada y se publican los eventos', async () => {
    const cuenta = await cuentaC(ctx, A());
    exigirEstado(
      await escribir(ctx, A().token.mozo!, 'post', `/ordenes/${cuenta.ordenId}/precuentas`, {
        id: randomUUID(),
      }),
      201,
      'Pedir la pre-cuenta',
    );
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('EN_PRECUENTA');
    expect(await estadoDeMesa(ctx, A().token.mozo!, cuenta.mesaId)).toBe('EN_PRECUENTA');
    const antes = await versionDe(cuenta.ordenId);
    ctx.publicador.limpiar();
    exigirEstado(
      await descuento(A().token.supervisor!, cuenta, { itemId: cuenta.item.lomo! }),
      201,
      'Descuento',
    );
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
    expect(await estadoDeMesa(ctx, A().token.mozo!, cuenta.mesaId)).toBe('OCUPADA');
    expect(await versionDe(cuenta.ordenId)).toBeGreaterThan(antes);
    const invalidadas = await filas('SELECT invalidada_en FROM precuenta WHERE orden_id = $1', [
      cuenta.ordenId,
    ]);
    expect(invalidadas.every((p) => p.invalidada_en !== null)).toBe(true);
    expect(
      eventosDe(ctx, 'orden.cambio').some((e) => (e.datos as Libre).ordenId === cuenta.ordenId),
    ).toBe(true);
    expect(eventosDe(ctx, 'salon.cambio').length).toBeGreaterThan(0);
    for (const e of ctx.publicador.eventos())
      expect(e.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
  });

  it('la pre-cuenta siguiente muestra cada descuento y cortesía con su monto y el total sin ICBPER, con la misma nota', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    exigirEstado(await descuento(sup, cuenta, { itemId: cuenta.item.lomo! }), 201, 'Descuento');
    exigirEstado(await cortesia(sup, cuenta, { itemId: cuenta.item.gaseosa! }), 201, 'Cortesía');
    const res = await escribir(
      ctx,
      A().token.mozo!,
      'post',
      `/ordenes/${cuenta.ordenId}/precuentas`,
      { id: randomUUID() },
    );
    exigirEstado(res, 201, 'Pedir la pre-cuenta');
    const pre = precuentaRespuestaSchema.parse(res.body);
    expect(pre.descuentos).toEqual([
      { itemId: cuenta.item.lomo, tipo: 'PORCENTAJE', valor: '10.00', monto: '5.60' },
    ]);
    expect(pre.cortesias).toEqual([
      { itemId: cuenta.item.gaseosa, cantidad: 1, valorReferencial: '9.00' },
    ]);
    // 68.20 − 5.60 − 9.00, sin ICBPER.
    expect(pre.total).toBe('53.60');
    expect(pre.nota).toContain('El ICBPER se suma al cobrar');
  });

  it('quitar un descuento también cambia la versión y vuelve a invalidar la pre-cuenta', async () => {
    const cuenta = await cuentaC(ctx, A());
    const creado = await descuento(A().token.supervisor!, cuenta, { itemId: cuenta.item.lomo! });
    exigirEstado(creado, 201, 'Descuento');
    exigirEstado(
      await escribir(ctx, A().token.mozo!, 'post', `/ordenes/${cuenta.ordenId}/precuentas`, {
        id: randomUUID(),
      }),
      201,
      'Pedir la pre-cuenta',
    );
    const antes = await versionDe(cuenta.ordenId);
    expect(
      (
        await quitar(
          A().token.supervisor!,
          `/cuentas/${cuenta.ordenId}/descuentos/${creado.body.id}`,
        )
      ).status,
    ).toBe(204);
    expect(await versionDe(cuenta.ordenId)).toBeGreaterThan(antes);
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
  });
});

describe('criterio 45 · solo antes de cobrar y en una orden abierta', () => {
  it('con algún cobro, aplicar o quitar descuentos y cortesías responde 409 CUENTA_EN_COBRO', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    const previo = await descuento(sup, cuenta, { itemId: cuenta.item.gaseosa!, valor: '10.00' });
    exigirEstado(previo, 201, 'Descuento previo');
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '28.00',
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] },
    });
    esperarError(
      await descuento(sup, cuenta, { itemId: cuenta.item.lomo! }),
      409,
      'CUENTA_EN_COBRO',
    );
    esperarError(
      await cortesia(sup, cuenta, { itemId: cuenta.item.mandarina! }),
      409,
      'CUENTA_EN_COBRO',
    );
    esperarError(
      await quitar(sup, `/cuentas/${cuenta.ordenId}/descuentos/${previo.body.id}`),
      409,
      'CUENTA_EN_COBRO',
    );
  });

  it('en una orden anulada o unida responde 409 ORDEN_NO_ABIERTA (con el ordenId de la principal si está unida)', async () => {
    const sup = A().token.supervisor!;
    const anulada = await cuentaC(ctx, A());
    exigirEstado(
      await escribir(ctx, sup, 'post', `/ordenes/${anulada.ordenId}/anulacion`, {
        motivo: 'Se fue',
        destinoStock: 'VUELVE',
      }),
      200,
      'Anular',
    );
    esperarError(
      await descuento(sup, anulada, { itemId: anulada.item.lomo! }),
      409,
      'ORDEN_NO_ABIERTA',
    );
    const principal = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const absorbida = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    exigirEstado(
      await escribir(ctx, sup, 'post', `/ordenes/${principal.ordenId}/union`, {
        mesaIds: [absorbida.mesaId],
      }),
      200,
      'Unir',
    );
    const res = await descuento(sup, absorbida, { itemId: absorbida.item.lomo! });
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(principal.ordenId);
  });
});

describe('criterio 46 · auditoría', () => {
  const delOrden = async (accion: string, ordenId: string) =>
    (await filasAuditoria(A().id, accion)).filter((f) => f.texto.includes(ordenId));

  it('cada acción deja exactamente una fila con el motivo y el detalle; la réplica no deja otra', async () => {
    const cuenta = await cuentaC(ctx, A());
    const sup = A().token.supervisor!;
    const clave = randomUUID();
    const cuerpo = {
      id: randomUUID(),
      itemId: cuenta.item.lomo,
      tipo: 'PORCENTAJE',
      valor: '10.00',
      motivo: 'Cliente frecuente',
    };
    const primera = await escribir(
      ctx,
      sup,
      'post',
      `/cuentas/${cuenta.ordenId}/descuentos`,
      cuerpo,
      { 'Idempotency-Key': clave },
    );
    exigirEstado(primera, 201, 'Descuento');
    const replica = await escribir(
      ctx,
      sup,
      'post',
      `/cuentas/${cuenta.ordenId}/descuentos`,
      cuerpo,
      { 'Idempotency-Key': clave },
    );
    expect(replica.status).toBe(201);
    const filasDescuento = await delOrden('aplicar_descuento', cuenta.ordenId);
    expect(filasDescuento).toHaveLength(1);
    const texto = filasDescuento[0]!.texto;
    for (const parte of ['Cliente frecuente', 'Lomo saltado', '5.60', cuenta.item.lomo!])
      expect(texto).toContain(parte);

    const cortesiaCreada = await cortesia(sup, cuenta, { itemId: cuenta.item.gaseosa! });
    exigirEstado(cortesiaCreada, 201, 'Cortesía');
    const filasCortesia = await delOrden('aplicar_cortesia', cuenta.ordenId);
    expect(filasCortesia).toHaveLength(1);
    expect(filasCortesia[0]!.texto).toContain('9.00');

    expect(
      (await quitar(sup, `/cuentas/${cuenta.ordenId}/descuentos/${primera.body.id}`)).status,
    ).toBe(204);
    expect(
      (await quitar(sup, `/cuentas/${cuenta.ordenId}/descuentos/${primera.body.id}`)).status,
    ).toBe(204);
    expect(
      (await quitar(sup, `/cuentas/${cuenta.ordenId}/cortesias/${cortesiaCreada.body.id}`)).status,
    ).toBe(204);
    expect(await delOrden('quitar_descuento', cuenta.ordenId)).toHaveLength(1);
    expect(await delOrden('quitar_cortesia', cuenta.ordenId)).toHaveLength(1);
  });

  it('con clave queda el autorizador, la autorización y la fila de consumo de 002', async () => {
    const cuenta = await cuentaC(ctx, A());
    const auth = await autorizar(
      ctx,
      A().token.cajero!,
      pin(),
      'APLICAR_DESCUENTO',
      objetivoDescuento(cuenta, cuenta.item.lomo!),
    );
    const res = await descuento(
      A().token.cajero!,
      cuenta,
      { itemId: cuenta.item.lomo! },
      auth.autorizacionId,
    );
    exigirEstado(res, 201, 'Descuento con clave');
    const [fila] = await delOrden('aplicar_descuento', cuenta.ordenId);
    expect(fila!.texto).toContain(A().personas.supervisor!.id);
    expect(fila!.texto).toContain(auth.autorizacionId);
    const consumos = (await filasAuditoria(A().id, 'APLICAR_DESCUENTO')).filter((f) =>
      f.texto.includes(auth.autorizacionId),
    );
    expect(consumos.length).toBeGreaterThanOrEqual(1);
  });
});
