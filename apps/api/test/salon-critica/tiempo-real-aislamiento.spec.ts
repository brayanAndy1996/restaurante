// spec: 004-salon-cocina (pruebas protegidas)
//
// P4 (parte 3) · Aislamiento del tiempo real (Socket.IO con el adaptador de PostgreSQL), ruta crítica,
// criterios 64 a 70, más la parte de eventos del 86:
// - 64: la conexión valida la sesión como una petición HTTP (token `se.…` válido y no expirado; `equipo`
//   obligatorio y del mismo equipo en una sesión PIN; contraseña no temporal); si no, se rechaza con
//   `NO_AUTENTICADO`; un token `sa.…`, `eq.…`, `pu.…` o `vi.…`, adulterado o de una sesión cerrada, también; la
//   conexión no renueva la inactividad;
// - 65: el cliente no elige salas: `join`, `subscribe` o cualquier evento suyo no cambia sus salas ni responde;
// - 66: al cerrar la sesión, cambiar de usuario, revocar el equipo, desactivar al usuario o cambiar de sucursal
//   activa se desconectan sus conexiones; al vencer, con `revisarAhora()` (la revisión periódica);
// - 67: un evento de sala empresa llega solo a las conexiones de esa empresa; uno de sala sucursal, solo a las de
//   esa sucursal de esa empresa (el Administrador sin sucursal activa no la recibe); uno con la empresa de A y una
//   sucursal de B no llega a nadie;
// - 68: con dos instancias de la API contra la misma base, un evento publicado por una llega a los clientes de la
//   otra con las mismas reglas, y un cierre de sesión en una desconecta al cliente de la otra;
// - 69: todo evento pesa menos de 4 KB y lleva solo ids, estados y nombres; los de la carta de 003 llegan por
//   este transporte sin cambiar su forma;
// - 70: la guarda de la API rechaza `pg_notify`, `pg_listening_channels`, `pg_locks`, `pg_blocking_pids`,
//   `pg_safe_snapshot_blocking_pids` y los cerrojos de sesión fuera de literales y comentarios (y deja pasar
//   `pg_advisory_xact_lock` y esos textos dentro de literales o de otros identificadores); el rol
//   `restaurante_tiempo_real` y el esquema `tiempo_real` tienen los atributos y privilegios de `spec.md`, y el
//   arranque rechaza un rol privilegiado en `DATABASE_TIEMPO_REAL_URL`;
// - 86 (eventos): con un pool de 2 y 100 envíos concurrentes de A y de B, cada evento llega solo a los clientes
//   de su empresa.
// Hoy el servidor rechaza toda conexión con "No implementado": las pruebas de conexión fallan por eso. La
// guarda todavía no incluye los nombres nuevos y el arranque no verifica el rol del adaptador: esas pruebas
// fallan porque la sentencia llega a la base o la API arranca con un rol privilegiado.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  eventoCartaActualizadaDatosSchema,
  eventoCocinaComandaDatosSchema,
  eventoCocinaLineaDatosSchema,
  eventoCocinaListoDatosSchema,
  eventoDisponibilidadDatosSchema,
  eventoOrdenCambioDatosSchema,
  eventoSalonCambioDatosSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import {
  PUBLICADOR_EVENTOS,
  type EventoPublicable,
  type PublicadorEventos,
} from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import { ServidorTiempoReal } from '../../src/nucleo/tiempo-real';
import {
  conEmpresa,
  crearUsuario,
  ingresarOk,
  INICIO_POR_DEFECTO,
  MINUTO,
  nuevoSuperadmin,
  recordarEquipo,
} from '../acceso/fabrica-plataforma';
import { variantes } from '../aislamiento/nombres-prohibidos';
import {
  crearEscenarioCarta,
  crearPersona,
  equipoDe,
  sesionPin,
  type EscenarioCarta,
} from '../carta-critica/fabrica-permisos-carta';
import { ClienteTiempoReal } from '../soporte';
import {
  BASE_DE_PRUEBA,
  NOMBRES_DE_ROLES,
  abrirCliente,
  fijarEntornoDePrueba,
  urlDeRol,
} from '../utilidades';
import {
  CONTROLES_ALIAS_TIEMPO_REAL,
  ENTRADAS_TIEMPO_REAL,
  abrirOrden,
  arrancarP4,
  sembrarCartaEjemplo,
  sembrarSalon,
  enviar,
  exigirEstado,
  exigirSinFallos,
  idsDeEmpresaSalon,
  lineaLomo,
  llamar,
  postConClave,
  sesionContrasena,
  uuidsEn,
  type AppP4,
  type CartaEjemplo,
} from './fabrica-p4';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const reloj = new RelojManual(INICIO_POR_DEFECTO);
let ctx: AppP4;
let admin: Client;

// ------------------------------------------------------------------------------------------------
// Conexiones que hay que cerrar
// ------------------------------------------------------------------------------------------------
const abiertos: ClienteTiempoReal[] = [];

async function conectar(
  app: INestApplication,
  token: string,
  equipo?: string,
): Promise<ClienteTiempoReal> {
  const cliente = await ClienteTiempoReal.conectar(app, { token, ...(equipo ? { equipo } : {}) });
  abiertos.push(cliente);
  return cliente;
}

afterEach(() => {
  for (const cliente of abiertos.splice(0)) cliente.cerrar();
});

const publicar = (app: INestApplication, evento: EventoPublicable) =>
  Promise.resolve(
    app.get<PublicadorEventos>(PUBLICADOR_EVENTOS, { strict: false }).publicar(evento),
  );

/** Un `orden.cambio` con un `ordenId` nuevo, para reconocerlo al llegar. */
const ordenCambio = (
  empresaId: string,
  sala: EventoPublicable['sala'],
): { evento: EventoPublicable; ordenId: string } => {
  const ordenId = randomUUID();
  return { evento: { empresaId, sala, nombre: 'orden.cambio', datos: { ordenId } }, ordenId };
};

// ------------------------------------------------------------------------------------------------
// El mundo: dos empresas con su carta y sus sesiones (sin depender de las rutas del salón)
// ------------------------------------------------------------------------------------------------
interface Mundo {
  e: EscenarioCarta;
  /** Carta de ejemplo de cada empresa, sembrada por las rutas de 003. */
  cartaA: CartaEjemplo;
  cartaB: CartaEjemplo;
  /** Sesiones de contraseña de A y de B (la sucursal activa va en el nombre). */
  tokens: {
    A: Record<
      | 'adminSin'
      | 'adminS1'
      | 'adminS2'
      | 'mozoS1'
      | 'cocinaS1'
      | 'supervisorS1'
      | 'cajeroS1'
      | 'cajeroS2',
      string
    >;
    B: Record<'adminSin' | 'adminS1' | 'mozoS1', string>;
  };
  /** Sesión de PIN del Mozo de A en S1, con el equipo recordado. */
  pin: { token: string; equipo: string };
}

let mundoPendiente: Promise<Mundo> | undefined;
function mundo(): Promise<Mundo> {
  mundoPendiente ??= (async () => {
    const e = await crearEscenarioCarta(ctx);
    const cartaA = await sembrarCartaEjemplo(ctx, e.A.tokenAdmin);
    const cartaB = await sembrarCartaEjemplo(ctx, e.B.tokenAdmin);
    const tokens = {
      A: {
        adminSin: await sesionContrasena(ctx, e.A.base.admin, null),
        adminS1: await sesionContrasena(ctx, e.A.base.admin, e.A.S1),
        adminS2: await sesionContrasena(ctx, e.A.base.admin, e.A.S2),
        mozoS1: await sesionContrasena(ctx, e.A.mozo, e.A.S1),
        cocinaS1: await sesionContrasena(ctx, e.A.cocina, e.A.S1),
        supervisorS1: await sesionContrasena(ctx, e.A.supervisor, e.A.S1),
        cajeroS1: await sesionContrasena(ctx, e.A.cajero, e.A.S1),
        cajeroS2: await sesionContrasena(ctx, e.A.cajero, e.A.S2),
      },
      B: {
        adminSin: await sesionContrasena(ctx, e.B.base.admin, null),
        adminS1: await sesionContrasena(ctx, e.B.base.admin, e.B.S1),
        mozoS1: await sesionContrasena(ctx, e.B.mozo, e.B.S1),
      },
    };
    const equipo = await equipoDe(ctx, e.A.mozo);
    const pin = { token: await sesionPin(ctx, e.A.mozo, equipo, e.A.S1), equipo };
    return { e, cartaA, cartaB, tokens, pin };
  })();
  return mundoPendiente;
}

beforeAll(async () => {
  ctx = await arrancarP4({ poolMax: 2, tiempoReal: true, reloj });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  for (const cliente of abiertos.splice(0)) cliente.cerrar();
  await ctx?.cerrar();
  await admin?.end();
});

/** Cambia el último carácter del token para adulterar el secreto. */
const adulterar = (token: string): string => token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');

