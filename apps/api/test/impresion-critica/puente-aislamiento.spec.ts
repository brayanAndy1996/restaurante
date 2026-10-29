// spec: 004-salon-cocina (pruebas protegidas)
//
// P6 (parte 2) · Aislamiento y permisos del puente de impresión (ruta crítica), entrega 3b, criterios 129 a 133 y las
// salas del 110 al 112:
// - 129: toda ruta registrada de `/sucursales/:sucursalId/impresoras…`, `…/estaciones-destino…`, `…/impresion`,
//   `…/vinculaciones-puente`, `…/puentes…`, `/impresion/*` y `/puente/*` está clasificada (la prueba recorre las
//   rutas en Nest y falla si una falta, sobra o tiene otra clasificación): `ADMINISTRAR`, solo `@RequiereSucursal()`
//   para `GET /impresion/estado`, `ATENDER_MESA` para los trabajos y la reimpresión, y la credencial del puente o de
//   vinculación para `/puente/*`; la lista cerrada de rutas públicas de 002 no cambia; cada rol sin permiso recibe
//   403 `PROHIBIDO` con sesión de contraseña y de PIN;
// - 131: las seis tablas nuevas (`impresora`, `estacion_destino`, `impresion_sucursal`, `vinculacion_puente`,
//   `puente`, `trabajo_impresion`) cumplen los criterios 82 a 84: existen; con el contexto de A no se leen,
//   actualizan ni borran filas de B ni se insertan filas con el `empresa_id` de B (rechazo de la política RLS); y
//   una fila de A que apunte a una de B (trabajo con impresora de B, destino con estación o impresora de B, y cada
//   llave foránea compuesta) falla por la llave foránea, igual que con un id inexistente;
// - 132: un puente de S1 de A no recibe trabajos de S2 ni de B, no puede reportar un trabajo de S2 o de B (404 igual
//   que uno inexistente, sin cambios), no ve impresoras de S2 ni de B en la configuración, no cambia con el latido
//   las impresoras de S2 ni de B, y su sala de Socket.IO no recibe avisos de otro puente; un `pu.` de A con la empresa
//   cambiada a B responde 401; las rutas de impresión de la PWA responden como un id inexistente ante ids de B o de
//   otra sucursal;
// - 133: con un pool de 2 conexiones, dos puentes (A y B) que piden trabajos y reportan resultados cien veces cada
//   uno en paralelo solo ven y cambian los suyos.
// Hoy las rutas de 3b responden 500 "No implementado" (sin `@Permiso`), las tablas no existen y el espacio `/puente`
// rechaza toda conexión con "No implementado": las pruebas fallan por eso. La prueba de la lista cerrada de rutas
// públicas y las de los eventos de la PWA que no pasan por el puente son controles que hoy ya pasan.
import { randomUUID } from 'node:crypto';
import {
  configuracionPuenteSchema,
  estadoImpresionRespuestaSchema,
  trabajoParaImprimirSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PERMISO,
  PUBLICA,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from '../../src/modulos/seguridad';
import {
  PUBLICADOR_EVENTOS,
  type EventoPublicable,
  type PublicadorEventos,
} from '../../src/nucleo/eventos';
import {
  METADATO_PUENTE,
  METADATO_SUPERADMINISTRADOR,
  METADATO_VINCULACION_PUENTE,
} from '../../src/nucleo/principal';
import { nuevoSuperadmin, type SuperadminDePrueba } from '../acceso/fabrica-plataforma';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { sesionContrasena, uuidsEn } from '../carta-critica/fabrica-permisos-carta';
import { ClienteTiempoReal } from '../soporte';
import { abrirCliente, rutasDeNest } from '../utilidades';
import {
  PRIVILEGIOS_IMPRESION,
  ROLES_SIN_ADMINISTRAR,
  TABLAS_IMPRESION,
  arrancarP6,
  auditoriaImpresion,
  conClave,
  conEmpresaDe,
  conIdDe,
  conSecretoDe,
  construirMundoP6,
  crearEmpresaP6,
  crearEstacion,
  crearImpresora,
  crearPrueba,
  crearRolesP6,
  cuerpoDe,
  cuerpoImpresora,
  exigirEstado,
  exigirSinFallos,
  existeTabla,
  filasDe,
  instantaneaImpresion,
  listarPuentes,
  llamar,
  llamarPuente,
  nuevoPuente,
  sembrarEmpresaSql,
  trabajosDelPuente,
  unico,
  vaciarCola,
  type AppP6,
  type BaseImpresion,
  type FilasImpresion,
  type MundoP6,
  type Privilegio,
  type PuenteVinculado,
  type TablaImpresion,
} from './fabrica-p6';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP6;
let admin: Client;
let apiCliente: Client;
let sa: SuperadminDePrueba;

beforeAll(async () => {
  ctx = await arrancarP6({ poolMax: 2 });
  admin = await abrirCliente('admin');
  apiCliente = await abrirCliente('api');
  sa = await nuevoSuperadmin(ctx);
});

afterAll(async () => {
  for (const cliente of abiertos.splice(0)) cliente.cerrar();
  await ctx?.cerrar();
  await admin?.end();
  await apiCliente?.end();
});

// ------------------------------------------------------------------------------------------------
// Conexiones de Socket.IO que hay que cerrar
// ------------------------------------------------------------------------------------------------
const abiertos: ClienteTiempoReal[] = [];

afterEach(() => {
  for (const cliente of abiertos.splice(0)) cliente.cerrar();
});

async function conectarPuente(token: string): Promise<ClienteTiempoReal> {
  const cliente = await ClienteTiempoReal.conectar(ctx.app, { token }, { espacio: '/puente' });
  abiertos.push(cliente);
  return cliente;
}

async function conectarPwa(token: string): Promise<ClienteTiempoReal> {
  const cliente = await ClienteTiempoReal.conectar(ctx.app, { token });
  abiertos.push(cliente);
  return cliente;
}

const publicar = (evento: EventoPublicable) =>
  Promise.resolve(
    ctx.app.get<PublicadorEventos>(PUBLICADOR_EVENTOS, { strict: false }).publicar(evento),
  );

type Conectados = Record<string, ClienteTiempoReal>;

/**
 * Después de `accion`, comprueba quién recibe el evento `nombre` (con los datos que da `datos` a partir del resultado de
 * la acción, una sola vez) y quién no. Las conexiones se limpian antes de la acción.
 */
async function exigirReparto<T>(
  clientes: Conectados,
  nombre: string,
  reciben: string[],
  accion: () => Promise<T>,
  datos: (resultado: T) => unknown,
  descripcion: string,
): Promise<void> {
  for (const c of Object.values(clientes)) c.limpiar();
  const resultado = await accion();
  const esperados = datos(resultado);
  const fallos: string[] = [];
  await Promise.all(
    Object.entries(clientes).map(async ([quien, cliente]) => {
      if (reciben.includes(quien)) {
        try {
          const recibido = await cliente.esperarEvento(nombre, 3000);
          if (JSON.stringify(recibido) !== JSON.stringify(esperados)) {
            fallos.push(`${descripcion}: ${quien} recibió ${JSON.stringify(recibido)}`);
          }
          await cliente.noRecibe(nombre, 300);
        } catch (error) {
          fallos.push(`${descripcion}: ${quien} debía recibirlo y: ${(error as Error).message}`);
        }
      } else {
        try {
          await cliente.noRecibe(nombre, 600);
        } catch (error) {
          fallos.push(`${descripcion}: ${quien} no debía recibirlo y: ${(error as Error).message}`);
        }
      }
    }),
  );
  exigirSinFallos(fallos);
}

/** Foto de los trabajos de una empresa (no incluye la fila del puente, que cambia con su señal). */
async function fotoDeTrabajos(empresaId: string): Promise<unknown> {
  if (!(await existeTabla(admin, 'trabajo_impresion'))) return 'SIN_TABLA';
  return filasDe(admin, 'trabajo_impresion', empresaId);
}

// ------------------------------------------------------------------------------------------------
// 129 · Clasificación de las rutas de 3b
// ------------------------------------------------------------------------------------------------

/** `:id`, `:sucursalId`, `:estacionId`… valen lo mismo para comparar con la tabla de endpoints. */
const normal = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, ':p');

/** Las rutas que cubre el criterio 129. */
const esRutaDe3b = (ruta: string): boolean =>
  ruta === '/puente' ||
  ruta.startsWith('/puente/') ||
  ruta === '/impresion' ||
  ruta.startsWith('/impresion/') ||
  /^\/sucursales\/:[A-Za-z]+\/(impresoras|estaciones-destino|impresion|vinculaciones-puente|puentes)(\/|$)/.test(
    ruta,
  );

type ClaseDeRuta = 'ADMINISTRAR' | 'SUCURSAL_ACTIVA' | 'ATENDER_MESA' | 'PUENTE' | 'VINCULACION';

