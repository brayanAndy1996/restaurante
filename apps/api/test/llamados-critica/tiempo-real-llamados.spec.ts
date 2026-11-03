// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P1 (parte 6) · Aislamiento del tiempo real de los llamados (Socket.IO con el adaptador de PostgreSQL), ruta
// crítica, criterio 57 (y el 36 y el 45 en lo que toca a las salas):
// - `llamado.nuevo` `{ llamadoId, tipo, mesaId, mesaNombre, destinatarios }` y `llamado.cambio` `{ llamadoId,
//   mesaId, estado }` se publican después de confirmar, solo en la sala de la sucursal de la mesa: los equipos
//   conectados de esa sucursal los reciben en menos de 1 segundo; los de otra sucursal de la misma empresa, el
//   Administrador sin sucursal activa y los de otra empresa, nunca; también con dos instancias de la API contra la
//   misma base;
// - pesan menos de 4 KB y llevan solo ids, tipo, estado, el nombre de la mesa y los destinatarios;
// - una réplica o un rechazo no publican nada; la carta web no se conecta a Socket.IO (no hay salas públicas).
// Hoy las rutas públicas responden 401 y las de la PWA lanzan "No implementado": las pruebas fallan por eso.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ClienteTiempoReal } from '../soporte';
import {
  UUID_RE,
  arrancarAislamiento,
  atenderLlamado,
  clave,
  clientePublico,
  crearLlamadoOk,
  crearMundo,
  descartarLlamado,
  exigirEstado,
  exigirSinFallos,
  llamar,
  llamarAlMozo,
  mesasNuevas,
  pedidoDeLomo,
  postConClave,
  rutaDeLlamados,
  sesiones,
  type AppP4,
  type EmpresaDelMundo,
  type Mundo,
} from './fabrica-aislamiento';
import { RelojManual } from '../../src/nucleo/reloj';
import { ClientePublico } from '../soporte';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const reloj = new RelojManual('2026-11-02T14:00:00-05:00');
let ctx: AppP4;
let mundoPendiente: Promise<Mundo> | undefined;
const mundo = () => (mundoPendiente ??= crearMundo(ctx));

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2, tiempoReal: true, reloj });
});

afterAll(async () => {
  for (const c of abiertos.splice(0)) c.cerrar();
  await ctx?.cerrar();
});

const abiertos: ClienteTiempoReal[] = [];
afterEach(() => {
  for (const c of abiertos.splice(0)) c.cerrar();
});

async function conectar(app: AppP4['app'], token: string): Promise<ClienteTiempoReal> {
  const cliente = await ClienteTiempoReal.conectar(app, { token });
  abiertos.push(cliente);
  return cliente;
}

// ------------------------------------------------------------------------------------------------
// Quién escucha
// ------------------------------------------------------------------------------------------------
type Quien =
  | 'A.mozoS1'
  | 'A.cajeroS1'
  | 'A.adminS1'
  | 'A.cajeroS2'
  | 'A.adminSin'
  | 'A.adminS2'
  | 'B.mozoS1'
  | 'B.adminS1'
  | 'B.adminSin';

const DE_S1_DE_A: Quien[] = ['A.mozoS1', 'A.cajeroS1', 'A.adminS1'];
const TODOS: Quien[] = [
  ...DE_S1_DE_A,
  'A.cajeroS2',
  'A.adminSin',
  'A.adminS2',
  'B.mozoS1',
  'B.adminS1',
  'B.adminSin',
];

async function tokensDe(m: Mundo): Promise<Record<Quien, string>> {
  const t = async (persona: Parameters<typeof sesiones>[1], sucursal: string | null) =>
    (await sesiones(ctx, persona, sucursal)).contrasena;
  return {
    'A.mozoS1': await t(m.A.mozo, m.A.S1),
    'A.cajeroS1': await t(m.A.cajero, m.A.S1),
    'A.adminS1': await t(m.e.A.base.admin, m.A.S1),
    'A.cajeroS2': await t(m.A.cajero, m.A.S2),
    'A.adminSin': await t(m.e.A.base.admin, null),
    'A.adminS2': await t(m.e.A.base.admin, m.A.S2),
    'B.mozoS1': await t(m.B.mozo, m.B.S1),
    'B.adminS1': await t(m.e.B.base.admin, m.B.S1),
    'B.adminSin': await t(m.e.B.base.admin, null),
  };
}

