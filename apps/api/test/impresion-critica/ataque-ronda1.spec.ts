// spec: 004-salon-cocina (pruebas protegidas)
//
// Ataque adversarial, ronda 1, a la entrega 3b (impresión). Cada falla que encontró el ataque es una prueba:
//
// - F1 · Ticket grande. Una comanda o una pre-cuenta muy grande siempre se entrega (`GET /puente/trabajos`) y se
//   imprime (el emulador recibe un ticket completo, sin comandos desconocidos), también con las marcas
//   "Impreso con retraso" (criterio 118) y "REIMPRESIÓN" (criterio 128). Casos: un combo de 20 componentes de
//   Cocina enviado en 6 líneas con observación, "para llevar" y tiempo 2; una pre-cuenta de unos 600 ítems.
// - F2 · Mesas unidas con nombres largos. Con 10 y con 20 mesas unidas, cada una con un nombre de 20 caracteres, el
//   envío a Cocina y la pre-cuenta responden 201, el trabajo se entrega e imprime y el ticket lleva todas las
//   mesas (pueden partirse en varias líneas, no recortarse en silencio).
// - F3 · La cola no se bloquea (criterio 113). La entrega se hace por impresora, como máximo `N_POR_IMPRESORA` por
//   impresora y en orden de creación dentro de cada una. Las impresoras Bluetooth y las inactivas no se entregan en
//   la 3b. Una impresora Bluetooth, inactiva o de red apagada (con `NO_IMPRESO`) que acumula más de 50 trabajos no
//   impide que se entregue e imprima la comanda de otra estación con una impresora de red encendida.
// - F4 · Socket que se cae tras el aviso (criterio 120). Después del aviso de desconexión, cerrar el socket del
//   puente no publica nada, `GET /impresion/estado` lo sigue mostrando desconectado y 61 s más tarde no hay un
//   segundo aviso.
// - F5 · Códigos de vinculación simultáneos (criterio 106). Dos `POST …/vinculaciones-puente` a la vez dejan un
//   solo código válido, en varias rondas.
// - F6 · Sin secreto guardado (criterio 106). Después de crear un código de vinculación con `Idempotency-Key`,
//   ninguna tabla de la base (en especial `idempotencia.respuesta`) contiene el secreto del token `vi.`.
// - F7 · Motivo largo (criterio 124). Un motivo de anulación de 300 caracteres sale completo en el ticket de
//   anulación, aunque ocupe varias líneas.
//
// Interpretaciones (ver el informe de entrega):
// - `N_POR_IMPRESORA = 20`: la especificación todavía dice "hasta 50 trabajos" en el criterio 113; la regla
//   aprobada por el orquestador es "como máximo N por impresora", y mientras el especificador no fije N se usa 20.
//   Solo la prueba "como máximo N por impresora" fija el valor exacto; las demás solo exigen que el trabajo
//   buscado se entregue.
// - "Se imprime" es: el `SimuladorPuente` pide los trabajos, los manda por TCP al `EmuladorEscPos` y este recibe
//   un ticket con su corte (`completo`) y sin comandos desconocidos.
// - Los textos se comparan sin espacios ni saltos de línea (`compacto`): un nombre o un motivo puede partirse en
//   varias líneas, lo que no puede es perderse.
// - El caso F4 usa `SenalPuenteService.revisarAhora()` (la revisión periódica del criterio 120), como la prueba
//   `estado-puente-reloj.spec.ts` del desarrollador.
//
// La API real corre con `RelojManual`, un `InventarioDePrueba` y Socket.IO habilitado. Las impresoras, los
// destinos y la vinculación se configuran por las rutas de 3b; el puente es el `SimuladorPuente`; las impresoras
// son `EmuladorEscPos`. La carta es la de ejemplo de `spec.md` (fábricas protegidas de 3a).
import { randomUUID } from 'node:crypto';
import {
  estadoImpresionRespuestaSchema,
  trabajoCreadoRespuestaSchema,
  trabajoParaImprimirSchema,
  vinculacionRespuestaSchema,
  type EstadoImpresionRespuesta,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SenalPuenteService } from '../../src/modulos/impresion/senal-puente.service';
import { INICIO_POR_DEFECTO, MINUTO } from '../acceso/fabrica-plataforma';
import {
  asentar,
  exigirEstado,
  llamar,
  sesionContrasena,
} from '../carta-critica/fabrica-permisos-carta';
import {
  abrirOrden,
  clave,
  comandaDe,
  crearEnCarta,
  enviarComanda,
  enviarOk,
  envio,
  nombreUnico,
  pedirPrecuenta,
  prepararEscenarioP2,
  SalonDePrueba,
  simpleNuevo,
  unirMesasOk,
  type EscenarioP2,
  type LineaCuerpo,
  type OrdenAbierta,
} from '../salon-critica/fabrica-p2';
import { interpretarEscPos, type TicketEmulado } from '../soporte/puente';
import { abrirCliente } from '../utilidades';
import {
  arrancarP5,
  Cierres,
  comandasBd,
  conectarSocketDelPuente,
  crearImpresora,
  fijarDestino,
  memorizar,
  prepararSucursalP5,
  simuladorVinculado,
  trabajosDeComandas,
  trabajosDeSucursal,
  type AppP5,
  type SucursalP5,
} from './fabrica-p5';
import {
  conClave,
  crearImpresora as crearImpresoraSinEmulador,
  desactivarImpresora,
  llamarPuente,
  nuevoPuente,
  vincular,
} from './fabrica-p6';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** Trabajos por impresora que entrega `GET /puente/trabajos` (criterio 113, regla aprobada; ver la cabecera). */
const N_POR_IMPRESORA = 20;
/** Más de 50: lo que cabía en la entrega antigua de una sola vez. */
const TRABAJOS_ACUMULADOS = 55;
/** Más de lo que fija el criterio 118 (2 minutos) y la regla del orquestador (3 minutos). */
const CON_RETRASO_MS = 4 * MINUTO;

let ctx: AppP5;
let admin: Client;
let esc: EscenarioP2;
let senal: SenalPuenteService;
const cierres = new Cierres();
const preparadas: SucursalP5[] = [];

const A = () => esc.e.A;
const B = () => esc.e.B;

