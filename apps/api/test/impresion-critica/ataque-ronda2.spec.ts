// spec: 004-salon-cocina (pruebas protegidas)
//
// Ataque adversarial, ronda 2, a la entrega 3b (impresión). Cada falla que encontró el ataque es una prueba:
//
// - F1 · Comandas y pre-cuentas grandes, dentro de los límites de entrada, se imprimen completas (criterios 124,
//   125 y 126). `MAXIMO_BLOQUES_TICKET` es 3000. Casos: un combo de 20 componentes de Cocina con nombres de 60
//   caracteres en un envío de 50 líneas; un producto SIMPLE con nombre de 100, 30 modificadores de 60 y observación
//   de 140 en 50 líneas; una pre-cuenta de 600 ítems (12 envíos de 50) con nombres de 100. Si un ticket aun así no
//   cabe, sale con el aviso "Ticket incompleto: faltan N líneas. Revisa la cuenta en la app." (sin remitir al KDS)
//   y el trabajo queda marcado `incompleto: true` en `GET /impresion/trabajos`.
// - F2 · La marca "Impreso con retraso · enviado a las …" (criterio 118) no se falsifica con un producto o un
//   modificador que se llame "Impreso con retraso de horno": sin retraso el ticket no lleva la marca y con retraso
//   (más de 2 minutos) sí, en una comanda y en una pre-cuenta.
// - F3 · `ordenId` de `GET /impresion/trabajos` (criterio 128). Con O2 unida a O1, `?ordenId=O2` responde una
//   lista vacía (O2 ya no tiene trabajos propios) y `?ordenId=O1` trae los dos trabajos; cada trabajo dice
//   `ordenId` = O1.
// - F4 · Reimpresión a una impresora que pasó a ser Bluetooth (criterio 128). Si la impresora original sigue activa
//   pero ahora es Bluetooth, `POST /impresion/trabajos/:id/reimpresion` responde 409 `SIN_IMPRESORA` y no crea el
//   trabajo (en 3b nadie imprime por Bluetooth, decisión 12).
// - F5 · Tamaño de la entrega (criterio 113). `GET /puente/trabajos` no pasa de un tope de bytes (menos de 2 MB) y
//   aun así entrega al menos un trabajo por impresora; con 5 impresoras y 20 tickets grandes cada una, el simulador
//   los imprime todos en llamadas sucesivas y en el orden de creación de cada impresora.
//
// Interpretaciones (ver el informe de entrega):
// - El campo del trabajo incompleto es `incompleto: boolean` en `trabajoResumenSchema` (si el backend lo llamó de
//   otro modo, cambia la constante `CAMPO_INCOMPLETO`). Se lee del cuerpo crudo de la respuesta, no del esquema
//   zod (que descartaría un campo que todavía no conozca). En un trabajo completo el campo es `false` o no viene.
// - "Ticket completo" es: el ticket se entrega y se imprime con su corte, no dice "Ticket incompleto" y lleva cada
//   nombre, modificador y observación tantas veces como líneas del envío. Los textos se comparan sin espacios ni
//   saltos de línea (`compacto`): un nombre puede partirse en varias líneas, lo que no puede es perderse.
// - Una "orden unida" no se vuelve a pedir por su id: `?ordenId=O2` es vacío aunque O2 haya tenido trabajos.
//
// La API real corre con `RelojManual`, un `InventarioDePrueba` y Socket.IO habilitado. Las impresoras, los
// destinos y la vinculación se configuran por las rutas de 3b; el puente es el `SimuladorPuente`; las impresoras
// son `EmuladorEscPos`. La carta es la de ejemplo de `spec.md` (fábricas protegidas de 3a).
import { randomUUID } from 'node:crypto';
import {
  MAXIMO_BLOQUES_TICKET,
  documentoTicketSchema,
  trabajoCreadoRespuestaSchema,
  trabajoParaImprimirSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  enviarOk,
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
  crearImpresora,
  fijarDestino,
  memorizar,
  prepararSucursalP5,
  simuladorVinculado,
  trabajosDeComandas,
  trabajosDeSucursal,
  contarTrabajos,
  type AppP5,
  type ImpresoraDePrueba,
  type SucursalP5,
} from './fabrica-p5';
import { llamarPuente } from './fabrica-p6';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

/** El nombre del campo que marca un trabajo cuyo ticket salió con el aviso "Ticket incompleto" (ver la cabecera). */
const CAMPO_INCOMPLETO = 'incompleto';
/** Más de lo que fija el criterio 118 (2 minutos). */
const CON_RETRASO_MS = 4 * MINUTO;
/** El tope de la respuesta de `GET /puente/trabajos` (F5). */
const DOS_MB = 2 * 1024 * 1024;

let ctx: AppP5;
let admin: Client;
let esc: EscenarioP2;
const cierres = new Cierres();
const preparadas: SucursalP5[] = [];