/** La tabla de endpoints de 3b de `spec.md`: 19 rutas. */
const RUTAS_3B: [string, ClaseDeRuta][] = [
  ['GET /sucursales/:p/impresoras', 'ADMINISTRAR'],
  ['POST /sucursales/:p/impresoras', 'ADMINISTRAR'],
  ['PATCH /sucursales/:p/impresoras/:p', 'ADMINISTRAR'],
  ['POST /sucursales/:p/impresoras/:p/prueba', 'ADMINISTRAR'],
  ['GET /sucursales/:p/estaciones-destino', 'ADMINISTRAR'],
  ['PUT /sucursales/:p/estaciones-destino/:p', 'ADMINISTRAR'],
  ['GET /sucursales/:p/impresion', 'ADMINISTRAR'],
  ['PUT /sucursales/:p/impresion', 'ADMINISTRAR'],
  ['POST /sucursales/:p/vinculaciones-puente', 'ADMINISTRAR'],
  ['GET /sucursales/:p/puentes', 'ADMINISTRAR'],
  ['DELETE /sucursales/:p/puentes/:p', 'ADMINISTRAR'],
  ['GET /impresion/estado', 'SUCURSAL_ACTIVA'],
  ['GET /impresion/trabajos', 'ATENDER_MESA'],
  ['POST /impresion/trabajos/:p/reimpresion', 'ATENDER_MESA'],
  ['POST /puente/vinculacion', 'VINCULACION'],
  ['GET /puente/configuracion', 'PUENTE'],
  ['GET /puente/trabajos', 'PUENTE'],
  ['POST /puente/trabajos/:p/resultado', 'PUENTE'],
  ['POST /puente/latido', 'PUENTE'],
];

/** La lista cerrada de rutas públicas de 002 (criterio 1). */
const RUTAS_PUBLICAS = [
  'GET /health',
  'POST /sesiones/contrasena',
  'POST /sesiones/pin',
  'GET /equipo',
  'POST /plataforma/sesiones',
];

describe('criterio 129 · toda ruta de 3b está clasificada', () => {
  it('las rutas registradas en Nest son exactamente las de la tabla de endpoints y cada una tiene su acción o su credencial', () => {
    const esperadas = new Map(RUTAS_3B);
    expect(esperadas.size).toBe(19);
    const registradas = rutasDeNest(ctx.app).filter((r) => esRutaDe3b(r.ruta));
    const problemas: string[] = [];
    const vistas = new Set<string>();
    for (const r of registradas) {
      const clave = `${r.metodo} ${normal(r.ruta)}`;
      if (vistas.has(clave)) problemas.push(`${clave}: ruta registrada dos veces`);
      vistas.add(clave);
      const manejador = r.controlador.prototype[r.manejador] as object;
      const leer = <T>(llave: string): T | undefined =>
        (Reflect.getMetadata(llave, manejador) as T | undefined) ??
        (Reflect.getMetadata(llave, r.controlador) as T | undefined);
      const clase = esperadas.get(clave);
      const permiso = leer<string>(PERMISO);
      const conPuente = leer<boolean>(METADATO_PUENTE) === true;
      const conVinculacion = leer<boolean>(METADATO_VINCULACION_PUENTE) === true;
      if (clase === undefined) {
        problemas.push(`${clave}: ruta sin clasificar (permiso ${permiso ?? 'NINGUNO'})`);
        continue;
      }
      if (leer<boolean>(PUBLICA) === true) problemas.push(`${clave}: no puede ser pública`);
      if (leer<boolean>(SOLO_ADMINISTRADOR) === true) {
        problemas.push(`${clave}: debe usar @Permiso, no @SoloAdministrador`);
      }
      if (leer<boolean>(METADATO_SUPERADMINISTRADOR) === true) {
        problemas.push(`${clave}: no es una ruta de plataforma`);
      }
      switch (clase) {
        case 'ADMINISTRAR':
        case 'ATENDER_MESA':
          if (permiso !== clase) problemas.push(`${clave}: debería ser ${clase} y es ${permiso}`);
          if (conPuente || conVinculacion) problemas.push(`${clave}: no es del puente`);
          break;
        case 'SUCURSAL_ACTIVA':
          if (permiso !== undefined) {
            problemas.push(`${clave}: solo debe pedir sucursal activa y lleva ${permiso}`);
          }
          if (leer<boolean>(REQUIERE_SUCURSAL) !== true) {
            problemas.push(`${clave}: debe llevar @RequiereSucursal()`);
          }
          if (conPuente || conVinculacion) problemas.push(`${clave}: no es del puente`);
          break;
        case 'PUENTE':
          if (!conPuente) problemas.push(`${clave}: debe llevar @Puente()`);
          if (conVinculacion) problemas.push(`${clave}: no es la vinculación`);
          if (permiso !== undefined) problemas.push(`${clave}: el puente no usa @Permiso`);
          break;
        case 'VINCULACION':
          if (!conVinculacion) problemas.push(`${clave}: debe llevar @VinculacionPuente()`);
          if (conPuente) problemas.push(`${clave}: la vinculación usa el código vi., no el pu.`);
          if (permiso !== undefined) problemas.push(`${clave}: el puente no usa @Permiso`);
          break;
      }
    }
    for (const clave of esperadas.keys()) {
      if (!vistas.has(clave)) problemas.push(`${clave}: falta la ruta`);
    }
    expect(registradas.length).toBeGreaterThan(0);
    exigirSinFallos(problemas);
  });

  it('la lista de rutas públicas de 002 no cambia y ninguna ruta de 3b es pública (hoy ya pasa: la fase A no marcó ninguna como pública)', () => {
    const publicas = rutasDeNest(ctx.app)
      .filter(
        (r) =>
          Reflect.getMetadata(PUBLICA, r.controlador.prototype[r.manejador] as object) === true,
      )
      .map((r) => `${r.metodo} ${r.ruta}`);
    expect([...publicas].sort()).toEqual([...RUTAS_PUBLICAS].sort());
  });
});