/** Arma una sucursal una sola vez; si falla, cada prueba que la usa ve el mismo error. */
const sucursal = (preparar: () => Promise<SucursalP5>) =>
  memorizar(async () => {
    const s = await preparar();
    preparadas.push(s);
    return s;
  });

const S = {
  /** S1 de A: Cocina a una impresora, Barra al KDS, puente vinculado (el simulador lo inicia cada prueba). */
  s1: sucursal(() =>
    prepararSucursalP5(ctx, cierres, {
      etiqueta: 'S1',
      sucursalId: A().S1,
      carta: esc.carta,
      salon: esc.salon,
      tokenAdmin: esc.token.adminA,
      tokenMozo: esc.token.mozo,
      tokenSupervisor: esc.token.supervisor,
      tokenCocina: esc.token.cocina,
      barraAlKdsExplicito: true,
      conPuente: true,
      conSocket: false,
    }),
  ),
  /** S2 de A: como S1, con la impresora de Cocina también como impresora de caja (se configura al usarla). */
  s2: sucursal(async () => {
    const adminS2 = await sesionContrasena(ctx, A().base.admin, A().S2);
    return prepararSucursalP5(ctx, cierres, {
      etiqueta: 'S2',
      sucursalId: A().S2,
      carta: esc.carta,
      salon: esc.salonS2,
      tokenAdmin: esc.token.adminA,
      tokenMozo: esc.token.mozoS2,
      tokenSupervisor: adminS2,
      tokenCocina: adminS2,
      barraAlKdsExplicito: true,
      conPuente: true,
      conSocket: false,
    });
  }),
  /** S3 de A: para la cola (F3); cada prueba arma las impresoras y los destinos que necesita. */
  s3: sucursal(async () => {
    const adminS3 = await sesionContrasena(ctx, A().base.admin, A().S3!);
    return prepararSucursalP5(ctx, cierres, {
      etiqueta: 'S3',
      sucursalId: A().S3!,
      carta: esc.carta,
      salon: new SalonDePrueba(ctx, esc.token.adminA, A().S3!, 'Patio'),
      tokenAdmin: esc.token.adminA,
      tokenMozo: adminS3,
      tokenSupervisor: adminS3,
      tokenCocina: adminS3,
      barraAlKdsExplicito: true,
      conPuente: true,
      conSocket: false,
    });
  }),
};

beforeAll(async () => {
  ctx = await arrancarP5();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
  senal = ctx.app.get(SenalPuenteService, { strict: false });
});

beforeEach(async () => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
  ctx.inventario.lanzarAlEnviar(null);
  ctx.inventario.lanzarAlAnular(null);
  await asentar();
  ctx.inventario.limpiar();
  ctx.publicador.limpiar();
  for (const s of preparadas) s.cocina.emulador.limpiar();
});

afterEach(async () => {
  // Un trabajo que no se imprimió (por la falla que se prueba) no puede ensuciar la cola de las demás pruebas.
  for (const s of preparadas) await limpiarCola(s);
});

afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await admin?.end();
});

// ---------------------------------------------------------------------------------------------------
// Ayudantes de la prueba
// ---------------------------------------------------------------------------------------------------

/** Texto sin espacios ni saltos de línea: para comprobar que algo está aunque el ticket lo parta en líneas. */
const compacto = (texto: string): string => texto.replace(/\s+/g, '');

const solo = <T>(valores: readonly T[]): T => {
  expect(valores).toHaveLength(1);
  return valores[0]!;
};

const abrir = (s: SucursalP5, mesaId?: string): Promise<OrdenAbierta> =>
  abrirOrden(ctx, s.salon, s.tokenMozo, mesaId === undefined ? {} : { mesaId });

/** Deja `IMPRESO` todo lo pendiente de la sucursal, por la API del puente (no depende de `GET /puente/trabajos`). */
async function limpiarCola(s: SucursalP5): Promise<void> {
  const { rows } = await admin.query<{ id: string }>(
    `SELECT id FROM trabajo_impresion WHERE sucursal_id = $1 AND estado = 'PENDIENTE'`,
    [s.id],
  );
  for (const fila of rows) {
    await llamarPuente(ctx, s.puente!.token!, 'post', `/puente/trabajos/${fila.id}/resultado`, {
      resultado: 'IMPRESO',
    });
  }
}

/** `GET /puente/trabajos` con la credencial del puente; exige 200 y el formato del protocolo. */
async function pedirTrabajos(s: SucursalP5) {
  const res = await llamarPuente(ctx, s.puente!.token!, 'get', '/puente/trabajos');
  exigirEstado(res, 200, 'GET /puente/trabajos');
  return z.array(trabajoParaImprimirSchema).parse(res.body);
}

type TrabajoEntregado = Awaited<ReturnType<typeof pedirTrabajos>>[number];

/** Decodifica los bytes de un trabajo: un solo ticket, con su corte y sin un comando que la impresora no conozca. */
function decodificar(trabajo: Pick<TrabajoEntregado, 'bytes'>, columnas = 48): TicketEmulado {
  const { tickets, parcial } = interpretarEscPos(Buffer.from(trabajo.bytes, 'base64'), {
    columnas,
  });
  expect(parcial, 'el ticket entregado termina con su corte').toBeNull();
  const ticket = solo(tickets);
  expect(ticket.completo).toBe(true);
  expect(ticket.comandosDesconocidos).toEqual([]);
  return ticket;
}

/** `GET /puente/trabajos` entrega el trabajo `trabajoId`; devuelve la lista y el ticket decodificado. */
async function entregado(s: SucursalP5, trabajoId: string, columnas = 48) {
  const lista = await pedirTrabajos(s);
  const trabajo = lista.find((t) => t.id === trabajoId);
  const { rows } = await admin.query<{ estado: string }>(
    'SELECT estado FROM trabajo_impresion WHERE id = $1',
    [trabajoId],
  );
  expect(
    trabajo,
    `GET /puente/trabajos debe entregar el trabajo ${trabajoId}, ${rows[0]?.estado} en la base (entregó ${lista.length} trabajos)`,
  ).toBeDefined();
  return { lista, trabajo: trabajo!, ticket: decodificar(trabajo!, columnas) };
}

