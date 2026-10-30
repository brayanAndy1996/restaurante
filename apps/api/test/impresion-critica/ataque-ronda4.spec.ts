// spec: 004-salon-cocina (pruebas protegidas)
//
// Ataque adversarial, ronda 4, a la entrega 3b (impresión). Tres fallas, cada una con la regla que fijó el
// orquestador:
//
// F1. El puente no repite si los reportes fallan. El lote "avanzó" solo si la API aceptó (2xx) al menos un
//     `POST /puente/trabajos/:id/resultado` de ese lote. Si todos los reportes fallan (500, 404, 409 o error de red),
//     el puente espera el intervalo normal o el aviso `trabajo.nuevo`, aunque haya `X-Puente-Hay-Mas` o 20 trabajos.
//     Antes, con 21 trabajos y la API devolviendo 500 en los resultados, el simulador pedía `GET /puente/trabajos` más
//     de 100 veces en 2 s y mandaba más de 2000 reportes. Control: con reportes aceptados sigue pidiendo enseguida
//     hasta vaciar la cola.
// F2. La marca `incompleto` refleja el ticket entregado. En cada entrega se recalcula: `incompleto` es verdadero si la
//     plantilla cortó el documento o si el renderizador lo cortó por el tope con la configuración de ESE momento.
//     Puede volver a `false`. Un documento que ya cortó la plantilla sigue `incompleto: true` en cualquier juego.
// F3. El "faltan N" del papel cuenta todo lo que falta: si el renderizador corta un documento que la plantilla ya había
//     cortado, N es lo que el renderizador dejó sin escribir más lo que la plantilla ya había descartado. N nunca es
//     menor que las líneas de la cuenta que no salieron en papel.
//
// Interpretaciones:
// - F1 se prueba con `SimuladorPuente` contra `ApiFalsaDelPuente` (su `fallosDeResultado`, `vencidos` y `topeDeBytes`
//   producen 500, 409 y la cabecera `X-Puente-Hay-Mas`). Un 404 y un error de red no se pueden provocar con la API falsa
//   sin modificarla: el 500 (sin respuesta útil de la API) y el 409 cubren la regla "ningún reporte fue aceptado". "Pide
//   enseguida" es: con `intervaloTrabajosMs` de 60 s, los trabajos quedan `IMPRESO` en la API en unos segundos.
// - F2 usa la API real. El documento de 1000 bloques se encola con `ColaImpresionService` (la API pública no deja armar
//   un documento así), el juego de caracteres se cambia con `PATCH /sucursales/:id/impresoras/:id` y la entrega es
//   `GET /puente/trabajos`. `incompleto` se lee del cuerpo crudo de `GET /impresion/trabajos`: `false` o ausente
//   significa "no incompleto" (el esquema lo declara opcional).
// - F3 usa las funciones públicas del módulo `escpos` (`documentoDePrecuenta`, `renderizarTicketDetallado`,
//   `esIncompleto`). El aviso se lee del papel sin espacios ni saltos de línea (la impresora lo parte en varias líneas
//   y la "í" cambia de byte según el juego). Las líneas de la cuenta que salieron en papel se cuentan por su importe
//   "0.10" (cada ítem lo lleva una vez) y, en el control del renderizador, por la marca "[n]" de cada bloque.
import { randomUUID } from 'node:crypto';
import {
  JUEGOS_CARACTERES,
  MAXIMO_BYTES_TICKET,
  MAXIMO_TRABAJOS_POR_IMPRESORA,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ColaImpresionService } from '../../src/modulos/impresion/cola-impresion.service';
