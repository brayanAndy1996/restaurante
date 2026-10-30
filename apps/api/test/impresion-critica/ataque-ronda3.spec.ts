// spec: 004-salon-cocina (pruebas protegidas)
//
// Ataque adversarial, ronda 3, a la entrega 3b (impresión). Una sola falla, F1: caracteres que CRECEN al pasarlos a
// la página de códigos de la impresora. Por ejemplo "ﷺ" (U+FDFA) vale 1 para `textoSchema` y su descomposición NFKD
// tiene 18 caracteres. Con nombres, modificadores y observaciones llenos de "ﷺ", dentro de los límites de entrada,
// un ticket pesaba entre 2 y 9 MB; el tope de `GET /puente/trabajos` (criterio 113) no lo limitaba (50 reimpresiones
// daban una respuesta de 513 MB que bloqueaba el proceso); `trabajoParaImprimirSchema.parse` reventaba con
// `RangeError: Maximum call stack size exceeded` (la regex de `base64Schema`) y el simulador dejaba de imprimir en
// toda la sucursal.
//
// Reglas que fijó el orquestador (criterios 113, 123 y 126):
// 1. Sustitución acotada: un carácter que no está en la página de códigos se cambia por, como mucho, dos o tres
//    caracteres; si su descomposición es más larga, sale como `?`. "ñ", las tildes y "×" siguen como hoy.
// 2. Tope de bytes por ticket: ningún ticket renderizado pasa de un máximo fijo de bytes ESC/POS (del orden de
//    256 KB, una constante de `packages/contratos`). Si un ticket lo pasaría, sale cortado con el aviso "Ticket
//    incompleto: faltan N líneas. Revisa la cuenta en la app." y el trabajo queda `incompleto: true`.
// 3. Respuesta acotada: `GET /puente/trabajos` nunca pasa de `MAXIMO_BYTES_RESPUESTA_TRABAJOS` más un ticket, aunque
//    haya muchas reimpresiones de tickets grandes.
// 4. El contrato valida sin reventar: `trabajoParaImprimirSchema` y `base64Schema` validan sin `RangeError` un
//    trabajo del tamaño máximo y también uno más grande (a este último lo rechazan con un error de validación normal).
//
// Interpretaciones (ver el informe de entrega):
// - La constante del tope de bytes de un ticket se busca en `@restaurante/contratos` (un número exportado cuyo nombre
//   empieza por `MAXIMO_BYTES_` y no es el de la respuesta; hoy es `MAXIMO_BYTES_TICKET`). Si no existe, se usa 262144 (256 KB).
// - Los bytes de una respuesta de `GET /puente/trabajos` se cuentan decodificados (como `MAXIMO_BYTES_RESPUESTA_
//   TRABAJOS`); el texto crudo (base64) se acota con ese mismo presupuesto por 4/3 más un margen de JSON.
// - "Ticket completo" y el campo `incompleto` se leen igual que en la ronda 2: el cuerpo crudo de
//   `GET /impresion/trabajos`; el campo es `false` o no viene en un ticket completo.
// - "Todo termina saliendo, o queda marcado": cada trabajo termina `IMPRESO`; si alguno no lo hizo, tiene que estar
//   marcado como `sinTicket` (error de armado, criterio 126) en `GET /impresion/trabajos`.
// - Un ticket de este caso cabe o no cabe según cómo recorte el backend; la prueba acepta las dos salidas siempre que
//   sean coherentes: sin aviso, el ticket lleva todo y el trabajo no es `incompleto`; con aviso (N > 0, sin remitir
//   al KDS), el trabajo es `incompleto: true`.
import { randomUUID } from 'node:crypto';
import * as contratos from '@restaurante/contratos';
import {
  JUEGOS_CARACTERES,
  MAXIMO_BYTES_RESPUESTA_TRABAJOS,
  trabajoCreadoRespuestaSchema,
  trabajoParaImprimirSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { adaptarTexto } from '../../src/modulos/impresion/escpos';
import { INICIO_POR_DEFECTO } from '../acceso/fabrica-plataforma';
import { asentar, exigirEstado, llamar } from '../carta-critica/fabrica-permisos-carta';
import {
  abrirOrden,
  clave,
  comandaDe,
  crearEnCarta,
  enviarOk,
  nombreUnico,
  prepararEscenarioP2,
  simpleNuevo,
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
  type AppP5,
  type ImpresoraDePrueba,
  type SucursalP5,
} from './fabrica-p5';
import { llamarPuente } from './fabrica-p6';

// Adaptar el texto: el escaneo de todos los puntos de código y las 50 reimpresiones son lentos con la API real.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

/** El nombre del campo que marca un trabajo cuyo ticket salió con el aviso "Ticket incompleto". */
const CAMPO_INCOMPLETO = 'incompleto';

/** El tope de bytes de un ticket: la constante de `packages/contratos` si existe; si no, 256 KB (ver la cabecera). */
const TOPE_POR_OMISION = 262_144;
const CONSTANTE_DEL_TOPE = Object.entries(contratos).find(
  ([nombre, valor]) =>
    nombre.startsWith('MAXIMO_BYTES_') &&
    nombre !== 'MAXIMO_BYTES_RESPUESTA_TRABAJOS' &&
    typeof valor === 'number',
);
const TOPE_BYTES_TICKET: number =
  (CONSTANTE_DEL_TOPE?.[1] as number | undefined) ?? TOPE_POR_OMISION;

/** "ﷺ" (U+FDFA): 1 carácter para `textoSchema`, 18 al descomponerlo con NFKD. */
const SALAT = 'ﷺ';
const ADAPTADO = '?';

/** Un texto de exactamente `largo` caracteres: `prefijo` (ASCII, para distinguirlo) y el resto "ﷺ". */
function conSalat(prefijo: string, largo: number): string {
  const texto = prefijo + SALAT.repeat(largo - prefijo.length);
  expect(texto).toHaveLength(largo);
  return texto;
}

/** Cómo debe verse el texto en la impresora: cada "ﷺ" sale como "?". */
const comoSale = (texto: string): string => texto.replaceAll(SALAT, ADAPTADO);

let ctx: AppP5;
let admin: Client;
let esc: EscenarioP2;
const cierres = new Cierres();
const preparadas: SucursalConBarra[] = [];

const A = () => esc.e.A;

interface SucursalConBarra extends SucursalP5 {
  /** Otra impresora de red, solo para la estación Barra. */
  barra: ImpresoraDePrueba;
}

/** S1 de A: Cocina a una impresora, Barra a OTRA impresora, puente vinculado (el simulador lo inicia cada prueba). */
const sucursal = memorizar(async (): Promise<SucursalConBarra> => {
  const s = await prepararSucursalP5(ctx, cierres, {
    etiqueta: 'R3',
    sucursalId: A().S1,
    carta: esc.carta,
    salon: esc.salon,
    tokenAdmin: esc.token.adminA,
    tokenMozo: esc.token.mozo,
    tokenSupervisor: esc.token.supervisor,
    tokenCocina: esc.token.cocina,
    barraAlKdsExplicito: false,
    conPuente: true,
    conSocket: false,
  });
  const barra = await crearImpresora(ctx, cierres, s.tokenAdmin, s.id, `Barra R3 ${marcaUnica()}`);
  await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
    destino: 'IMPRESORA',
    impresoraId: barra.id,
  });
  const completa = { ...s, barra };
  preparadas.push(completa);
  return completa;
});

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
  for (const s of preparadas) {
    s.cocina.emulador.limpiar();
    s.barra.emulador.limpiar();
  }
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