/** Inicia el simulador del puente de la sucursal y espera `n` tickets en el emulador de su impresora de Cocina. */
async function imprimir(s: SucursalP5, n: number, ms = 15_000): Promise<TicketEmulado[]> {
  const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!);
  await simulador.iniciar();
  try {
    const tickets = await s.cocina.emulador.esperarTickets(n, ms);
    await simulador.esperarImpresos(n, 5000);
    for (const t of tickets) {
      expect(t.completo, 'el emulador recibe el ticket con su corte').toBe(true);
      expect(t.comandosDesconocidos, 'ningún comando que la impresora no conozca').toEqual([]);
    }
    return tickets;
  } finally {
    await simulador.detener();
  }
}

interface PlatoPropio {
  id: string;
  nombre: string;
  /** La última palabra del nombre, única por producto: identifica la comanda en un ticket. */
  marca: string;
  linea: (cantidad?: number) => LineaCuerpo;
}

/** Un producto nuevo de una estación, sin control de stock, con un nombre único. */
async function platoNuevo(estacion: 'cocina' | 'barra'): Promise<PlatoPropio> {
  const nombre = nombreUnico('Plato');
  const creado = await crearEnCarta(
    ctx,
    esc.token.adminA,
    '/carta/productos',
    simpleNuevo(esc.carta, {
      nombre,
      precio: '10.00',
      estacionId: estacion === 'cocina' ? esc.carta.cocinaId : esc.carta.barraId,
      tipoControlStock: 'SIN_CONTROL',
    }),
  );
  return {
    id: creado.id,
    nombre,
    marca: nombre.split(' ').at(-1)!,
    linea: (cantidad = 1) => ({ productoId: creado.id, modificadorIds: [], cantidad }),
  };
}

/** Reimprime un trabajo (`ATENDER_MESA`, `Idempotency-Key` obligatoria) y devuelve el id del trabajo nuevo. */
async function reimprimir(s: SucursalP5, trabajoId: string): Promise<string> {
  const res = await llamar(ctx, s.tokenMozo, {
    metodo: 'post',
    ruta: `/impresion/trabajos/${trabajoId}/reimpresion`,
    cabeceras: clave(),
  });
  exigirEstado(res, 201, 'reimprimir el trabajo');
  return trabajoCreadoRespuestaSchema.parse(res.body).trabajoId;
}

/** El trabajo de la comanda de Cocina de un envío. */
async function trabajoDeCocina(
  comandas: Parameters<typeof comandaDe>[0],
): Promise<{ id: string; comandaId: string }> {
  const comanda = comandaDe(comandas, 'Cocina');
  const trabajo = solo(await trabajosDeComandas(admin, [comanda.id]));
  return { id: trabajo.id, comandaId: comanda.id };
}

/** Las marcas del criterio 118 y del 128, para el ticket de un trabajo con o sin ellas. */
function verificarMarcas(texto: string, marcas: { retraso: boolean; reimpresion: boolean }): void {
  if (marcas.retraso) expect(texto).toMatch(/Impreso con retraso/);
  else expect(texto).not.toMatch(/Impreso con retraso/);
  if (marcas.reimpresion) expect(texto).toMatch(/REIMPRESI.N/);
  else expect(texto).not.toMatch(/REIMPRESI.N/);
}

/**
 * Los tickets que recibió el emulador: todos completos, y con las marcas del caso. Si hay reimpresión, exactamente uno
 * lleva "REIMPRESIÓN" (los dos tienen la misma hora de creación, así que el orden entre ellos no se fija).
 */
function verificarImpresos(
  impresos: readonly TicketEmulado[],
  marcas: { retraso: boolean; reimpresion: boolean },
  verificarContenido: (texto: string) => void,
): void {
  const reimpresos = impresos.filter((t) => /REIMPRESI.N/.test(t.texto));
  expect(reimpresos, 'tickets con la marca REIMPRESIÓN').toHaveLength(marcas.reimpresion ? 1 : 0);
  for (const t of impresos) {
    verificarContenido(t.texto);
    verificarMarcas(t.texto, { retraso: marcas.retraso, reimpresion: reimpresos.includes(t) });
  }
}

const CASOS_DE_MARCAS = [
  { nombre: 'sin marcas', retraso: false, reimpresion: false },
  { nombre: 'con "Impreso con retraso"', retraso: true, reimpresion: false },
  { nombre: 'con "REIMPRESIÓN"', retraso: false, reimpresion: true },
  { nombre: 'con las dos marcas', retraso: true, reimpresion: true },
] as const;

// ===================================================================================================
// F1 · Ticket grande
// ===================================================================================================

/** 140 caracteres: el máximo de una observación (criterio 15). */
const OBSERVACION =
  'Sin cebolla ni ajo, salsa aparte, bien cocido, cortar en cuatro partes, empacar por separado y sin cubiertos descartables, gracias ok ya'.slice(
    0,
    140,
  );

interface ComboGrande {
  productoId: string;
  /** Nombre de cada uno de los 20 componentes de Cocina. */
  componentes: string[];
}

/** Un combo de 20 componentes de Cocina, con nombres largos y distintos. */
const comboGrande = memorizar(async (): Promise<ComboGrande> => {
  const componentes: { id: string; nombre: string }[] = [];
  for (let i = 1; i <= 20; i++) {
    const nombre = `Componente ${String(i).padStart(2, '0')} de la fuente grande ${randomUUID().slice(0, 8)}`;
    const creado = await crearEnCarta(ctx, esc.token.adminA, '/carta/productos', {
      tipo: 'SIMPLE',
      nombre,
      familiaId: esc.carta.familiaId,
      seVendeSolo: false,
      estacionId: esc.carta.cocinaId,
      tipoControlStock: 'SIN_CONTROL',
    });
    componentes.push({ id: creado.id, nombre });
  }
  const combo = await crearEnCarta(ctx, esc.token.adminA, '/carta/productos', {
    tipo: 'COMBO',
    nombre: nombreUnico('Combo familiar gigante'),
    familiaId: esc.carta.familiaId,
    precio: '150.00',
    tipoControlStock: 'SIN_CONTROL',
    componentes: componentes.map((c) => ({ productoId: c.id, cantidad: 1 })),
  });
  return { productoId: combo.id, componentes: componentes.map((c) => c.nombre) };
});