// ------------------------------------------------------------------------------------------------
// 64 · Conexión
// ------------------------------------------------------------------------------------------------
describe('criterio 64 · conexión con cada tipo de token', () => {
  it('una sesión de contraseña válida de cada rol conecta, con y sin sucursal activa', async () => {
    const m = await mundo();
    const fallos: string[] = [];
    for (const [nombre, token] of [...Object.entries(m.tokens.A), ...Object.entries(m.tokens.B)]) {
      const { cliente, error } = await ClienteTiempoReal.intentarConectar(ctx.app, { token });
      if (cliente === null) fallos.push(`${nombre}: rechazada con ${error}`);
      else abiertos.push(cliente);
    }
    exigirSinFallos(fallos);
  });

  it('una sesión de PIN conecta con el equipo de la sesión', async () => {
    const m = await mundo();
    const cliente = await conectar(ctx.app, m.pin.token, m.pin.equipo);
    expect(cliente.conectado).toBe(true);
  });

  it('se rechazan con NO_AUTENTICADO: sin token, basura, secreto adulterado, empresa cambiada y sesión cerrada', async () => {
    const m = await mundo();
    const cerrada = await sesionContrasena(ctx, m.e.A.mozo, m.e.A.S1);
    exigirEstado(
      await llamar(ctx, cerrada, { metodo: 'delete', ruta: '/sesion' }),
      204,
      'cerrar la sesión',
    );
    const casos: [string, { token?: string; equipo?: string }][] = [
      ['sin token', {}],
      ['token vacío', { token: '' }],
      ['basura', { token: 'esto-no-es-un-token' }],
      ['secreto adulterado', { token: adulterar(m.tokens.A.mozoS1) }],
      ['empresa cambiada a B', { token: conEmpresa(m.tokens.A.mozoS1, m.e.B.empresaId) }],
      ['sesión cerrada', { token: cerrada }],
    ];
    const fallos: string[] = [];
    for (const [nombre, auth] of casos) {
      const r = await ClienteTiempoReal.intentarConectar(ctx.app, auth);
      if (r.cliente !== null) {
        abiertos.push(r.cliente);
        fallos.push(`${nombre}: la conexión fue aceptada`);
      } else if (r.error !== 'NO_AUTENTICADO') {
        fallos.push(`${nombre}: se esperaba el error NO_AUTENTICADO y fue "${r.error}"`);
      }
    }
    exigirSinFallos(fallos);
  });

  it('se rechazan con NO_AUTENTICADO los tokens sa., eq., pu. y vi., también si se manda con equipo', async () => {
    const m = await mundo();
    const sa = await nuevoSuperadmin(ctx);
    const equipo = await equipoDe(ctx, m.e.A.cocina);
    const falso = (prefijo: string) =>
      `${prefijo}.${m.e.A.empresaId}.${randomUUID()}.${randomUUID()}`;
    const casos: [string, { token?: string; equipo?: string }][] = [
      ['token de superadministrador (sa.)', { token: sa.token }],
      ['token de equipo (eq.)', { token: equipo }],
      ['token de equipo (eq.) con el mismo equipo', { token: equipo, equipo }],
      ['token de puente (pu.)', { token: falso('pu') }],
      ['token de vinculación (vi.)', { token: falso('vi') }],
    ];
    const fallos: string[] = [];
    for (const [nombre, auth] of casos) {
      const r = await ClienteTiempoReal.intentarConectar(ctx.app, auth);
      if (r.cliente !== null) {
        abiertos.push(r.cliente);
        fallos.push(`${nombre}: la conexión fue aceptada`);
      } else if (r.error !== 'NO_AUTENTICADO') {
        fallos.push(`${nombre}: se esperaba el error NO_AUTENTICADO y fue "${r.error}"`);
      }
    }
    exigirSinFallos(fallos);
  });

  it('una sesión con contraseña temporal se rechaza hasta que la persona la cambia', async () => {
    const m = await mundo();
    const persona = await crearUsuario(ctx, m.tokens.A.adminSin, {
      accesos: [{ sucursalId: m.e.A.S1, rol: 'MOZO' }],
    });
    const { token } = await ingresarOk(ctx, persona.usuario, persona.contrasenaTemporal);
    const r = await ClienteTiempoReal.intentarConectar(ctx.app, { token });
    if (r.cliente !== null) abiertos.push(r.cliente);
    expect(r).toEqual({ cliente: null, error: 'NO_AUTENTICADO' });
  });

  it('una sesión de PIN sin equipo, con el equipo de otra persona o con un equipo adulterado se rechaza; con el suyo conecta', async () => {
    const m = await mundo();
    const equipoAjeno = await equipoDe(ctx, m.e.A.cocina);
    const casos: [string, { token?: string; equipo?: string }][] = [
      ['sin equipo', { token: m.pin.token }],
      ['con el equipo de otra persona', { token: m.pin.token, equipo: equipoAjeno }],
      ['con el equipo adulterado', { token: m.pin.token, equipo: adulterar(m.pin.equipo) }],
      ['con un equipo de B', { token: m.pin.token, equipo: await equipoDe(ctx, m.e.B.mozo) }],
    ];
    const fallos: string[] = [];
    for (const [nombre, auth] of casos) {
      const r = await ClienteTiempoReal.intentarConectar(ctx.app, auth);
      if (r.cliente !== null) {
        abiertos.push(r.cliente);
        fallos.push(`${nombre}: la conexión fue aceptada`);
      } else if (r.error !== 'NO_AUTENTICADO') {
        fallos.push(`${nombre}: se esperaba el error NO_AUTENTICADO y fue "${r.error}"`);
      }
    }
    exigirSinFallos(fallos);
    const propio = await ClienteTiempoReal.intentarConectar(ctx.app, {
      token: m.pin.token,
      equipo: m.pin.equipo,
    });
    if (propio.cliente !== null) abiertos.push(propio.cliente);
    expect(propio.error, 'con su propio equipo').toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// 65 · El cliente no elige salas
// ------------------------------------------------------------------------------------------------
describe('criterio 65 · lo que el cliente emite no cambia sus salas ni provoca respuesta', () => {
  it('join, subscribe y otros eventos con salas de B o de otra sucursal no suman salas ni reciben respuesta', async () => {
    const m = await mundo();
    const intruso = await conectar(ctx.app, m.tokens.A.mozoS1);
    const vecinoB = await conectar(ctx.app, m.tokens.B.mozoS1);
    const salasAjenas = [
      `e:${m.e.B.empresaId}`,
      `s:${m.e.B.empresaId}:${m.e.B.S1}`,
      `s:${m.e.A.empresaId}:${m.e.A.S2}`,
      `e:${m.e.A.empresaId}:todo`,
    ];
    for (const sala of salasAjenas) {
      for (const nombre of ['join', 'subscribe', 'unirse', 'rooms']) {
        intruso.emitir(nombre, sala);
        intruso.emitir(nombre, { sala, room: sala, empresaId: m.e.B.empresaId });
      }
    }
    // Ninguno de esos eventos recibe un acuse.
    const acuse = await new Promise<'sin-acuse' | 'con-acuse'>((resolver) => {
      intruso.socket.timeout(500).emit('join', salasAjenas[0], (error: unknown) => {
        resolver(error ? 'sin-acuse' : 'con-acuse');
      });
    });
    expect(acuse).toBe('sin-acuse');
    expect(intruso.eventos()).toEqual([]);
    expect(intruso.conectado, 'el servidor no lo desconectó').toBe(true);

    // Lo publicado en las salas ajenas no le llega, aunque a su dueño sí.
    for (const [empresaId, sala] of [
      [m.e.B.empresaId, { tipo: 'empresa' }],
      [m.e.B.empresaId, { tipo: 'sucursal', sucursalId: m.e.B.S1 }],
      [m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S2 }],
    ] as const) {
      const { evento, ordenId } = ordenCambio(empresaId, sala);
      await publicar(ctx.app, evento);
      if (empresaId === m.e.B.empresaId) {
        expect(await vecinoB.esperarEvento<{ ordenId: string }>('orden.cambio')).toEqual({
          ordenId,
        });
      }
      await intruso.noRecibe('orden.cambio', 400);
      vecinoB.limpiar();
    }
    // Y lo de su propia sala sigue llegando, una sola vez.
    const propio = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S1 });
    await publicar(ctx.app, propio.evento);
    expect(await intruso.esperarEvento<{ ordenId: string }>('orden.cambio')).toEqual({
      ordenId: propio.ordenId,
    });
    await intruso.noRecibe('orden.cambio', 300);
  });
});

// ------------------------------------------------------------------------------------------------
// 67 · Salas por empresa y sucursal
// ------------------------------------------------------------------------------------------------
interface Conectados {
  [nombre: string]: ClienteTiempoReal;
}

async function conectarTodos(app: INestApplication, m: Mundo): Promise<Conectados> {
  const c: Conectados = {};
  for (const [nombre, token] of Object.entries(m.tokens.A))
    c[`A.${nombre}`] = await conectar(app, token);
  for (const [nombre, token] of Object.entries(m.tokens.B))
    c[`B.${nombre}`] = await conectar(app, token);
  c['A.mozoPinS1'] = await conectar(app, m.pin.token, m.pin.equipo);
  return c;
}

const SUCURSAL_1_DE_A = [
  'A.adminS1',
  'A.mozoS1',
  'A.cocinaS1',
  'A.supervisorS1',
  'A.cajeroS1',
  'A.mozoPinS1',
];
const SUCURSAL_2_DE_A = ['A.adminS2', 'A.cajeroS2'];
const TODOS_DE_A = ['A.adminSin', ...SUCURSAL_1_DE_A, ...SUCURSAL_2_DE_A];
const TODOS_DE_B = ['B.adminSin', 'B.adminS1', 'B.mozoS1'];

/** Publica el evento y comprueba quién lo recibe (una sola vez) y quién no. */
async function exigirReparto(
  app: INestApplication,
  clientes: Conectados,
  evento: EventoPublicable,
  ordenId: string,
  reciben: string[],
  descripcion: string,
  publicarDesde: INestApplication = app,
): Promise<void> {
  for (const c of Object.values(clientes)) c.limpiar();
  await publicar(publicarDesde, evento);
  const fallos: string[] = [];
  await Promise.all(
    Object.entries(clientes).map(async ([nombre, cliente]) => {
      if (reciben.includes(nombre)) {
        try {
          const datos = await cliente.esperarEvento<{ ordenId: string }>('orden.cambio', 3000);
          if (datos.ordenId !== ordenId)
            fallos.push(`${descripcion}: ${nombre} recibió otro evento`);
          await cliente.noRecibe('orden.cambio', 300);
        } catch (error) {
          fallos.push(`${descripcion}: ${nombre} debía recibirlo y: ${(error as Error).message}`);
        }
      } else {
        try {
          await cliente.noRecibe('orden.cambio', 600);
        } catch (error) {
          fallos.push(
            `${descripcion}: ${nombre} no debía recibirlo y: ${(error as Error).message}`,
          );
        }
      }
    }),
  );
  exigirSinFallos(fallos);
}

describe('criterio 67 · las salas llevan la empresa y la sucursal', () => {
  it('un evento de sala empresa llega a todas las conexiones de esa empresa (también al Administrador sin sucursal) y a ninguna de otra', async () => {
    const m = await mundo();
    const c = await conectarTodos(ctx.app, m);
    const deA = ordenCambio(m.e.A.empresaId, { tipo: 'empresa' });
    await exigirReparto(ctx.app, c, deA.evento, deA.ordenId, TODOS_DE_A, 'empresa A');
    const deB = ordenCambio(m.e.B.empresaId, { tipo: 'empresa' });
    await exigirReparto(ctx.app, c, deB.evento, deB.ordenId, TODOS_DE_B, 'empresa B');
  });

  it('un evento de sala sucursal llega solo a las conexiones de esa sucursal de esa empresa, y no al Administrador sin sucursal activa', async () => {
    const m = await mundo();
    const c = await conectarTodos(ctx.app, m);
    const s1 = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S1 });
    await exigirReparto(ctx.app, c, s1.evento, s1.ordenId, SUCURSAL_1_DE_A, 'sucursal 1 de A');
    const s2 = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S2 });
    await exigirReparto(ctx.app, c, s2.evento, s2.ordenId, SUCURSAL_2_DE_A, 'sucursal 2 de A');
    const b1 = ordenCambio(m.e.B.empresaId, { tipo: 'sucursal', sucursalId: m.e.B.S1 });
    await exigirReparto(
      ctx.app,
      c,
      b1.evento,
      b1.ordenId,
      ['B.adminS1', 'B.mozoS1'],
      'sucursal 1 de B',
    );
  });

  it('un evento con la empresa de A y una sucursal de B (o al revés) no llega a nadie', async () => {
    const m = await mundo();
    const c = await conectarTodos(ctx.app, m);
    const cruzado1 = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.B.S1 });
    await exigirReparto(
      ctx.app,
      c,
      cruzado1.evento,
      cruzado1.ordenId,
      [],
      'empresa A con sucursal de B',
    );
    const cruzado2 = ordenCambio(m.e.B.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S1 });
    await exigirReparto(
      ctx.app,
      c,
      cruzado2.evento,
      cruzado2.ordenId,
      [],
      'empresa B con sucursal de A',
    );
    const puente = ordenCambio(m.e.A.empresaId, { tipo: 'puente', puenteId: randomUUID() });
    await exigirReparto(ctx.app, c, puente.evento, puente.ordenId, [], 'sala de puente');
  });
});

