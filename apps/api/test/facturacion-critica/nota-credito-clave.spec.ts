// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P8 · La clave del supervisor atada a la nota de crédito (ruta crítica), criterio 145:
// - el Cajero necesita `X-Autorizacion` de una autorización de `EMITIR_NOTA_CREDITO` cuyo objetivo sea exactamente
//   `{ tipo: 'NOTA_CREDITO', comprobanteId, tipoNota, total, devuelto }` (con `total` el que recalcula el servidor y `devuelto`
//   la suma de los pagos de la devolución o `"0.00"`, normalizados a 2 decimales): sin ella, 403 `CLAVE_REQUERIDA`; de otra
//   acción, de otro objetivo (otro total, otro tipo, otro comprobante, otro `devuelto`), sin objetivo, usada o vencida,
//   403 `AUTORIZACION_INVALIDA`; nada cambia;
// - la autorización se consume en la misma transacción y vuelve si la nota falla después (criterio 40);
// - el Supervisor y el Administrador emiten sin clave; Mozo y Cocina/Barra, 403 `PROHIBIDO` con contraseña y con PIN.
// Hoy falla por "No implementado": `POST /notas-credito` y el worker lanzan `Error('No implementado')` y las series de notas de
// crédito todavía no existen.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Cierres,
  cerrarAdmin,
  crearEscenario,
  equipoDe,
  esperarError,
  filas,
  sesionContrasena,
  sesionPin,
  type Escenario,
} from '../caja-critica/fabrica-caja';
import {
  arrancarNotas,
  autorizarNota,
  contarFilas,
  cuerpoNota,
  efectivo,
  emitirAceptado,
  emitirNota,
  fallarElTicketDeLaNota,
  impresoraEnS1,
  notaCrudo,
  notasDelOriginal,
  objetivoNota,
  prepararNotas,
  type AppNotas,
  type Libre,
} from './fabrica-notas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

const cierres = new Cierres();
let ctx: AppNotas;
let esc: Escenario;
const A = () => esc.A;
const cajero = () => A().token.cajero!;
const pinSupervisor = () => A().personas.supervisor!.pin;