/** Seis líneas del combo grande, cada una con observación, "para llevar" y tiempo 2. */
const seisLineasDelCombo = (combo: ComboGrande): LineaCuerpo[] =>
  Array.from({ length: 6 }, (_v, i) => ({
    productoId: combo.productoId,
    modificadorIds: [],
    cantidad: i + 1,
    observacion: OBSERVACION,
    tiempo: 2 as const,
    paraLlevar: true,
  }));

/** El ticket de la comanda grande lleva sus 20 componentes, la observación y las marcas, sin recortes. */
function verificarComandaGrande(texto: string, combo: ComboGrande): void {
  const plano = compacto(texto);
  for (const nombre of combo.componentes) {
    expect(plano, `el ticket lleva el componente "${nombre}"`).toContain(compacto(nombre));
  }
  expect(texto).toMatch(/COCINA/);
  expect(texto).toMatch(/PARA LLEVAR/);
  expect(texto).toMatch(/ESPERAR/);
  expect(plano, 'el ticket lleva la observación completa').toContain(compacto(OBSERVACION));
}

describe('F1 · una comanda muy grande siempre se entrega y se imprime', () => {
  for (const caso of CASOS_DE_MARCAS) {
    it(`combo de 20 componentes en 6 líneas con observación, para llevar y tiempo 2, ${caso.nombre}`, async () => {
      const s = await S.s1();
      const combo = await comboGrande();
      const o = await abrir(s);
      const r = await enviarOk(ctx, s.tokenMozo, o.id, seisLineasDelCombo(combo));
      const original = await trabajoDeCocina(r.comandas);
      const objetivo = caso.reimpresion ? await reimprimir(s, original.id) : original.id;
      if (caso.retraso) ctx.reloj.avanzar(CON_RETRASO_MS);

      // El puente lo recibe: el trabajo está en la lista y sus bytes son un ticket completo.
      const { ticket } = await entregado(s, objetivo);
      verificarComandaGrande(ticket.texto, combo);
      verificarMarcas(ticket.texto, caso);

      // Y se imprime: el emulador recibe el mismo ticket completo (primero el original, si hay reimpresión).
      const pendientes = caso.reimpresion ? 2 : 1;
      const impresos = await imprimir(s, pendientes);
      verificarImpresos(impresos, caso, (texto) => verificarComandaGrande(texto, combo));
    });
  }
});

/** S2 con la impresora de Cocina también como impresora de caja (las pre-cuentas salen por ella). */
const conCaja = memorizar(async () => {
  const s = await S.s2();
  const caja = await llamar(ctx, s.tokenAdmin, {
    metodo: 'put',
    ruta: `/sucursales/${s.id}/impresion`,
    cuerpo: { impresoraCajaId: s.cocina.id },
  });
  exigirEstado(caja, 200, 'fijar la impresora de caja');
  return s;
});

/** Una orden de S2 con 600 ítems sin estación (no crean comandas). */
const ordenGrande = memorizar(async () => {
  const s = await conCaja();
  const productos: string[] = [];
  const marca = randomUUID().slice(0, 8);
  const crear = async (i: number) => {
    const creado = await crearEnCarta(
      ctx,
      esc.token.adminA,
      '/carta/productos',
      simpleNuevo(esc.carta, {
        nombre: `Ítem ${String(i).padStart(3, '0')} ${marca}`,
        precio: '10.00',
        estacionId: null,
        tipoControlStock: 'SIN_CONTROL',
      }),
    );
    productos[i] = creado.id;
  };
  for (let desde = 0; desde < 601; desde += 5) {
    await Promise.all(
      Array.from({ length: Math.min(5, 601 - desde) }, (_v, k) => crear(desde + k)),
    );
  }
  const orden = await abrir(s);
  for (let envioNumero = 0; envioNumero < 12; envioNumero++) {
    const lineas = Array.from({ length: 50 }, (_v, k) => ({
      productoId: productos[envioNumero * 50 + k]!,
      modificadorIds: [] as string[],
      cantidad: 1,
    }));
    await enviarOk(ctx, s.tokenMozo, orden.id, lineas);
  }
  return { s, orden, adicional: productos[600]! };
});

describe('F1 · una pre-cuenta de unos 600 ítems siempre se entrega y se imprime', () => {
  for (const caso of CASOS_DE_MARCAS) {
    it(`pre-cuenta de 600 ítems, ${caso.nombre}`, async () => {
      const grande = await ordenGrande();
      const { s, orden } = grande;
      // Cada caso agrega un ítem: la pre-cuenta vigente se invalida y la que sigue es nueva (criterio 53).
      const adicion = await enviarOk(ctx, s.tokenMozo, orden.id, [
        { productoId: grande.adicional, modificadorIds: [], cantidad: 1 },
      ]);
      expect(adicion.items).toHaveLength(1);
      const res = await pedirPrecuenta(ctx, s.tokenMozo, orden.id);
      exigirEstado(res, 201, 'pedir la pre-cuenta de 600 ítems');
      expect(res.body.impresion).toBe('EN_COLA');
      const original = res.body.trabajoId as string;
      expect(original).toEqual(expect.any(String));
      const total = res.body.total as string;
      const objetivo = caso.reimpresion ? await reimprimir(s, original) : original;
      if (caso.retraso) ctx.reloj.avanzar(CON_RETRASO_MS);

      const verificar = (texto: string) => {
        const plano = compacto(texto);
        expect(texto).toMatch(/PRE-CUENTA/);
        const conMiles = total.replace(/\B(?=(\d{3})+(?!\d))/, ',');
        expect(
          plano.includes(`TOTALS/${total}`) || plano.includes(`TOTALS/${conMiles}`),
          `el ticket lleva "TOTAL S/ ${total}"`,
        ).toBe(true);
        expect(plano, 'el ticket lleva la nota del criterio 51').toContain('PreciosconIGVincluido');
      };

      const { ticket } = await entregado(s, objetivo);
      verificar(ticket.texto);
      verificarMarcas(ticket.texto, caso);

      const impresos = await imprimir(s, caso.reimpresion ? 2 : 1);
      verificarImpresos(impresos, caso, verificar);
    });
  }
});