const A = () => esc.e.A;

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
  /** S2 de A: como S1; su impresora de Cocina es también la de caja (se configura al usarla). */
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
  /** S3 de A: para el tamaño de la entrega (F5), con cinco impresoras propias. */
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

/** Cuántas veces aparece `aguja` en `pajar` (sin solaparse). */
const contar = (pajar: string, aguja: string): number =>
  aguja.length === 0 ? 0 : pajar.split(aguja).length - 1;

const solo = <T>(valores: readonly T[]): T => {
  expect(valores).toHaveLength(1);
  return valores[0]!;
};

const RELLENO =
  ' de la casa con mucho sabor y cuidado para el cliente que nos visita hoy en el salon principal del restaurante y su familia';

/** Un nombre de exactamente `largo` caracteres (ASCII, sin espacios al inicio ni al final), único por `etiqueta`. */
function nombreDeLargo(largo: number, etiqueta: string): string {
  const base = `${etiqueta}${RELLENO.repeat(Math.ceil(largo / RELLENO.length) + 1)}`.slice(
    0,
    largo,
  );
  const nombre = base.endsWith(' ') ? `${base.slice(0, -1)}x` : base;
  expect(nombre).toHaveLength(largo);
  return nombre;
}

const marcaUnica = (): string => randomUUID().replace(/-/g, '').slice(0, 8);

const abrir = (s: SucursalP5): Promise<OrdenAbierta> => abrirOrden(ctx, s.salon, s.tokenMozo);

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

/** `GET /puente/trabajos` entrega el trabajo `trabajoId`; devuelve el ticket decodificado. */
async function entregado(s: SucursalP5, trabajoId: string): Promise<TicketEmulado> {
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
  return decodificar(trabajo!);
}

/** Inicia el simulador del puente de la sucursal y espera `n` tickets en el emulador de su impresora de Cocina. */
async function imprimir(s: SucursalP5, n: number, ms = 60_000): Promise<TicketEmulado[]> {
  const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!);
  await simulador.iniciar();
  try {
    const tickets = await s.cocina.emulador.esperarTickets(n, ms);
    await simulador.esperarImpresos(n, 15_000);
    for (const t of tickets) {
      expect(t.completo, 'el emulador recibe el ticket con su corte').toBe(true);
      expect(t.comandosDesconocidos, 'ningún comando que la impresora no conozca').toEqual([]);
    }
    return tickets;
  } finally {
    await simulador.detener();
  }
}

/** `GET /impresion/trabajos` con una sesión de la sucursal (cuerpo crudo: incluye campos que el esquema no conozca). */
async function listarTrabajos(
  token: string,
  consulta = '',
): Promise<Array<Record<string, unknown>>> {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: `/impresion/trabajos${consulta}` });
  exigirEstado(res, 200, `GET /impresion/trabajos${consulta}`);
  expect(Array.isArray(res.body)).toBe(true);
  return res.body as Array<Record<string, unknown>>;
}

/** El resumen de un trabajo en la lista de "Trabajos de hoy". */
async function resumenDe(s: SucursalP5, trabajoId: string): Promise<Record<string, unknown>> {
  const lista = await listarTrabajos(s.tokenMozo);
  const resumen = lista.find((t) => t.id === trabajoId);
  expect(resumen, `GET /impresion/trabajos lista el trabajo ${trabajoId}`).toBeDefined();
  return resumen!;
}

/** Un trabajo completo no se marca como incompleto (el campo es `false` o no viene). */
function exigirCompleto(resumen: Record<string, unknown>): void {
  expect(resumen[CAMPO_INCOMPLETO] === true, 'el trabajo no está marcado como incompleto').toBe(
    false,
  );
}

/** El trabajo de la comanda de Cocina de un envío. */
async function trabajoDeCocina(
  comandas: Parameters<typeof comandaDe>[0],
): Promise<{ id: string; comandaId: string }> {
  const comanda = comandaDe(comandas, 'Cocina');
  const trabajo = solo(await trabajosDeComandas(admin, [comanda.id]));
  return { id: trabajo.id, comandaId: comanda.id };
}

/** Reimprime un trabajo (`ATENDER_MESA`, `Idempotency-Key` obligatoria). */
function pedirReimpresion(s: SucursalP5, trabajoId: string) {
  return llamar(ctx, s.tokenMozo, {
    metodo: 'post',
    ruta: `/impresion/trabajos/${trabajoId}/reimpresion`,
    cabeceras: clave(),
  });
}

/** El ticket no dice que le falten líneas ni deja de llevar nada. */
function exigirSinAviso(texto: string): void {
  expect(compacto(texto), 'el ticket no dice "Ticket incompleto"').not.toMatch(/Ticketincompleto/i);
}

/** El aviso del papel cuando a un ticket no le cupo todo: dice cuántas líneas faltan y no remite al KDS. */
const AVISO_COMPACTO = /Ticketincompleto:faltan(\d+)líneas\.Revisalacuentaenlaapp\./;

// ---------------------------------------------------------------------------------------------------
// La carta de los casos grandes
// ---------------------------------------------------------------------------------------------------