type Conectados = Partial<Record<Quien, ClienteTiempoReal>>;

async function conectarTodos(m: Mundo, repartir = false, otra?: AppP4): Promise<Conectados> {
  const tokens = await tokensDe(m);
  const clientes: Conectados = {};
  for (const [i, quien] of TODOS.entries()) {
    const app = repartir && otra !== undefined && i % 2 === 1 ? otra.app : ctx.app;
    clientes[quien] = await conectar(app, tokens[quien]);
  }
  return clientes;
}

const limpiar = (c: Conectados) => Object.values(c).forEach((x) => x?.limpiar());

/** Quién recibe el evento (en menos de un segundo) y quién no (durante 600 ms). */
async function exigirReparto(
  clientes: Conectados,
  nombre: string,
  reciben: Quien[],
  descripcion: string,
  esElEsperado: (datos: any) => boolean,
): Promise<any[]> {
  const fallos: string[] = [];
  const recibidos: any[] = [];
  await Promise.all(
    TODOS.map(async (quien) => {
      const cliente = clientes[quien]!;
      if (reciben.includes(quien)) {
        try {
          const datos = await cliente.esperarEvento<any>(nombre, 1000);
          if (!esElEsperado(datos)) fallos.push(`${descripcion}: ${quien} recibió otro evento`);
          recibidos.push(datos);
          await cliente.noRecibe(nombre, 300);
        } catch (error) {
          fallos.push(`${descripcion}: ${quien} debía recibirlo y: ${(error as Error).message}`);
        }
      } else {
        try {
          await cliente.noRecibe(nombre, 700);
        } catch (error) {
          fallos.push(`${descripcion}: ${quien} no debía recibirlo y: ${(error as Error).message}`);
        }
      }
    }),
  );
  exigirSinFallos(fallos);
  return recibidos;
}

// ------------------------------------------------------------------------------------------------
// Los eventos
// ------------------------------------------------------------------------------------------------
const esquemaNuevo = z.strictObject({
  llamadoId: z.string().regex(UUID_RE),
  tipo: z.enum(['PEDIDO', 'LLAMAR_MOZO', 'PEDIR_CUENTA']),
  mesaId: z.string().regex(UUID_RE),
  mesaNombre: z.string(),
  destinatarios: z.array(z.string().regex(UUID_RE)).nullable(),
});
const esquemaCambio = z.strictObject({
  llamadoId: z.string().regex(UUID_RE),
  mesaId: z.string().regex(UUID_RE),
  estado: z.enum(['PENDIENTE', 'ATENDIDO', 'PASADO_A_CUENTA', 'DESCARTADO', 'VENCIDO']),
});
const pesa = (datos: unknown) => Buffer.byteLength(JSON.stringify(datos));