// ===================================================================================================
// F2 · Mesas unidas con nombres largos
// ===================================================================================================

/** Crea `cantidad` mesas libres de una sucursal, cada una con un nombre de 20 caracteres (el máximo). */
async function mesasConNombreLargo(
  s: SucursalP5,
  cantidad: number,
): Promise<{ id: string; nombre: string }[]> {
  const zona = await llamar(ctx, s.tokenAdmin, {
    metodo: 'post',
    ruta: `/sucursales/${s.id}/zonas`,
    cuerpo: { nombre: `Zona ${randomUUID().slice(0, 8)}`, columnas: 12, filas: 30 },
  });
  exigirEstado(zona, 201, 'crear una zona');
  const mesas: { id: string; nombre: string }[] = [];
  for (let i = 0; i < cantidad; i++) {
    // No empieza con "Mesa": el ticket antepone "Mesas" y omite esa palabra del nombre.
    const nombre = `Salon ${String(i + 1).padStart(2, '0')} ${randomUUID().replace(/-/g, '').slice(0, 11)}`;
    expect(nombre).toHaveLength(20);
    const mesa = await llamar(ctx, s.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${s.id}/zonas/${zona.body.id}/mesas`,
      cuerpo: {
        nombre,
        capacidad: 4,
        forma: 'CUADRADA',
        columna: (i % 12) + 1,
        fila: Math.floor(i / 12) + 1,
      },
    });
    exigirEstado(mesa, 201, 'crear una mesa de 20 caracteres');
    mesas.push({ id: mesa.body.id as string, nombre });
  }
  return mesas;
}

describe('F2 · mesas unidas con nombres de 20 caracteres', () => {
  for (const cantidad of [10, 20]) {
    it(`con ${cantidad} mesas unidas, el envío a Cocina y la pre-cuenta responden 201 y los dos tickets llevan todas las mesas`, async () => {
      const s = await conCaja();
      const mesas = await mesasConNombreLargo(s, cantidad);
      const orden = await abrir(s, mesas[0]!.id);
      await unirMesasOk(
        ctx,
        s.tokenSupervisor,
        orden.id,
        mesas.slice(1).map((m) => m.id),
      );
      const plato = await platoNuevo('cocina');

      const envioRes = await enviarComanda(ctx, s.tokenMozo, orden.id, envio([plato.linea(2)]));
      exigirEstado(envioRes, 201, `enviar a Cocina con ${cantidad} mesas unidas`);
      const comanda = await trabajoDeCocina(envioRes.body.comandas);
      const precuentaRes = await pedirPrecuenta(ctx, s.tokenMozo, orden.id);
      exigirEstado(precuentaRes, 201, `pedir la pre-cuenta con ${cantidad} mesas unidas`);
      expect(precuentaRes.body.impresion).toBe('EN_COLA');
      const precuenta = precuentaRes.body.trabajoId as string;

      // Se entregan los dos trabajos, con todas las mesas.
      const { ticket: deComanda } = await entregado(s, comanda.id);
      const { ticket: dePrecuenta } = await entregado(s, precuenta);
      const verificar = (texto: string, que: string) => {
        const plano = compacto(texto);
        for (const mesa of mesas) {
          // Las comandas llevan el título en mayúsculas: se compara sin distinguirlas.
          expect(plano.toUpperCase(), `${que} lleva la mesa "${mesa.nombre}"`).toContain(
            compacto(mesa.nombre).toUpperCase(),
          );
        }
      };
      verificar(deComanda.texto, 'el ticket de la comanda');
      verificar(dePrecuenta.texto, 'el ticket de la pre-cuenta');

      // Y se imprimen.
      const impresos = await imprimir(s, 2);
      const impresoComanda = impresos.find((t) => !/PRE-CUENTA/.test(t.texto));
      const impresaPrecuenta = impresos.find((t) => /PRE-CUENTA/.test(t.texto));
      expect(impresoComanda, 'el emulador recibe el ticket de la comanda').toBeDefined();
      expect(impresaPrecuenta, 'el emulador recibe el ticket de la pre-cuenta').toBeDefined();
      expect(impresoComanda!.texto).toContain(plato.marca);
      verificar(impresoComanda!.texto, 'el ticket impreso de la comanda');
      verificar(impresaPrecuenta!.texto, 'el ticket impreso de la pre-cuenta');
    });
  }
});

// ===================================================================================================
// F3 · La cola no se bloquea
// ===================================================================================================

/** Alta de una impresora Bluetooth (no la reporta el puente de 3b). */
async function crearImpresoraBluetooth(s: SucursalP5): Promise<string> {
  const res = await llamar(ctx, s.tokenAdmin, {
    metodo: 'post',
    ruta: `/sucursales/${s.id}/impresoras`,
    cuerpo: {
      nombre: `Bluetooth ${randomUUID().slice(0, 8)}`,
      conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF' },
      anchoMm: 58,
      juegoCaracteres: 'PC850',
      gaveta: false,
    },
  });
  exigirEstado(res, 201, 'crear la impresora Bluetooth');
  return res.body.id as string;
}

/**
 * Manda `cantidad` adiciones de un producto de Barra a la misma orden (cada una crea un trabajo para la impresora
 * de Barra) y devuelve los ids de esos trabajos de la impresora, en el orden en que se crearon.
 */
async function acumularTrabajos(
  s: SucursalP5,
  plato: PlatoPropio,
  impresoraId: string,
  cantidad: number,
): Promise<string[]> {
  const existentes = new Set((await trabajosDeSucursal(admin, s.id)).map((t) => t.id));
  const orden = await abrir(s);
  for (let i = 0; i < cantidad; i++) {
    await enviarOk(ctx, s.tokenMozo, orden.id, [plato.linea(1)]);
    ctx.reloj.avanzar(20);
  }
  const propios = (await trabajosDeSucursal(admin, s.id)).filter(
    (t) => t.impresora_id === impresoraId && !existentes.has(t.id),
  );
  expect(propios, `trabajos acumulados en la impresora ${impresoraId}`).toHaveLength(cantidad);
  return propios.map((t) => t.id);
}

/** Después de acumular, una comanda de Cocina (impresora de red encendida) se entrega y se imprime. */
async function comandaDeCocinaSeImprime(s: SucursalP5, acumulados: readonly string[]) {
  ctx.reloj.avanzar(1000);
  const plato = await platoNuevo('cocina');
  const o = await abrir(s);
  const r = await enviarOk(ctx, s.tokenMozo, o.id, [plato.linea(1)]);
  const trabajo = await trabajoDeCocina(r.comandas);

  const lista = await pedirTrabajos(s);
  expect(
    lista.some((t) => t.id === trabajo.id),
    `GET /puente/trabajos entrega la comanda de Cocina (entregó ${lista.length} trabajos)`,
  ).toBe(true);
  const delSobrante = lista.filter((t) => acumulados.includes(t.id));
  return { lista, delSobrante, plato, trabajo };
}

describe('F3 · una impresora con muchos trabajos acumulados no bloquea a las demás', () => {
  it('una estación con impresora Bluetooth que acumula más de 50 trabajos: la comanda de Cocina se entrega e imprime y los trabajos Bluetooth no se entregan', async () => {
    const s = await S.s3();
    const bluetooth = await crearImpresoraBluetooth(s);
    await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
      destino: 'IMPRESORA',
      impresoraId: bluetooth,
    });
    try {
      const barra = await platoNuevo('barra');
      const acumulados = await acumularTrabajos(s, barra, bluetooth, TRABAJOS_ACUMULADOS);

      const { delSobrante, plato } = await comandaDeCocinaSeImprime(s, acumulados);
      expect(
        delSobrante.map((t) => t.id),
        'los trabajos de una impresora Bluetooth no se entregan en la 3b',
      ).toEqual([]);

      const [ticket] = await imprimir(s, 1);
      expect(ticket!.texto).toContain(plato.marca);
      expect(ticket!.texto).toMatch(/COCINA/);
    } finally {
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, { destino: 'KDS' });
    }
  });

  it('una impresora de red apagada que acumula más de 50 trabajos NO_IMPRESO: la comanda de Cocina se entrega e imprime y de la apagada no se entregan más de N', async () => {
    const s = await S.s3();
    const apagada = await crearImpresora(
      ctx,
      cierres,
      s.tokenAdmin,
      s.id,
      `Barra ${randomUUID().slice(0, 8)}`,
    );
    await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
      destino: 'IMPRESORA',
      impresoraId: apagada.id,
    });
    try {
      const barra = await platoNuevo('barra');
      const acumulados = await acumularTrabajos(s, barra, apagada.id, TRABAJOS_ACUMULADOS);
      await apagada.emulador.apagar();
      // El puente intentó imprimirlos todos y la impresora no respondió.
      for (const id of acumulados) {
        const res = await llamarPuente(
          ctx,
          s.puente!.token!,
          'post',
          `/puente/trabajos/${id}/resultado`,
          {
            resultado: 'NO_IMPRESO',
            error: 'La impresora no responde',
          },
        );
        exigirEstado(res, 200, 'reportar NO_IMPRESO');
      }
      const pendientes = (await trabajosDeSucursal(admin, s.id)).filter(
        (t) => t.impresora_id === apagada.id,
      );
      expect(pendientes.every((t) => t.estado === 'PENDIENTE' && t.intentos >= 1)).toBe(true);

      const { delSobrante, plato } = await comandaDeCocinaSeImprime(s, acumulados);
      expect(delSobrante.length).toBeLessThanOrEqual(N_POR_IMPRESORA);

      const [ticket] = await imprimir(s, 1);
      expect(ticket!.texto).toContain(plato.marca);
      expect(ticket!.texto).toMatch(/COCINA/);
    } finally {
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, { destino: 'KDS' });
    }
  });

  it('una impresora inactiva con más de 50 trabajos pendientes: la comanda de Cocina se entrega e imprime y los trabajos de la inactiva no se entregan', async () => {
    const s = await S.s3();
    const inactiva = await crearImpresora(
      ctx,
      cierres,
      s.tokenAdmin,
      s.id,
      `Vieja ${randomUUID().slice(0, 8)}`,
    );
    await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
      destino: 'IMPRESORA',
      impresoraId: inactiva.id,
    });
    const barra = await platoNuevo('barra');
    const acumulados = await acumularTrabajos(s, barra, inactiva.id, TRABAJOS_ACUMULADOS);
    // Se deja de usar y se desactiva: sus trabajos siguen en la cola (criterio 104).
    await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, { destino: 'KDS' });
    await desactivarImpresora(ctx, s.tokenAdmin, s.id, inactiva.id);

    const { delSobrante, plato } = await comandaDeCocinaSeImprime(s, acumulados);
    expect(
      delSobrante.map((t) => t.id),
      'los trabajos de una impresora inactiva no se entregan en la 3b',
    ).toEqual([]);

    const [ticket] = await imprimir(s, 1);
    expect(ticket!.texto).toContain(plato.marca);
    await inactiva.emulador.noRecibe(300);
  });

  it('con pocos trabajos, los de una impresora Bluetooth o inactiva tampoco se entregan y los de la impresora de red sí', async () => {
    const s = await S.s3();
    const bluetooth = await crearImpresoraBluetooth(s);
    const inactiva = await crearImpresora(
      ctx,
      cierres,
      s.tokenAdmin,
      s.id,
      `Vieja ${randomUUID().slice(0, 8)}`,
    );
    const barra = await platoNuevo('barra');
    try {
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
        destino: 'IMPRESORA',
        impresoraId: bluetooth,
      });
      const deBluetooth = await acumularTrabajos(s, barra, bluetooth, 3);
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
        destino: 'IMPRESORA',
        impresoraId: inactiva.id,
      });
      const deInactiva = await acumularTrabajos(s, barra, inactiva.id, 3);
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, { destino: 'KDS' });
      await desactivarImpresora(ctx, s.tokenAdmin, s.id, inactiva.id);

      const { lista, delSobrante, trabajo } = await comandaDeCocinaSeImprime(s, [
        ...deBluetooth,
        ...deInactiva,
      ]);
      expect(lista.some((t) => t.id === trabajo.id)).toBe(true);
      expect(
        delSobrante.map((t) => t.id),
        'ni Bluetooth ni inactiva',
      ).toEqual([]);
    } finally {
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, { destino: 'KDS' });
    }
  });

  it('la entrega es por impresora: como máximo N por impresora y los más antiguos de cada una, en orden de creación', async () => {
    const s = await S.s3();
    const otra = await crearImpresora(
      ctx,
      cierres,
      s.tokenAdmin,
      s.id,
      `Barra ${randomUUID().slice(0, 8)}`,
    );
    await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
      destino: 'IMPRESORA',
      impresoraId: otra.id,
    });
    try {
      const deCocina = await platoNuevo('cocina');
      const deBarra = await platoNuevo('barra');
      // 30 trabajos para Cocina y después 30 para la otra impresora: la entrega antigua daba 30 y 20.
      const idsCocina = await acumularTrabajos(s, deCocina, s.cocina.id, 30);
      const idsOtra = await acumularTrabajos(s, deBarra, otra.id, 30);

      const lista = await pedirTrabajos(s);
      const entregadosDe = (impresoraId: string) =>
        lista.filter((t) => t.impresoraId === impresoraId).map((t) => t.id);
      expect(entregadosDe(s.cocina.id)).toEqual(idsCocina.slice(0, N_POR_IMPRESORA));
      expect(entregadosDe(otra.id)).toEqual(idsOtra.slice(0, N_POR_IMPRESORA));
      expect(lista.filter((t) => [s.cocina.id, otra.id].includes(t.impresoraId))).toHaveLength(
        2 * N_POR_IMPRESORA,
      );
    } finally {
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, { destino: 'KDS' });
    }
  });
});

// ===================================================================================================
// F4 · El socket se cae después del aviso de desconexión
// ===================================================================================================

describe('F4 · cerrar el socket del puente después del aviso de desconexión', () => {
  /** Avisos `impresion.estado` de una sucursal publicados desde la última vez (los saca de la memoria). */
  const avisos = (sucursalId: string): number => {
    const propios = ctx.publicador
      .eventos()
      .filter(
        (e) =>
          e.nombre === 'impresion.estado' &&
          e.sala.tipo === 'sucursal' &&
          e.sala.sucursalId === sucursalId,
      );
    ctx.publicador.limpiar();
    return propios.length;
  };

  const pedirEstado = async (token: string): Promise<EstadoImpresionRespuesta> => {
    const res = await llamar(ctx, token, { metodo: 'get', ruta: '/impresion/estado' });
    exigirEstado(res, 200, 'GET /impresion/estado');
    return estadoImpresionRespuestaSchema.parse(res.body);
  };

  /** Espera a que el socket del puente deje su señal (con el reloj manual: `ultima_senal_en` = ahora). */
  const esperarSenal = async (puenteId: string) => {
    const limite = Date.now() + 5000;
    for (;;) {
      const { rows } = await admin.query<{ ok: boolean }>(
        'SELECT ultima_senal_en = $2 AS ok FROM puente WHERE id = $1',
        [puenteId, ctx.reloj.ahora()],
      );
      if (rows[0]?.ok === true) return;
      if (Date.now() >= limite) throw new Error('El socket del puente no dejó su señal en 5 s');
      await asentar(20);
    }
  };

  it('no publica ningún evento, el puente sigue desconectado y 61 s más tarde no hay un segundo aviso', async () => {
    const sucursalId = B().S1;
    const token = await sesionContrasena(ctx, B().base.admin, sucursalId);
    await crearImpresoraSinEmulador(ctx, B().tokenAdmin, sucursalId);
    const puente = await nuevoPuente(ctx, B().tokenAdmin, B(), sucursalId);

    // El puente se conecta por el socket y deja su señal.
    ctx.reloj.avanzar(1000);
    const socket = await conectarSocketDelPuente(ctx.app, cierres, puente.token);
    await esperarSenal(puente.id);
    await asentar(400);
    expect((await pedirEstado(token)).puente).toMatchObject({ id: puente.id, conectado: true });
    avisos(sucursalId);

    // Pasan más de 60 segundos sin señal: la revisión avisa la desconexión, una vez.
    ctx.reloj.avanzar(61_000);
    await senal.revisarAhora();
    expect(avisos(sucursalId), 'la revisión avisa la desconexión').toBe(1);
    expect((await pedirEstado(token)).puente).toMatchObject({ id: puente.id, conectado: false });

    // El socket se cae después del aviso: no cambia nada.
    socket.cerrar();
    await asentar(600);
    expect(avisos(sucursalId), 'cerrar el socket no publica ningún evento').toBe(0);
    expect(
      (await pedirEstado(token)).puente,
      'el puente sigue desconectado después de cerrar el socket',
    ).toMatchObject({ id: puente.id, conectado: false });

    // 61 s más tarde, la revisión no vuelve a avisar.
    ctx.reloj.avanzar(61_000);
    await senal.revisarAhora();
    await senal.revisarAhora();
    expect(avisos(sucursalId), 'no hay un segundo aviso de desconexión').toBe(0);
    expect((await pedirEstado(token)).puente).toMatchObject({ id: puente.id, conectado: false });
  });
});

// ===================================================================================================
// F5 · Dos códigos de vinculación a la vez
// ===================================================================================================

describe('F5 · dos códigos de vinculación simultáneos dejan un solo código válido', () => {
  const RONDAS = 12;

  it(`en ${RONDAS} rondas, los dos POST responden 201 y solo uno de los dos códigos vincula`, async () => {
    const sucursalId = B().S2;
    const ruta = `/sucursales/${sucursalId}/vinculaciones-puente`;
    for (let ronda = 1; ronda <= RONDAS; ronda++) {
      const [uno, otro] = await Promise.all([
        llamar(ctx, B().tokenAdmin, { metodo: 'post', ruta }),
        llamar(ctx, B().tokenAdmin, { metodo: 'post', ruta }),
      ]);
      exigirEstado(uno, 201, `ronda ${ronda}: el primer código`);
      exigirEstado(otro, 201, `ronda ${ronda}: el segundo código`);
      const codigos = [uno, otro].map((r) => vinculacionRespuestaSchema.parse(r.body).token);
      expect(codigos[0]).not.toBe(codigos[1]);

      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM vinculacion_puente
          WHERE sucursal_id = $1 AND usada_en IS NULL AND invalidada_en IS NULL AND expira_en > $2`,
        [sucursalId, ctx.reloj.ahora()],
      );
      expect(rows[0]!.n, `ronda ${ronda}: códigos pendientes y vigentes en la base`).toBe(1);

      // Y por la API: exactamente uno de los dos vincula (el que vincula queda usado).
      const estados: number[] = [];
      for (const codigo of codigos) estados.push((await vincular(ctx, codigo)).status);
      expect(estados.sort(), `ronda ${ronda}: resultado de usar cada código`).toEqual([201, 401]);
    }
  });
});