import {
  documentoDePrecuenta,
  esIncompleto,
  renderizarTicketDetallado,
} from '../../src/modulos/impresion/escpos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { sesionContrasena } from '../carta-critica/fabrica-permisos-carta';
import { cuerpoRed, impresoraCreada } from '../impresion/ayudas-impresion';
import {
  exigirEstado,
  llamar,
  prepararEscenarioP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { ApiFalsaDelPuente, BytesEscPos, EmuladorEscPos, SimuladorPuente } from '../soporte/puente';
import { arrancarP5, Cierres, type AppP5 } from './fabrica-p5';
import { llamarPuente, nuevoPuente, vaciarCola, type PuenteVinculado } from './fabrica-p6';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const pausa = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

/** Espera (hasta `tiempoMs`) a que `condicion` sea verdadera; devuelve si lo fue. */
async function esperarCondicion(
  condicion: () => boolean,
  tiempoMs: number,
  pasoMs = 25,
): Promise<boolean> {
  const limite = Date.now() + tiempoMs;
  while (Date.now() < limite) {
    if (condicion()) return true;
    await pausa(pasoMs);
  }
  return condicion();
}

/** Texto sin espacios ni saltos de línea: el aviso del papel se parte en varias líneas. */
const compacto = (texto: string): string => texto.replace(/\s+/g, '');

/** El aviso del papel (criterio 126), compacto y sin depender de la "í" (cambia de byte según el juego). */
const AVISO_N = /Ticketincompleto:faltan(\d+)l/g;

/** Todos los "faltan N" que dice un ticket en papel. */
const avisosDe = (bytes: Uint8Array): number[] =>
  [...compacto(Buffer.from(bytes).toString('latin1')).matchAll(AVISO_N)].map((m) => Number(m[1]));

const contarCoincidencias = (texto: string, patron: RegExp): number =>
  (texto.match(new RegExp(patron.source, 'g')) ?? []).length;

/**
 * Pre-cuenta de 6000 ítems con nombres de 95 "…" más el número. La plantilla la corta (no caben en 3000 bloques) y,
 * a 58 mm, el renderizador también la corta por el tope de bytes, en cualquier juego de caracteres.
 */
const TOTAL_ITEMS = 6000;
function precuentaGigante(): DocumentoTicket {
  const lineas = Array.from({ length: TOTAL_ITEMS }, (_v, i) => ({
    nombre: '…'.repeat(95) + i,
    modificadores: [],
    cantidad: 1,
    total: '0.10',
  }));
  const documento = documentoDePrecuenta(
    {
      numero: 1,
      orden: { mesas: [{ nombre: '4' }], mozo: { nombre: 'Ana' }, comensales: 2 },
      lineas,
      total: '600.00',
      nota: 'Precios con IGV incluido.',
    },
    { sucursal: 'Centro', hora: '20:15' },
  );
  expect(esIncompleto(documento), 'precondición: la plantilla ya cortó la pre-cuenta').toBe(true);
  return documento;
}

// ====================================================================================================
// F1 · el puente no repite si los reportes fallan
// ====================================================================================================

describe('F1 · si ningún reporte es aceptado, el puente no insiste en bucle', () => {
  const OPCIONES = {
    intervaloTrabajosMs: 60_000,
    intervaloLatidoMs: 60_000,
    esperaInicialMs: 5_000,
    esperaMaximaMs: 5_000,
    tiempoImpresoraMs: 400,
  } as const;

  const cierres = new Cierres();
  afterAll(async () => cierres.cerrarTodo());

  interface Banco {
    api: ApiFalsaDelPuente;
    impresoraId: string;
  }

  /** API falsa + emulador + simulador vinculado e iniciado, con `n` trabajos de una impresora (sin avisar). */
  async function montar(n: number): Promise<Banco> {
    const api = await ApiFalsaDelPuente.iniciar();
    cierres.agregar(() => api.cerrar());
    const cocina = await EmuladorEscPos.iniciar({ nombre: 'cocina' });
    cierres.agregar(() => cocina.cerrar());
    const impresora = api.agregarImpresoraDeRed(cocina.host, cocina.puerto, 'Cocina');
    for (let i = 0; i < n; i++) {
      api.encolar(impresora.id, BytesEscPos.ticket([`t${i}`]), { avisar: false });
    }
    return { api, impresoraId: impresora.id };
  }

  async function iniciarSimulador(banco: Banco): Promise<SimuladorPuente> {
    const { qr } = banco.api.nuevoQr();
    const sim = new SimuladorPuente({ qr, ...OPCIONES });
    cierres.agregar(() => sim.detener());
    await sim.vincular();
    await sim.iniciar();
    return sim;
  }

  const pedidosDeTrabajos = (api: ApiFalsaDelPuente): number =>
    api.peticionesA('GET', '/puente/trabajos').length;
  const reportesEnviados = (api: ApiFalsaDelPuente): number =>
    api.peticionesA('POST', /\/resultado$/).length;
  const impresos = (api: ApiFalsaDelPuente): number =>
    api.trabajos.filter((t) => t.estado === 'IMPRESO').length;

  /** Ningún trabajo se mandó dos veces a la impresora. */
  const sinReimpresiones = (sim: SimuladorPuente): void => {
    const ids = sim.impresiones.map((i) => i.trabajoId);
    expect(new Set(ids).size, 'cada trabajo se imprimió una sola vez').toBe(ids.length);
  };

  it('21 trabajos y todos los resultados con 500: en 2 s, como mucho 2 pedidos y sin reimprimir', async () => {
    const banco = await montar(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    banco.api.fallosDeResultado = 1_000_000;
    const sim = await iniciarSimulador(banco);

    await pausa(2_000);

    expect(
      sim.peticionesDeTrabajos,
      'GET /puente/trabajos que hizo el simulador en 2 s',
    ).toBeLessThanOrEqual(2);
    expect(
      pedidosDeTrabajos(banco.api),
      'GET /puente/trabajos que recibió la API en 2 s',
    ).toBeLessThanOrEqual(2);
    expect(
      reportesEnviados(banco.api),
      'reportes enviados en 2 s (un lote, a lo más dos)',
    ).toBeLessThanOrEqual(2 * (MAXIMO_TRABAJOS_POR_IMPRESORA + 1));
    expect(sim.impresiones.length).toBeLessThanOrEqual(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    sinReimpresiones(sim);
  });

  it('21 trabajos y todos los resultados con 409 (vencidos): en 2 s, como mucho 2 pedidos', async () => {
    const banco = await montar(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    for (const t of banco.api.trabajos) banco.api.vencidos.add(t.id);
    const sim = await iniciarSimulador(banco);

    await pausa(2_000);

    expect(sim.peticionesDeTrabajos).toBeLessThanOrEqual(2);
    expect(pedidosDeTrabajos(banco.api)).toBeLessThanOrEqual(2);
    expect(reportesEnviados(banco.api)).toBeLessThanOrEqual(
      2 * (MAXIMO_TRABAJOS_POR_IMPRESORA + 1),
    );
    sinReimpresiones(sim);
  });

  it('con la cabecera X-Puente-Hay-Mas y todos los resultados con 500: no pide en bucle', async () => {
    const banco = await montar(3);
    // Un tope de bytes de 1: la API entrega un trabajo por lote y avisa con `X-Puente-Hay-Mas`.
    banco.api.topeDeBytes = 1;
    banco.api.fallosDeResultado = 1_000_000;
    const sim = await iniciarSimulador(banco);

    await pausa(2_000);

    expect(sim.peticionesDeTrabajos).toBeLessThanOrEqual(2);
    expect(pedidosDeTrabajos(banco.api)).toBeLessThanOrEqual(2);
    sinReimpresiones(sim);
  });

  it('un aviso trabajo.nuevo despierta al puente aunque los reportes sigan fallando, y nada se reimprime', async () => {
    const banco = await montar(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    banco.api.fallosDeResultado = 1_000_000;
    const sim = await iniciarSimulador(banco);
    await pausa(1_500);
    const antes = pedidosDeTrabajos(banco.api);
    expect(antes).toBeLessThanOrEqual(2);

    banco.api.encolar(banco.impresoraId, BytesEscPos.ticket(['nuevo']), { avisar: true });

    expect(
      await esperarCondicion(() => pedidosDeTrabajos(banco.api) > antes, 2_000),
      'el aviso hace que pida trabajos',
    ).toBe(true);
    await pausa(1_500);
    expect(
      pedidosDeTrabajos(banco.api),
      'tras el aviso, un pedido (a lo más dos), no un bucle',
    ).toBeLessThanOrEqual(antes + 2);
    sinReimpresiones(sim);

    // La API se recupera: con el siguiente aviso se reportan los trabajos ya impresos, sin imprimirlos otra vez.
    banco.api.fallosDeResultado = 0;
    const impresionesAntes = sim.impresiones.length;
    banco.api.encolar(banco.impresoraId, BytesEscPos.ticket(['otro']), { avisar: true });
    expect(
      await esperarCondicion(() => impresos(banco.api) >= MAXIMO_TRABAJOS_POR_IMPRESORA, 10_000),
      'al aceptarse los reportes, los trabajos ya impresos quedan IMPRESO',
    ).toBe(true);
    sinReimpresiones(sim);
    expect(
      sim.impresiones.length - impresionesAntes,
      'se imprimen a lo más los trabajos nuevos',
    ).toBeLessThanOrEqual(3);
  });

  it('control: con los reportes aceptados, 21 trabajos quedan IMPRESO enseguida (sin esperar el intervalo)', async () => {
    const banco = await montar(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    const sim = await iniciarSimulador(banco);

    expect(
      await esperarCondicion(
        () => impresos(banco.api) === MAXIMO_TRABAJOS_POR_IMPRESORA + 1,
        15_000,
      ),
      'los 21 trabajos quedan IMPRESO con un intervalo de 60 s',
    ).toBe(true);
    expect(
      pedidosDeTrabajos(banco.api),
      'pidió más de una vez para vaciar la cola',
    ).toBeGreaterThanOrEqual(2);
    expect(sim.impresiones).toHaveLength(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    sinReimpresiones(sim);
  });

  it('control: con la cabecera X-Puente-Hay-Mas y los reportes aceptados, vacía la cola enseguida', async () => {
    const banco = await montar(3);
    banco.api.topeDeBytes = 1;
    const sim = await iniciarSimulador(banco);

    expect(
      await esperarCondicion(() => impresos(banco.api) === 3, 15_000),
      'los 3 trabajos quedan IMPRESO aunque la API entregue uno por lote',
    ).toBe(true);
    expect(pedidosDeTrabajos(banco.api)).toBeGreaterThanOrEqual(3);
    sinReimpresiones(sim);
  });

  it('control: si la API acepta al menos un reporte del lote, el lote avanzó y sigue pidiendo', async () => {
    const banco = await montar(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    // Los primeros 5 reportes fallan; los otros 15 del lote se aceptan.
    banco.api.fallosDeResultado = 5;
    const sim = await iniciarSimulador(banco);

    expect(
      await esperarCondicion(
        () => impresos(banco.api) === MAXIMO_TRABAJOS_POR_IMPRESORA + 1,
        15_000,
      ),
      'los 21 trabajos quedan IMPRESO sin esperar el intervalo',
    ).toBe(true);
    expect(sim.impresiones).toHaveLength(MAXIMO_TRABAJOS_POR_IMPRESORA + 1);
    sinReimpresiones(sim);
  });
});

// ====================================================================================================
// F2 · la marca `incompleto` refleja el ticket entregado
// ====================================================================================================

describe('F2 · `incompleto` se recalcula en cada entrega', () => {
  let ctx: AppP5;
  let esc: EscenarioP2;
  const cierres = new Cierres();
  const A = () => esc.e.A;
  const T = () => esc.token.adminA;

  beforeAll(async () => {
    ctx = await arrancarP5();
    esc = await prepararEscenarioP2(ctx);
  });
  afterAll(async () => {
    await cierres.cerrarTodo();
    await ctx?.cerrar();
  });

  /** 1000 bloques de 200 "…": en PC437 cada "…" sale como "..." (600 KB), en WPC1252 es 1 byte (cabe en el tope). */
  const documentoMilBloques = (): DocumentoTicket => ({
    version: 1,
    tipo: 'COMANDA',
    bloques: Array.from({ length: 1000 }, () => ({
      tipo: 'linea' as const,
      texto: '…'.repeat(200),
    })),
  });

  async function encolar(
    impresoraId: string,
    documento: DocumentoTicket,
    tipo: 'COMANDA' | 'PRECUENTA',
  ): Promise<string> {
    const cola = ctx.app.get(ColaImpresionService, { strict: false });
    const contexto = ctx.app.get(ContextoEmpresa, { strict: false });
    const [id] = await contexto.ejecutar(
      A().empresaId,
      () =>
        cola.encolar([
          {
            sucursalId: A().S1,
            impresoraId,
            estacionId: null,
            tipo,
            comandaId: null,
            precuentaId: null,
            mesa: '4',
            ordenId: null,
            envioNumero: null,
            documento,
          },
        ]),
      { actor: { sistema: 'prueba' } },
    );
    return id!;
  }

  /** `GET /puente/trabajos`: los bytes que se entregan hoy para el trabajo `id`. */
  async function entregar(puente: PuenteVinculado, id: string): Promise<Uint8Array> {
    const res = await llamarPuente(ctx, puente.token, 'get', '/puente/trabajos');
    exigirEstado(res, 200, 'GET /puente/trabajos');
    const lote = res.body as Array<{ id: string; bytes: string }>;
    const trabajo = lote.find((t) => t.id === id);
    expect(trabajo, `GET /puente/trabajos entrega el trabajo ${id}`).toBeDefined();
    const bytes = Uint8Array.from(Buffer.from(trabajo!.bytes, 'base64'));
    expect(bytes.length, 'ningún ticket pasa del tope de bytes').toBeLessThanOrEqual(
      MAXIMO_BYTES_TICKET,
    );
    return bytes;
  }

  /** El `incompleto` del trabajo según `GET /impresion/trabajos` (cuerpo crudo; ausente cuenta como `false`). */
  async function incompletoDe(sesion: string, id: string): Promise<boolean> {
    const res = await llamar(ctx, sesion, { metodo: 'get', ruta: '/impresion/trabajos' });
    exigirEstado(res, 200, 'GET /impresion/trabajos');
    const resumen = (res.body as Array<Record<string, unknown>>).find((t) => t.id === id);
    expect(resumen, `GET /impresion/trabajos lista el trabajo ${id}`).toBeDefined();
    return resumen!.incompleto === true;
  }

  async function cambiarJuego(impresoraId: string, juegoCaracteres: string): Promise<void> {
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${A().S1}/impresoras/${impresoraId}`,
        cuerpo: { juegoCaracteres },
      }),
      200,
      `pasar la impresora a ${juegoCaracteres}`,
    );
  }

  /** Un caso: impresora de red de 80 mm, puente vinculado y sesión del Administrador; deja la cola limpia al terminar. */
  async function caso(
    juego: string,
    cuerpo: (ctxCaso: {
      impresoraId: string;
      puente: PuenteVinculado;
      sesion: string;
    }) => Promise<void>,
  ): Promise<void> {
    const impresora = await impresoraCreada(
      ctx,
      T(),
      A().S1,
      cuerpoRed({ anchoMm: 80, juegoCaracteres: juego, nombre: `R4 ${randomUUID().slice(0, 8)}` }),
    );
    const puente = await nuevoPuente(ctx, T(), A(), A().S1);
    const sesion = await sesionContrasena(ctx, A().base.admin, A().S1);
    try {
      await cuerpo({ impresoraId: impresora.id, puente, sesion });
    } finally {
      await vaciarCola(ctx, puente);
    }
  }

  it('cortado por el renderizador en PC437 y entregado completo tras pasar a WPC1252: vuelve a incompleto: false', async () => {
    await caso('PC437', async ({ impresoraId, puente, sesion }) => {
      const id = await encolar(impresoraId, documentoMilBloques(), 'COMANDA');

      const enPc437 = await entregar(puente, id);
      expect(avisosDe(enPc437), 'en PC437 el ticket sale cortado, con un solo aviso').toHaveLength(
        1,
      );
      expect(await incompletoDe(sesion, id), 'cortado en PC437: incompleto').toBe(true);

      await cambiarJuego(impresoraId, 'WPC1252');

      const enWpc1252 = await entregar(puente, id);
      expect(avisosDe(enWpc1252), 'en WPC1252 el ticket sale completo, sin aviso').toEqual([]);
      expect(enWpc1252.length, 'lleva los 1000 bloques de 200 caracteres').toBeGreaterThanOrEqual(
        200_000,
      );
      expect(await incompletoDe(sesion, id), 'entregado completo: incompleto: false').toBe(false);
    });
  });

  it('completo en WPC1252, cortado al pasar a PC437 y completo otra vez al volver: la marca sigue al ticket', async () => {
    await caso('WPC1252', async ({ impresoraId, puente, sesion }) => {
      const id = await encolar(impresoraId, documentoMilBloques(), 'COMANDA');

      expect(avisosDe(await entregar(puente, id)), 'completo en WPC1252').toEqual([]);
      expect(await incompletoDe(sesion, id)).toBe(false);

      await cambiarJuego(impresoraId, 'PC437');
      expect(avisosDe(await entregar(puente, id)), 'cortado en PC437').toHaveLength(1);
      expect(await incompletoDe(sesion, id), 'cortado en PC437: incompleto').toBe(true);

      await cambiarJuego(impresoraId, 'WPC1252');
      expect(avisosDe(await entregar(puente, id)), 'completo otra vez en WPC1252').toEqual([]);
      expect(await incompletoDe(sesion, id), 'completo otra vez: incompleto: false').toBe(false);
    });
  });

  it('control: un documento que ya cortó la plantilla sigue incompleto: true en cualquier juego', async () => {
    await caso('PC437', async ({ impresoraId, puente, sesion }) => {
      const id = await encolar(impresoraId, precuentaGigante(), 'PRECUENTA');
      for (const juego of JUEGOS_CARACTERES) {
        await cambiarJuego(impresoraId, juego);
        const bytes = await entregar(puente, id);
        expect(
          avisosDe(bytes).length,
          `con ${juego} el ticket lleva el aviso de incompleto`,
        ).toBeGreaterThanOrEqual(1);
        expect(await incompletoDe(sesion, id), `con ${juego} sigue incompleto: true`).toBe(true);
      }
    });
  });
});

// ====================================================================================================
// F3 · el "faltan N" cuenta todo lo que falta
// ====================================================================================================

describe('F3 · el aviso del papel cuenta lo que descartó la plantilla y lo que cortó el renderizador', () => {
  for (const juego of ['PC437', 'WPC1252'] as const) {
    it(`pre-cuenta de ${TOTAL_ITEMS} ítems a 58 mm en ${juego}: un solo aviso, con N >= ítems que no salieron`, () => {
      const documento = precuentaGigante();

      const ticket = renderizarTicketDetallado(documento, { anchoMm: 58, juegoCaracteres: juego });
      expect(ticket.bytes.length).toBeLessThanOrEqual(MAXIMO_BYTES_TICKET);

      const texto = Buffer.from(ticket.bytes).toString('latin1');
      const itemsImpresos = contarCoincidencias(texto, /0\.10/);
      expect(
        itemsImpresos,
        'precondición: el renderizador también cortó (no salieron todos)',
      ).toBeLessThan(TOTAL_ITEMS);
      expect(itemsImpresos, 'precondición: salió una parte de la cuenta').toBeGreaterThan(0);

      const avisos = avisosDe(ticket.bytes);
      expect(avisos, 'un solo aviso de incompleto en el papel').toHaveLength(1);
      expect(
        avisos[0],
        `faltan N: N (${avisos[0]}) no puede ser menor que los ítems que no salieron (${TOTAL_ITEMS - itemsImpresos})`,
      ).toBeGreaterThanOrEqual(TOTAL_ITEMS - itemsImpresos);
    });
  }

  it('control: documento que la plantilla no cortó y el renderizador sí: N cubre los bloques que no salieron', () => {
    const bloques = 3000;
    const documento: DocumentoTicket = {
      version: 1,
      tipo: 'COMANDA',
      bloques: Array.from({ length: bloques }, (_v, i) => ({
        tipo: 'linea' as const,
        texto: `[${i}] ${'…'.repeat(190)}`,
      })),
    };
    expect(esIncompleto(documento), 'precondición: la plantilla no cortó nada').toBe(false);

    const ticket = renderizarTicketDetallado(documento, { anchoMm: 58, juegoCaracteres: 'PC437' });
    expect(ticket.bytes.length).toBeLessThanOrEqual(MAXIMO_BYTES_TICKET);
    const texto = Buffer.from(ticket.bytes).toString('latin1');
    const salieron = new Set(texto.match(/\[\d+\]/g) ?? []).size;
    expect(salieron, 'precondición: el renderizador cortó').toBeLessThan(bloques);
    expect(salieron).toBeGreaterThan(0);

    const avisos = avisosDe(ticket.bytes);
    expect(avisos, 'un solo aviso de incompleto').toHaveLength(1);
    expect(avisos[0]).toBeGreaterThanOrEqual(bloques - salieron);
  });
});