const marcaUnica = (): string => randomUUID().replace(/-/g, '').slice(0, 8);

/** Texto sin espacios ni saltos de línea: para comprobar que algo está aunque el ticket lo parta en líneas. */
const compacto = (texto: string): string => texto.replace(/\s+/g, '');

/** Cuántas veces aparece `aguja` en `pajar` (sin solaparse). */
const contar = (pajar: string, aguja: string): number =>
  aguja.length === 0 ? 0 : pajar.split(aguja).length - 1;

const solo = <T>(valores: readonly T[]): T => {
  expect(valores).toHaveLength(1);
  return valores[0]!;
};

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

interface TrabajoCrudo {
  id: string;
  impresoraId: string;
  bytes: string;
}

/** Los bytes ESC/POS que lleva un texto base64 (sin decodificarlo). */
const bytesDe = (base64: string): number => {
  const relleno = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - relleno;
};

/** `GET /puente/trabajos` con la credencial del puente: exige 200 y devuelve el cuerpo sin pasarlo por zod. */
async function pedirTrabajosCrudo(s: SucursalP5) {
  const res = await llamarPuente(ctx, s.puente!.token!, 'get', '/puente/trabajos');
  exigirEstado(res, 200, 'GET /puente/trabajos');
  const lista = res.body as TrabajoCrudo[];
  expect(Array.isArray(lista)).toBe(true);
  return {
    lista,
    bytesDelTexto: Buffer.byteLength(res.text, 'utf8'),
    bytesEscPos: lista.reduce((suma, t) => suma + bytesDe(t.bytes), 0),
  };
}