beforeAll(async () => {
  ctx = await arrancarNotas();
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

const lomoDe = (comprobante: Libre): number =>
  (comprobante.lineas as Libre[]).find((l) => /Lomo/.test(l.descripcion as string))!
    .posicion as number;

describe('criterio 145 · la clave atada de la nota de crédito', () => {
  it('sin clave el Cajero recibe 403 CLAVE_REQUERIDA y no se emite nada', async () => {
    const o = await boleta();
    const res = await notaCrudo(
      ctx,
      cajero(),
      cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
    );
    esperarError(res, 403, 'CLAVE_REQUERIDA');
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });

  it('con la autorización del objetivo exacto el Cajero emite, y la autorización queda usada', async () => {
    const o = await boleta();
    // Los montos del objetivo se normalizan a 2 decimales: "69.2" y "0" valen "69.20" y "0.00".
    const clave = await autorizarNota(
      ctx,
      cajero(),
      pinSupervisor(),
      objetivoNota(o.comprobanteId, 'ANULACION', '69.2', '0'),
    );
    const res = await emitirNota(
      ctx,
      cajero(),
      { comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' },
      { autorizacion: clave.autorizacionId },
    );
    expect((res.nota as Libre).totales).toMatchObject({ total: '69.20' });
    // Una autorización se usa una sola vez.
    const otra = await boleta();
    const reutilizada = await notaCrudo(
      ctx,
      cajero(),
      cuerpoNota({ comprobanteId: otra.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      { autorizacion: clave.autorizacionId },
    );
    esperarError(reutilizada, 403, 'AUTORIZACION_INVALIDA');
    expect(await notasDelOriginal(otra.comprobanteId)).toEqual([]);
  });

  it('una devolución se autoriza con el total de la nota y lo que se devuelve (Σ de los pagos)', async () => {
    const o = await boleta();
    const lomo = lomoDe(o.cobro.comprobante);
    const clave = await autorizarNota(
      ctx,
      cajero(),
      pinSupervisor(),
      objetivoNota(o.comprobanteId, 'DEVOLUCION', '28.00', '28.00'),
    );
    const res = await emitirNota(
      ctx,
      cajero(),
      {
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: lomo, cantidad: 1 }],
        devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
      },
      { autorizacion: clave.autorizacionId },
    );
    expect(res.devolucion).toMatchObject({ total: '28.00' });
  });

  it('el cambio a factura se autoriza con su tipo de nota y devuelto 0.00', async () => {
    const o = await boleta();
    const clave = await autorizarNota(
      ctx,
      cajero(),
      pinSupervisor(),
      objetivoNota(o.comprobanteId, 'CAMBIO_A_FACTURA', '69.20'),
    );
    const res = await emitirNota(
      ctx,
      cajero(),
      {
        comprobanteId: o.comprobanteId,
        tipo: 'CAMBIO_A_FACTURA',
        total: '69.20',
        cliente: {
          tipoDocumento: 'RUC',
          numero: '20100070970',
          nombre: 'Supermercados Peruanos S.A.',
          direccion: 'Av. Prueba 123, Lima',
        },
      },
      { autorizacion: clave.autorizacionId },
    );
    expect(res.factura).not.toBeNull();
  });

  it('de otra acción, de otro objetivo (total, tipo, comprobante o devuelto) o sin objetivo: 403 AUTORIZACION_INVALIDA y nada cambia', async () => {
    const o = await boleta();
    const lomo = lomoDe(o.cobro.comprobante);
    const otro = await boleta();
    const cuerpoAnulacion = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const cuerpoDevolucion = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: lomo, cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    const casos: Array<[string, () => Promise<{ autorizacionId: string }>, Libre]> = [
      [
        'otra acción',
        () => autorizarNota(ctx, cajero(), pinSupervisor(), undefined, 'ANULAR_ORDEN'),
        cuerpoAnulacion,
      ],
      ['sin objetivo', () => autorizarNota(ctx, cajero(), pinSupervisor()), cuerpoAnulacion],
      [
        'otro total',
        () =>
          autorizarNota(
            ctx,
            cajero(),
            pinSupervisor(),
            objetivoNota(o.comprobanteId, 'ANULACION', '68.00'),
          ),
        cuerpoAnulacion,
      ],
      [
        'otro tipo de nota',
        () =>
          autorizarNota(
            ctx,
            cajero(),
            pinSupervisor(),
            objetivoNota(o.comprobanteId, 'DEVOLUCION', '69.20'),
          ),
        cuerpoAnulacion,
      ],
      [
        'otro comprobante',
        () =>
          autorizarNota(
            ctx,
            cajero(),
            pinSupervisor(),
            objetivoNota(otro.comprobanteId, 'ANULACION', '69.20'),
          ),
        cuerpoAnulacion,
      ],
      [
        'otro devuelto (la autorización es de una nota sin devolución)',
        () =>
          autorizarNota(
            ctx,
            cajero(),
            pinSupervisor(),
            objetivoNota(o.comprobanteId, 'DEVOLUCION', '28.00', '0.00'),
          ),
        cuerpoDevolucion,
      ],
      [
        'otro devuelto (la autorización devuelve menos)',
        () =>
          autorizarNota(
            ctx,
            cajero(),
            pinSupervisor(),
            objetivoNota(o.comprobanteId, 'DEVOLUCION', '28.00', '14.00'),
          ),
        cuerpoDevolucion,
      ],
    ];
    const fallos: string[] = [];
    for (const [que, pedir, cuerpo] of casos) {
      let clave: { autorizacionId: string };
      try {
        clave = await pedir();
      } catch {
        continue; // La API pudo rechazar de entrada una autorización incoherente: tampoco sirve.
      }
      const res = await notaCrudo(ctx, cajero(), cuerpo, { autorizacion: clave.autorizacionId });
      if (res.status !== 403 || res.body?.codigo !== 'AUTORIZACION_INVALIDA') {
        fallos.push(`${que}: ${res.status} ${res.body?.codigo ?? res.text.slice(0, 80)}`);
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });

  it('una autorización vencida (2 minutos) es 403 AUTORIZACION_INVALIDA; un instante antes todavía sirve', async () => {
    const o = await boleta();
    const objetivo = objetivoNota(o.comprobanteId, 'ANULACION', '69.20');
    const vieja = await autorizarNota(ctx, cajero(), pinSupervisor(), objetivo);
    ctx.reloj.avanzar(2 * 60_000);
    esperarError(
      await notaCrudo(
        ctx,
        cajero(),
        cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
        { autorizacion: vieja.autorizacionId },
      ),
      403,
      'AUTORIZACION_INVALIDA',
    );
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
    const justa = await autorizarNota(ctx, cajero(), pinSupervisor(), objetivo);
    ctx.reloj.avanzar(2 * 60_000 - 1_000);
    await emitirNota(
      ctx,
      cajero(),
      { comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' },
      { autorizacion: justa.autorizacionId },
    );
  });

  it('si la nota falla después de numerar, se revierte todo y la autorización vuelve: se puede usar de nuevo', async () => {
    // La falla inyectada salta al encolar el ticket, así que la caja necesita su impresora.
    await impresoraEnS1(ctx, esc, cierres);
    const o = await boleta();
    const clave = await autorizarNota(
      ctx,
      cajero(),
      pinSupervisor(),
      objetivoNota(o.comprobanteId, 'ANULACION', '69.20'),
    );
    const cuerpo = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const serie = await filas(
      `SELECT ultimo_numero FROM serie WHERE caja_id = $1 AND tipo = 'NOTA_CREDITO_BOLETA' AND activa`,
      [o.cajaId],
    );
    const quitar = await fallarElTicketDeLaNota(o.comprobanteId);
    try {
      const fallida = await notaCrudo(ctx, cajero(), cuerpo, {
        autorizacion: clave.autorizacionId,
      });
      expect(fallida.status, fallida.text).toBeGreaterThanOrEqual(400);
    } finally {
      await quitar();
    }
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
    expect(
      await filas(
        `SELECT ultimo_numero FROM serie WHERE caja_id = $1 AND tipo = 'NOTA_CREDITO_BOLETA' AND activa`,
        [o.cajaId],
      ),
    ).toEqual(serie);
    const reintento = await notaCrudo(ctx, cajero(), cuerpo, {
      autorizacion: clave.autorizacionId,
    });
    expect(reintento.status, reintento.text).toBe(201);
  });

  it('el Supervisor y el Administrador emiten sin clave', async () => {
    const delSupervisor = await boleta();
    const delAdmin = await boleta();
    const admin = await sesionContrasena(ctx, A().base.admin, A().S1);
    for (const [token, o] of [
      [A().token.supervisor!, delSupervisor],
      [admin, delAdmin],
    ] as const) {
      const res = await emitirNota(ctx, token, {
        comprobanteId: o.comprobanteId,
        tipo: 'ANULACION',
        total: '69.20',
      });
      expect((res.nota as Libre).estado).toBe('POR_ENVIAR');
    }
  });

  it('Mozo y Cocina/Barra reciben 403 PROHIBIDO con contraseña y con PIN, aunque lleven una clave, sin cambiar nada', async () => {
    // El 403 de rol sale antes de mirar si el comprobante existe: el id es cualquiera.
    const o = { comprobanteId: randomUUID() };
    const cuerpo = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    // Las sesiones y los equipos se abren antes de medir: abrirlos también deja filas de auditoría.
    const sesiones: Array<[string, string]> = [];
    for (const nombre of ['mozo', 'cocina'] as const) {
      const persona = A().personas[nombre]!;
      const tokenEquipo = await equipoDe(ctx, persona);
      sesiones.push([`${nombre} (contraseña)`, await sesionContrasena(ctx, persona, A().S1)]);
      sesiones.push([`${nombre} (PIN)`, await sesionPin(ctx, persona, tokenEquipo, A().S1)]);
    }
    const antes = await contarFilas('SELECT 1 FROM comprobante WHERE empresa_id = $1', [A().id]);
    const auditoriaAntes = await contarFilas('SELECT 1 FROM auditoria WHERE empresa_id = $1', [
      A().id,
    ]);
    const fallos: string[] = [];
    for (const [quien, token] of sesiones) {
      for (const autorizacion of [undefined, randomUUID()]) {
        const res = await notaCrudo(ctx, token, cuerpo, autorizacion ? { autorizacion } : {});
        if (res.status !== 403 || res.body?.codigo !== 'PROHIBIDO') {
          fallos.push(
            `${quien}${autorizacion ? ', con clave' : ''}: ${res.status} ${res.body?.codigo}`,
          );
        }
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
    expect(await contarFilas('SELECT 1 FROM comprobante WHERE empresa_id = $1', [A().id])).toBe(
      antes,
    );
    expect(await contarFilas('SELECT 1 FROM auditoria WHERE empresa_id = $1', [A().id])).toBe(
      auditoriaAntes,
    );
  });
});