describe('criterio 57 · llamado.nuevo solo llega a la sala de la sucursal de la mesa', () => {
  it('con la mesa libre, lo reciben los equipos de S1 de A en menos de 1 segundo, con destinatarios null, y nadie más', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    limpiar(c);
    const id = randomUUID();
    const inicio = Date.now();
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, pedidoDeLomo(m.A.carta, { id }));
    const recibidos = await exigirReparto(
      c,
      'llamado.nuevo',
      DE_S1_DE_A,
      'mesa libre de S1 de A',
      (d) => d.llamadoId === id,
    );
    expect(Date.now() - inicio).toBeLessThan(5000);
    for (const datos of recibidos) {
      esquemaNuevo.parse(datos);
      expect(datos).toEqual({
        llamadoId: id,
        tipo: 'PEDIDO',
        mesaId: mesa!.id,
        mesaNombre: mesa!.nombre,
        destinatarios: null,
      });
      expect(pesa(datos)).toBeLessThan(4096);
    }
  });

  it('con la mesa ocupada, destinatarios es el mozo responsable', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const mozo = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    exigirEstado(
      await postConClave(ctx, mozo, '/ordenes', {
        id: randomUUID(),
        mesaId: mesa!.id,
        comensales: 2,
      }),
      201,
      'abrir la mesa',
    );
    limpiar(c);
    const id = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, llamarAlMozo(id));
    const recibidos = await exigirReparto(
      c,
      'llamado.nuevo',
      DE_S1_DE_A,
      'mesa ocupada de S1 de A',
      (d) => d.llamadoId === id,
    );
    for (const datos of recibidos) {
      esquemaNuevo.parse(datos);
      expect(datos.destinatarios).toEqual([m.A.mozo.id]);
      expect(datos.tipo).toBe('LLAMAR_MOZO');
    }
  });

  it('un llamado de B llega solo a los equipos de S1 de B, y uno de la sucursal 2 de A, solo a los de S2', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    limpiar(c);
    const idB = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), m.B.mesa12.codigo, llamarAlMozo(idB));
    await exigirReparto(
      c,
      'llamado.nuevo',
      ['B.mozoS1', 'B.adminS1'],
      'S1 de B',
      (d) => d.llamadoId === idB,
    );
    limpiar(c);
    const idS2 = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), m.A.mesaS2.codigo, llamarAlMozo(idS2));
    await exigirReparto(
      c,
      'llamado.nuevo',
      ['A.cajeroS2', 'A.adminS2'],
      'S2 de A',
      (d) => d.llamadoId === idS2,
    );
  });

  it('pesa menos de 4 KB y no lleva líneas, nota, precios ni nombres de personas, ni con un pedido de 30 líneas', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    limpiar(c);
    const id = randomUUID();
    const lineas = Array.from({ length: 30 }, (_, i) => ({
      productoId: m.A.carta.gaseosaId,
      modificadorIds: [] as string[],
      cantidad: 1 + (i % 3),
      observacion: `Sin hielo ${i}`.padEnd(120, '.'),
    }));
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, {
      id,
      tipo: 'PEDIDO',
      lineas,
      nota: 'n'.repeat(140),
    });
    const [datos] = await exigirReparto(
      c,
      'llamado.nuevo',
      DE_S1_DE_A,
      'pedido de 30 líneas',
      (d) => d.llamadoId === id,
    );
    esquemaNuevo.parse(datos);
    expect(Object.keys(datos).sort()).toEqual(
      ['destinatarios', 'llamadoId', 'mesaId', 'mesaNombre', 'tipo'].sort(),
    );
    expect(pesa(datos)).toBeLessThan(4096);
  });

  it('una réplica, un rechazo y un 404 no publican nada', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    const [mesa, otra] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 2);
    const cliente = clientePublico(ctx);
    const cuerpo = pedidoDeLomo(m.A.carta);
    await crearLlamadoOk(cliente, mesa!.codigo, cuerpo);
    await new Promise((r) => setTimeout(r, 400));
    limpiar(c);
    // Réplica por id.
    exigirEstado(await cliente.post(rutaDeLlamados(mesa!.codigo), cuerpo), 201, 'la réplica');
    // Otro llamado con la mesa ya pendiente: 409.
    const pendiente = await cliente.post(rutaDeLlamados(mesa!.codigo), llamarAlMozo());
    expect(pendiente.status, pendiente.text).toBe(409);
    // Un producto de B: 422.
    const malo = await cliente.post(rutaDeLlamados(otra!.codigo), {
      id: randomUUID(),
      tipo: 'PEDIDO',
      lineas: [{ productoId: m.B.carta.lomoId, modificadorIds: [], cantidad: 1 }],
    });
    expect(malo.status, malo.text).toBe(422);
    // Un código desconocido: 404.
    expect((await cliente.post(rutaDeLlamados('A'.repeat(22)), llamarAlMozo())).status).toBe(404);
    await exigirReparto(c, 'llamado.nuevo', [], 'réplicas y rechazos', () => false);
  });

  it('la carta web no se conecta a Socket.IO: sin token no hay sala pública ni se recibe nada', async () => {
    const m = await mundo();
    const anonimo = await ClienteTiempoReal.intentarConectar(ctx.app, {});
    expect(anonimo.cliente, 'una conexión sin sesión no debe aceptarse').toBeNull();
    expect(anonimo.error).toBe('NO_AUTENTICADO');
    // Con el código de una mesa como token tampoco.
    const conCodigo = await ClienteTiempoReal.intentarConectar(ctx.app, {
      token: m.A.mesa4.codigo,
    });
    expect(conCodigo.cliente).toBeNull();
  });
});