/** Lo que el simulador hace con cada trabajo: validarlo con el contrato del protocolo. No puede lanzar nada. */
function validarConElContrato(lista: readonly TrabajoCrudo[]): void {
  for (const trabajo of lista) {
    let resultado;
    try {
      resultado = trabajoParaImprimirSchema.safeParse(trabajo);
    } catch (error) {
      throw new Error(
        `trabajoParaImprimirSchema lanzó ${(error as Error).name}: ${(error as Error).message} ` +
          `con un trabajo de ${bytesDe(trabajo.bytes)} bytes`,
      );
    }
    expect(resultado.success, `el trabajo ${trabajo.id} cumple el contrato del protocolo`).toBe(
      true,
    );
  }
}

/** Decodifica los bytes de un trabajo: un solo ticket, con su corte y sin un comando que la impresora no conozca. */
function decodificar(trabajo: Pick<TrabajoCrudo, 'bytes'>, columnas = 48): TicketEmulado {
  const { tickets, parcial } = interpretarEscPos(Buffer.from(trabajo.bytes, 'base64'), {
    columnas,
  });
  expect(parcial, 'el ticket entregado termina con su corte').toBeNull();
  const ticket = solo(tickets);
  expect(ticket.completo).toBe(true);
  expect(ticket.comandosDesconocidos).toEqual([]);
  return ticket;
}

/** `GET /impresion/trabajos` con una sesión de la sucursal (cuerpo crudo: incluye campos que el esquema no conozca). */
async function listarTrabajos(token: string): Promise<Array<Record<string, unknown>>> {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/impresion/trabajos' });
  exigirEstado(res, 200, 'GET /impresion/trabajos');
  expect(Array.isArray(res.body)).toBe(true);
  return res.body as Array<Record<string, unknown>>;
}

async function resumenDe(s: SucursalP5, trabajoId: string): Promise<Record<string, unknown>> {
  const lista = await listarTrabajos(s.tokenMozo);
  const resumen = lista.find((t) => t.id === trabajoId);
  expect(resumen, `GET /impresion/trabajos lista el trabajo ${trabajoId}`).toBeDefined();
  return resumen!;
}

/** El aviso del papel cuando a un ticket no le cupo todo (criterio 126), sin espacios ni saltos. */
const AVISO_COMPACTO = /Ticketincompleto:faltan(\d+)líneas\.Revisalacuentaenlaapp\./;

// ---------------------------------------------------------------------------------------------------
// La carta de la falla: todo lleno de "ﷺ", dentro de los límites de entrada
// ---------------------------------------------------------------------------------------------------

interface CartaSalat {
  productoId: string;
  /** Cada uno de los 20 componentes de Cocina (60 caracteres, con "ﷺ"). */
  componentes: string[];
  /** Id y nombre (60 caracteres, con "ﷺ") de cada uno de los 30 modificadores. */
  modificadores: { id: string; nombre: string }[];
}

/** 140 caracteres: el máximo de una observación (criterio 15), todos "ﷺ". */
const OBSERVACION = SALAT.repeat(140);