// ===================================================================================================
// F6 · El secreto del código de vinculación no se guarda
// ===================================================================================================

describe('F6 · ninguna tabla guarda el secreto del token de vinculación', () => {
  /** Tablas (esquema.tabla) cuya fila contiene alguno de los textos dados, en cualquier columna. */
  async function tablasConTexto(textos: string[]): Promise<string[]> {
    const { rows: tablas } = await admin.query<{ esquema: string; tabla: string }>(
      `SELECT n.nspname AS esquema, c.relname AS tabla
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
        ORDER BY 1, 2`,
    );
    const halladas: string[] = [];
    for (const { esquema, tabla } of tablas) {
      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${esquema}"."${tabla}" f
          WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) x WHERE strpos(f::text, x) > 0)`,
        [textos],
      );
      if (rows[0]!.n > 0) halladas.push(`${esquema}.${tabla}`);
    }
    return halladas;
  }

  it('crear el código con Idempotency-Key no deja el secreto en idempotencia.respuesta ni en ninguna otra tabla', async () => {
    const res = await conClave(
      ctx,
      B().tokenAdmin,
      'post',
      `/sucursales/${B().S2}/vinculaciones-puente`,
      undefined,
      randomUUID(),
    );
    exigirEstado(res, 201, 'crear el código de vinculación con Idempotency-Key');
    const { token, qr } = vinculacionRespuestaSchema.parse(res.body);
    const [prefijo, , vinculacionId, secreto] = token.split('.') as [
      string,
      string,
      string,
      string,
    ];
    expect(prefijo).toBe('vi');
    expect(secreto).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Control: la búsqueda encuentra algo que sí se guarda (el id de la vinculación), así no es una búsqueda vacía.
    expect(await tablasConTexto([vinculacionId])).toContain('public.vinculacion_puente');

    const bytes = Buffer.from(secreto, 'base64url');
    const variantes = [secreto, bytes.toString('hex'), bytes.toString('base64'), token, qr];
    const halladas = await tablasConTexto(variantes);
    expect(halladas, 'tablas que guardan el secreto del token vi.').toEqual([]);
  });
});

// ===================================================================================================
// F7 · Motivo largo en el ticket de anulación
// ===================================================================================================

/** 43 palabras de 6 caracteres separadas por un espacio: exactamente 300 caracteres (el máximo de un motivo). */
const MOTIVO_LARGO = Array.from(
  { length: 43 },
  (_v, i) => `mot${String(i + 1).padStart(3, '0')}`,
).join(' ');

describe('F7 · un motivo de anulación de 300 caracteres sale completo en el ticket', () => {
  it('el motivo mide 300 caracteres', () => {
    expect(MOTIVO_LARGO).toHaveLength(300);
  });

  it('anular un ítem enviado: el trabajo de anulación se entrega e imprime con el motivo completo', async () => {
    const s = await S.s1();
    const plato = await platoNuevo('cocina');
    const o = await abrir(s);
    const r = await enviarOk(ctx, s.tokenMozo, o.id, [plato.linea(3)]);
    const res = await llamar(ctx, s.tokenSupervisor, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/items/${r.items[0]!.id}/anulaciones`,
      cuerpo: { id: randomUUID(), cantidad: 1, motivo: MOTIVO_LARGO, destinoStock: 'VUELVE' },
      cabeceras: clave(),
    });
    exigirEstado(res, 201, 'anular un ítem con un motivo de 300 caracteres');
    const comandas = (await comandasBd(admin, o.id)).filter(
      (c) => c.tipo === 'ANULACION' && c.estacion_id === s.carta.cocinaId,
    );
    const anulacion = solo(await trabajosDeComandas(admin, [solo(comandas).id]));

    const { ticket } = await entregado(s, anulacion.id);
    expect(ticket.texto).toMatch(/ANULACI.N/);
    expect(compacto(ticket.texto), 'el ticket lleva el motivo completo').toContain(
      compacto(MOTIVO_LARGO),
    );

    const impresos = await imprimir(s, 2);
    const impreso = impresos.find((t) => /ANULACI.N/.test(t.texto));
    expect(impreso, 'el emulador recibe el ticket de anulación').toBeDefined();
    expect(compacto(impreso!.texto)).toContain(compacto(MOTIVO_LARGO));
  });

  it('anular la orden: el trabajo de anulación se entrega e imprime con el motivo completo', async () => {
    const s = await S.s1();
    const plato = await platoNuevo('cocina');
    const o = await abrir(s);
    await enviarOk(ctx, s.tokenMozo, o.id, [plato.linea(2)]);
    const res = await llamar(ctx, s.tokenSupervisor, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/anulacion`,
      cuerpo: { motivo: MOTIVO_LARGO, destinoStock: 'VUELVE' },
      cabeceras: clave(),
    });
    exigirEstado(res, 200, 'anular la orden con un motivo de 300 caracteres');
    const comandas = (await comandasBd(admin, o.id)).filter(
      (c) => c.tipo === 'ANULACION' && c.estacion_id === s.carta.cocinaId,
    );
    const trabajo = solo(await trabajosDeComandas(admin, [solo(comandas).id]));

    const { ticket } = await entregado(s, trabajo.id);
    expect(ticket.texto).toMatch(/ANULACI.N/);
    expect(compacto(ticket.texto), 'el ticket lleva el motivo completo').toContain(
      compacto(MOTIVO_LARGO),
    );

    const impresos = await imprimir(s, 2);
    const impreso = impresos.find((t) => /ANULACI.N/.test(t.texto));
    expect(impreso, 'el emulador recibe el ticket de anulación').toBeDefined();
    expect(compacto(impreso!.texto)).toContain(compacto(MOTIVO_LARGO));
  });
});