describe('criterio 57 · llamado.cambio solo llega a la sala de la sucursal de la mesa', () => {
  async function llamadoAtendible(m: Mundo, empresa: EmpresaDelMundo = m.A) {
    const [mesa] = await mesasNuevas(ctx, empresa.tokenAdmin, empresa.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, pedidoDeLomo(empresa.carta, { id }));
    return { mesa: mesa!, id };
  }

  it('atender y descartar publican llamado.cambio con el estado nuevo en la sala de S1, y nadie más lo recibe', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    const { mesa, id } = await llamadoAtendible(m);
    const mozo = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    await new Promise((r) => setTimeout(r, 300));
    limpiar(c);
    await atenderLlamado(ctx, mozo, id, { ordenId: randomUUID(), comensales: 2 });
    const [atendido] = await exigirReparto(
      c,
      'llamado.cambio',
      DE_S1_DE_A,
      'atender',
      (d) => d.llamadoId === id,
    );
    esquemaCambio.parse(atendido);
    expect(atendido).toEqual({ llamadoId: id, mesaId: mesa.id, estado: 'ATENDIDO' });
    expect(pesa(atendido)).toBeLessThan(4096);
    limpiar(c);
    await descartarLlamado(ctx, mozo, id, { motivo: 'Pedido falso' });
    const [descartado] = await exigirReparto(
      c,
      'llamado.cambio',
      DE_S1_DE_A,
      'descartar',
      (d) => d.llamadoId === id,
    );
    esquemaCambio.parse(descartado);
    expect(descartado).toEqual({ llamadoId: id, mesaId: mesa.id, estado: 'DESCARTADO' });
  });

  it('pasar a la cuenta publica llamado.cambio con PASADO_A_CUENTA y ningún otro evento de cocina', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    const { mesa, id } = await llamadoAtendible(m);
    const mozo = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    await atenderLlamado(ctx, mozo, id, { ordenId: randomUUID(), comensales: 2 });
    await new Promise((r) => setTimeout(r, 300));
    limpiar(c);
    const paso = await postConClave(ctx, mozo, `/llamados/${id}/paso-a-cuenta`, {
      lineas: [{ posicion: 0, cantidad: 1 }],
    });
    exigirEstado(paso, 200, 'pasar a la cuenta');
    const [cambio] = await exigirReparto(
      c,
      'llamado.cambio',
      DE_S1_DE_A,
      'pasar a la cuenta',
      (d) => d.llamadoId === id,
    );
    expect(cambio).toEqual({ llamadoId: id, mesaId: mesa.id, estado: 'PASADO_A_CUENTA' });
    // Pasar a la cuenta no avisa a la cocina, al salón ni a la orden (criterio 49).
    for (const quien of DE_S1_DE_A) {
      const cliente = c[quien]!;
      for (const ajeno of [
        'salon.cambio',
        'orden.cambio',
        'cocina.comanda',
        'cocina.linea',
        'cocina.visto',
        'cocina.listo',
      ]) {
        expect(cliente.eventos(ajeno), `${quien} recibió ${ajeno}`).toEqual([]);
      }
    }
  });

  it('una réplica, un rechazo y un 404 no publican nada', async () => {
    const m = await mundo();
    const c = await conectarTodos(m);
    const { id } = await llamadoAtendible(m);
    const mozo = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    const cuerpo = { ordenId: randomUUID(), comensales: 2 };
    const clave1 = randomUUID();
    const atender = (token: string, idLlamado: string, k: string) =>
      llamar(ctx, token, {
        metodo: 'post',
        ruta: `/llamados/${idLlamado}/atencion`,
        cuerpo,
        cabeceras: { 'Idempotency-Key': k },
      });
    exigirEstado(await atender(mozo, id, clave1), 200, 'atender');
    await new Promise((r) => setTimeout(r, 400));
    limpiar(c);
    // Réplica con la misma clave y con otra clave (la misma persona otra vez).
    exigirEstado(await atender(mozo, id, clave1), 200, 'réplica con la misma clave');
    exigirEstado(await atender(mozo, id, randomUUID()), 200, 'la misma persona con otra clave');
    // Un llamado que no existe: 404. Sin cuerpo válido: 400.
    expect((await atender(mozo, randomUUID(), randomUUID())).status).toBe(404);
    const sinClave = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta: `/llamados/${id}/descarte`,
      cuerpo: {},
    });
    expect(sinClave.status).toBe(400);
    // Pasar con una posición fuera de rango: 422.
    const fuera = await postConClave(ctx, mozo, `/llamados/${id}/paso-a-cuenta`, {
      lineas: [{ posicion: 7, cantidad: 1 }],
    });
    expect(fuera.status, fuera.text).toBe(422);
    await exigirReparto(c, 'llamado.cambio', [], 'réplicas y rechazos', () => false);
  });
});