/** Un combo de 20 componentes de 60 con "ﷺ", con un grupo de 30 modificadores de 60 con "ﷺ". */
const comboSalat = memorizar(async (): Promise<CartaSalat> => {
  const marca = marcaUnica();
  const componentes: { id: string; nombre: string }[] = [];
  for (let i = 1; i <= 20; i++) {
    const nombre = conSalat(`Comp${String(i).padStart(2, '0')}x${marca}`, 60);
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
  const nombresDeModificadores = Array.from({ length: 30 }, (_v, i) =>
    conSalat(`Mod${String(i + 1).padStart(2, '0')}x${marca}`, 60),
  );
  const grupo = await crearEnCarta(ctx, esc.token.adminA, '/carta/grupos-modificadores', {
    nombre: nombreUnico('Extras sagrados'),
    seleccion: 'MULTIPLE',
    minimo: 0,
    maximo: 30,
    modificadores: nombresDeModificadores.map((nombre) => ({ nombre })),
  });
  const creados = grupo.modificadores ?? [];
  expect(creados).toHaveLength(30);
  const combo = await crearEnCarta(ctx, esc.token.adminA, '/carta/productos', {
    tipo: 'COMBO',
    nombre: conSalat(`Combo${marca}`, 100),
    familiaId: esc.carta.familiaId,
    precio: '150.00',
    tipoControlStock: 'SIN_CONTROL',
    componentes: componentes.map((c) => ({ productoId: c.id, cantidad: 1 })),
    gruposModificadores: [grupo.id],
  });
  return {
    productoId: combo.id,
    componentes: componentes.map((c) => c.nombre),
    modificadores: creados.map((m) => ({ id: m.id, nombre: m.nombre })),
  };
});

/** Una bebida normal de la estación Barra. */
const bebida = memorizar(async () => {
  const nombre = nombreUnico('Chicha morada');
  const creada = await crearEnCarta(
    ctx,
    esc.token.adminA,
    '/carta/productos',
    simpleNuevo(esc.carta, {
      nombre,
      precio: '6.00',
      estacionId: esc.carta.barraId,
      tipoControlStock: 'SIN_CONTROL',
    }),
  );
  return { productoId: creada.id, nombre };
});

/** Envía 50 líneas del combo (con los 30 modificadores y la observación) a una orden nueva y devuelve su trabajo. */
async function enviarGrande(s: SucursalP5) {
  const carta = await comboSalat();
  const lineas: LineaCuerpo[] = Array.from({ length: 50 }, (_v, i) => ({
    productoId: carta.productoId,
    modificadorIds: carta.modificadores.map((m) => m.id),
    cantidad: i + 1,
    observacion: OBSERVACION,
  }));
  const orden = await abrir(s);
  // El envío no se rechaza por el tamaño del ticket (criterio 126).
  const envio = await enviarOk(ctx, s.tokenMozo, orden.id, lineas);
  const comanda = comandaDe(envio.comandas, 'Cocina');
  const trabajo = solo(await trabajosDeComandas(admin, [comanda.id]));
  return { orden, trabajoId: trabajo.id, carta };
}

/** Envía una bebida de Barra a la orden dada y devuelve su trabajo. */
async function enviarBebida(s: SucursalConBarra, ordenId: string) {
  const b = await bebida();
  const envio = await enviarOk(ctx, s.tokenMozo, ordenId, [
    { productoId: b.productoId, modificadorIds: [], cantidad: 1 },
  ]);
  const comanda = comandaDe(envio.comandas, 'Barra');
  const trabajo = solo(await trabajosDeComandas(admin, [comanda.id]));
  expect(trabajo.impresora_id, 'la bebida va a la impresora de Barra').toBe(s.barra.id);
  return { trabajoId: trabajo.id, nombre: b.nombre };
}

/**
 * El ticket es coherente: o lleva todo (sin aviso) y el trabajo no es `incompleto`, o lleva el aviso del criterio 126
 * (N líneas, sin remitir al KDS) y el trabajo es `incompleto: true`.
 */
function exigirTicketCoherente(texto: string, carta: CartaSalat, resumen: Record<string, unknown>) {
  const plano = compacto(texto);
  const aviso = AVISO_COMPACTO.exec(plano);
  if (aviso !== null) {
    expect(Number(aviso[1]), 'faltan N líneas, con N positivo').toBeGreaterThan(0);
    expect(texto, 'el aviso no remite al KDS').not.toMatch(/KDS/i);
    expect(texto, 'el aviso no remite a la pantalla').not.toMatch(/pantalla/i);
    expect(resumen[CAMPO_INCOMPLETO], 'el trabajo con aviso queda incompleto: true').toBe(true);
  } else {
    expect(compacto(texto), 'sin aviso, el ticket no dice "Ticket incompleto"').not.toMatch(
      /Ticketincompleto/i,
    );
    expect(resumen[CAMPO_INCOMPLETO] === true, 'sin aviso, el trabajo no es incompleto').toBe(
      false,
    );
    for (const nombre of carta.componentes) {
      expect(contar(plano, compacto(comoSale(nombre))), `el componente ${nombre}, 50 veces`).toBe(
        50,
      );
    }
    for (const m of carta.modificadores) {
      expect(contar(plano, compacto(comoSale(m.nombre))), `el modificador ${m.nombre}`).toBe(50);
    }
    expect(contar(plano, comoSale(OBSERVACION)), 'la observación de 140, 50 veces').toBe(50);
  }
}

/** Inicia el simulador, espera los tickets de Cocina y de Barra y que reporte todo como impreso. */
async function imprimirTodo(
  s: SucursalConBarra,
  esperados: { cocina: number; barra: number },
): Promise<{ cocina: TicketEmulado[]; barra: TicketEmulado[] }> {
  const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!);
  await simulador.iniciar();
  try {
    const cocina = await s.cocina.emulador.esperarTickets(esperados.cocina, 60_000);
    const barra = await s.barra.emulador.esperarTickets(esperados.barra, 60_000);
    await simulador.esperarImpresos(esperados.cocina + esperados.barra, 15_000);
    for (const t of [...cocina, ...barra]) {
      expect(t.completo, 'el emulador recibe el ticket con su corte').toBe(true);
      expect(t.comandosDesconocidos, 'ningún comando que la impresora no conozca').toEqual([]);
    }
    return { cocina, barra };
  } finally {
    await simulador.detener();
  }
}

