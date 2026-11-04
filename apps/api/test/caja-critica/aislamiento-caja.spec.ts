// spec: 006-caja-cobro (pruebas protegidas)
//
// P6 (parte 3) · Aislamiento entre empresas por HTTP, ids de cliente y concurrencia (ruta crítica), criterios 106 y 107:
// - 106: en toda ruta de caja, un id de B en la ruta responde 404 y en el cuerpo 404 o 422, con el mismo estado y el mismo
//   cuerpo que un id inexistente y sin cambios en B; los ids que genera el cliente (turno, movimiento, cobro, descuento y
//   cortesía) son únicos por empresa: el mismo id usado en B crea su propia fila; las series de A y de B pueden ser
//   iguales (`B001`) y cada una numera por su lado;
// - 107: con un pool de 2 conexiones, 100 cobros concurrentes alternando A y B (cada una con su turno y su serie `B001`)
//   dejan cada serie con sus números consecutivos, cada cobro en su empresa y cada evento solo en su empresa.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cobrar,
  cobrarCrudo,
  crearEscenario,
  cuentaC,
  cuentaCon,
  cuerpoDeCobro,
  escribir,
  exigirEstado,
  filas,
  ultimoNumero,
  versionDe,
  yape,
  type AppP5,
  type Cuenta,
  type Escenario,
  type Libre,
  type Res,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;
const B = () => esc.B;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 2 });
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

/** Lo de B que las pruebas intentan tocar desde A. */
interface DeB {
  caja: string;
  turno: string;
  orden: string;
  itemLomo: string;
  comprobante: string;
  descuento: string;
  cortesia: string;
}
let deBPendiente: Promise<DeB> | undefined;
function deB(): Promise<DeB> {
  deBPendiente ??= (async () => {
    const cajas = await B().cajas();
    const turno = await abrirTurno(ctx, B().token.cajero!, cajas.S1!.caja1);
    const cuentaDescuentos = await cuentaC(ctx, B(), 'S1');
    const sup = B().token.supervisor!;
    const d = await escribir(ctx, sup, 'post', `/cuentas/${cuentaDescuentos.ordenId}/descuentos`, {
      id: randomUUID(),
      itemId: cuentaDescuentos.item.lomo,
      tipo: 'PORCENTAJE',
      valor: '10.00',
      motivo: 'Prueba',
    });
    exigirEstado(d, 201, 'Descuento en B');
    const c = await escribir(ctx, sup, 'post', `/cuentas/${cuentaDescuentos.ordenId}/cortesias`, {
      id: randomUUID(),
      itemId: cuentaDescuentos.item.gaseosa,
      cantidad: 1,
      motivo: 'Prueba',
    });
    exigirEstado(c, 201, 'Cortesía en B');
    const cobrada = await cuentaC(ctx, B(), 'S1');
    const cobro = await cobrar(ctx, B().token.cajero!, cobrada, { turnoId: turno, total: '69.20' });
    return {
      caja: cajas.S1!.caja1,
      turno,
      orden: cuentaDescuentos.ordenId,
      itemLomo: cuentaDescuentos.item.lomo!,
      comprobante: cobro.comprobante.id as string,
      descuento: d.body.id as string,
      cortesia: c.body.id as string,
    };
  })();
  return deBPendiente;
}