/** 140 caracteres: el máximo de una observación (criterio 15). */
const OBSERVACION = nombreDeLargo(140, 'Obs larga');

interface ComboGrande {
  productoId: string;
  /** Nombre de cada uno de los 20 componentes de Cocina (60 caracteres). */
  componentes: string[];
}

/** Un combo de 20 componentes de Cocina con nombres de 60 caracteres, sin modificadores. */
const comboDe20 = memorizar(async (): Promise<ComboGrande> => {
  const componentes = await componentesDe20();
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

const componentesDe20 = memorizar(async () => {
  const marca = marcaUnica();
  const componentes: { id: string; nombre: string }[] = [];
  for (let i = 1; i <= 20; i++) {
    const nombre = nombreDeLargo(60, `Comp${String(i).padStart(2, '0')}x${marca}`);
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
  return componentes;
});

interface GrupoDe30 {
  grupoId: string;
  /** Id y nombre (60 caracteres) de cada uno de los 30 modificadores. */
  modificadores: { id: string; nombre: string }[];
}

/** Un grupo de selección múltiple de 30 modificadores de 60 caracteres, sin producto ligado. */
async function grupoDe30(): Promise<GrupoDe30> {
  const marca = marcaUnica();
  const nombres = Array.from({ length: 30 }, (_v, i) =>
    nombreDeLargo(60, `Mod${String(i + 1).padStart(2, '0')}x${marca}`),
  );
  const grupo = await crearEnCarta(ctx, esc.token.adminA, '/carta/grupos-modificadores', {
    nombre: nombreUnico('Extras largos'),
    seleccion: 'MULTIPLE',
    minimo: 0,
    maximo: 30,
    modificadores: nombres.map((nombre) => ({ nombre })),
  });
  const creados = grupo.modificadores ?? [];
  expect(creados).toHaveLength(30);
  return { grupoId: grupo.id, modificadores: creados.map((m) => ({ id: m.id, nombre: m.nombre })) };
}

interface SimpleDe30 extends GrupoDe30 {
  productoId: string;
  nombre: string;
}

/** Un producto SIMPLE de Cocina con nombre de 100 caracteres y el grupo de 30 modificadores. */
const simpleDe30 = memorizar(async (): Promise<SimpleDe30> => {
  const grupo = await grupoDe30();
  const nombre = nombreDeLargo(100, `Plato100x${marcaUnica()}`);
  const producto = await crearEnCarta(
    ctx,
    esc.token.adminA,
    '/carta/productos',
    simpleNuevo(esc.carta, {
      nombre,
      precio: '10.00',
      estacionId: esc.carta.cocinaId,
      tipoControlStock: 'SIN_CONTROL',
      gruposModificadores: [grupo.grupoId],
    }),
  );
  return { ...grupo, productoId: producto.id, nombre };
});

/** Un combo de 20 componentes con el grupo de 30 modificadores sin producto ligado. */
const comboDe20Con30 = memorizar(async () => {
  const componentes = await componentesDe20();
  const grupo = await grupoDe30();
  const combo = await crearEnCarta(ctx, esc.token.adminA, '/carta/productos', {
    tipo: 'COMBO',
    nombre: nombreUnico('Combo con opciones sin fin'),
    familiaId: esc.carta.familiaId,
    precio: '150.00',
    tipoControlStock: 'SIN_CONTROL',
    componentes: componentes.map((c) => ({ productoId: c.id, cantidad: 1 })),
    gruposModificadores: [grupo.grupoId],
  });
  return { productoId: combo.id, componentes: componentes.map((c) => c.nombre), ...grupo };
});

// ===================================================================================================
// F1 · Comandas y pre-cuentas grandes, dentro de los límites de entrada, se imprimen completas
// ===================================================================================================

describe('F1 · el máximo de bloques del documento es 3000', () => {
  it('MAXIMO_BLOQUES_TICKET vale 3000 y documentoTicket acepta 3000 bloques y rechaza 3001', () => {
    expect(MAXIMO_BLOQUES_TICKET).toBe(3000);
    const documento = (n: number) => ({
      version: 1,
      tipo: 'COMANDA',
      bloques: Array.from({ length: n }, () => ({ tipo: 'espacio' })),
    });
    expect(documentoTicketSchema.safeParse(documento(3000)).success).toBe(true);
    expect(documentoTicketSchema.safeParse(documento(3001)).success).toBe(false);
  });
});

describe('F1 · una comanda grande dentro de los límites de entrada sale completa', () => {
  it('combo de 20 componentes con nombres de 60 caracteres en 50 líneas: los 20 componentes de las 50 líneas, sin "Ticket incompleto"', async () => {
    const s = await S.s1();
    const combo = await comboDe20();
    const lineas: LineaCuerpo[] = Array.from({ length: 50 }, (_v, i) => ({
      productoId: combo.productoId,
      modificadorIds: [],
      cantidad: i + 1,
    }));
    const o = await abrir(s);
    const r = await enviarOk(ctx, s.tokenMozo, o.id, lineas);
    const trabajo = await trabajoDeCocina(r.comandas);

    const verificar = (texto: string) => {
      exigirSinAviso(texto);
      const plano = compacto(texto);
      for (const nombre of combo.componentes) {
        expect(
          contar(plano, compacto(nombre)),
          `el ticket lleva el componente "${nombre}" una vez por cada una de las 50 líneas`,
        ).toBe(50);
      }
    };

    verificar((await entregado(s, trabajo.id)).texto);
    exigirCompleto(await resumenDe(s, trabajo.id));
    const [impreso] = await imprimir(s, 1);
    verificar(impreso!.texto);
  });

  it('producto SIMPLE de nombre 100 con 30 modificadores de 60 y observación de 140, en 50 líneas: ticket completo', async () => {
    const s = await S.s1();
    const p = await simpleDe30();
    const lineas: LineaCuerpo[] = Array.from({ length: 50 }, (_v, i) => ({
      productoId: p.productoId,
      modificadorIds: p.modificadores.map((m) => m.id),
      cantidad: i + 1,
      observacion: OBSERVACION,
    }));
    const o = await abrir(s);
    const r = await enviarOk(ctx, s.tokenMozo, o.id, lineas);
    const trabajo = await trabajoDeCocina(r.comandas);

    const verificar = (texto: string) => {
      exigirSinAviso(texto);
      const plano = compacto(texto);
      expect(contar(plano, compacto(p.nombre)), 'el nombre de 100 caracteres, 50 veces').toBe(50);
      for (const m of p.modificadores) {
        expect(
          contar(plano, compacto(m.nombre)),
          `el modificador "${m.nombre}" una vez por cada una de las 50 líneas`,
        ).toBe(50);
      }
      expect(contar(plano, compacto(OBSERVACION)), 'la observación de 140, 50 veces').toBe(50);
    };

    verificar((await entregado(s, trabajo.id)).texto);
    exigirCompleto(await resumenDe(s, trabajo.id));
  });
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

describe('F1 · una pre-cuenta grande dentro de los límites de entrada sale completa', () => {
  it('pre-cuenta de 600 ítems (12 envíos de 50) con nombres de 100 caracteres: ticket completo, con el total', async () => {
    const s = await conCaja();
    const marca = marcaUnica();
    const nombres: string[] = [];
    const productos: string[] = [];
    const crear = async (i: number) => {
      const nombre = nombreDeLargo(100, `Item${String(i).padStart(3, '0')}x${marca}`);
      const creado = await crearEnCarta(
        ctx,
        esc.token.adminA,
        '/carta/productos',
        simpleNuevo(esc.carta, {
          nombre,
          precio: '10.00',
          estacionId: null,
          tipoControlStock: 'SIN_CONTROL',
        }),
      );
      nombres[i] = nombre;
      productos[i] = creado.id;
    };
    for (let desde = 0; desde < 600; desde += 5) {
      await Promise.all(Array.from({ length: 5 }, (_v, k) => crear(desde + k)));
    }
    const o = await abrir(s);
    for (let envioNumero = 0; envioNumero < 12; envioNumero++) {
      const lineas: LineaCuerpo[] = Array.from({ length: 50 }, (_v, k) => ({
        productoId: productos[envioNumero * 50 + k]!,
        modificadorIds: [],
        cantidad: 1,
      }));
      await enviarOk(ctx, s.tokenMozo, o.id, lineas);
    }

    const res = await pedirPrecuenta(ctx, s.tokenMozo, o.id);
    exigirEstado(res, 201, 'pedir la pre-cuenta de 600 ítems');
    expect(res.body.impresion).toBe('EN_COLA');
    const trabajoId = res.body.trabajoId as string;
    const total = res.body.total as string;
    expect(total).toBe('6000.00');

    const verificar = (texto: string) => {
      exigirSinAviso(texto);
      const plano = compacto(texto);
      expect(texto).toMatch(/PRE-CUENTA/);
      // El monto de la línea va a la derecha de su primera fila y puede quedar en medio de un nombre que se parte
      // en varias: para contar los nombres se quitan los montos (los nombres no llevan puntos).
      const sinMontos = compacto(texto.replace(/\d[\d,]*\.\d\d/g, ''));
      for (const nombre of nombres) {
        expect(contar(sinMontos, compacto(nombre)), `la pre-cuenta lleva "${nombre}"`).toBe(1);
      }
      const conMiles = total.replace(/\B(?=(\d{3})+(?!\d))/, ',');
      expect(
        plano.includes(`TOTALS/${total}`) || plano.includes(`TOTALS/${conMiles}`),
        `el ticket lleva "TOTAL S/ ${total}"`,
      ).toBe(true);
    };

    verificar((await entregado(s, trabajoId)).texto);
    exigirCompleto(await resumenDe(s, trabajoId));
    const impresos = await imprimir(s, 1);
    verificar(impresos.find((t) => /PRE-CUENTA/.test(t.texto))!.texto);
  });
});

describe('F1 · un ticket que aun así no cabe sale con un aviso claro y el trabajo queda marcado', () => {
  it('50 líneas de un combo de 20 componentes con 30 modificadores sin ligar de 60: aviso "Revisa la cuenta en la app" (sin KDS) y el trabajo incompleto en la lista', async () => {
    const s = await S.s1();
    const combo = await comboDe20Con30();
    const lineas: LineaCuerpo[] = Array.from({ length: 50 }, (_v, i) => ({
      productoId: combo.productoId,
      modificadorIds: combo.modificadores.map((m) => m.id),
      cantidad: i + 1,
      observacion: OBSERVACION,
    }));
    const o = await abrir(s);
    // El envío no se rechaza por el tamaño del ticket (criterio 126).
    const r = await enviarOk(ctx, s.tokenMozo, o.id, lineas);
    const trabajo = await trabajoDeCocina(r.comandas);

    const verificar = (texto: string) => {
      const plano = compacto(texto);
      const aviso = AVISO_COMPACTO.exec(plano);
      expect(
        aviso,
        'el ticket dice "Ticket incompleto: faltan N líneas. Revisa la cuenta en la app."',
      ).not.toBeNull();
      expect(Number(aviso![1]), 'faltan N líneas, con N positivo').toBeGreaterThan(0);
      expect(texto, 'el aviso no remite al KDS').not.toMatch(/KDS/i);
      expect(texto, 'el aviso no remite a la pantalla').not.toMatch(/pantalla/i);
      expect(texto, 'el ticket sigue siendo una comanda de Cocina').toMatch(/COCINA/);
    };

    // Se entrega (no queda como un trabajo sin ticket) y se imprime con su corte.
    verificar((await entregado(s, trabajo.id)).texto);
    const antes = await resumenDe(s, trabajo.id);
    expect(antes[CAMPO_INCOMPLETO], 'el trabajo se ve incompleto en GET /impresion/trabajos').toBe(
      true,
    );
    expect(antes.sinTicket === true, 'el ticket sí se pudo armar').toBe(false);

    const [impreso] = await imprimir(s, 1);
    verificar(impreso!.texto);
    const despues = await resumenDe(s, trabajo.id);
    expect(despues.estado).toBe('IMPRESO');
    expect(despues[CAMPO_INCOMPLETO], 'sigue marcado como incompleto una vez impreso').toBe(true);
  });
});

// ===================================================================================================
// F2 · La marca de retraso no se falsifica
// ===================================================================================================

const NOMBRE_ENGANOSO = 'Impreso con retraso de horno';
const MARCA_DE_RETRASO = /Impreso con retraso · enviado a las \d\d:\d\d/;

/** Un producto de Cocina y su modificador llevan el nombre de la marca de retraso. */
const platoEnganoso = memorizar(async () => {
  const grupo = await crearEnCarta(ctx, esc.token.adminA, '/carta/grupos-modificadores', {
    nombre: nombreUnico('Cocción'),
    seleccion: 'MULTIPLE',
    minimo: 0,
    maximo: 1,
    modificadores: [{ nombre: NOMBRE_ENGANOSO }],
  });
  const producto = await crearEnCarta(
    ctx,
    esc.token.adminA,
    '/carta/productos',
    simpleNuevo(esc.carta, {
      nombre: NOMBRE_ENGANOSO,
      precio: '10.00',
      estacionId: esc.carta.cocinaId,
      tipoControlStock: 'SIN_CONTROL',
      gruposModificadores: [grupo.id],
    }),
  );
  return { productoId: producto.id, modificadorId: grupo.modificadores![0]!.id };
});

/** Las líneas del ticket (sin marcas) donde aparece `patron`. */
const indicesDe = (ticket: TicketEmulado, patron: RegExp): number[] =>
  ticket.lineas.flatMap((l, i) => (patron.test(l.texto) ? [i] : []));

/** La marca de retraso está, una sola vez, y arriba: antes de cualquier línea con el nombre engañoso. */
function exigirMarcaDeRetraso(ticket: TicketEmulado): void {
  expect(ticket.texto).toMatch(MARCA_DE_RETRASO);
  const marcas = indicesDe(ticket, /Impreso con retraso · enviado a las/);
  expect(marcas, 'la marca de retraso sale una sola vez').toHaveLength(1);
  const engañosas = indicesDe(ticket, /de horno/);
  expect(engañosas.length, 'el ticket lleva el nombre engañoso').toBeGreaterThan(0);
  expect(marcas[0]!, 'la marca de retraso va arriba').toBeLessThan(engañosas[0]!);
}

/** Sin retraso el ticket no lleva la marca aunque lleve el nombre engañoso. */
function exigirSinMarcaDeRetraso(ticket: TicketEmulado): void {
  expect(ticket.texto, 'el nombre engañoso sí sale en el ticket').toMatch(/de horno/);
  expect(ticket.texto).not.toMatch(/enviado a las/);
  expect(ticket.texto).not.toMatch(MARCA_DE_RETRASO);
}

describe('F2 · un producto o un modificador "Impreso con retraso de horno" no falsifica la marca', () => {
  const lineaEnganosa = async (): Promise<LineaCuerpo> => {
    const p = await platoEnganoso();
    return { productoId: p.productoId, modificadorIds: [p.modificadorId], cantidad: 1 };
  };

  it('comanda entregada a tiempo: el ticket lleva el nombre pero no la marca', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const r = await enviarOk(ctx, s.tokenMozo, o.id, [await lineaEnganosa()]);
    const trabajo = await trabajoDeCocina(r.comandas);
    exigirSinMarcaDeRetraso(await entregado(s, trabajo.id));
  });

  it('comanda entregada más de 2 minutos después: el ticket lleva la marca arriba, una sola vez', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const r = await enviarOk(ctx, s.tokenMozo, o.id, [await lineaEnganosa()]);
    const trabajo = await trabajoDeCocina(r.comandas);
    ctx.reloj.avanzar(CON_RETRASO_MS);
    exigirMarcaDeRetraso(await entregado(s, trabajo.id));
  });

  it('pre-cuenta entregada a tiempo: el ticket lleva el nombre pero no la marca', async () => {
    const s = await conCaja();
    const o = await abrir(s);
    await enviarOk(ctx, s.tokenMozo, o.id, [await lineaEnganosa()]);
    const res = await pedirPrecuenta(ctx, s.tokenMozo, o.id);
    exigirEstado(res, 201, 'pedir la pre-cuenta');
    expect(res.body.impresion).toBe('EN_COLA');
    const ticket = await entregado(s, res.body.trabajoId as string);
    expect(ticket.texto).toMatch(/PRE-CUENTA/);
    exigirSinMarcaDeRetraso(ticket);
  });

  it('pre-cuenta entregada más de 2 minutos después: el ticket lleva la marca arriba, una sola vez', async () => {
    const s = await conCaja();
    const o = await abrir(s);
    await enviarOk(ctx, s.tokenMozo, o.id, [await lineaEnganosa()]);
    const res = await pedirPrecuenta(ctx, s.tokenMozo, o.id);
    exigirEstado(res, 201, 'pedir la pre-cuenta');
    expect(res.body.impresion).toBe('EN_COLA');
    ctx.reloj.avanzar(CON_RETRASO_MS);
    const ticket = await entregado(s, res.body.trabajoId as string);
    expect(ticket.texto).toMatch(/PRE-CUENTA/);
    exigirMarcaDeRetraso(ticket);
  });
});

// ===================================================================================================
// F3 · `ordenId` en GET /impresion/trabajos
// ===================================================================================================

describe('F3 · ?ordenId= con órdenes unidas', () => {
  it('al unir O2 a O1: ?ordenId=O2 queda vacío, ?ordenId=O1 trae los dos trabajos y todos dicen ordenId = O1', async () => {
    const s = await S.s1();
    const plato = await crearEnCarta(
      ctx,
      esc.token.adminA,
      '/carta/productos',
      simpleNuevo(esc.carta, {
        nombre: nombreUnico('Plato de unión'),
        precio: '10.00',
        estacionId: esc.carta.cocinaId,
        tipoControlStock: 'SIN_CONTROL',
      }),
    );
    const linea = (cantidad: number): LineaCuerpo => ({
      productoId: plato.id,
      modificadorIds: [],
      cantidad,
    });
    const o1 = await abrir(s);
    const o2 = await abrir(s);
    const r1 = await enviarOk(ctx, s.tokenMozo, o1.id, [linea(1)]);
    ctx.reloj.avanzar(20);
    const r2 = await enviarOk(ctx, s.tokenMozo, o2.id, [linea(2)]);
    const t1 = await trabajoDeCocina(r1.comandas);
    const t2 = await trabajoDeCocina(r2.comandas);

    // Antes de unir, cada cuenta ve solo su ticket.
    expect((await listarTrabajos(s.tokenMozo, `?ordenId=${o1.id}`)).map((t) => t.id)).toEqual([
      t1.id,
    ]);
    expect((await listarTrabajos(s.tokenMozo, `?ordenId=${o2.id}`)).map((t) => t.id)).toEqual([
      t2.id,
    ]);

    await unirMesasOk(ctx, s.tokenSupervisor, o1.id, [o2.mesaId]);

    const deO2 = await listarTrabajos(s.tokenMozo, `?ordenId=${o2.id}`);
    expect(deO2, 'O2 ya no tiene trabajos propios').toEqual([]);

    const deO1 = await listarTrabajos(s.tokenMozo, `?ordenId=${o1.id}`);
    expect(deO1.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    expect(deO1.map((t) => t.ordenId)).toEqual([o1.id, o1.id]);

    // Sin filtro, los dos trabajos también dicen que son de O1.
    const todos = await listarTrabajos(s.tokenMozo);
    for (const id of [t1.id, t2.id]) {
      expect(todos.find((t) => t.id === id)?.ordenId, `el trabajo ${id} dice ordenId = O1`).toBe(
        o1.id,
      );
    }
  });
});

// ===================================================================================================
// F4 · Reimpresión a una impresora que pasó a ser Bluetooth
// ===================================================================================================

describe('F4 · la reimpresión no va a una impresora Bluetooth (decisión 12)', () => {
  it('con la impresora original activa pero ahora Bluetooth: 409 SIN_IMPRESORA y no se crea el trabajo', async () => {
    const s = await S.s1();
    const estacion = await crearEnCarta(ctx, esc.token.adminA, '/carta/estaciones', {
      nombre: nombreUnico('Parrilla'),
    });
    const impresora = await crearImpresora(
      ctx,
      cierres,
      s.tokenAdmin,
      s.id,
      nombreUnico('Parrilla').slice(0, 40),
    );
    await fijarDestino(ctx, s.tokenAdmin, s.id, estacion.id, {
      destino: 'IMPRESORA',
      impresoraId: impresora.id,
    });
    const producto = await crearEnCarta(
      ctx,
      esc.token.adminA,
      '/carta/productos',
      simpleNuevo(esc.carta, {
        nombre: nombreUnico('Parrillada'),
        precio: '10.00',
        estacionId: estacion.id,
        tipoControlStock: 'SIN_CONTROL',
      }),
    );
    const o = await abrir(s);
    const r = await enviarOk(ctx, s.tokenMozo, o.id, [
      { productoId: producto.id, modificadorIds: [], cantidad: 1 },
    ]);
    const comanda = solo(r.comandas);
    const original = solo(await trabajosDeComandas(admin, [comanda.id]));
    expect(original.impresora_id).toBe(impresora.id);

    // Sanidad: mientras es de red, se puede reimprimir.
    const previa = await pedirReimpresion(s, original.id);
    exigirEstado(previa, 201, 'reimprimir en una impresora de red');
    const previoId = trabajoCreadoRespuestaSchema.parse(previa.body).trabajoId;
    expect(previoId).not.toBe(original.id);

    // La impresora sigue activa pero ahora es Bluetooth.
    const cambio = await llamar(ctx, s.tokenAdmin, {
      metodo: 'patch',
      ruta: `/sucursales/${s.id}/impresoras/${impresora.id}`,
      cuerpo: { conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF' } },
    });
    exigirEstado(cambio, 200, 'pasar la impresora a Bluetooth');
    expect(cambio.body.activa).toBe(true);
    expect(cambio.body.conexion.tipo).toBe('BLUETOOTH');

    const antes = await contarTrabajos(admin, s.id);
    const res = await pedirReimpresion(s, original.id);
    exigirEstado(res, 409, 'reimprimir en una impresora Bluetooth');
    expect(res.body.codigo).toBe('SIN_IMPRESORA');
    expect(await contarTrabajos(admin, s.id), 'no se crea ningún trabajo').toBe(antes);
  });
});

// ===================================================================================================
// F5 · Tamaño de la entrega
// ===================================================================================================

const IMPRESORAS = 5;
const TICKETS_POR_IMPRESORA = 20;
const LINEAS_POR_TICKET = 25;

describe('F5 · GET /puente/trabajos no pasa de un tope de bytes y entrega al menos un trabajo por impresora', () => {
  it('5 impresoras con 20 tickets grandes cada una: la respuesta pesa menos de 2 MB, cada impresora recibe uno y todo se imprime en llamadas sucesivas, en orden', async () => {
    const s = await S.s3();
    const p = await simpleDe30();
    const estaciones: string[] = [];
    const impresoras: ImpresoraDePrueba[] = [];
    for (let i = 0; i < IMPRESORAS; i++) {
      const estacion = await crearEnCarta(ctx, esc.token.adminA, '/carta/estaciones', {
        nombre: nombreUnico('Estación grande'),
      });
      const impresora = await crearImpresora(
        ctx,
        cierres,
        s.tokenAdmin,
        s.id,
        `Grande ${i + 1} ${marcaUnica()}`,
      );
      await fijarDestino(ctx, s.tokenAdmin, s.id, estacion.id, {
        destino: 'IMPRESORA',
        impresoraId: impresora.id,
      });
      estaciones.push(estacion.id);
      impresoras.push(impresora);
    }
    // Un producto por estación, con los 30 modificadores de 60 caracteres.
    const productos: string[] = [];
    for (let i = 0; i < IMPRESORAS; i++) {
      const producto = await crearEnCarta(
        ctx,
        esc.token.adminA,
        '/carta/productos',
        simpleNuevo(esc.carta, {
          nombre: nombreDeLargo(100, `Grande${i + 1}x${marcaUnica()}`),
          precio: '10.00',
          estacionId: estaciones[i],
          tipoControlStock: 'SIN_CONTROL',
          gruposModificadores: [p.grupoId],
        }),
      );
      productos.push(producto.id);
    }

    // 20 envíos por impresora, cada uno con 25 líneas de 30 modificadores y su marca "T<impresora>-<n>".
    const creados: string[][] = impresoras.map(() => []);
    for (let i = 0; i < IMPRESORAS; i++) {
      const o = await abrir(s);
      for (let n = 1; n <= TICKETS_POR_IMPRESORA; n++) {
        const lineas: LineaCuerpo[] = Array.from({ length: LINEAS_POR_TICKET }, () => ({
          productoId: productos[i]!,
          modificadorIds: p.modificadores.map((m) => m.id),
          cantidad: 1,
          observacion: `T${i + 1}-${String(n).padStart(2, '0')}`,
        }));
        const r = await enviarOk(ctx, s.tokenMozo, o.id, lineas);
        const comanda = solo(r.comandas);
        const trabajo = solo(await trabajosDeComandas(admin, [comanda.id]));
        expect(trabajo.impresora_id).toBe(impresoras[i]!.id);
        creados[i]!.push(trabajo.id);
        // Instantes distintos: el orden de creación dentro de cada impresora queda fijo.
        ctx.reloj.avanzar(20);
      }
    }
    const idsCreados = new Set(creados.flat());
    expect(idsCreados.size).toBe(IMPRESORAS * TICKETS_POR_IMPRESORA);

    // Una entrega: menos de 2 MB, al menos un trabajo por impresora, y en el orden de creación de cada una.
    const res = await llamarPuente(ctx, s.puente!.token!, 'get', '/puente/trabajos');
    exigirEstado(res, 200, 'GET /puente/trabajos con 100 tickets grandes');
    const bytes = Buffer.byteLength(res.text, 'utf8');
    expect(bytes, `la respuesta pesa ${bytes} bytes`).toBeLessThan(DOS_MB);
    const entrega = z.array(trabajoParaImprimirSchema).parse(res.body);
    for (let i = 0; i < IMPRESORAS; i++) {
      const propios = entrega.filter((t) => t.impresoraId === impresoras[i]!.id).map((t) => t.id);
      expect(propios.length, `la impresora ${i + 1} recibe al menos un trabajo`).toBeGreaterThan(0);
      expect(propios, `la impresora ${i + 1}: los primeros, en orden`).toEqual(
        creados[i]!.slice(0, propios.length),
      );
    }
    // La entrega no alcanza para todo: el tope de bytes recorta (100 tickets grandes pesan mucho más de 2 MB).
    expect(entrega.length).toBeLessThan(IMPRESORAS * TICKETS_POR_IMPRESORA);

    // Llamadas sucesivas con el simulador: cada una pesa menos de 2 MB y al final todo está impreso.
    const tamanos: number[] = [];
    const fetchMedido: typeof fetch = async (entrada, init) => {
      const respuesta = await fetch(entrada, init);
      const url =
        typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if ((init?.method ?? 'GET') === 'GET' && url.endsWith('/puente/trabajos')) {
        tamanos.push((await respuesta.clone().arrayBuffer()).byteLength);
      }
      return respuesta;
    };
    const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!, { fetch: fetchMedido });
    await simulador.iniciar();
    try {
      const total = IMPRESORAS * TICKETS_POR_IMPRESORA;
      for (let vuelta = 0; vuelta < 200 && simulador.impresos.length < total; vuelta++) {
        await simulador.pedirTrabajosAhora();
      }
      await simulador.esperarImpresos(total, 30_000);
    } finally {
      await simulador.detener();
    }
    expect(tamanos.length, 'el simulador necesitó varias llamadas').toBeGreaterThan(1);
    for (const t of tamanos) expect(t).toBeLessThan(DOS_MB);

    for (let i = 0; i < IMPRESORAS; i++) {
      const tickets = await impresoras[i]!.emulador.esperarTickets(TICKETS_POR_IMPRESORA, 60_000);
      expect(
        tickets,
        `la impresora ${i + 1} imprime exactamente ${TICKETS_POR_IMPRESORA} tickets`,
      ).toHaveLength(TICKETS_POR_IMPRESORA);
      const marcas = tickets.map((t) => /T(\d)-(\d\d)/.exec(t.texto)?.[0]);
      expect(marcas, `la impresora ${i + 1} imprime en el orden de creación`).toEqual(
        Array.from(
          { length: TICKETS_POR_IMPRESORA },
          (_v, n) => `T${i + 1}-${String(n + 1).padStart(2, '0')}`,
        ),
      );
      for (const t of tickets) {
        expect(t.completo).toBe(true);
        expect(t.comandosDesconocidos).toEqual([]);
      }
    }
    const pendientes = (await trabajosDeSucursal(admin, s.id)).filter(
      (t) => idsCreados.has(t.id) && t.estado !== 'IMPRESO',
    );
    expect(pendientes, 'todos los trabajos quedan IMPRESO').toEqual([]);
  });
});