// ===================================================================================================
// F1 · Caracteres que crecen al pasarlos a la página de códigos
// ===================================================================================================

describe('F1 · adaptarTexto: la sustitución está acotada (regla 1)', () => {
  /** Los caracteres cuya descomposición NFKD pasa de 3 caracteres: los que "crecen" (incluye "ﷺ"). */
  const crecen: string[] = [];
  for (let codigo = 0; codigo <= 0x10ffff; codigo += 1) {
    if (codigo >= 0xd800 && codigo <= 0xdfff) continue;
    const caracter = String.fromCodePoint(codigo);
    if ([...caracter.normalize('NFKD')].length > 3) crecen.push(caracter);
  }

  it('"ﷺ" crece a 18 caracteres con NFKD y el escaneo encuentra muchos como él', () => {
    expect([...SALAT.normalize('NFKD')]).toHaveLength(18);
    expect(crecen).toContain(SALAT);
    expect(crecen.length).toBeGreaterThanOrEqual(20);
  });

  it('"ﷺ" sale como un solo "?" en todos los juegos de caracteres', () => {
    for (const juego of JUEGOS_CARACTERES) {
      expect(adaptarTexto(SALAT, juego), juego).toBe('?');
      expect(adaptarTexto(`a${SALAT}b`, juego), juego).toBe('a?b');
      expect(adaptarTexto(SALAT.repeat(140), juego), juego).toBe('?'.repeat(140));
      expect(adaptarTexto(SALAT.repeat(10_000), juego), juego).toHaveLength(10_000);
    }
  });

  it('ningún carácter que crece sale como más de 3 caracteres, en ningún juego', () => {
    for (const juego of JUEGOS_CARACTERES) {
      const demasiado = crecen
        .map((c) => ({ c, salida: adaptarTexto(c, juego) }))
        .filter(({ salida }) => [...salida].length > 3);
      expect(
        demasiado
          .slice(0, 5)
          .map(({ c, salida }) => `U+${c.codePointAt(0)!.toString(16)} → ${salida.length}`),
        `${juego}: caracteres que salen con más de 3 caracteres (${demasiado.length})`,
      ).toEqual([]);
    }
  });

  it('la "ñ", las tildes y la "×" siguen como hoy', () => {
    for (const juego of ['PC437', 'PC850', 'PC858', 'WPC1252'] as const) {
      expect(adaptarTexto('ñ Ñ ü ¿¡', juego), juego).toBe('ñ Ñ ü ¿¡');
      expect(adaptarTexto('áéíóú', juego), juego).toBe('áéíóú');
      expect(adaptarTexto('Ají de gallina', juego), juego).toBe('Ají de gallina');
    }
    // PC437 no tiene Á, Í, Ó, Ú ni ×; las demás páginas sí.
    expect(adaptarTexto('ÁÉÍÓÚ × ñ Ñ', 'PC437')).toBe('AÉIOU x ñ Ñ');
    for (const juego of ['PC850', 'PC858', 'WPC1252'] as const) {
      expect(adaptarTexto('ÁÉÍÓÚ ×', juego), juego).toBe('ÁÉÍÓÚ ×');
    }
    // SIN_TILDES todo en ASCII.
    expect(adaptarTexto('Ají ñ Ñ áéíóú 3 × 2', 'SIN_TILDES')).toBe('Aji n N aeiou 3 x 2');
  });

  it('un carácter que sí se descompone en pocos (la ligadura "ﬁ") se sigue sustituyendo', () => {
    expect(adaptarTexto('ﬁ', 'PC850')).toBe('fi');
    expect(adaptarTexto('ﬁ', 'SIN_TILDES')).toBe('fi');
  });

  it('lo demás sin equivalente sigue saliendo como "?"', () => {
    expect(adaptarTexto('日本', 'PC850')).toBe('??');
    expect(adaptarTexto('😀', 'PC850')).toBe('?');
  });
});