describe('criterio 129 · cada rol sin permiso recibe 403 PROHIBIDO', () => {
  it('las 11 rutas de ADMINISTRAR rechazan a los otros cuatro roles, con sesión de contraseña y de PIN, sin cambiar nada', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const impresora = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    const estacionId = await crearEstacion(ctx, A.tokenAdmin);
    const puente = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
    const rutas: [Parameters<typeof llamar>[2]['metodo'], string, unknown?][] = [
      ['get', `/sucursales/${A.S1}/impresoras`],
      ['post', `/sucursales/${A.S1}/impresoras`, cuerpoImpresora()],
      ['patch', `/sucursales/${A.S1}/impresoras/${impresora.id}`, { nombre: unico('Otra') }],
      ['post', `/sucursales/${A.S1}/impresoras/${impresora.id}/prueba`],
      ['get', `/sucursales/${A.S1}/estaciones-destino`],
      ['put', `/sucursales/${A.S1}/estaciones-destino/${estacionId}`, { destino: 'KDS' }],
      ['get', `/sucursales/${A.S1}/impresion`],
      ['put', `/sucursales/${A.S1}/impresion`, { impresoraCajaId: impresora.id }],
      ['post', `/sucursales/${A.S1}/vinculaciones-puente`],
      ['get', `/sucursales/${A.S1}/puentes`],
      ['delete', `/sucursales/${A.S1}/puentes/${puente.id}`],
    ];
    expect(rutas).toHaveLength(11);
    const antes = await instantaneaImpresion(admin, A.empresaId);
    const fallos: string[] = [];
    for (const rol of ROLES_SIN_ADMINISTRAR) {
      for (const [tipo, token] of [
        ['contraseña', roles[rol].contrasena],
        ['PIN', roles[rol].pin],
      ] as const) {
        for (const [metodo, ruta, cuerpo] of rutas) {
          const res = await llamar(ctx, token, {
            metodo,
            ruta,
            ...(cuerpo === undefined ? {} : { cuerpo }),
            cabeceras: { 'Idempotency-Key': randomUUID() },
          });
          if (res.status !== 403 || res.body.codigo !== 'PROHIBIDO') {
            fallos.push(
              `${rol} (${tipo}) ${metodo.toUpperCase()} ${ruta}: ${res.status} ${JSON.stringify(res.body)}`,
            );
          }
        }
      }
    }
    exigirSinFallos(fallos);
    expect(await instantaneaImpresion(admin, A.empresaId)).toEqual(antes);
    // Control: el Administrador sí lee.
    for (const ruta of [
      `/sucursales/${A.S1}/impresoras`,
      `/sucursales/${A.S1}/estaciones-destino`,
      `/sucursales/${A.S1}/impresion`,
      `/sucursales/${A.S1}/puentes`,
    ]) {
      exigirEstado(await llamar(ctx, A.tokenAdmin, { metodo: 'get', ruta }), 200, `GET ${ruta}`);
    }
  });

  it('los trabajos y la reimpresión son de ATENDER_MESA: Cocina/Barra recibe 403, Mozo, Cajero, Supervisor y Administrador pasan', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const impresora = await crearImpresora(ctx, A.tokenAdmin, A.S1);
    const trabajoId = await crearPrueba(ctx, A.tokenAdmin, A.S1, impresora.id);
    const antes = await instantaneaImpresion(admin, A.empresaId);
    const fallos: string[] = [];
    for (const [tipo, token] of [
      ['contraseña', roles.COCINA_BARRA.contrasena],
      ['PIN', roles.COCINA_BARRA.pin],
    ] as const) {
      for (const [metodo, ruta] of [
        ['get', '/impresion/trabajos'],
        ['post', `/impresion/trabajos/${trabajoId}/reimpresion`],
      ] as const) {
        const res = await conClave(ctx, token, metodo, ruta);
        if (res.status !== 403 || res.body.codigo !== 'PROHIBIDO') {
          fallos.push(`Cocina/Barra (${tipo}) ${metodo.toUpperCase()} ${ruta}: ${res.status}`);
        }
      }
    }
    exigirSinFallos(fallos);
    expect(await instantaneaImpresion(admin, A.empresaId)).toEqual(antes);
    for (const [nombre, token] of [
      ['Mozo', roles.MOZO.contrasena],
      ['Mozo con PIN', roles.MOZO.pin],
      ['Cajero', roles.CAJERO.contrasena],
      ['Supervisor', roles.SUPERVISOR.contrasena],
      ['Administrador con S1', A.tokenS1],
    ] as const) {
      const res = await llamar(ctx, token, { metodo: 'get', ruta: '/impresion/trabajos' });
      exigirEstado(res, 200, `${nombre} pide los trabajos`);
      expect(Array.isArray(res.body), nombre).toBe(true);
    }
  });

  it('GET /impresion/estado lo ve cualquier rol con sucursal activa; sin sucursal activa es 409 SUCURSAL_NO_ELEGIDA y sin sesión 401', async () => {
    const A = await crearEmpresaP6(ctx, sa, 2);
    const roles = await crearRolesP6(ctx, A);
    const fallos: string[] = [];
    for (const [nombre, token] of [
      ['Mozo', roles.MOZO.contrasena],
      ['Cajero', roles.CAJERO.contrasena],
      ['Cocina/Barra', roles.COCINA_BARRA.contrasena],
      ['Cocina/Barra con PIN', roles.COCINA_BARRA.pin],
      ['Supervisor', roles.SUPERVISOR.contrasena],
      ['Administrador con S1', A.tokenS1],
    ] as const) {
      const res = await llamar(ctx, token, { metodo: 'get', ruta: '/impresion/estado' });
      if (res.status !== 200 || !estadoImpresionRespuestaSchema.safeParse(res.body).success) {
        fallos.push(`${nombre}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    const sinSucursal = await llamar(ctx, A.tokenAdmin, {
      metodo: 'get',
      ruta: '/impresion/estado',
    });
    if (sinSucursal.status !== 409 || sinSucursal.body.codigo !== 'SUCURSAL_NO_ELEGIDA') {
      fallos.push(`sin sucursal activa: ${sinSucursal.status} ${JSON.stringify(sinSucursal.body)}`);
    }
    const sinSesion = await llamar(ctx, undefined, { metodo: 'get', ruta: '/impresion/estado' });
    if (sinSesion.status !== 401) fallos.push(`sin sesión: ${sinSesion.status}`);
    exigirSinFallos(fallos);
  });
});

// ------------------------------------------------------------------------------------------------
// 132 · El puente no sale de su sucursal
// ------------------------------------------------------------------------------------------------
describe('criterio 132 · un puente de S1 de A solo ve y cambia lo de S1 de A', () => {
  let mundoPendiente: Promise<MundoP6> | undefined;
  const mundo = () => (mundoPendiente ??= construirMundoP6(ctx, sa));

  /** Deja las tres colas vacías para que cada prueba cuente solo lo que crea. */
  async function colasVacias(m: MundoP6): Promise<void> {
    for (const p of [m.puA1, m.puA2, m.puB1]) await vaciarCola(ctx, p);
  }

  it('GET /puente/trabajos entrega solo los trabajos de las impresoras de su sucursal, en orden de creación', async () => {
    const m = await mundo();
    await colasVacias(m);
    const deA1: string[] = [];
    for (let i = 0; i < 3; i++) {
      ctx.reloj.avanzar(1000);
      deA1.push(await crearPrueba(ctx, m.A.tokenAdmin, m.A.S1, m.impA1));
    }
    const deA2 = [await crearPrueba(ctx, m.A.tokenAdmin, m.A.S2, m.impA2)];
    const deB1 = [await crearPrueba(ctx, m.B.tokenAdmin, m.B.S1, m.impB1)];

    const veA1 = await trabajosDelPuente(ctx, m.puA1);
    expect(veA1.map((t) => t.id)).toEqual(deA1);
    for (const t of veA1) {
      trabajoParaImprimirSchema.parse(t);
      expect(t).toMatchObject({ impresoraId: m.impA1, tipo: 'PRUEBA' });
      expect(t.bytes.length).toBeGreaterThan(0);
    }
    expect((await trabajosDelPuente(ctx, m.puA2)).map((t) => t.id)).toEqual(deA2);
    expect((await trabajosDelPuente(ctx, m.puB1)).map((t) => t.id)).toEqual(deB1);
    // Lo mismo, pedido otra vez: nada se movió de sucursal.
    expect((await trabajosDelPuente(ctx, m.puA1)).map((t) => t.id)).toEqual(deA1);
  });

  it('POST /puente/trabajos/:id/resultado con un trabajo de S2 o de B es 404 igual que uno inexistente, y nada cambia', async () => {
    const m = await mundo();
    await colasVacias(m);
    const propio = await crearPrueba(ctx, m.A.tokenAdmin, m.A.S1, m.impA1);
    const deS2 = await crearPrueba(ctx, m.A.tokenAdmin, m.A.S2, m.impA2);
    const deB = await crearPrueba(ctx, m.B.tokenAdmin, m.B.S1, m.impB1);
    const antesA = await fotoDeTrabajos(m.A.empresaId);
    const antesB = await fotoDeTrabajos(m.B.empresaId);
    const auditoriaAntes = (await auditoriaImpresion(admin, m.A.empresaId)).length;
    const fallos: string[] = [];
    for (const cuerpo of [
      { resultado: 'IMPRESO' },
      { resultado: 'NO_IMPRESO', error: 'Sin papel' },
    ]) {
      const reportar = (id: string) =>
        llamarPuente(ctx, m.puA1.token, 'post', `/puente/trabajos/${id}/resultado`, cuerpo);
      const inexistente = await reportar(randomUUID());
      if (inexistente.status !== 404 || inexistente.body.codigo !== 'NO_ENCONTRADO') {
        fallos.push(`inexistente: ${inexistente.status} ${JSON.stringify(inexistente.body)}`);
      }
      for (const [nombre, id] of [
        ['trabajo de S2', deS2],
        ['trabajo de B', deB],
      ] as const) {
        const res = await reportar(id);
        if (cuerpoDe(res) !== cuerpoDe(inexistente)) {
          fallos.push(`${nombre} (${cuerpo.resultado}): ${res.status} ${JSON.stringify(res.body)}`);
        }
      }
    }
    exigirSinFallos(fallos);
    expect(await fotoDeTrabajos(m.A.empresaId)).toEqual(antesA);
    expect(await fotoDeTrabajos(m.B.empresaId)).toEqual(antesB);
    expect((await auditoriaImpresion(admin, m.A.empresaId)).length).toBe(auditoriaAntes);
    // Controles: cada puente reporta lo suyo.
    for (const [puente, id] of [
      [m.puA1, propio],
      [m.puA2, deS2],
      [m.puB1, deB],
    ] as const) {
      const res = await llamarPuente(
        ctx,
        puente.token,
        'post',
        `/puente/trabajos/${id}/resultado`,
        {
          resultado: 'IMPRESO',
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
  });

  it('GET /puente/configuracion trae solo las impresoras activas de su sucursal, y un cambio del Administrador solo se ve en la suya', async () => {
    const m = await mundo();
    const pedir = async (p: PuenteVinculado) => {
      const res = await llamarPuente(ctx, p.token, 'get', '/puente/configuracion');
      exigirEstado(res, 200, 'pedir la configuración');
      return configuracionPuenteSchema.parse(res.body);
    };
    const cfgA1 = await pedir(m.puA1);
    const cfgA2 = await pedir(m.puA2);
    const cfgB1 = await pedir(m.puB1);
    expect(cfgA1.impresoras.map((i) => i.id)).toEqual([m.impA1]);
    expect(cfgA2.impresoras.map((i) => i.id)).toEqual([m.impA2]);
    expect(cfgB1.impresoras.map((i) => i.id)).toEqual([m.impB1]);
    expect(cfgA1.puente.id).toBe(m.puA1.id);
    expect(cfgA1.sucursal.id).toBe(m.A.S1);
    expect(cfgA2.sucursal.id).toBe(m.A.S2);
    expect(cfgB1.sucursal.id).toBe(m.B.S1);
    const todos = JSON.stringify([cfgA1, cfgA2, cfgB1]);
    expect(todos).not.toContain(m.impA1Inactiva);

    const nombreNuevo = unico('Barra');
    exigirEstado(
      await llamar(ctx, m.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${m.A.S1}/impresoras/${m.impA1}`,
        cuerpo: { nombre: nombreNuevo },
      }),
      200,
      'renombrar la impresora de S1',
    );
    expect((await pedir(m.puA1)).impresoras[0]!.nombre).toBe(nombreNuevo);
    expect(await pedir(m.puA2)).toEqual(cfgA2);
    expect(await pedir(m.puB1)).toEqual(cfgB1);
  });

  it('el latido con impresoras de S2 o de B no las cambia, no cambia la señal de otro puente y no avisa a otras sucursales; las propias sí', async () => {
    const m = await construirMundoP6(ctx, sa);
    const tokenA1 = await sesionContrasena(ctx, m.A.base.admin, m.A.S1);
    const tokenA2 = await sesionContrasena(ctx, m.A.base.admin, m.A.S2);
    const tokenB1 = await sesionContrasena(ctx, m.B.base.admin, m.B.S1);
    const pwa: Conectados = {
      'A.S1': await conectarPwa(tokenA1),
      'A.S2': await conectarPwa(tokenA2),
      'B.S1': await conectarPwa(tokenB1),
    };
    const estadoDe = async (token: string, sucursalId: string) => {
      const res = await llamar(ctx, token, {
        metodo: 'get',
        ruta: `/sucursales/${sucursalId}/impresoras`,
      });
      exigirEstado(res, 200, 'listar las impresoras');
      return new Map(
        (res.body as { id: string; estado: string; estadoDesde: string | null }[]).map((i) => [
          i.id,
          i,
        ]),
      );
    };
    const antesA2 = await estadoDe(m.A.tokenAdmin, m.A.S2);
    const antesB1 = await estadoDe(m.B.tokenAdmin, m.B.S1);
    const puentesAntes = {
      A2: await listarPuentes(ctx, m.A.tokenAdmin, m.A.S2),
      B1: await listarPuentes(ctx, m.B.tokenAdmin, m.B.S1),
    };

    // Un primer latido propio deja la señal y el estado de la impresora de S1 al día (puede avisar a S1).
    ctx.reloj.avanzar(1000);
    const base = await llamarPuente(ctx, m.puA1.token, 'post', '/puente/latido', {
      versionApp: '1.0.9',
      impresoras: [{ id: m.impA1, estado: 'LISTA' }],
    });
    expect(base.status, JSON.stringify(base.body)).toBe(204);
    await new Promise((resolver) => setTimeout(resolver, 500));

    // Un latido que solo menciona impresoras ajenas: no cambia nada ni avisa a nadie.
    ctx.reloj.avanzar(1000);
    await exigirReparto(
      pwa,
      'impresion.estado',
      [],
      async () => {
        const res = await llamarPuente(ctx, m.puA1.token, 'post', '/puente/latido', {
          versionApp: '1.0.9',
          impresoras: [
            { id: m.impA2, estado: 'NO_RESPONDE', error: 'de S2' },
            { id: m.impB1, estado: 'NO_RESPONDE', error: 'de B' },
          ],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(204);
      },
      () => undefined,
      'latido con impresoras ajenas',
    );
    expect(await estadoDe(m.A.tokenAdmin, m.A.S2)).toEqual(antesA2);
    expect(await estadoDe(m.B.tokenAdmin, m.B.S1)).toEqual(antesB1);
    expect(antesA2.get(m.impA2)).toMatchObject({ estado: 'DESCONOCIDO', estadoDesde: null });
    expect(antesB1.get(m.impB1)).toMatchObject({ estado: 'DESCONOCIDO', estadoDesde: null });

    // Un latido con una propia que cambia y dos ajenas: la propia cambia y avisa solo a su sucursal.
    ctx.reloj.avanzar(1000);
    await exigirReparto(
      pwa,
      'impresion.estado',
      ['A.S1'],
      async () => {
        const res = await llamarPuente(ctx, m.puA1.token, 'post', '/puente/latido', {
          versionApp: '1.0.9',
          impresoras: [
            { id: m.impA1, estado: 'NO_RESPONDE', error: 'Sin papel' },
            { id: m.impA2, estado: 'LISTA' },
            { id: m.impB1, estado: 'LISTA' },
          ],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(204);
      },
      () => ({ sucursalId: m.A.S1 }),
      'latido con una impresora propia',
    );
    const propias = await estadoDe(m.A.tokenAdmin, m.A.S1);
    expect(propias.get(m.impA1)).toMatchObject({ estado: 'NO_RESPONDE' });
    expect(propias.get(m.impA1)!.estadoDesde).not.toBeNull();
    expect(await estadoDe(m.A.tokenAdmin, m.A.S2)).toEqual(antesA2);
    expect(await estadoDe(m.B.tokenAdmin, m.B.S1)).toEqual(antesB1);
    expect(await listarPuentes(ctx, m.A.tokenAdmin, m.A.S2)).toEqual(puentesAntes.A2);
    expect(await listarPuentes(ctx, m.B.tokenAdmin, m.B.S1)).toEqual(puentesAntes.B1);
    const [propio] = await listarPuentes(ctx, m.A.tokenAdmin, m.A.S1);
    expect(propio!.ultimaSenalEn).toBe(ctx.reloj.ahora().toISOString());
  });

  it('un pu. de A con la empresa cambiada a B (o el de B con la de A) es 401 en todas las rutas y no toca nada de B', async () => {
    const m = await mundo();
    const deB = await crearPrueba(ctx, m.B.tokenAdmin, m.B.S1, m.impB1);
    const antesB = await fotoDeTrabajos(m.B.empresaId);
    const fallos: string[] = [];
    const rutas = [
      { metodo: 'get', ruta: '/puente/configuracion' },
      { metodo: 'get', ruta: '/puente/trabajos' },
      {
        metodo: 'post',
        ruta: `/puente/trabajos/${deB}/resultado`,
        cuerpo: { resultado: 'IMPRESO' },
      },
      {
        metodo: 'post',
        ruta: '/puente/latido',
        cuerpo: { versionApp: '1.0', impresoras: [{ id: m.impB1, estado: 'LISTA' }] },
      },
    ] as const;
    for (const [nombre, token] of [
      ['pu. de A con la empresa de B', conEmpresaDe(m.puA1.token, m.B.empresaId)],
      ['pu. de B con la empresa de A', conEmpresaDe(m.puB1.token, m.A.empresaId)],
      ['pu. de A con el id del puente de B', conIdDe(m.puA1.token, m.puB1.id)],
      ['pu. de A con el secreto del puente de B', conSecretoDe(m.puA1.token, m.puB1.token)],
    ] as const) {
      for (const r of rutas) {
        const res = await llamarPuente(
          ctx,
          token,
          r.metodo,
          r.ruta,
          'cuerpo' in r ? r.cuerpo : undefined,
        );
        if (res.status !== 401) fallos.push(`${nombre} ${r.ruta}: ${res.status}`);
      }
    }
    exigirSinFallos(fallos);
    expect(await fotoDeTrabajos(m.B.empresaId)).toEqual(antesB);
    // Controles: los verdaderos siguen sirviendo.
    expect((await trabajosDelPuente(ctx, m.puB1)).map((t) => t.id)).toContain(deB);
    exigirEstado(
      await llamarPuente(ctx, m.puA1.token, 'get', '/puente/configuracion'),
      200,
      'el de A',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 111, 110, 112 · Las salas de Socket.IO son una por puente
// ------------------------------------------------------------------------------------------------
describe('salas de Socket.IO por puente', () => {
  /** Un mundo nuevo por prueba: los puentes se reemplazan y las conexiones se cierran al terminar. */
  async function preparar() {
    const m = await construirMundoP6(ctx, sa);
    const puentes: Conectados = {
      'puente A.S1': await conectarPuente(m.puA1.token),
      'puente A.S2': await conectarPuente(m.puA2.token),
      'puente B.S1': await conectarPuente(m.puB1.token),
    };
    const pwa: Conectados = {
      'PWA A.S1': await conectarPwa(await sesionContrasena(ctx, m.A.base.admin, m.A.S1)),
      'PWA A.S2': await conectarPwa(await sesionContrasena(ctx, m.A.base.admin, m.A.S2)),
      'PWA B.S1': await conectarPwa(await sesionContrasena(ctx, m.B.base.admin, m.B.S1)),
    };
    return { m, puentes, pwa, todos: { ...puentes, ...pwa } };
  }

  it('trabajo.nuevo de cada sucursal llega exactamente a su puente', async () => {
    const { m, todos } = await preparar();
    const casos: [string, () => Promise<string>][] = [
      ['puente A.S1', () => crearPrueba(ctx, m.A.tokenAdmin, m.A.S1, m.impA1)],
      ['puente A.S2', () => crearPrueba(ctx, m.A.tokenAdmin, m.A.S2, m.impA2)],
      ['puente B.S1', () => crearPrueba(ctx, m.B.tokenAdmin, m.B.S1, m.impB1)],
    ];
    for (const [receptor, crear] of casos) {
      await exigirReparto(
        todos,
        'trabajo.nuevo',
        [receptor],
        crear,
        (trabajoId) => ({ trabajoId }),
        `trabajo de ${receptor}`,
      );
    }
  });

  it('puente.configuracion llega solo al puente de la sucursal de la impresora cambiada', async () => {
    const { m, todos } = await preparar();
    await exigirReparto(
      todos,
      'puente.configuracion',
      ['puente A.S1'],
      async () => {
        exigirEstado(
          await llamar(ctx, m.A.tokenAdmin, {
            metodo: 'patch',
            ruta: `/sucursales/${m.A.S1}/impresoras/${m.impA1}`,
            cuerpo: { gaveta: true },
          }),
          200,
          'cambiar la impresora de A.S1',
        );
      },
      () => ({}),
      'cambio en A.S1',
    );
    await exigirReparto(
      todos,
      'puente.configuracion',
      ['puente B.S1'],
      async () => {
        exigirEstado(
          await llamar(ctx, m.B.tokenAdmin, {
            metodo: 'patch',
            ruta: `/sucursales/${m.B.S1}/impresoras/${m.impB1}`,
            cuerpo: { gaveta: true },
          }),
          200,
          'cambiar la impresora de B.S1',
        );
      },
      () => ({}),
      'cambio en B.S1',
    );
  });

  it('publicar en la sala de un puente solo llega a ese puente; con la empresa de otro o un puente de otra empresa no llega a nadie', async () => {
    const { m, todos } = await preparar();
    const evento = (empresaId: string, puenteId: string): EventoPublicable => ({
      empresaId,
      sala: { tipo: 'puente', puenteId },
      nombre: 'trabajo.nuevo',
      datos: { trabajoId: randomUUID() },
    });
    const casos: [string, EventoPublicable, string[]][] = [
      ['puente A.S1 de A', evento(m.A.empresaId, m.puA1.id), ['puente A.S1']],
      ['puente A.S2 de A', evento(m.A.empresaId, m.puA2.id), ['puente A.S2']],
      ['puente B.S1 de B', evento(m.B.empresaId, m.puB1.id), ['puente B.S1']],
      ['puente de B con la empresa de A', evento(m.A.empresaId, m.puB1.id), []],
      ['puente de A con la empresa de B', evento(m.B.empresaId, m.puA1.id), []],
      ['puente inexistente', evento(m.A.empresaId, randomUUID()), []],
    ];
    for (const [descripcion, e, reciben] of casos) {
      await exigirReparto(
        todos,
        'trabajo.nuevo',
        reciben,
        () => publicar(e),
        () => e.datos,
        descripcion,
      );
    }
  });

  it('el puente no está en las salas de la PWA: no recibe los eventos de su empresa ni de su sucursal, y la PWA no recibe los de su sala', async () => {
    const { m, todos } = await preparar();
    const ordenId = randomUUID();
    for (const sala of [{ tipo: 'empresa' }, { tipo: 'sucursal', sucursalId: m.A.S1 }] as const) {
      await exigirReparto(
        todos,
        'orden.cambio',
        sala.tipo === 'empresa' ? ['PWA A.S1', 'PWA A.S2'] : ['PWA A.S1'],
        () =>
          publicar({ empresaId: m.A.empresaId, sala, nombre: 'orden.cambio', datos: { ordenId } }),
        () => ({ ordenId }),
        `orden.cambio en la sala ${sala.tipo}`,
      );
    }
    // El aviso de estado de la impresión de su propia sucursal tampoco le llega: va a la sala de la sucursal.
    await exigirReparto(
      todos,
      'impresion.estado',
      ['PWA A.S1'],
      async () => {
        const res = await llamarPuente(ctx, m.puA1.token, 'post', '/puente/latido', {
          versionApp: '1.0.0',
          impresoras: [{ id: m.impA1, estado: 'NO_RESPONDE', error: 'Sin papel' }],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(204);
      },
      () => ({ sucursalId: m.A.S1 }),
      'impresion.estado de A.S1',
    );
  });

  it('el puente no elige sus salas: join, subscribe o emitir con la sala de otro puente no cambia nada ni recibe respuesta', async () => {
    const { m, puentes, todos } = await preparar();
    const intruso = puentes['puente A.S1']!;
    const salasAjenas = [
      `p:${m.B.empresaId}:${m.puB1.id}`,
      `p:${m.A.empresaId}:${m.puA2.id}`,
      `s:${m.A.empresaId}:${m.A.S1}`,
      `e:${m.A.empresaId}`,
    ];
    for (const sala of salasAjenas) {
      for (const nombre of ['join', 'subscribe', 'unirse']) {
        intruso.emitir(nombre, sala);
        intruso.emitir(nombre, { sala, room: sala });
      }
    }
    const acuse = await new Promise<'sin-acuse' | 'con-acuse'>((resolver) => {
      intruso.socket.timeout(500).emit('join', salasAjenas[0], (error: unknown) => {
        resolver(error ? 'sin-acuse' : 'con-acuse');
      });
    });
    expect(acuse).toBe('sin-acuse');
    expect(intruso.conectado).toBe(true);
    const evento = (empresaId: string, puenteId: string): EventoPublicable => ({
      empresaId,
      sala: { tipo: 'puente', puenteId },
      nombre: 'trabajo.nuevo',
      datos: { trabajoId: randomUUID() },
    });
    for (const [descripcion, e, reciben] of [
      ['puente de B', evento(m.B.empresaId, m.puB1.id), ['puente B.S1']],
      ['puente A.S2', evento(m.A.empresaId, m.puA2.id), ['puente A.S2']],
      ['su propio puente', evento(m.A.empresaId, m.puA1.id), ['puente A.S1']],
    ] as const) {
      await exigirReparto(
        todos,
        'trabajo.nuevo',
        [...reciben],
        () => publicar(e),
        () => e.datos,
        descripcion,
      );
    }
  });

  it('al reemplazar el puente de una sucursal, trabajo.nuevo va solo al nuevo', async () => {
    const m = await construirMundoP6(ctx, sa);
    const S3 = m.A.S3!;
    const impresora = await crearImpresora(ctx, m.A.tokenAdmin, S3);
    const viejo = await nuevoPuente(ctx, m.A.tokenAdmin, m.A, S3);
    const conexionVieja = await conectarPuente(viejo.token);
    const nuevo = await nuevoPuente(ctx, m.A.tokenAdmin, m.A, S3);
    await conexionVieja.esperarDesconexion(3000);
    const conexionNueva = await conectarPuente(nuevo.token);
    const trabajoId = await crearPrueba(ctx, m.A.tokenAdmin, S3, impresora.id);
    expect(await conexionNueva.esperarEvento('trabajo.nuevo')).toEqual({ trabajoId });
    await conexionVieja.noRecibe('trabajo.nuevo', 400);
    // El trabajo lo entrega el puente nuevo; el revocado no ve nada.
    expect((await trabajosDelPuente(ctx, nuevo)).map((t) => t.id)).toEqual([trabajoId]);
    expect((await llamarPuente(ctx, viejo.token, 'get', '/puente/trabajos')).status).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------------
// 132 · Las rutas de impresión de la PWA ante ids de B o de otra sucursal
// ------------------------------------------------------------------------------------------------
describe('criterio 132 · ids de B o de otra sucursal en las rutas de impresión de la PWA', () => {
  it('responden como un id inexistente (404 o 422 con el mismo cuerpo) y no cambian nada', async () => {
    const m = await construirMundoP6(ctx, sa);
    const estacionA = await crearEstacion(ctx, m.A.tokenAdmin);
    const estacionB = await crearEstacion(ctx, m.B.tokenAdmin);
    const trabajoB = await crearPrueba(ctx, m.B.tokenAdmin, m.B.S1, m.impB1);
    const trabajoS2 = await crearPrueba(ctx, m.A.tokenAdmin, m.A.S2, m.impA2);
    const antesA = await instantaneaImpresion(admin, m.A.empresaId);
    const antesB = await instantaneaImpresion(admin, m.B.empresaId);
    const T = m.A.tokenAdmin;
    const aleatorio = () => randomUUID();

    interface Caso {
      nombre: string;
      ajena: () => Promise<{ status: number; body: unknown }>;
      inexistente: () => Promise<{ status: number; body: unknown }>;
      estado: number;
    }
    const pedir = (
      token: string,
      metodo: 'get' | 'post' | 'put' | 'patch' | 'delete',
      ruta: string,
      cuerpo?: unknown,
    ) =>
      llamar(ctx, token, {
        metodo,
        ruta,
        ...(cuerpo === undefined ? {} : { cuerpo }),
        cabeceras: { 'Idempotency-Key': randomUUID() },
      });
    const casos: Caso[] = [];
    // Una sucursal de B en la ruta es como una sucursal inexistente.
    for (const [metodo, sufijo, cuerpo] of [
      ['get', 'impresoras'],
      ['post', 'impresoras', cuerpoImpresora()],
      ['get', 'estaciones-destino'],
      ['get', 'impresion'],
      ['put', 'impresion', { impresoraCajaId: null }],
      ['post', 'vinculaciones-puente'],
      ['get', 'puentes'],
    ] as const) {
      casos.push({
        nombre: `${metodo.toUpperCase()} /sucursales/<de B>/${sufijo}`,
        ajena: () => pedir(T, metodo, `/sucursales/${m.B.S1}/${sufijo}`, cuerpo),
        inexistente: () => pedir(T, metodo, `/sucursales/${aleatorio()}/${sufijo}`, cuerpo),
        estado: 404,
      });
    }
    // Una impresora de B o de S2 en la ruta de S1 es como una impresora inexistente.
    for (const [nombre, id] of [
      ['de B', m.impB1],
      ['de S2', m.impA2],
    ] as const) {
      casos.push({
        nombre: `PATCH impresora ${nombre}`,
        ajena: () =>
          pedir(T, 'patch', `/sucursales/${m.A.S1}/impresoras/${id}`, { nombre: 'Hackeada' }),
        inexistente: () =>
          pedir(T, 'patch', `/sucursales/${m.A.S1}/impresoras/${aleatorio()}`, {
            nombre: 'Hackeada',
          }),
        estado: 404,
      });
      casos.push({
        nombre: `POST página de prueba de la impresora ${nombre}`,
        ajena: () => pedir(T, 'post', `/sucursales/${m.A.S1}/impresoras/${id}/prueba`),
        inexistente: () =>
          pedir(T, 'post', `/sucursales/${m.A.S1}/impresoras/${aleatorio()}/prueba`),
        estado: 404,
      });
    }
    casos.push({
      nombre: 'PUT destino de una estación de B',
      ajena: () =>
        pedir(T, 'put', `/sucursales/${m.A.S1}/estaciones-destino/${estacionB}`, {
          destino: 'KDS',
        }),
      inexistente: () =>
        pedir(T, 'put', `/sucursales/${m.A.S1}/estaciones-destino/${aleatorio()}`, {
          destino: 'KDS',
        }),
      estado: 404,
    });
    // Una impresora de B, de S2 o inactiva como destino o como impresora de caja es una referencia inválida.
    for (const [nombre, id] of [
      ['de B', m.impB1],
      ['de S2', m.impA2],
      ['inactiva', m.impA1Inactiva],
    ] as const) {
      casos.push({
        nombre: `PUT destino IMPRESORA con una impresora ${nombre}`,
        ajena: () =>
          pedir(T, 'put', `/sucursales/${m.A.S1}/estaciones-destino/${estacionA}`, {
            destino: 'IMPRESORA',
            impresoraId: id,
          }),
        inexistente: () =>
          pedir(T, 'put', `/sucursales/${m.A.S1}/estaciones-destino/${estacionA}`, {
            destino: 'IMPRESORA',
            impresoraId: aleatorio(),
          }),
        estado: 422,
      });
      if (nombre === 'inactiva') continue; // la especificación no dice nada de una impresora de caja inactiva
      casos.push({
        nombre: `PUT impresora de caja ${nombre}`,
        ajena: () => pedir(T, 'put', `/sucursales/${m.A.S1}/impresion`, { impresoraCajaId: id }),
        inexistente: () =>
          pedir(T, 'put', `/sucursales/${m.A.S1}/impresion`, { impresoraCajaId: aleatorio() }),
        estado: 422,
      });
    }
    // Un puente de B o de S2 en la ruta de S1.
    for (const [nombre, id] of [
      ['de B', m.puB1.id],
      ['de S2', m.puA2.id],
    ] as const) {
      casos.push({
        nombre: `DELETE puente ${nombre}`,
        ajena: () => pedir(T, 'delete', `/sucursales/${m.A.S1}/puentes/${id}`),
        inexistente: () => pedir(T, 'delete', `/sucursales/${m.A.S1}/puentes/${aleatorio()}`),
        estado: 404,
      });
    }
    // Un trabajo de B o de otra sucursal no se reimprime (sucursal activa S1).
    for (const [nombre, id] of [
      ['de B', trabajoB],
      ['de S2', trabajoS2],
    ] as const) {
      casos.push({
        nombre: `POST reimpresión de un trabajo ${nombre}`,
        ajena: () => pedir(m.A.tokenS1, 'post', `/impresion/trabajos/${id}/reimpresion`),
        inexistente: () =>
          pedir(m.A.tokenS1, 'post', `/impresion/trabajos/${aleatorio()}/reimpresion`),
        estado: 404,
      });
    }

    const fallos: string[] = [];
    for (const caso of casos) {
      const inexistente = await caso.inexistente();
      const ajena = await caso.ajena();
      if (inexistente.status !== caso.estado) {
        fallos.push(
          `${caso.nombre}: el inexistente dio ${inexistente.status} y se esperaba ${caso.estado}`,
        );
      }
      if (cuerpoDe(ajena) !== cuerpoDe(inexistente)) {
        fallos.push(
          `${caso.nombre}: ${ajena.status} ${JSON.stringify(ajena.body)} no es igual al inexistente ${inexistente.status} ${JSON.stringify(inexistente.body)}`,
        );
      }
    }
    exigirSinFallos(fallos);
    const destino = await pedir(T, 'put', `/sucursales/${m.A.S1}/estaciones-destino/${estacionA}`, {
      destino: 'IMPRESORA',
      impresoraId: m.impB1,
    });
    expect(destino.body).toMatchObject({ codigo: 'REFERENCIA_INVALIDA' });
    expect(await instantaneaImpresion(admin, m.A.empresaId)).toEqual(antesA);
    expect(await instantaneaImpresion(admin, m.B.empresaId)).toEqual(antesB);
  });

  it('GET /impresion/estado y GET /impresion/trabajos solo traen datos de la sucursal activa y de la empresa de la sesión', async () => {
    const m = await construirMundoP6(ctx, sa);
    const deA1 = await crearPrueba(ctx, m.A.tokenAdmin, m.A.S1, m.impA1);
    const deA2 = await crearPrueba(ctx, m.A.tokenAdmin, m.A.S2, m.impA2);
    const deB1 = await crearPrueba(ctx, m.B.tokenAdmin, m.B.S1, m.impB1);
    const tokenB1 = await sesionContrasena(ctx, m.B.base.admin, m.B.S1);
    const ajenosAS1 = [m.impA2, m.impB1, deA2, deB1, m.puA2.id, m.puB1.id, m.A.S2, m.B.S1];
    const ajenosAB1 = [m.impA1, m.impA2, deA1, deA2, m.puA1.id, m.puA2.id, m.A.S1, m.A.S2];
    for (const [ruta, token, propios, ajenos] of [
      ['/impresion/estado', m.A.tokenS1, [m.impA1, m.puA1.id], ajenosAS1],
      ['/impresion/trabajos', m.A.tokenS1, [deA1, m.impA1], ajenosAS1],
      ['/impresion/estado', tokenB1, [m.impB1, m.puB1.id], ajenosAB1],
      ['/impresion/trabajos', tokenB1, [deB1, m.impB1], ajenosAB1],
    ] as const) {
      const res = await llamar(ctx, token, { metodo: 'get', ruta });
      exigirEstado(res, 200, `GET ${ruta}`);
      const ids = uuidsEn(JSON.stringify(res.body));
      expect(
        ids.filter((id) => ajenos.includes(id)),
        `${ruta}: ids de otra sucursal o de otra empresa`,
      ).toEqual([]);
      for (const id of propios) expect(ids, `${ruta} trae ${id}`).toContain(id);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 131 · RLS y referencias cruzadas de las seis tablas nuevas
// ------------------------------------------------------------------------------------------------
interface Sembrada {
  base: BaseImpresion;
  filas: FilasImpresion;
  comanda: string;
  precuenta: string;
}

let sembradoPendiente: Promise<{ A: Sembrada; B: Sembrada }> | undefined;
function sembrado() {
  sembradoPendiente ??= (async () => {
    const sembrar = async (): Promise<Sembrada> => {
      const e = await crearEmpresaP6(ctx, sa, 2);
      const { base, filas, salon } = await sembrarEmpresaSql(ctx, apiCliente, e);
      return { base, filas, comanda: salon.comanda, precuenta: salon.precuenta };
    };
    return { A: await sembrar(), B: await sembrar() };
  })();
  return sembradoPendiente;
}

const idsDe = async (tabla: string, empresaId: string): Promise<string[]> =>
  (
    await admin.query<{ id: string }>(`SELECT id FROM ${tabla} WHERE empresa_id = $1 ORDER BY id`, [
      empresaId,
    ])
  ).rows.map((f) => f.id);

const fotoDe = async (tabla: string, empresaId: string) =>
  (
    await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    )
  ).rows.map((f) => f.fila);

/** Transacción de `restaurante_api` con el actor `prueba` y el contexto de `empresaId`; siempre se revierte. */
const comoApi = <T>(empresaId: string, fn: () => Promise<T>) =>
  enTransaccion(apiCliente, empresaId, fn);

describe('criterios 82 y 131 · las seis tablas nuevas de 3b existen', () => {
  it('impresora, estacion_destino, impresion_sucursal, vinculacion_puente, puente y trabajo_impresion', async () => {
    const faltan: string[] = [];
    for (const tabla of TABLAS_IMPRESION) {
      if (!(await existeTabla(admin, tabla))) faltan.push(tabla);
    }
    expect(faltan, `faltan estas tablas de 3b: ${faltan.join(', ')}`).toEqual([]);
  });
});

describe.each(TABLAS_IMPRESION.map((tabla) => ({ tabla, api: PRIVILEGIOS_IMPRESION[tabla] })))(
  'criterio 131 (83) · $tabla',
  ({ tabla, api }) => {
    const puede = (privilegio: Privilegio) => api.includes(privilegio);

    /** Si la API no tiene el privilegio, la sentencia se rechaza por permisos (42501), no por RLS. */
    async function exigirSinPermiso(sentencia: Promise<unknown>): Promise<void> {
      const error = await errorDe(sentencia);
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/permission denied/i);
    }

    it('la siembra dejó filas de A y de B en la tabla (la prueba no es vacía)', async () => {
      const { A, B } = await sembrado();
      expect(
        (await idsDe(tabla, A.base.empresaId)).length,
        `filas de A en ${tabla}`,
      ).toBeGreaterThan(0);
      expect(
        (await idsDe(tabla, B.base.empresaId)).length,
        `filas de B en ${tabla}`,
      ).toBeGreaterThan(0);
    });

    it('lectura: con el contexto de A no se leen filas de B por id ni sin WHERE, y sí las de A', async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.base.empresaId);
      const idsA = await idsDe(tabla, A.base.empresaId);
      await comoApi(A.base.empresaId, async () => {
        const todas = await apiCliente.query<{ id: string; empresa_id: string }>(
          `SELECT id, empresa_id FROM ${tabla}`,
        );
        expect(todas.rows.map((f) => f.id).sort()).toEqual(idsA);
        expect(todas.rows.every((f) => f.empresa_id === A.base.empresaId)).toBe(true);
        const porId = await apiCliente.query(`SELECT id FROM ${tabla} WHERE id = ANY($1::uuid[])`, [
          idsB,
        ]);
        expect(porId.rows).toEqual([]);
        const deB = await apiCliente.query(`SELECT id FROM ${tabla} WHERE empresa_id = $1`, [
          B.base.empresaId,
        ]);
        expect(deB.rows).toEqual([]);
      });
      // Control: con el contexto de B se ven sus propias filas.
      await comoApi(B.base.empresaId, async () => {
        const propias = await apiCliente.query<{ id: string }>(`SELECT id FROM ${tabla}`);
        expect(propias.rows.map((f) => f.id).sort()).toEqual(idsB);
      });
    });

    it('actualización: el UPDATE por id y sin WHERE no toca filas de B, y cambiar el dueño a B falla por la política', async () => {
      const { A, B } = await sembrado();
      const idsB = await idsDe(tabla, B.base.empresaId);
      const idsA = await idsDe(tabla, A.base.empresaId);
      const antesB = await fotoDe(tabla, B.base.empresaId);
      await comoApi(A.base.empresaId, async () => {
        if (!puede('UPDATE')) {
          await exigirSinPermiso(apiCliente.query(`UPDATE ${tabla} SET empresa_id = empresa_id`));
          return;
        }
        const porId = await apiCliente.query(
          `UPDATE ${tabla} SET empresa_id = empresa_id WHERE id = ANY($1::uuid[]) RETURNING id`,
          [idsB],
        );
        expect(porId.rowCount).toBe(0);
        const sinWhere = await apiCliente.query<{ id: string; empresa_id: string }>(
          `UPDATE ${tabla} SET empresa_id = empresa_id RETURNING id, empresa_id`,
        );
        expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
        expect(sinWhere.rows.every((f) => f.empresa_id === A.base.empresaId)).toBe(true);
        await apiCliente.query('SAVEPOINT dueno');
        const cambio = await errorDe(
          apiCliente.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [
            B.base.empresaId,
            idsA[0],
          ]),
        );
        expect(cambio.code, cambio.message).toBe('42501');
        expect(cambio.message).toMatch(/row-level security/);
        await apiCliente.query('ROLLBACK TO SAVEPOINT dueno');
      });
      expect(await fotoDe(tabla, B.base.empresaId)).toEqual(antesB);
    });

    it('borrado: la API no tiene DELETE en la tabla y el intento se rechaza por permisos, sin tocar a B', async () => {
      const { A, B } = await sembrado();
      const idsA = await idsDe(tabla, A.base.empresaId);
      const antesB = await fotoDe(tabla, B.base.empresaId);
      expect(
        puede('DELETE'),
        'la tabla "Permisos" de spec.md no da DELETE en ninguna tabla de 3b',
      ).toBe(false);
      const idsB = await idsDe(tabla, B.base.empresaId);
      await comoApi(A.base.empresaId, async () => {
        await apiCliente.query('SAVEPOINT sin_where');
        await exigirSinPermiso(apiCliente.query(`DELETE FROM ${tabla}`));
        await apiCliente.query('ROLLBACK TO SAVEPOINT sin_where');
        await exigirSinPermiso(
          apiCliente.query(`DELETE FROM ${tabla} WHERE id = ANY($1::uuid[])`, [idsB]),
        );
      });
      expect(await fotoDe(tabla, B.base.empresaId)).toEqual(antesB);
      expect(await idsDe(tabla, A.base.empresaId), 'A conserva sus filas').toEqual(idsA);
    });

    it('inserción: una fila con el empresa_id de B falla por la política RLS (con el actor fijado) y no se crea', async () => {
      const { A, B } = await sembrado();
      const antesB = await fotoDe(tabla, B.base.empresaId);
      const idsAntes = await idsDe(tabla, B.base.empresaId);
      // Copia de una fila de A con otro id y empresa_id = B (jsonb_populate_record sirve para cualquier tabla).
      const copiar = `INSERT INTO ${tabla}
        SELECT (jsonb_populate_record(NULL::${tabla},
                 to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
          FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`;
      await comoApi(A.base.empresaId, async () => {
        const error = await errorDe(apiCliente.query(copiar, [B.base.empresaId, A.base.empresaId]));
        expect(error.code, error.message).toBe('42501');
        expect(error.message).toMatch(/row-level security/);
        expect(error.message).not.toMatch(/contexto de actor ausente/);
      });
      expect(await idsDe(tabla, B.base.empresaId)).toEqual(idsAntes);
      expect(await fotoDe(tabla, B.base.empresaId)).toEqual(antesB);
    });
  },
);

// ------------------------------------------------------------------------------------------------
// 131 (84) · Referencias cruzadas en la base
// ------------------------------------------------------------------------------------------------
type Objetivo =
  | 'sucursal'
  | 'sucursalSinFila'
  | 'estacion'
  | 'impresora'
  | 'puente'
  | 'comanda'
  | 'precuenta'
  | 'trabajo';

interface Referencia {
  tabla: TablaImpresion;
  columna: string;
  objetivo: Objetivo;
  /** Cláusula `SET` extra del `UPDATE` (por ejemplo, un puente revocado para no chocar con el índice parcial). */
  setExtra?: string;
}

/** Cada llave foránea compuesta de las tablas de 3b hacia otra tabla de empresa (y hacia `sucursal`). */
const REFERENCIAS: Referencia[] = [
  { tabla: 'impresora', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'estacion_destino', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'estacion_destino', columna: 'estacion_id', objetivo: 'estacion' },
  { tabla: 'estacion_destino', columna: 'impresora_id', objetivo: 'impresora' },
  { tabla: 'impresion_sucursal', columna: 'sucursal_id', objetivo: 'sucursalSinFila' },
  { tabla: 'impresion_sucursal', columna: 'impresora_caja_id', objetivo: 'impresora' },
  { tabla: 'vinculacion_puente', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'vinculacion_puente', columna: 'puente_id', objetivo: 'puente' },
  {
    tabla: 'puente',
    columna: 'sucursal_id',
    objetivo: 'sucursal',
    setExtra: ', activo = false, revocado_en = now()',
  },
  { tabla: 'trabajo_impresion', columna: 'sucursal_id', objetivo: 'sucursal' },
  { tabla: 'trabajo_impresion', columna: 'impresora_id', objetivo: 'impresora' },
  { tabla: 'trabajo_impresion', columna: 'comanda_id', objetivo: 'comanda' },
  { tabla: 'trabajo_impresion', columna: 'precuenta_id', objetivo: 'precuenta' },
  { tabla: 'trabajo_impresion', columna: 'reimpresion_de_id', objetivo: 'trabajo' },
];

const deB = (b: Sembrada, objetivo: Objetivo): string =>
  ({
    sucursal: b.base.sucursal1,
    // B no tiene `impresion_sucursal` en esta sucursal: así un índice único no puede delatar la fila de B.
    sucursalSinFila: b.base.sucursal2,
    estacion: b.base.estacion1,
    impresora: b.filas.impresora,
    puente: b.filas.puente,
    comanda: b.comanda,
    precuenta: b.precuenta,
    trabajo: b.filas.trabajo,
  })[objetivo];

/**
 * Cambios que evitan que la copia choque con la fila de A de la que sale (un nombre, la estación o la sucursal
 * únicos, el índice parcial del puente activo). Nunca tocan la columna que se prueba ni los valores que
 * compartiría con la fila de B: si un índice único dejara ver la fila de B, el error sería 23505 y no 23503, y la
 * prueba lo señala.
 */
function sinChocarConA(tabla: TablaImpresion, a: Sembrada): Record<string, unknown> {
  switch (tabla) {
    case 'impresora':
      return { nombre: unico('Impresora copia') };
    case 'estacion_destino':
      return { estacion_id: a.base.estacion2 };
    case 'impresion_sucursal':
      return { sucursal_id: a.base.sucursal2, impresora_caja_id: a.filas.impresoraS2 };
    case 'puente':
      return { activo: false, revocado_en: new Date().toISOString() };
    default:
      return {};
  }
}

describe.each(REFERENCIAS)(
  'criterio 131 (84) · $tabla · $columna apunta a otra empresa',
  ({ tabla, columna, objetivo, setExtra }) => {
    /** Copia una fila de A cambiando `columna` (y el id) y la inserta con el contexto de A. */
    const insertarCopia = (a: Sembrada, valor: string | null) => {
      const cambios: Record<string, unknown> = {
        id: randomUUID(),
        ...sinChocarConA(tabla, a),
        ...(valor === null ? {} : { [columna]: valor }),
      };
      return apiCliente.query(
        `INSERT INTO ${tabla}
           SELECT (jsonb_populate_record(NULL::${tabla}, to_jsonb(x) || $1::jsonb)).*
             FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`,
        [JSON.stringify(cambios), a.base.empresaId],
      );
    };

    it('control: la copia de la fila de A con otro id y sin la referencia cruzada se inserta', async () => {
      const { A } = await sembrado();
      const resultado = await comoApi(A.base.empresaId, () => insertarCopia(A, null));
      expect(resultado.rowCount).toBe(1);
    });

    it('insertar una fila de A que apunta a una de B falla por la llave foránea, igual que con un id inexistente', async () => {
      const { A, B } = await sembrado();
      const cruzada = await comoApi(A.base.empresaId, () =>
        errorDe(insertarCopia(A, deB(B, objetivo))),
      );
      const inexistente = await comoApi(A.base.empresaId, () =>
        errorDe(insertarCopia(A, randomUUID())),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint, 'llave foránea nombrada').toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
    });

    it('actualizar una fila de A para que apunte a una de B falla por la llave foránea y no cambia la fila', async () => {
      const { A, B } = await sembrado();
      const antes = await fotoDe(tabla, A.base.empresaId);
      const actualizar = (valor: string) =>
        apiCliente.query(
          `UPDATE ${tabla} SET ${columna} = $1${setExtra ?? ''} WHERE empresa_id = $2`,
          [valor, A.base.empresaId],
        );
      const cruzada = await comoApi(A.base.empresaId, () => errorDe(actualizar(deB(B, objetivo))));
      const inexistente = await comoApi(A.base.empresaId, () => errorDe(actualizar(randomUUID())));
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code, inexistente.message).toBe('23503');
      expect(cruzada.constraint).toBe(inexistente.constraint);
      expect(await fotoDe(tabla, A.base.empresaId)).toEqual(antes);
    });
  },
);

// ------------------------------------------------------------------------------------------------
// 133 · Concurrencia con un pool de 2
// ------------------------------------------------------------------------------------------------
describe('criterio 133 · dos puentes con un pool de 2 conexiones', () => {
  it('cien rondas de pedir trabajos y reportar resultados en paralelo: cada puente solo ve y cambia los suyos', async () => {
    const m = await construirMundoP6(ctx, sa);
    const PROPIOS = 10;
    const deA: string[] = [];
    const deB: string[] = [];
    for (let i = 0; i < PROPIOS; i++) {
      deA.push(await crearPrueba(ctx, m.A.tokenAdmin, m.A.S1, m.impA1));
      deB.push(await crearPrueba(ctx, m.B.tokenAdmin, m.B.S1, m.impB1));
    }
    const lados = [
      { nombre: 'A', puente: m.puA1, propios: deA, ajenos: deB },
      { nombre: 'B', puente: m.puB1, propios: deB, ajenos: deA },
    ];

    const problemas: string[] = [];
    const tareas: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      for (const lado of lados) {
        tareas.push(
          (async () => {
            const lista = await llamarPuente(ctx, lado.puente.token, 'get', '/puente/trabajos');
            if (lista.status !== 200) {
              problemas.push(
                `${lado.nombre} #${i}: GET dio ${lista.status} ${JSON.stringify(lista.body)}`,
              );
              return;
            }
            for (const t of lista.body as { id: string; impresoraId: string }[]) {
              if (!lado.propios.includes(t.id))
                problemas.push(`${lado.nombre} #${i}: vio el trabajo ajeno ${t.id}`);
            }
            const propio = lado.propios[i % lado.propios.length]!;
            const reporte = await llamarPuente(
              ctx,
              lado.puente.token,
              'post',
              `/puente/trabajos/${propio}/resultado`,
              { resultado: 'NO_IMPRESO', error: `intento ${i}` },
            );
            if (reporte.status !== 200) {
              problemas.push(
                `${lado.nombre} #${i}: resultado propio dio ${reporte.status} ${JSON.stringify(reporte.body)}`,
              );
            }
            if (i % 4 === 0) {
              const ajeno = lado.ajenos[i % lado.ajenos.length]!;
              const cruzado = await llamarPuente(
                ctx,
                lado.puente.token,
                'post',
                `/puente/trabajos/${ajeno}/resultado`,
                { resultado: 'IMPRESO' },
              );
              if (cruzado.status !== 404) {
                problemas.push(`${lado.nombre} #${i}: resultado ajeno dio ${cruzado.status}`);
              }
            }
          })(),
        );
      }
    }
    await Promise.all(tareas);
    exigirSinFallos(problemas);

    // Cada empresa suma exactamente sus cien intentos y ninguno de sus trabajos quedó impreso por el otro.
    for (const [nombre, empresaId] of [
      ['A', m.A.empresaId],
      ['B', m.B.empresaId],
    ] as const) {
      const r = await admin.query<{ intentos: string; pendientes: string; impresos: string }>(
        `SELECT coalesce(sum(intentos), 0)::text AS intentos,
                count(*) FILTER (WHERE estado = 'PENDIENTE')::text AS pendientes,
                count(*) FILTER (WHERE estado = 'IMPRESO' OR impreso_en IS NOT NULL)::text AS impresos
           FROM trabajo_impresion WHERE empresa_id = $1`,
        [empresaId],
      );
      expect(r.rows[0], `empresa ${nombre}`).toEqual({
        intentos: '100',
        pendientes: '10',
        impresos: '0',
      });
    }

    // Y ahora cada uno imprime todo lo suyo, otra vez en paralelo.
    const impresiones = await Promise.all(
      lados.flatMap((lado) =>
        lado.propios.map((id) =>
          llamarPuente(ctx, lado.puente.token, 'post', `/puente/trabajos/${id}/resultado`, {
            resultado: 'IMPRESO',
          }),
        ),
      ),
    );
    expect(impresiones.map((r) => r.status)).toEqual(Array(impresiones.length).fill(200));
    for (const lado of lados) {
      expect(await trabajosDelPuente(ctx, lado.puente), `cola de ${lado.nombre}`).toEqual([]);
    }
    const fin = await admin.query<{ empresa_id: string; impresos: string }>(
      `SELECT empresa_id, count(*) FILTER (WHERE estado = 'IMPRESO')::text AS impresos
         FROM trabajo_impresion WHERE empresa_id = ANY($1::uuid[]) GROUP BY empresa_id`,
      [[m.A.empresaId, m.B.empresaId]],
    );
    expect(fin.rows.map((f) => f.impresos)).toEqual(['10', '10']);
  });
});