/** Foto de las filas de B en las tablas que las pruebas no deben cambiar. */
async function fotoDeB() {
  const foto: Record<string, unknown> = {};
  for (const tabla of [
    'caja',
    'turno',
    'movimiento_caja',
    'cobro',
    'comprobante',
    'serie',
    'descuento',
    'cortesia',
    'orden',
  ]) {
    foto[tabla] = (
      await filas(
        `SELECT to_jsonb(t) AS f FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
        [B().id],
      )
    ).map((x) => x.f);
  }
  return foto;
}

/** El mismo estado y el mismo cuerpo para el id de B y para un id inexistente. */
async function igualQueInexistente(
  que: string,
  clave: keyof DeB,
  conIdDeB: (id: string) => Promise<Res>,
  estados: number[] = [404],
): Promise<void> {
  const idB = (await deB())[clave];
  const cruzada = await conIdDeB(idB);
  const inexistente = await conIdDeB(randomUUID());
  expect(estados, `${que}: ${cruzada.status} ${cruzada.text}`).toContain(cruzada.status);
  expect(cruzada.status, que).toBe(inexistente.status);
  expect(cruzada.body, que).toEqual(inexistente.body);
  expect(cruzada.text, que).not.toMatch(/SQLSTATE|violates|relation "|restaurante_/);
}

/** El turno abierto de una caja o, si no hay, uno nuevo del dueño del token. */
async function turnoAbiertoEn(token: string, cajaId: string): Promise<string> {
  const [t] = await filas(`SELECT id FROM turno WHERE estado = 'ABIERTO' AND caja_id = $1`, [
    cajaId,
  ]);
  return (t?.id as string | undefined) ?? (await abrirTurno(ctx, token, cajaId));
}

describe('criterio 106 · un id de B en la ruta o en el cuerpo se ve igual que uno inexistente', () => {
  type Caso = [string, keyof DeB, (id: string) => Promise<Res>, number[]?];
  const casos = (): Caso[] => {
    const cajero = A().token.cajero!;
    const sup = A().token.supervisor!;
    const admin = A().token.admin!;
    return [
      ['GET /turnos/:id', 'turno', (id) => api(ctx, cajero, 'get', `/turnos/${id}`)],
      [
        'GET /turnos/:id/reporte',
        'turno',
        (id) => api(ctx, cajero, 'get', `/turnos/${id}/reporte`),
      ],
      [
        'POST /turnos/:id/movimientos',
        'turno',
        (id) =>
          escribir(ctx, cajero, 'post', `/turnos/${id}/movimientos`, {
            id: randomUUID(),
            tipo: 'INGRESO',
            monto: '1.00',
            motivo: 'Prueba',
          }),
      ],
      [
        'POST /turnos/:id/reporte-x/impresiones',
        'turno',
        (id) => escribir(ctx, cajero, 'post', `/turnos/${id}/reporte-x/impresiones`),
      ],
      [
        'POST /turnos/:id/cierre',
        'turno',
        (id) =>
          escribir(ctx, cajero, 'post', `/turnos/${id}/cierre`, {
            conteo: ['EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'].map(
              (medio) => ({ medio, contado: '0.00', motivo: 'x' }),
            ),
          }),
      ],
      ['GET /cuentas/:ordenId', 'orden', (id) => api(ctx, cajero, 'get', `/cuentas/${id}`)],
      [
        'POST /cuentas/:ordenId/cobros',
        'orden',
        async (id) =>
          cobrarCrudo(
            ctx,
            cajero,
            id,
            cuerpoDeCobro({ turnoId: randomUUID(), version: 1, total: '1.00' }),
          ),
      ],
      [
        'POST /cuentas/:ordenId/descuentos',
        'orden',
        (id) =>
          escribir(ctx, sup, 'post', `/cuentas/${id}/descuentos`, {
            id: randomUUID(),
            itemId: null,
            tipo: 'MONTO',
            valor: '1.00',
            motivo: 'Prueba',
          }),
      ],
      [
        'POST /cuentas/:ordenId/cortesias',
        'orden',
        (id) =>
          escribir(ctx, sup, 'post', `/cuentas/${id}/cortesias`, {
            id: randomUUID(),
            itemId: randomUUID(),
            cantidad: 1,
            motivo: 'Prueba',
          }),
      ],
      [
        'DELETE /cuentas/:ordenId/descuentos/:id',
        'descuento',
        (id) => api(ctx, sup, 'delete', `/cuentas/${randomUUID()}/descuentos/${id}`),
      ],
      [
        'DELETE /cuentas/:ordenId/cortesias/:id',
        'cortesia',
        (id) => api(ctx, sup, 'delete', `/cuentas/${randomUUID()}/cortesias/${id}`),
      ],
      [
        'GET /comprobantes/:id',
        'comprobante',
        (id) => api(ctx, cajero, 'get', `/comprobantes/${id}`),
      ],
      [
        'POST /comprobantes/:id/impresiones',
        'comprobante',
        (id) => escribir(ctx, cajero, 'post', `/comprobantes/${id}/impresiones`),
      ],
      [
        'GET /sucursales/:sucursalId/cajas',
        'caja',
        (_id) => api(ctx, admin, 'get', `/sucursales/${B().S1}/cajas`),
      ],
      [
        'PATCH /sucursales/:sucursalId/cajas/:id',
        'caja',
        (id) =>
          api(ctx, admin, 'patch', `/sucursales/${A().S1}/cajas/${id}`, { nombre: 'Intento' }),
      ],
      [
        'PUT /sucursales/:sucursalId/cajas/:cajaId/series/:tipo',
        'caja',
        (id) =>
          api(ctx, admin, 'put', `/sucursales/${A().S1}/cajas/${id}/series/BOLETA`, {
            serie: 'B9Q9',
          }),
      ],
      [
        'PUT /emisores/:id/tasas-igv/:desde',
        'caja',
        (id) => api(ctx, admin, 'put', `/emisores/${id}/tasas-igv/2031-01-01`, { tasa: '10.00' }),
      ],
    ];
  };

  it('en la ruta: 404 con el mismo cuerpo que un id inexistente y sin cambios en B', async () => {
    await deB();
    const antes = await fotoDeB();
    const fallos: string[] = [];
    for (const [que, clave, llamada, estados] of casos()) {
      try {
        await igualQueInexistente(que, clave, llamada, estados ?? [404]);
      } catch (e) {
        fallos.push(`${que}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await fotoDeB()).toEqual(antes);
  });

  it('en el cuerpo: un turno, una caja o un ítem de B es 404 o 422 igual que uno inexistente', async () => {
    const b = await deB();
    const cajero = A().token.cajero!;
    const sup = A().token.supervisor!;
    const antes = await fotoDeB();
    const cuentaA = await cuentaC(ctx, A());
    const cuerpos: Array<[string, (id: string) => Promise<Res>]> = [
      [
        'POST /turnos con cajaId',
        (id) =>
          escribir(ctx, cajero, 'post', '/turnos', {
            id: randomUUID(),
            cajaId: id,
            fondo: '10.00',
          }),
      ],
      [
        'cobro con turnoId',
        async (id) =>
          cobrarCrudo(
            ctx,
            cajero,
            cuentaA.ordenId,
            cuerpoDeCobro({
              turnoId: id,
              version: await versionDe(cuentaA.ordenId),
              total: '69.20',
            }),
          ),
      ],
      [
        'cobro con itemId en la parte',
        async (id) =>
          cobrarCrudo(
            ctx,
            cajero,
            cuentaA.ordenId,
            cuerpoDeCobro({
              turnoId: randomUUID(),
              version: await versionDe(cuentaA.ordenId),
              total: '28.00',
              parte: { tipo: 'ITEMS', items: [{ itemId: id, cantidad: 1 }] },
            }),
          ),
      ],
      [
        'descuento con itemId',
        (id) =>
          escribir(ctx, sup, 'post', `/cuentas/${cuentaA.ordenId}/descuentos`, {
            id: randomUUID(),
            itemId: id,
            tipo: 'PORCENTAJE',
            valor: '10.00',
            motivo: 'Prueba',
          }),
      ],
      [
        'cortesía con itemId',
        (id) =>
          escribir(ctx, sup, 'post', `/cuentas/${cuentaA.ordenId}/cortesias`, {
            id: randomUUID(),
            itemId: id,
            cantidad: 1,
            motivo: 'Prueba',
          }),
      ],
      [
        'caja con impresoraId',
        (id) =>
          api(ctx, A().token.admin, 'patch', `/sucursales/${A().S1}/cajas/${randomUUID()}`, {
            impresoraId: id,
          }),
      ],
    ];
    const ids: Record<string, string> = {
      'POST /turnos con cajaId': b.caja,
      'cobro con turnoId': b.turno,
      'cobro con itemId en la parte': b.itemLomo,
      'descuento con itemId': b.itemLomo,
      'cortesía con itemId': b.itemLomo,
      'caja con impresoraId': b.caja,
    };
    const fallos: string[] = [];
    for (const [que, llamada] of cuerpos) {
      const cruzada = await llamada(ids[que]!);
      const inexistente = await llamada(randomUUID());
      if (
        ![404, 422].includes(cruzada.status) ||
        cruzada.status !== inexistente.status ||
        JSON.stringify(cruzada.body) !== JSON.stringify(inexistente.body)
      ) {
        fallos.push(
          `${que}: ${cruzada.status} ${cruzada.text} / ${inexistente.status} ${inexistente.text}`,
        );
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await fotoDeB()).toEqual(antes);
  });

  it('los ids que genera el cliente son únicos por empresa: el mismo id en B crea su propia fila', async () => {
    const cajasA = await A().cajas();
    const cajasB = await B().cajas();
    const idTurno = randomUUID();
    const a = await escribir(ctx, A().token.cajero2!, 'post', '/turnos', {
      id: idTurno,
      cajaId: cajasA.S1!.caja2,
      fondo: '10.00',
    });
    const b = await escribir(ctx, B().token.supervisor!, 'post', '/turnos', {
      id: idTurno,
      cajaId: cajasB.S1!.caja2,
      fondo: '20.00',
    });
    exigirEstado(a, 201, 'Turno en A');
    exigirEstado(b, 201, 'Turno con el mismo id en B');
    expect(a.body.fondo).toBe('10.00');
    expect(b.body.fondo).toBe('20.00');
    expect(
      await filas('SELECT empresa_id FROM turno WHERE id = $1 ORDER BY empresa_id', [idTurno]),
    ).toHaveLength(2);

    const idMovimiento = randomUUID();
    for (const [token, turnoId] of [
      [A().token.cajero2!, idTurno],
      [B().token.supervisor!, idTurno],
    ] as const) {
      exigirEstado(
        await escribir(ctx, token, 'post', `/turnos/${turnoId}/movimientos`, {
          id: idMovimiento,
          tipo: 'INGRESO',
          monto: '5.00',
          motivo: 'Cambio',
        }),
        201,
        'Movimiento con el mismo id en cada empresa',
      );
    }
    expect(await filas('SELECT 1 FROM movimiento_caja WHERE id = $1', [idMovimiento])).toHaveLength(
      2,
    );

    // El mismo id de cobro, de descuento y de cortesía en cada empresa.
    const idCobro = randomUUID();
    const idDescuento = randomUUID();
    const idCortesia = randomUUID();
    const turnoA = idTurno;
    const turnoB = idTurno;
    const cuentaA = await cuentaC(ctx, A());
    const cuentaB = await cuentaC(ctx, B());
    for (const [e, cuenta] of [
      [A(), cuentaA],
      [B(), cuentaB],
    ] as const) {
      const sup = e.token.supervisor!;
      exigirEstado(
        await escribir(ctx, sup, 'post', `/cuentas/${cuenta.ordenId}/descuentos`, {
          id: idDescuento,
          itemId: cuenta.item.lomo,
          tipo: 'PORCENTAJE',
          valor: '10.00',
          motivo: 'Prueba',
        }),
        201,
        'Descuento con el mismo id',
      );
      exigirEstado(
        await escribir(ctx, sup, 'post', `/cuentas/${cuenta.ordenId}/cortesias`, {
          id: idCortesia,
          itemId: cuenta.item.gaseosa,
          cantidad: 1,
          motivo: 'Prueba',
        }),
        201,
        'Cortesía con el mismo id',
      );
    }
    const cobroA = await cobrar(ctx, A().token.cajero2!, cuentaA, {
      id: idCobro,
      turnoId: turnoA,
      total: '54.60',
    });
    const cobroB = await cobrar(ctx, B().token.supervisor!, cuentaB, {
      id: idCobro,
      turnoId: turnoB,
      total: '54.60',
    });
    expect(cobroA.ordenId).toBe(cuentaA.ordenId);
    expect(cobroB.ordenId).toBe(cuentaB.ordenId);
    expect(await filas('SELECT empresa_id FROM cobro WHERE id = $1', [idCobro])).toHaveLength(2);
    expect(await filas('SELECT 1 FROM descuento WHERE id = $1', [idDescuento])).toHaveLength(2);
    expect(await filas('SELECT 1 FROM cortesia WHERE id = $1', [idCortesia])).toHaveLength(2);
  });

  it('las series de A y de B pueden ser iguales (B001) y cada una numera por su lado', async () => {
    const cajasA = await A().cajas();
    const cajasB = await B().cajas();
    const turnoA = await turnoAbiertoEn(A().token.cajero!, cajasA.S1!.caja1);
    await deB();
    const antesA = await ultimoNumero(cajasA.S1!.caja1, 'BOLETA');
    const antesB = await ultimoNumero(cajasB.S1!.caja1, 'BOLETA');
    const turnoB = await turnoAbiertoEn(B().token.cajero!, cajasB.S1!.caja1);
    const a = await cobrar(ctx, A().token.cajero!, await cuentaC(ctx, A()), {
      turnoId: turnoA,
      total: '69.20',
    });
    const b = await cobrar(ctx, B().token.cajero!, await cuentaC(ctx, B()), {
      turnoId: turnoB,
      total: '69.20',
    });
    expect(a.comprobante.numero).toBe(`B001-${String(antesA + 1).padStart(8, '0')}`);
    expect(b.comprobante.numero).toBe(`B001-${String(antesB + 1).padStart(8, '0')}`);
    expect(await ultimoNumero(cajasA.S1!.caja1, 'BOLETA')).toBe(antesA + 1);
    expect(await ultimoNumero(cajasB.S1!.caja1, 'BOLETA')).toBe(antesB + 1);
  });
});