describe('F1 · el contrato valida sin reventar (regla 4)', () => {
  /** Un `base64Schema`: el exportado por `contratos` si lo hay, y si no, el del campo `bytes` del trabajo. */
  const base64Schema = ((contratos as Record<string, unknown>)['base64Schema'] ??
    trabajoParaImprimirSchema.shape.bytes) as ZodType;

  const validar = (esquema: ZodType, valor: unknown) => {
    try {
      return esquema.safeParse(valor);
    } catch (error) {
      throw new Error(`lanzó ${(error as Error).name}: ${(error as Error).message}`);
    }
  };

  const trabajoCon = (bytes: string) => ({
    id: randomUUID(),
    impresoraId: randomUUID(),
    tipo: 'COMANDA',
    creadoEn: new Date(INICIO_POR_DEFECTO).toISOString(),
    bytes,
  });

  /** `n` bytes distintos, codificados en base64 (lo que manda la API). */
  const base64De = (n: number): string => Buffer.alloc(n, 0x41).toString('base64');

  it('base64Schema con un texto de 5 MB no lanza RangeError (válido o no)', () => {
    const cincoMb = 5 * 1024 * 1024;
    const valido = 'A'.repeat(cincoMb);
    expect(valido.length % 4).toBe(0);
    expect(() => validar(base64Schema, valido)).not.toThrow();
    // Un texto grande que no es base64 se rechaza con un error de validación normal.
    const invalido = validar(base64Schema, `${'A'.repeat(cincoMb)}!!!`);
    expect(invalido.success).toBe(false);
  });

  it('un trabajo del tamaño máximo (el tope de bytes de un ticket) se valida sin RangeError y se acepta', () => {
    const resultado = validar(trabajoParaImprimirSchema, trabajoCon(base64De(TOPE_BYTES_TICKET)));
    expect(resultado.success, `un trabajo de ${TOPE_BYTES_TICKET} bytes se acepta`).toBe(true);
    expect(validar(base64Schema, base64De(TOPE_BYTES_TICKET)).success).toBe(true);
  });

  it('un trabajo más grande que el máximo (5 MB) se rechaza con un error de validación, no con una excepción', () => {
    const resultado = validar(trabajoParaImprimirSchema, trabajoCon(base64De(5 * 1024 * 1024)));
    expect(resultado.success, 'un trabajo de 5 MB se rechaza').toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues.length).toBeGreaterThan(0);
      expect(
        resultado.error.issues.some((i) => i.path.includes('bytes')),
        'el error señala el campo bytes',
      ).toBe(true);
    }
  });

  it('un trabajo apenas más grande que el máximo también se rechaza sin excepción', () => {
    const resultado = validar(
      trabajoParaImprimirSchema,
      trabajoCon(base64De(TOPE_BYTES_TICKET * 2)),
    );
    expect(resultado.success, 'un trabajo del doble del tope se rechaza').toBe(false);
  });
});