// ------------------------------------------------------------------------------------------------
// 67 y 69 · Eventos reales de la carta (003) y del salón por este transporte
// ------------------------------------------------------------------------------------------------
describe('criterios 67 y 69 · los eventos reales llegan solo a su sala y no cambian de forma', () => {
  it('carta.actualizada llega a toda la empresa que cambió el producto y a ninguna otra, con su forma de 003', async () => {
    const m = await mundo();
    const c = await conectarTodos(ctx.app, m);
    for (const cliente of Object.values(c)) cliente.limpiar();
    const res = await llamar(ctx, m.tokens.A.adminSin, {
      metodo: 'patch',
      ruta: `/carta/productos/${m.cartaA.gaseosaId}`,
      cuerpo: { precio: '9.50' },
    });
    exigirEstado(res, 200, 'cambiar el precio de la gaseosa');
    const fallos: string[] = [];
    await Promise.all(
      Object.entries(c).map(async ([nombre, cliente]) => {
        if (nombre.startsWith('A.')) {
          try {
            const datos = await cliente.esperarEvento('carta.actualizada', 3000);
            const r = eventoCartaActualizadaDatosSchema.safeParse(datos);
            if (!r.success)
              fallos.push(`${nombre}: forma de carta.actualizada ${JSON.stringify(datos)}`);
          } catch (error) {
            fallos.push(`${nombre}: ${(error as Error).message}`);
          }
        } else {
          try {
            await cliente.noRecibe('carta.actualizada', 600);
          } catch (error) {
            fallos.push(`${nombre}: ${(error as Error).message}`);
          }
        }
      }),
    );
    exigirSinFallos(fallos);
  });

  it('carta.disponibilidad llega solo a las conexiones de la sucursal donde se agotó el producto, con su forma de 003', async () => {
    const m = await mundo();
    const c = await conectarTodos(ctx.app, m);
    for (const cliente of Object.values(c)) cliente.limpiar();
    const ruta = `/carta/sucursal/agotados/${m.cartaA.gaseosaId}`;
    try {
      exigirEstado(
        await llamar(ctx, m.tokens.A.adminS1, {
          metodo: 'put',
          ruta,
          cuerpo: { hasta: 'FIN_DEL_DIA' },
        }),
        200,
        'marcar agotada la gaseosa en S1',
      );
      const fallos: string[] = [];
      await Promise.all(
        Object.entries(c).map(async ([nombre, cliente]) => {
          if (SUCURSAL_1_DE_A.includes(nombre)) {
            try {
              const datos = await cliente.esperarEvento<{ sucursalId: string; productoId: string }>(
                'carta.disponibilidad',
                3000,
              );
              if (!eventoDisponibilidadDatosSchema.safeParse(datos).success) {
                fallos.push(`${nombre}: forma de carta.disponibilidad ${JSON.stringify(datos)}`);
              }
              if (datos.sucursalId !== m.e.A.S1 || datos.productoId !== m.cartaA.gaseosaId) {
                fallos.push(`${nombre}: carta.disponibilidad de otro producto o sucursal`);
              }
            } catch (error) {
              fallos.push(`${nombre}: ${(error as Error).message}`);
            }
          } else {
            try {
              await cliente.noRecibe('carta.disponibilidad', 600);
            } catch (error) {
              fallos.push(`${nombre}: ${(error as Error).message}`);
            }
          }
        }),
      );
      exigirSinFallos(fallos);
    } finally {
      await llamar(ctx, m.tokens.A.adminS1, { metodo: 'delete', ruta });
    }
  });

  it('abrir una mesa y enviar la comanda publican salon.cambio, orden.cambio y cocina.comanda solo a la sucursal, en menos de 1 segundo', async () => {
    const m = await mundo();
    const c = await conectarTodos(ctx.app, m);
    const salon = await sembrarSalon(
      ctx,
      m.tokens.A.adminSin,
      m.e.A.S1,
      `t${randomUUID().slice(0, 5)}`,
      2,
    );
    for (const cliente of Object.values(c)) cliente.limpiar();
    const mesa = salon.mesas[0]!;
    const apertura = await abrirOrden(ctx, m.tokens.A.mozoS1, { mesaId: mesa.id, comensales: 2 });
    exigirEstado(apertura, 201, 'abrir la mesa');
    const ordenId = apertura.body.id as string;
    const fallos: string[] = [];
    await Promise.all(
      Object.entries(c).map(async ([nombre, cliente]) => {
        if (SUCURSAL_1_DE_A.includes(nombre)) {
          try {
            const salon = await cliente.esperarEvento<{ mesaIds: string[]; ordenId: string }>(
              'salon.cambio',
              1000,
            );
            if (!eventoSalonCambioDatosSchema.safeParse(salon).success) {
              fallos.push(`${nombre}: forma de salon.cambio ${JSON.stringify(salon)}`);
            }
            if (salon.ordenId !== ordenId || !salon.mesaIds.includes(mesa.id)) {
              fallos.push(`${nombre}: salon.cambio de otra orden o mesa`);
            }
            const orden = await cliente.esperarEvento('orden.cambio', 1000);
            if (!eventoOrdenCambioDatosSchema.safeParse(orden).success) {
              fallos.push(`${nombre}: forma de orden.cambio ${JSON.stringify(orden)}`);
            }
          } catch (error) {
            fallos.push(`${nombre}: ${(error as Error).message}`);
          }
        } else {
          for (const evento of ['salon.cambio', 'orden.cambio']) {
            try {
              await cliente.noRecibe(evento, 500);
            } catch (error) {
              fallos.push(`${nombre}: ${(error as Error).message}`);
            }
          }
        }
      }),
    );
    exigirSinFallos(fallos);

    for (const cliente of Object.values(c)) cliente.limpiar();
    const envio = await enviar(ctx, m.tokens.A.mozoS1, ordenId, [lineaLomo(m.cartaA)]);
    exigirEstado(envio, 201, 'enviar la comanda');
    const comandas = envio.body.comandas as { id: string; estacionId: string; tipo: string }[];
    expect(comandas.length).toBeGreaterThan(0);
    const fallosEnvio: string[] = [];
    await Promise.all(
      Object.entries(c).map(async ([nombre, cliente]) => {
        if (SUCURSAL_1_DE_A.includes(nombre)) {
          try {
            const datos = await cliente.esperarEvento<{ comandaId: string }>(
              'cocina.comanda',
              1000,
            );
            if (!eventoCocinaComandaDatosSchema.safeParse(datos).success) {
              fallosEnvio.push(`${nombre}: forma de cocina.comanda ${JSON.stringify(datos)}`);
            }
            if (!comandas.some((x) => x.id === datos.comandaId)) {
              fallosEnvio.push(`${nombre}: cocina.comanda de otra comanda`);
            }
          } catch (error) {
            fallosEnvio.push(`${nombre}: ${(error as Error).message}`);
          }
        } else {
          try {
            await cliente.noRecibe('cocina.comanda', 500);
          } catch (error) {
            fallosEnvio.push(`${nombre}: ${(error as Error).message}`);
          }
        }
      }),
    );
    exigirSinFallos(fallosEnvio);
  });

  it('un rechazo (id de B) no publica ningún evento a nadie', async () => {
    const m = await mundo();
    const c = await conectarTodos(ctx.app, m);
    const salonB = await sembrarSalon(
      ctx,
      m.tokens.B.adminSin,
      m.e.B.S1,
      `r${randomUUID().slice(0, 5)}`,
      1,
    );
    const ordenDeB = await abrirOrden(ctx, m.tokens.B.adminS1, { mesaId: salonB.mesas[0]!.id });
    exigirEstado(ordenDeB, 201, 'abrir una mesa en B');
    for (const cliente of Object.values(c)) cliente.limpiar();
    const res = await postConClave(ctx, m.tokens.A.adminS1, `/ordenes/${ordenDeB.body.id}/envios`, {
      id: randomUUID(),
      lineas: [lineaLomo(m.cartaA)],
    });
    expect(res.status).toBe(404);
    for (const nombre of ['salon.cambio', 'orden.cambio', 'cocina.comanda']) {
      await Promise.all(Object.values(c).map((cliente) => cliente.noRecibe(nombre, 500)));
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 69 · Tamaño y contenido de cada evento
// ------------------------------------------------------------------------------------------------
const CLAVES_DE_EVENTO: Record<string, string[]> = {
  'salon.cambio': ['mesaIds', 'ordenId'],
  'orden.cambio': ['ordenId'],
  'cocina.comanda': ['comandaId', 'estacionId', 'tipo'],
  'cocina.linea': ['comandaId', 'lineaId', 'estado'],
  'cocina.listo': ['cantidad', 'destinatarios', 'itemId', 'lineaId', 'mesas', 'nombre', 'ordenId'],
};

describe('criterio 69 · cada evento pesa menos de 4 KB y lleva solo ids, estados y nombres', () => {
  it('en el peor caso (20 mesas unidas, producto de 100 caracteres, mesas de 20 caracteres) cada evento del salón y de la cocina cumple su forma y su tamaño', async () => {
    const m = await mundo();
    const tokenS3 = await sesionContrasena(ctx, m.e.A.base.admin, m.e.A.S3!);
    const cliente = await conectar(ctx.app, tokenS3);
    const zona = await llamar(ctx, m.tokens.A.adminSin, {
      metodo: 'post',
      ruta: `/sucursales/${m.e.A.S3}/zonas`,
      cuerpo: { nombre: 'Zona grande', columnas: 12, filas: 2 },
    });
    exigirEstado(zona, 201, 'crear la zona grande');
    const mesas: { id: string; nombre: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const nombre = `M${i}-${randomUUID().replace(/-/g, '').slice(0, 15)}`;
      const res = await llamar(ctx, m.tokens.A.adminSin, {
        metodo: 'post',
        ruta: `/sucursales/${m.e.A.S3}/zonas/${zona.body.id}/mesas`,
        cuerpo: {
          nombre,
          capacidad: 4,
          forma: 'REDONDA',
          columna: (i % 12) + 1,
          fila: Math.floor(i / 12) + 1,
        },
      });
      exigirEstado(res, 201, `crear la mesa ${nombre}`);
      mesas.push({ id: res.body.id as string, nombre });
    }
    const nombreLargo = 'X'.repeat(100);
    const largo = await llamar(ctx, m.tokens.A.adminSin, {
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: {
        tipo: 'SIMPLE',
        nombre: nombreLargo,
        familiaId: m.cartaA.familiaId,
        precio: '5.00',
        estacionId: m.cartaA.cocinaId,
        tipoControlStock: 'SIN_CONTROL',
      },
    });
    exigirEstado(largo, 201, 'crear el producto de nombre largo');

    cliente.limpiar();
    const apertura = await abrirOrden(ctx, tokenS3, { mesaId: mesas[0]!.id, comensales: 99 });
    exigirEstado(apertura, 201, 'abrir la mesa');
    const ordenId = apertura.body.id as string;
    const union = await postConClave(ctx, tokenS3, `/ordenes/${ordenId}/union`, {
      mesaIds: mesas.slice(1).map((x) => x.id),
    });
    exigirEstado(union, 200, 'unir 19 mesas');
    const envio = await enviar(ctx, tokenS3, ordenId, [
      { productoId: largo.body.id as string, modificadorIds: [], cantidad: 999 },
    ]);
    exigirEstado(envio, 201, 'enviar el producto de nombre largo');
    const lineas = await admin.query<{ id: string; comanda_id: string }>(
      `SELECT l.id, l.comanda_id FROM comanda_linea l JOIN comanda c ON c.id = l.comanda_id AND c.empresa_id = l.empresa_id
        WHERE c.orden_id = $1 AND l.empresa_id = $2`,
      [ordenId, m.e.A.empresaId],
    );
    expect(lineas.rowCount).toBeGreaterThan(0);
    const estado = await llamar(ctx, tokenS3, {
      metodo: 'put',
      ruta: `/cocina/lineas/${lineas.rows[0]!.id}/estado`,
      cuerpo: { estado: 'LISTO' },
    });
    exigirEstado(estado, 200, 'marcar la línea lista');
    const itemId = (envio.body.items as { id: string }[])[0]!.id;
    const anulacion = await postConClave(
      ctx,
      tokenS3,
      `/ordenes/${ordenId}/items/${itemId}/anulaciones`,
      {
        id: randomUUID(),
        cantidad: 500,
        motivo: 'Error de toma',
        destinoStock: 'MERMA',
      },
    );
    exigirEstado(anulacion, 201, 'anular parte');
    await new Promise((resolver) => setTimeout(resolver, 600));

    const vistos = new Set<string>();
    const fallos: string[] = [];
    for (const evento of cliente.eventos()) {
      vistos.add(evento.nombre);
      const claves = CLAVES_DE_EVENTO[evento.nombre];
      if (claves === undefined) {
        fallos.push(`evento inesperado: ${evento.nombre}`);
        continue;
      }
      const peso = Buffer.byteLength(JSON.stringify(evento.datos));
      if (peso >= 4096) fallos.push(`${evento.nombre} pesa ${peso} bytes (el límite es 4096)`);
      const llaves = Object.keys(evento.datos as object).sort();
      if (JSON.stringify(llaves) !== JSON.stringify(claves)) {
        fallos.push(
          `${evento.nombre} trae ${llaves.join(', ')} y se esperaba ${claves.join(', ')}`,
        );
      }
      const esquema = {
        'salon.cambio': eventoSalonCambioDatosSchema,
        'orden.cambio': eventoOrdenCambioDatosSchema,
        'cocina.comanda': eventoCocinaComandaDatosSchema,
        'cocina.linea': eventoCocinaLineaDatosSchema,
        'cocina.listo': eventoCocinaListoDatosSchema,
      }[evento.nombre];
      if (esquema && !esquema.safeParse(evento.datos).success) {
        fallos.push(
          `${evento.nombre} no cumple su esquema: ${JSON.stringify(evento.datos).slice(0, 200)}`,
        );
      }
    }
    for (const nombre of Object.keys(CLAVES_DE_EVENTO)) {
      if (!vistos.has(nombre)) fallos.push(`no llegó ningún ${nombre} en el recorrido`);
    }
    exigirSinFallos(fallos);
    const peor = cliente
      .eventos('salon.cambio')
      .find((e) => (e.datos as { mesaIds: string[] }).mesaIds.length >= 20);
    expect(peor, 'un salon.cambio con las 20 mesas').toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------
// 66 · Desconexión al cerrar la sesión, cambiar de usuario, revocar y cambiar de sucursal
// ------------------------------------------------------------------------------------------------
describe('criterio 66 · se desconectan las conexiones de una sesión que se cierra o cambia', () => {
  it('DELETE /sesion desconecta a esa sesión y no a otra sesión de la misma persona', async () => {
    const m = await mundo();
    const propia = await sesionContrasena(ctx, m.e.A.mozo, m.e.A.S1);
    const otra = await sesionContrasena(ctx, m.e.A.mozo, m.e.A.S1);
    const cerrada = await conectar(ctx.app, propia);
    const abierta = await conectar(ctx.app, otra);
    exigirEstado(
      await llamar(ctx, propia, { metodo: 'delete', ruta: '/sesion' }),
      204,
      'cerrar la sesión',
    );
    await cerrada.esperarDesconexion(3000);
    expect(cerrada.conectado).toBe(false);
    const evento = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S1 });
    await publicar(ctx.app, evento.evento);
    expect(await abierta.esperarEvento<{ ordenId: string }>('orden.cambio')).toEqual({
      ordenId: evento.ordenId,
    });
    expect(abierta.conectado).toBe(true);
  });

  it('el cambio rápido de usuario con PIN en el mismo equipo desconecta al usuario anterior y no al nuevo', async () => {
    const m = await mundo();
    const equipo = await equipoDe(ctx, m.e.A.mozo);
    const contrasenaCajero = await sesionContrasena(ctx, m.e.A.cajero, null);
    await recordarEquipo(ctx, contrasenaCajero, { tokenEquipo: equipo });
    const pinMozo = await sesionPin(ctx, m.e.A.mozo, equipo, m.e.A.S1);
    const anterior = await conectar(ctx.app, pinMozo, equipo);
    const pinCajero = await sesionPin(ctx, m.e.A.cajero, equipo, m.e.A.S1);
    await anterior.esperarDesconexion(3000);
    const nuevo = await conectar(ctx.app, pinCajero, equipo);
    expect(nuevo.conectado).toBe(true);
    // Control: la sesión de contraseña del cajero en otro equipo no se toca.
    const deContrasena = await conectar(ctx.app, contrasenaCajero);
    expect(deContrasena.conectado).toBe(true);
    const evento = ordenCambio(m.e.A.empresaId, { tipo: 'empresa' });
    await publicar(ctx.app, evento.evento);
    expect(await nuevo.esperarEvento<{ ordenId: string }>('orden.cambio')).toEqual({
      ordenId: evento.ordenId,
    });
  });

  it('cambiar de sucursal activa desconecta la conexión; al reconectar con la misma sesión solo recibe lo de la sucursal nueva', async () => {
    const m = await mundo();
    const token = await sesionContrasena(ctx, m.e.A.cajero, m.e.A.S1);
    const primera = await conectar(ctx.app, token);
    const cambio = await llamar(ctx, token, {
      metodo: 'put',
      ruta: '/sesion/sucursal',
      cuerpo: { sucursalId: m.e.A.S2 },
    });
    exigirEstado(cambio, 200, 'cambiar a S2');
    await primera.esperarDesconexion(3000);
    const segunda = await conectar(ctx.app, token);
    const deS1 = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S1 });
    await publicar(ctx.app, deS1.evento);
    await segunda.noRecibe('orden.cambio', 500);
    const deS2 = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S2 });
    await publicar(ctx.app, deS2.evento);
    expect(await segunda.esperarEvento<{ ordenId: string }>('orden.cambio')).toEqual({
      ordenId: deS2.ordenId,
    });
  });

  it('revocar los equipos recordados de la persona desconecta sus sesiones de PIN de esos equipos', async () => {
    const m = await mundo();
    const persona = await crearPersona(ctx, m.tokens.A.adminSin, [
      { sucursalId: m.e.A.S1, rol: 'MOZO' },
    ]);
    const equipo = await equipoDe(ctx, persona);
    const token = await sesionPin(ctx, persona, equipo, m.e.A.S1);
    const cliente = await conectar(ctx.app, token, equipo);
    const revocacion = await llamar(ctx, m.tokens.A.adminSin, {
      metodo: 'delete',
      ruta: `/usuarios/${persona.id}/equipos`,
    });
    exigirEstado(revocacion, 204, 'revocar los equipos');
    await cliente.esperarDesconexion(3000);
  });

  it('desactivar a la persona desconecta todas sus sesiones', async () => {
    const m = await mundo();
    const persona = await crearPersona(ctx, m.tokens.A.adminSin, [
      { sucursalId: m.e.A.S1, rol: 'MOZO' },
    ]);
    const cliente = await conectar(ctx.app, await sesionContrasena(ctx, persona, m.e.A.S1));
    const baja = await llamar(ctx, m.tokens.A.adminSin, {
      metodo: 'patch',
      ruta: `/usuarios/${persona.id}`,
      cuerpo: { activo: false },
    });
    exigirEstado(baja, 200, 'desactivar a la persona');
    await cliente.esperarDesconexion(3000);
  });
});

// ------------------------------------------------------------------------------------------------
// 68 · Varias instancias
// ------------------------------------------------------------------------------------------------
describe('criterio 68 · dos instancias de la API contra la misma base', () => {
  let ctx2: AppP4;

  beforeAll(async () => {
    ctx2 = await arrancarP4({ poolMax: 2, tiempoReal: true, reloj });
  });

  afterAll(async () => {
    for (const cliente of abiertos.splice(0)) cliente.cerrar();
    await ctx2?.cerrar();
  });

  /** Clientes repartidos entre las dos instancias. */
  async function repartidos(m: Mundo): Promise<{ clientes: Conectados; deLaInstancia2: string[] }> {
    const clientes: Conectados = {};
    const deLaInstancia2: string[] = [];
    const entradas = [
      ...Object.entries(m.tokens.A).map(([n, t]) => [`A.${n}`, t] as const),
      ...Object.entries(m.tokens.B).map(([n, t]) => [`B.${n}`, t] as const),
    ];
    for (const [indice, [nombre, token]] of entradas.entries()) {
      const enLaSegunda = indice % 2 === 1;
      clientes[nombre] = await conectar(enLaSegunda ? ctx2.app : ctx.app, token);
      if (enLaSegunda) deLaInstancia2.push(nombre);
    }
    return { clientes, deLaInstancia2 };
  }

  it('un evento publicado por una instancia llega a los clientes de las dos, con las mismas reglas de sala', async () => {
    const m = await mundo();
    const { clientes, deLaInstancia2 } = await repartidos(m);
    expect(deLaInstancia2.length).toBeGreaterThan(2);
    const reciben = (lista: string[]) => lista.filter((n) => n in clientes);
    for (const desde of [ctx.app, ctx2.app]) {
      const empresaA = ordenCambio(m.e.A.empresaId, { tipo: 'empresa' });
      await exigirReparto(
        ctx.app,
        clientes,
        empresaA.evento,
        empresaA.ordenId,
        reciben(TODOS_DE_A),
        'empresa A',
        desde,
      );
      const s1 = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S1 });
      await exigirReparto(
        ctx.app,
        clientes,
        s1.evento,
        s1.ordenId,
        reciben(SUCURSAL_1_DE_A),
        'sucursal 1 de A',
        desde,
      );
      const s2 = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S2 });
      await exigirReparto(
        ctx.app,
        clientes,
        s2.evento,
        s2.ordenId,
        reciben(SUCURSAL_2_DE_A),
        'sucursal 2 de A',
        desde,
      );
      const deB = ordenCambio(m.e.B.empresaId, { tipo: 'empresa' });
      await exigirReparto(
        ctx.app,
        clientes,
        deB.evento,
        deB.ordenId,
        reciben(TODOS_DE_B),
        'empresa B',
        desde,
      );
      const cruzado = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.B.S1 });
      await exigirReparto(
        ctx.app,
        clientes,
        cruzado.evento,
        cruzado.ordenId,
        [],
        'empresa A con sucursal de B',
        desde,
      );
    }
  });

  it('una operación hecha en una instancia (agotar un producto) llega por el adaptador a los clientes de la otra', async () => {
    const m = await mundo();
    const enLaSegunda = await conectar(ctx2.app, m.tokens.A.mozoS1);
    const deOtraSucursal = await conectar(ctx2.app, m.tokens.A.adminS2);
    const deB = await conectar(ctx2.app, m.tokens.B.adminS1);
    const ruta = `/carta/sucursal/agotados/${m.cartaA.gaseosaId}`;
    try {
      exigirEstado(
        await llamar(ctx, m.tokens.A.adminS1, {
          metodo: 'put',
          ruta,
          cuerpo: { hasta: 'FIN_DEL_DIA' },
        }),
        200,
        'agotar en la instancia 1',
      );
      const datos = await enLaSegunda.esperarEvento<{ productoId: string }>(
        'carta.disponibilidad',
        3000,
      );
      expect(datos.productoId).toBe(m.cartaA.gaseosaId);
      await deOtraSucursal.noRecibe('carta.disponibilidad', 600);
      await deB.noRecibe('carta.disponibilidad', 100);
    } finally {
      await llamar(ctx, m.tokens.A.adminS1, { metodo: 'delete', ruta });
    }
  });

  it('cerrar la sesión en una instancia desconecta al cliente que estaba en la otra', async () => {
    const m = await mundo();
    const token = await sesionContrasena(ctx, m.e.A.mozo, m.e.A.S1);
    const cliente = await conectar(ctx2.app, token);
    exigirEstado(
      await llamar(ctx, token, { metodo: 'delete', ruta: '/sesion' }),
      204,
      'cerrar la sesión',
    );
    await cliente.esperarDesconexion(3000);
  });
});