describe('criterio 107 · concurrencia con un pool de 2 conexiones', () => {
  it('100 cobros concurrentes alternando A y B dejan cada serie consecutiva, cada cobro en su empresa y cada evento en la suya', async () => {
    const cajasA = await A().cajas();
    const cajasB = await B().cajas();
    await deB();
    const turnoA = await turnoAbiertoEn(A().token.cajero!, cajasA.S1!.caja1);
    const turnoB = await turnoAbiertoEn(B().token.cajero!, cajasB.S1!.caja1);
    const antesA = await ultimoNumero(cajasA.S1!.caja1, 'BOLETA');
    const antesB = await ultimoNumero(cajasB.S1!.caja1, 'BOLETA');
    const crear = async (e: Escenario['A'], n: number): Promise<Cuenta[]> => {
      const hechas: Cuenta[] = [];
      for (let i = 0; i < n; i += 5) {
        hechas.push(
          ...(await Promise.all(
            Array.from({ length: Math.min(5, n - i) }, () =>
              cuentaCon(ctx, e, 'S1', [['lomo', 1]]),
            ),
          )),
        );
      }
      return hechas;
    };
    const cuentasA = await crear(A(), 50);
    const cuentasB = await crear(B(), 50);
    ctx.publicador.limpiar();
    const pagos = [yape('28.00')];
    const tareas: Array<Promise<Res>> = [];
    for (let i = 0; i < 50; i++) {
      for (const [e, cuenta, turnoId] of [
        [A(), cuentasA[i]!, turnoA],
        [B(), cuentasB[i]!, turnoB],
      ] as const) {
        tareas.push(
          versionDe(cuenta.ordenId).then((version) =>
            cobrarCrudo(
              ctx,
              e.token.cajero!,
              cuenta.ordenId,
              cuerpoDeCobro({ turnoId, version, total: '28.00', pagos }),
            ),
          ),
        );
      }
    }
    const respuestas = await Promise.all(tareas);
    for (const r of respuestas) expect(r.status, r.text).toBe(201);
    const numeros = (empresaId: string, serie: string) =>
      filas('SELECT numero FROM comprobante WHERE empresa_id = $1 AND serie = $2 ORDER BY numero', [
        empresaId,
        serie,
      ]).then((f) => f.map((x) => Number(x.numero)));
    const nA = (await numeros(A().id, 'B001')).filter((n) => n > antesA);
    const nB = (await numeros(B().id, 'B001')).filter((n) => n > antesB);
    expect(nA).toEqual(Array.from({ length: 50 }, (_, i) => antesA + 1 + i));
    expect(nB).toEqual(Array.from({ length: 50 }, (_, i) => antesB + 1 + i));
    // Cada cobro quedó en su empresa: el comprobante y su orden son de la misma empresa que el token.
    const cruzados = await filas(
      `SELECT 1 FROM comprobante c JOIN orden o ON o.id = c.orden_id WHERE c.empresa_id <> o.empresa_id`,
    );
    expect(cruzados).toEqual([]);
    for (const [e, cuentas] of [
      [A(), cuentasA],
      [B(), cuentasB],
    ] as const) {
      const propios = await filas(
        `SELECT count(*)::int AS n FROM cobro WHERE empresa_id = $1 AND orden_id = ANY($2::uuid[])`,
        [e.id, cuentas.map((c) => c.ordenId)],
      );
      expect(propios[0]!.n).toBe(50);
    }
    // Cada evento solo en su empresa y en la sala de su sucursal.
    const sucursalesDe = (id: string) =>
      id === A().id ? [A().S1, A().S2, A().S3] : [B().S1, B().S2];
    for (const ev of ctx.publicador.eventos()) {
      expect([A().id, B().id]).toContain(ev.empresaId);
      if (ev.sala.tipo === 'sucursal')
        expect(sucursalesDe(ev.empresaId)).toContain(ev.sala.sucursalId);
      const datos = ev.datos as Libre;
      if (ev.nombre === 'orden.cambio') {
        const [o] = await filas('SELECT empresa_id FROM orden WHERE id = $1', [datos.ordenId]);
        expect(o!.empresa_id).toBe(ev.empresaId);
      }
      if (ev.nombre === 'turno.cambio') {
        const [t] = await filas('SELECT empresa_id FROM turno WHERE id = $1', [datos.turnoId]);
        expect(t!.empresa_id).toBe(ev.empresaId);
      }
    }
    expect(JSON.stringify(ctx.publicador.eventos()).length).toBeGreaterThan(0);
  });
});