describe('F1 · un ticket lleno de "ﷺ" dentro de los límites de entrada (reglas 2 y 3)', () => {
  it('combo de 20 componentes de 60, 30 modificadores de 60 y 50 líneas con observación de 140: 201, el ticket baja del tope, es coherente y el simulador lo imprime', async () => {
    const s = await sucursal();
    const { trabajoId, carta } = await enviarGrande(s);

    const { lista, bytesEscPos, bytesDelTexto } = await pedirTrabajosCrudo(s);
    expect(
      bytesEscPos,
      `la respuesta trae ${bytesEscPos} bytes ESC/POS (${bytesDelTexto} de texto)`,
    ).toBeLessThanOrEqual(MAXIMO_BYTES_RESPUESTA_TRABAJOS + TOPE_BYTES_TICKET);
    const trabajo = lista.find((t) => t.id === trabajoId);
    expect(trabajo, 'GET /puente/trabajos entrega el trabajo').toBeDefined();
    expect(
      bytesDe(trabajo!.bytes),
      `el ticket renderizado pesa ${bytesDe(trabajo!.bytes)} bytes (tope ${TOPE_BYTES_TICKET})`,
    ).toBeLessThanOrEqual(TOPE_BYTES_TICKET);
    validarConElContrato(lista);

    const entregado = decodificar(trabajo!);
    exigirTicketCoherente(entregado.texto, carta, await resumenDe(s, trabajoId));

    // El simulador lo imprime: llega completo a la impresora y el trabajo queda IMPRESO.
    const { cocina } = await imprimirTodo(s, { cocina: 1, barra: 0 });
    const impreso = solo(cocina);
    expect(impreso.texto).toBe(entregado.texto);
    const despues = await resumenDe(s, trabajoId);
    expect(despues.estado).toBe('IMPRESO');
    exigirTicketCoherente(impreso.texto, carta, despues);
  });

  it('en la misma sucursal, una bebida de Barra en otra impresora también se imprime: la cola no se bloquea', async () => {
    const s = await sucursal();
    const { orden, trabajoId } = await enviarGrande(s);
    const b = await enviarBebida(s, orden.id);

    // La primera entrega ya lleva la bebida: la impresora de Cocina no frena a la de Barra.
    const { lista } = await pedirTrabajosCrudo(s);
    expect(lista.map((t) => t.id)).toContain(b.trabajoId);
    expect(lista.map((t) => t.id)).toContain(trabajoId);
    validarConElContrato(lista);

    const { cocina, barra } = await imprimirTodo(s, { cocina: 1, barra: 1 });
    expect(solo(cocina).completo).toBe(true);
    expect(compacto(solo(barra).texto)).toContain(compacto(b.nombre));
    const pendientes = (await trabajosDeSucursal(admin, s.id)).filter(
      (t) => [trabajoId, b.trabajoId].includes(t.id) && t.estado !== 'IMPRESO',
    );
    expect(pendientes, 'los dos trabajos quedan IMPRESO').toEqual([]);
  });

  it('50 reimpresiones del ticket: cada GET /puente/trabajos queda bajo 1 MB más un ticket y todo sale en llamadas sucesivas', async () => {
    const s = await sucursal();
    const { orden, trabajoId } = await enviarGrande(s);
    const b = await enviarBebida(s, orden.id);

    // Antes de reimprimir, el ticket de partida ya respeta el tope (si no, 50 copias serían una respuesta enorme).
    const previa = await pedirTrabajosCrudo(s);
    const original = previa.lista.find((t) => t.id === trabajoId);
    expect(original, 'GET /puente/trabajos entrega el trabajo').toBeDefined();
    expect(
      bytesDe(original!.bytes),
      `el ticket de partida pesa ${bytesDe(original!.bytes)} bytes (tope ${TOPE_BYTES_TICKET})`,
    ).toBeLessThanOrEqual(TOPE_BYTES_TICKET);

    const idsReimpresos: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const res = await llamar(ctx, s.tokenMozo, {
        metodo: 'post',
        ruta: `/impresion/trabajos/${trabajoId}/reimpresion`,
        cabeceras: clave(),
      });
      exigirEstado(res, 201, `reimpresión ${i + 1}`);
      idsReimpresos.push(trabajoCreadoRespuestaSchema.parse(res.body).trabajoId);
    }
    expect(new Set(idsReimpresos).size).toBe(50);
    const todos = new Set([trabajoId, b.trabajoId, ...idsReimpresos]);

    // Cada respuesta pesa, decodificada, a lo más lo que fija el criterio 113 más un ticket.
    const maximoEscPos = MAXIMO_BYTES_RESPUESTA_TRABAJOS + TOPE_BYTES_TICKET;
    const maximoTexto = Math.ceil((maximoEscPos * 4) / 3) + 64 * 1024;
    const revisar = (descripcion: string, bytesEscPos: number, bytesDelTexto: number) => {
      expect(
        bytesEscPos,
        `${descripcion}: ${bytesEscPos} bytes ESC/POS (máximo ${maximoEscPos})`,
      ).toBeLessThanOrEqual(maximoEscPos);
      expect(
        bytesDelTexto,
        `${descripcion}: ${bytesDelTexto} bytes de texto (máximo ${maximoTexto})`,
      ).toBeLessThanOrEqual(maximoTexto);
    };

    const directa = await pedirTrabajosCrudo(s);
    revisar('la primera entrega con las reimpresiones', directa.bytesEscPos, directa.bytesDelTexto);
    expect(
      directa.lista.map((t) => t.id),
      'la bebida de Barra sale en la primera entrega aunque Cocina tenga 51 tickets grandes',
    ).toContain(b.trabajoId);
    expect(directa.lista.length, 'la entrega no se queda sin ticket').toBeGreaterThan(0);
    validarConElContrato(directa.lista);

    // El simulador imprime todo en llamadas sucesivas; se mide cada respuesta.
    const respuestas: Array<{ escPos: number; texto: number }> = [];
    const fetchMedido: typeof fetch = async (entrada, init) => {
      const respuesta = await fetch(entrada, init);
      const url =
        typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if ((init?.method ?? 'GET') === 'GET' && url.endsWith('/puente/trabajos')) {
        const texto = await respuesta.clone().text();
        const lista = JSON.parse(texto) as TrabajoCrudo[];
        respuestas.push({
          escPos: lista.reduce((suma, t) => suma + bytesDe(t.bytes), 0),
          texto: Buffer.byteLength(texto, 'utf8'),
        });
      }
      return respuesta;
    };
    const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!, { fetch: fetchMedido });
    await simulador.iniciar();
    try {
      for (let vuelta = 0; vuelta < 300 && simulador.impresos.length < todos.size; vuelta += 1) {
        await simulador.pedirTrabajosAhora();
      }
      await simulador.esperarImpresos(todos.size, 60_000);
    } finally {
      await simulador.detener();
    }
    expect(respuestas.length, 'el simulador necesitó varias llamadas').toBeGreaterThan(1);
    respuestas.forEach((r, i) => revisar(`la llamada ${i + 1} del simulador`, r.escPos, r.texto));

    // Todo termina saliendo: IMPRESO, o marcado (error de armado) en la lista de trabajos.
    const enBd = (await trabajosDeSucursal(admin, s.id)).filter((t) => todos.has(t.id));
    expect(enBd).toHaveLength(todos.size);
    const noImpresos = enBd.filter((t) => t.estado !== 'IMPRESO');
    if (noImpresos.length > 0) {
      const lista = await listarTrabajos(s.tokenMozo);
      for (const t of noImpresos) {
        const resumen = lista.find((r) => r.id === t.id);
        expect(resumen?.sinTicket, `el trabajo ${t.id} sin imprimir está marcado`).toBe(true);
      }
    }
    const impresosDeCocina = await s.cocina.emulador.esperarTickets(
      todos.size - 1 - noImpresos.length,
      60_000,
    );
    for (const t of impresosDeCocina) {
      expect(t.completo).toBe(true);
      expect(t.comandosDesconocidos).toEqual([]);
    }
    const deBarra = await s.barra.emulador.esperarTickets(1, 15_000);
    expect(compacto(solo(deBarra).texto)).toContain(compacto(b.nombre));
  });
});