// ------------------------------------------------------------------------------------------------
// 86 · Eventos con peticiones concurrentes y un pool de 2
// ------------------------------------------------------------------------------------------------
describe('criterio 86 · 100 envíos concurrentes de A y de B con un pool de 2: cada evento llega solo a su empresa', () => {
  it('el cliente de A solo recibe eventos de A, el de B solo de B, y uno por cada envío', async () => {
    const m = await mundo();
    const cA = await conectar(ctx.app, m.tokens.A.adminS1);
    const cB = await conectar(ctx.app, m.tokens.B.adminS1);
    // Una mesa abierta por empresa: a ella van los 100 envíos.
    const preparar = async (
      e: EscenarioCarta['A'],
      tokenAdmin: string,
      tokenS1: string,
      carta: CartaEjemplo,
    ) => {
      const salon = await sembrarSalon(ctx, tokenAdmin, e.S1, `c${randomUUID().slice(0, 5)}`, 1);
      const apertura = await abrirOrden(ctx, tokenS1, { mesaId: salon.mesas[0]!.id });
      exigirEstado(apertura, 201, 'abrir la mesa');
      return { ordenId: apertura.body.id as string, tokenS1, carta };
    };
    const empresas = [
      await preparar(m.e.A, m.tokens.A.adminSin, m.tokens.A.adminS1, m.cartaA),
      await preparar(m.e.B, m.tokens.B.adminSin, m.tokens.B.adminS1, m.cartaB),
    ] as const;
    cA.limpiar();
    cB.limpiar();
    const enviados: [number, number] = [0, 0];
    const respuestas = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const quien = (i % 2) as 0 | 1;
        const e = empresas[quien];
        const res = await enviar(ctx, e.tokenS1, e.ordenId, [lineaLomo(e.carta)]);
        if (res.status === 201) enviados[quien]++;
        return `#${i} (${quien === 0 ? 'A' : 'B'}) ${res.status}`;
      }),
    );
    expect(respuestas.filter((r) => !r.endsWith('201'))).toEqual([]);
    expect(enviados).toEqual([50, 50]);
    await vi.waitFor(
      () => {
        expect(cA.eventos('orden.cambio')).toHaveLength(50);
        expect(cB.eventos('orden.cambio')).toHaveLength(50);
      },
      { timeout: 10_000, interval: 100 },
    );
    await new Promise((resolver) => setTimeout(resolver, 500));
    const idsA = await idsDeEmpresaSalon(admin, m.e.A.empresaId);
    const idsB = await idsDeEmpresaSalon(admin, m.e.B.empresaId);
    for (const [nombre, cliente, propios, ajenos, propia] of [
      ['A', cA, idsA, idsB, empresas[0]] as const,
      ['B', cB, idsB, idsA, empresas[1]] as const,
    ]) {
      for (const evento of cliente.eventos()) {
        const ids = uuidsEn(JSON.stringify(evento.datos));
        expect(
          ids.filter((id) => ajenos.has(id)),
          `${nombre}: ${evento.nombre} con ids de la otra empresa`,
        ).toEqual([]);
        expect(
          ids.filter((id) => !propios.has(id)),
          `${nombre}: ${evento.nombre} con ids desconocidos`,
        ).toEqual([]);
      }
      expect(
        cliente
          .eventos('orden.cambio')
          .every((e) => (e.datos as { ordenId: string }).ordenId === propia.ordenId),
      ).toBe(true);
      expect(cliente.eventos('cocina.comanda')).toHaveLength(50);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 70 · Canal lateral de PostgreSQL: guarda de nombres
// ------------------------------------------------------------------------------------------------
describe('criterio 70 · la guarda de la API rechaza antes de la base los nombres del canal lateral', () => {
  let sequelize: Sequelize;
  let contexto: ContextoEmpresa;
  let empresaId: string;
  let sucursales: string[];

  beforeAll(async () => {
    const m = await mundo();
    sequelize = ctx.app.get<Sequelize>(CONEXION_API);
    contexto = ctx.app.get(ContextoEmpresa);
    empresaId = m.e.A.empresaId;
    sucursales = [m.e.A.S1, m.e.A.S2, m.e.A.S3!].sort();
  });

  type Fila = { id: string };
  const describir = (valor: unknown) =>
    valor instanceof Error ? `${valor.constructor.name}: ${valor.message}` : String(valor);

  /**
   * Corre `sql` dentro de `ejecutar(A)` y luego un SELECT sobre sucursal en la misma transacción. Devuelve un
   * texto con el problema, o `null` si la sentencia se rechazó antes de la base y la transacción sigue sana.
   */
  async function problemaAlRechazar(sql: string): Promise<string | null> {
    const visto = await contexto.ejecutar(empresaId, async () => {
      let error: unknown;
      try {
        await sequelize.query(sql);
      } catch (e) {
        error = e;
      }
      let lectura: Fila[] | string;
      try {
        lectura = await sequelize.query<Fila>('SELECT id FROM sucursal', {
          type: QueryTypes.SELECT,
        });
      } catch (e) {
        lectura = describir(e);
      }
      return { error, lectura };
    });
    if (visto.error === undefined) return 'la sentencia tuvo éxito (no se rechazó)';
    if (visto.error instanceof DatabaseError) return `llegó a la base: ${describir(visto.error)}`;
    if (!(visto.error instanceof Error))
      return `se lanzó un valor que no es un Error: ${String(visto.error)}`;
    if (typeof visto.lectura === 'string') return `el SELECT posterior falló: ${visto.lectura}`;
    const vistos = visto.lectura.map((f) => f.id).sort();
    if (JSON.stringify(vistos) !== JSON.stringify(sucursales)) {
      return `el SELECT posterior no devolvió solo las filas de A: ${vistos.join(',')}`;
    }
    return null;
  }

  it.each(ENTRADAS_TIEMPO_REAL.map((e) => [e.nombre, e] as const))(
    '%s se rechaza en todas sus variantes y el SELECT posterior solo ve filas de A',
    async (_nombre, entrada) => {
      const problemas: string[] = [];
      for (const [descripcion, sql] of variantes(entrada)) {
        const problema = await problemaAlRechazar(sql);
        if (problema !== null)
          problemas.push(`[${descripcion}] ${JSON.stringify(sql)} → ${problema}`);
      }
      expect(problemas, problemas.join('\n')).toEqual([]);
    },
  );

  it('control · pg_advisory_xact_lock sigue permitido y no se confunde con los cerrojos de sesión', async () => {
    const filas = await contexto.ejecutar(empresaId, async () => {
      await sequelize.query('SELECT pg_advisory_xact_lock(424242424243)');
      return sequelize.query<Fila>('SELECT id FROM sucursal', { type: QueryTypes.SELECT });
    });
    expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
  });

  it.each(CONTROLES_ALIAS_TIEMPO_REAL)(
    'control · el alias %s (que contiene un nombre dentro de otro identificador) se ejecuta',
    async (alias) => {
      const filas = await contexto.ejecutar(empresaId, async () => {
        await sequelize.query(`SELECT 1 AS ${alias}`);
        return sequelize.query<Fila>('SELECT id FROM sucursal', { type: QueryTypes.SELECT });
      });
      expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
    },
  );

  it.each([
    [
      'comillas simples',
      `'pg_notify pg_listening_channels pg_locks pg_blocking_pids pg_advisory_lock'`,
    ],
    ['E-string', `E'pg_notify pg_try_advisory_lock_shared pg_advisory_unlock_all'`],
    ['comillas de dólar', `$$pg_notify('c', 'x'); pg_advisory_lock(1)$$`],
    ['comillas de dólar con etiqueta', `$q$pg_safe_snapshot_blocking_pids pg_locks$q$`],
  ])(
    'control · un UPDATE con un literal (%s) con esos nombres guarda el valor tal cual',
    async (_nombre, literal) => {
      const esperado = (await admin.query<{ v: string }>(`SELECT ${literal} AS v`)).rows[0]!.v;
      await contexto.ejecutar(
        empresaId,
        () =>
          sequelize.query(
            `UPDATE sucursal SET direccion = ${literal} WHERE id = '${sucursales[0]}'`,
          ),
        { actor: { sistema: 'prueba' } },
      );
      const { rows } = await admin.query<{ direccion: string }>(
        'SELECT direccion FROM sucursal WHERE id = $1',
        [sucursales[0]],
      );
      expect(rows[0]!.direccion).toBe(esperado);
    },
  );

  it.each([
    `/* pg_notify pg_locks pg_advisory_lock */ SELECT id FROM sucursal`,
    `-- pg_listening_channels pg_blocking_pids\nSELECT id FROM sucursal`,
    `SELECT id FROM sucursal /* pg_try_advisory_lock pg_advisory_unlock_all */`,
  ])(
    'control · un comentario con esos nombres antes o después de un SELECT no se rechaza: %j',
    async (sql) => {
      const filas = await contexto.ejecutar(empresaId, () =>
        sequelize.query<Fila>(sql, { type: QueryTypes.SELECT }),
      );
      expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
    },
  );
});

// ------------------------------------------------------------------------------------------------
// 70 · El rol y el esquema del adaptador
// ------------------------------------------------------------------------------------------------
describe('criterio 70 · el rol restaurante_tiempo_real y el esquema tiempo_real', () => {
  const ROL = 'restaurante_tiempo_real';
  const { api, plataforma, migrador } = NOMBRES_DE_ROLES;

  it('el rol es de aplicación: LOGIN, sin superusuario, BYPASSRLS, CREATEROLE ni CREATEDB, sin membresías y sin objetos propios', async () => {
    const rol = await admin.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = $1`,
      [ROL],
    );
    expect(rol.rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolcanlogin: true,
      },
    ]);
    const membresias = await admin.query(
      `SELECT g.rolname FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid
        WHERE r.rolname = $1`,
      [ROL],
    );
    expect(membresias.rows).toEqual([]);
    const objetos = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1`,
      [ROL],
    );
    expect(objetos.rows).toEqual([]);
    const funciones = await admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = $1`,
      [ROL],
    );
    expect(funciones.rows).toEqual([]);
  });

  it('no tiene ningún privilegio sobre las tablas de public ni sobre el esquema, y no puede leerlas', async () => {
    const privilegios = await admin.query<{ tabla: string; privilegio: string }>(
      `SELECT c.relname AS tabla, p.privilegio
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilegio)
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege($1, c.oid, p.privilegio)`,
      [ROL],
    );
    expect(privilegios.rows).toEqual([]);
    const esquema = await admin.query<{ uso: boolean; crear: boolean }>(
      `SELECT has_schema_privilege($1, 'public', 'USAGE') AS uso, has_schema_privilege($1, 'public', 'CREATE') AS crear`,
      [ROL],
    );
    expect(esquema.rows).toEqual([{ uso: false, crear: false }]);
    const cliente = await abrirCliente('tiempoReal');
    try {
      for (const tabla of ['empresa', 'sucursal', 'orden', 'auditoria']) {
        const error = await cliente.query(`SELECT 1 FROM public.${tabla}`).then(
          () => null,
          (e: { code?: string }) => e,
        );
        expect(error?.code, `SELECT sobre ${tabla}`).toBe('42501');
      }
    } finally {
      await cliente.end();
    }
  });

  it('el esquema tiempo_real es del migrador, con USAGE solo para el rol del adaptador', async () => {
    const duenoEsquema = await admin.query<{ dueno: string }>(
      `SELECT r.rolname AS dueno FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE n.nspname = 'tiempo_real'`,
    );
    expect(duenoEsquema.rows, 'el esquema tiempo_real existe').toEqual([{ dueno: migrador }]);
    const concedidos = await admin.query<{ grantee: string; privilegio: string }>(
      `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE (SELECT rolname FROM pg_roles WHERE oid = a.grantee) END AS grantee,
              a.privilege_type AS privilegio
         FROM pg_namespace n, aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE n.nspname = 'tiempo_real'`,
    );
    const ajenos = concedidos.rows.filter((f) => f.grantee !== migrador && f.grantee !== ROL);
    expect(ajenos, 'nadie más tiene privilegios sobre el esquema').toEqual([]);
    expect(concedidos.rows.filter((f) => f.grantee === ROL).map((f) => f.privilegio)).toContain(
      'USAGE',
    );
    for (const otro of [api, plataforma]) {
      const r = await admin.query<{ uso: boolean }>(
        `SELECT has_schema_privilege($1, 'tiempo_real', 'USAGE') AS uso`,
        [otro],
      );
      expect(r.rows[0]!.uso, `${otro} no tiene USAGE sobre tiempo_real`).toBe(false);
    }
  });

  it('socket_io_attachments (id, created_at, payload) es del migrador: el rol del adaptador puede SELECT, INSERT y DELETE, y la API y plataforma nada', async () => {
    const tabla = 'tiempo_real.socket_io_attachments';
    const columnas = await admin.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'tiempo_real' AND table_name = 'socket_io_attachments' ORDER BY column_name`,
    );
    expect(columnas.rows).toEqual([
      { column_name: 'created_at', data_type: 'timestamp with time zone' },
      { column_name: 'id', data_type: 'bigint' },
      { column_name: 'payload', data_type: 'bytea' },
    ]);
    const dueno = await admin.query<{ dueno: string }>(
      `SELECT r.rolname AS dueno FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.oid = $1::regclass`,
      [tabla],
    );
    expect(dueno.rows).toEqual([{ dueno: migrador }]);
    const puede = async (rol: string, privilegio: string) =>
      (
        await admin.query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
          rol,
          tabla,
          privilegio,
        ])
      ).rows[0]!.ok;
    expect(await puede(ROL, 'SELECT')).toBe(true);
    expect(await puede(ROL, 'INSERT')).toBe(true);
    expect(await puede(ROL, 'DELETE')).toBe(true);
    expect(await puede(ROL, 'UPDATE')).toBe(false);
    for (const otro of [api, plataforma]) {
      for (const privilegio of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await puede(otro, privilegio), `${otro} ${privilegio}`).toBe(false);
      }
    }
  });

  it('el rol del adaptador inserta, lee y borra mensajes en la tabla, y la API no puede leerla', async () => {
    const cliente = await abrirCliente('tiempoReal');
    try {
      await cliente.query('BEGIN');
      const insertado = await cliente.query<{ id: string }>(
        `INSERT INTO tiempo_real.socket_io_attachments (payload) VALUES ('\\x0102') RETURNING id`,
      );
      expect(insertado.rowCount).toBe(1);
      const leido = await cliente.query(
        `SELECT payload FROM tiempo_real.socket_io_attachments WHERE id = $1`,
        [insertado.rows[0]!.id],
      );
      expect(leido.rowCount).toBe(1);
      const borrado = await cliente.query(
        `DELETE FROM tiempo_real.socket_io_attachments WHERE id = $1`,
        [insertado.rows[0]!.id],
      );
      expect(borrado.rowCount).toBe(1);
      await cliente.query('ROLLBACK');
    } finally {
      await cliente.end();
    }
    const apiCliente = await abrirCliente('api');
    try {
      const error = await apiCliente.query('SELECT 1 FROM tiempo_real.socket_io_attachments').then(
        () => null,
        (e: { code?: string }) => e,
      );
      expect(error?.code).toBe('42501');
    } finally {
      await apiCliente.end();
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 70 · El arranque rechaza un rol privilegiado en DATABASE_TIEMPO_REAL_URL
// ------------------------------------------------------------------------------------------------
describe('criterio 70 · el arranque rechaza roles privilegiados en DATABASE_TIEMPO_REAL_URL', () => {
  const { migrador } = NOMBRES_DE_ROLES;
  const sufijo = randomUUID().replace(/-/g, '').slice(0, 10);
  const rolBypass = `prueba_tr_bypass_${sufijo}`;
  const rolMiembro = `prueba_tr_miembro_${sufijo}`;
  const contrasena = `pw_${randomUUID()}`;
  let adminLocal: Client;
  let escrituras: ReturnType<typeof vi.spyOn>[] = [];

  beforeAll(async () => {
    adminLocal = await abrirCliente('admin');
    await adminLocal.query(
      `CREATE ROLE ${rolBypass} LOGIN BYPASSRLS PASSWORD ${adminLocal.escapeLiteral(contrasena)}`,
    );
    await adminLocal.query(
      `CREATE ROLE ${rolMiembro} LOGIN NOSUPERUSER NOBYPASSRLS INHERIT PASSWORD ${adminLocal.escapeLiteral(contrasena)} IN ROLE ${migrador}`,
    );
    for (const rol of [rolBypass, rolMiembro]) {
      await adminLocal.query(
        `GRANT CONNECT ON DATABASE ${adminLocal.escapeIdentifier(BASE_DE_PRUEBA)} TO ${rol}`,
      );
    }
  });

  afterAll(async () => {
    try {
      for (const rol of [rolBypass, rolMiembro]) {
        await adminLocal.query(
          `REVOKE ALL ON DATABASE ${adminLocal.escapeIdentifier(BASE_DE_PRUEBA)} FROM ${rol}`,
        );
        await adminLocal.query(`DROP ROLE IF EXISTS ${rol}`);
      }
    } finally {
      await adminLocal.end();
    }
  });

  afterEach(() => {
    for (const espia of escrituras) espia.mockRestore();
    escrituras = [];
    fijarEntornoDePrueba();
  });

  const urlConRol = (rol: string): string => {
    const url = new URL(urlDeRol('tiempoReal'));
    url.username = rol;
    url.password = contrasena;
    return url.toString();
  };

  /** Intenta arrancar la API con el tiempo real habilitado; devuelve el texto del error, o `null` si arrancó. */
  async function intentarArrancar(url: string): Promise<string | null> {
    fijarEntornoDePrueba({ extra: { DATABASE_TIEMPO_REAL_URL: url } });
    let registro = '';
    escrituras = [
      vi.spyOn(process.stdout, 'write').mockImplementation(((trozo: string | Uint8Array) => {
        registro += String(trozo);
        return true;
      }) as typeof process.stdout.write),
      vi.spyOn(process.stderr, 'write').mockImplementation(((trozo: string | Uint8Array) => {
        registro += String(trozo);
        return true;
      }) as typeof process.stderr.write),
    ];
    try {
      const app = await crearAplicacion({
        logger: ['error', 'warn', 'log'],
        tiempoReal: { habilitado: true },
      });
      await app.close();
      return null;
    } catch (error) {
      return `${error instanceof Error ? error.message : String(error)}\n${registro}`;
    } finally {
      for (const espia of escrituras) espia.mockRestore();
      escrituras = [];
    }
  }

  const casos: { motivo: string; url: () => string; rol: () => string; atributo: RegExp }[] = [
    {
      motivo: 'superusuario',
      url: () => urlDeRol('admin'),
      rol: () => decodeURIComponent(new URL(urlDeRol('admin')).username),
      atributo: /superusuario|superuser/i,
    },
    {
      motivo: 'BYPASSRLS',
      url: () => urlConRol(rolBypass),
      rol: () => rolBypass,
      atributo: /bypassrls/i,
    },
    {
      motivo: 'dueño de una tabla de public',
      url: () => urlDeRol('migrador'),
      rol: () => migrador,
      atributo: /due[ñn]o|owner|propietari/i,
    },
    {
      motivo: 'miembro del migrador',
      url: () => urlConRol(rolMiembro),
      rol: () => rolMiembro,
      atributo: new RegExp(`miembro|member|membres[ií]a|${migrador}`, 'i'),
    },
  ];

  it.each(casos)('un rol $motivo: no arranca y se indica rol y atributo', async (caso) => {
    const texto = await intentarArrancar(caso.url());
    expect(
      texto,
      'la API arrancó con un rol privilegiado en DATABASE_TIEMPO_REAL_URL',
    ).not.toBeNull();
    expect(texto).toContain(caso.rol());
    expect(texto).toMatch(caso.atributo);
  });

  it('control · con restaurante_tiempo_real la API sí arranca', async () => {
    const texto = await intentarArrancar(urlDeRol('tiempoReal'));
    expect(texto).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// 64 y 66 · Con el reloj: la conexión no renueva y la revisión periódica desconecta
// (al final del archivo: adelantan el reloj compartido y las sesiones de arriba dejan de valer)
// ------------------------------------------------------------------------------------------------
describe('criterios 64 y 66 · inactividad y vencimiento (con el reloj de la API)', () => {
  /** Las sesiones de arriba pueden haber vencido con el reloj adelantado: el Administrador entra de nuevo. */
  const adminNuevo = (m: Mundo) => sesionContrasena(ctx, m.e.A.base.admin, null);

  /** Sesión de contraseña de una persona con acceso solo a S1. */
  async function sesionNueva(
    m: Mundo,
  ): Promise<{ token: string; persona: Awaited<ReturnType<typeof crearPersona>> }> {
    const persona = await crearPersona(ctx, await adminNuevo(m), [
      { sucursalId: m.e.A.S1, rol: 'MOZO' },
    ]);
    return { token: await sesionContrasena(ctx, persona, m.e.A.S1), persona };
  }

  it('conectar no renueva la inactividad: a los 29 minutos conecta y a los 31 la sesión ya venció', async () => {
    const m = await mundo();
    const { token } = await sesionNueva(m);
    reloj.avanzar(29 * MINUTO);
    const cliente = await conectar(ctx.app, token);
    expect(cliente.conectado).toBe(true);
    reloj.avanzar(2 * MINUTO);
    const res = await llamar(ctx, token, { metodo: 'get', ruta: '/sesion' });
    expect(
      res.status,
      'si la conexión hubiera renovado la actividad, la sesión seguiría válida',
    ).toBe(401);
    expect((res.body as { codigo?: string }).codigo).toBe('SESION_EXPIRADA');
  });

  it('revisarAhora() desconecta las sesiones de contraseña vencidas (30 minutos) y deja las que se usaron', async () => {
    const m = await mundo();
    const dormida = await sesionNueva(m);
    const activa = await sesionNueva(m);
    const cDormida = await conectar(ctx.app, dormida.token);
    const cActiva = await conectar(ctx.app, activa.token);
    reloj.avanzar(20 * MINUTO);
    exigirEstado(
      await llamar(ctx, activa.token, { metodo: 'get', ruta: '/sesion' }),
      200,
      'la sesión activa se usa',
    );
    reloj.avanzar(11 * MINUTO);
    await ctx.app.get(ServidorTiempoReal).revisarAhora();
    await cDormida.esperarDesconexion(3000);
    expect(cDormida.conectado).toBe(false);
    expect(cActiva.conectado, 'la sesión usada hace 11 minutos sigue conectada').toBe(true);
    const evento = ordenCambio(m.e.A.empresaId, { tipo: 'sucursal', sucursalId: m.e.A.S1 });
    await publicar(ctx.app, evento.evento);
    expect(await cActiva.esperarEvento<{ ordenId: string }>('orden.cambio')).toEqual({
      ordenId: evento.ordenId,
    });
  });

  it('revisarAhora() desconecta una sesión de PIN a los 6 minutos sin uso (5 por defecto) y no a los 4', async () => {
    const m = await mundo();
    const persona = await crearPersona(ctx, await adminNuevo(m), [
      { sucursalId: m.e.A.S1, rol: 'MOZO' },
    ]);
    const equipo = await equipoDe(ctx, persona);
    const token = await sesionPin(ctx, persona, equipo, m.e.A.S1);
    const cliente = await conectar(ctx.app, token, equipo);
    reloj.avanzar(4 * MINUTO);
    await ctx.app.get(ServidorTiempoReal).revisarAhora();
    await cliente.noRecibe('inexistente', 300);
    expect(cliente.conectado, 'a los 4 minutos sigue conectada').toBe(true);
    reloj.avanzar(2 * MINUTO);
    await ctx.app.get(ServidorTiempoReal).revisarAhora();
    await cliente.esperarDesconexion(3000);
  });
});