describe('criterio 57 · con dos instancias de la API contra la misma base', () => {
  let ctx2: AppP4;

  beforeAll(async () => {
    ctx2 = await arrancarAislamiento({ poolMax: 2, tiempoReal: true, reloj });
  });

  afterAll(async () => {
    for (const c of abiertos.splice(0)) c.cerrar();
    await ctx2?.cerrar();
  });

  it('un llamado creado en la instancia 2 llega a los equipos de S1 conectados a cualquiera de las dos, y a nadie más', async () => {
    const m = await mundo();
    const c = await conectarTodos(m, true, ctx2);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    limpiar(c);
    const id = randomUUID();
    const desdeLaSegunda = new ClientePublico(ctx2.app);
    await crearLlamadoOk(desdeLaSegunda, mesa!.codigo, llamarAlMozo(id));
    await exigirReparto(
      c,
      'llamado.nuevo',
      DE_S1_DE_A,
      'creado en la instancia 2',
      (d) => d.llamadoId === id,
    );
    // Y al revés: creado en la 1, con clientes repartidos en las dos.
    limpiar(c);
    const [otra] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const id2 = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), otra!.codigo, llamarAlMozo(id2));
    await exigirReparto(
      c,
      'llamado.nuevo',
      DE_S1_DE_A,
      'creado en la instancia 1',
      (d) => d.llamadoId === id2,
    );
  });

  it('atender en la instancia 2 publica llamado.cambio a los equipos de S1 de las dos instancias, y a nadie más', async () => {
    const m = await mundo();
    const c = await conectarTodos(m, true, ctx2);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const id = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), mesa!.codigo, llamarAlMozo(id));
    const mozo = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    await new Promise((r) => setTimeout(r, 300));
    limpiar(c);
    exigirEstado(
      await llamar(ctx2, mozo, {
        metodo: 'post',
        ruta: `/llamados/${id}/atencion`,
        cuerpo: { ordenId: randomUUID(), comensales: 2 },
        cabeceras: clave(),
      }),
      200,
      'atender desde la instancia 2',
    );
    const [cambio] = await exigirReparto(
      c,
      'llamado.cambio',
      DE_S1_DE_A,
      'atender en la instancia 2',
      (d) => d.llamadoId === id,
    );
    expect(cambio.estado).toBe('ATENDIDO');
  });
});
