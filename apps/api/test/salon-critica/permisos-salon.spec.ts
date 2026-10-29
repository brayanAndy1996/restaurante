// spec: 004-salon-cocina (pruebas protegidas)
//
// P3 (parte 2) · Permisos de las rutas de salón y cocina (ruta crítica), criterios 78 y 79 (y el 10 y el 44 en lo
// que toca a las sesiones de soporte):
// - 78: toda ruta registrada en Nest de `/salon`, `/ordenes`, `/cocina` y `/sucursales/:sucursalId/zonas…` o
//   `/mesas…` lleva exactamente la acción de la tabla de endpoints y el módulo que corresponde (las rutas se
//   recorren en Nest, no desde una lista fija: falla si una no está clasificada o tiene otra acción);
// - 79: cada rol sin permiso, con sesión de contraseña y de PIN, recibe 403 `PROHIBIDO` en cada ruta sin cambiar
//   filas, sin auditoría, sin llamadas al inventario y sin eventos; el rol es el de la sucursal activa (Mozo en
//   S1 y Cocina/Barra en S2); sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`; con el módulo `SALON` o `COCINA`
//   fuera del plan, 403 `MODULO_NO_INCLUIDO`; las sesiones de soporte son Administrador y quedan trazadas con el
//   superadministrador.
// Hoy las rutas existen sin `@Permiso` ni `@RequiereModulo`: las pruebas fallan por la clasificación y con 500
// `ERROR_INTERNO` ("No implementado") en lugar de 403, 409 o 2xx.
import { randomUUID } from 'node:crypto';
import { requisitoPermiso, type Rol } from '@restaurante/dominio';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PERMISO,
  PUBLICA,
  REQUIERE_MODULO,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from '../../src/modulos/seguridad';
import { abrirCliente, rutasDeNest } from '../utilidades';
import { bearer, partesDeToken } from '../acceso/fabrica-plataforma';
import {
  PoolDeMesas,
  RUTAS_SALON,
  TIPOS_DE_SESION,
  abrirOrden,
  abrirSesiones,
  anularItem,
  anularOrden,
  arrancarP3,
  asentar,
  auditoriaNueva,
  auditoriaSalon,
  autorDeFila,
  crearEscenarioP3,
  crearPersona,
  cuerpoDeAnulacion,
  enviar,
  esperarError,
  exigirEstado,
  exigirSinFallos,
  filasDe,
  idsAleatoriosSalon,
  idsRealesSalon,
  instantaneaSalon,
  leerCocina,
  leerOrden,
  liberarMesa,
  lineaGaseosa,
  llamar,
  ordenConItems,
  sembrarCartaSalon,
  sesiones,
  unaFilaDe,
  unico,
  type AccionDeSalon,
  type AppP3,
  type CartaSalon,
  type EscenarioP3,
  type IdsDeRutaSalon,
  type PersonaConSesion,
  type RutaSalon,
} from './fabrica-p3';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP3;
let admin: Client;
let escPendiente: Promise<EscenarioP3> | undefined;
let cartaPendiente: Promise<CartaSalon> | undefined;
let mesasPendientes: Promise<PoolDeMesas> | undefined;

beforeAll(async () => {
  ctx = await arrancarP3();
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const esc = () => (escPendiente ??= crearEscenarioP3(ctx));
const carta = () => (cartaPendiente ??= esc().then((e) => sembrarCartaSalon(ctx, e.A.tokenAdmin)));
const mesasS1 = () =>
  (mesasPendientes ??= esc().then((e) => new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1)));

/** `:id`, `:sucursalId`, `:itemId`… valen lo mismo para comparar con la tabla de endpoints. */
const normal = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, ':p');

/** Las rutas que cubre el criterio 78. */
const esRutaDeSalon = (ruta: string): boolean =>
  ruta === '/salon' ||
  ruta.startsWith('/salon/') ||
  ruta === '/ordenes' ||
  ruta.startsWith('/ordenes/') ||
  ruta === '/cocina' ||
  ruta.startsWith('/cocina/') ||
  /^\/sucursales\/:[A-Za-z]+\/(zonas|mesas)(\/|$)/.test(ruta);

// ------------------------------------------------------------------------------------------------
// 78 · La matriz y la clasificación de las rutas
// ------------------------------------------------------------------------------------------------
describe('criterio 78 · la matriz de permisos no cambia', () => {
  const ROLES: Rol[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'];
  const fila = (accion: Parameters<typeof requisitoPermiso>[1]) =>
    ROLES.map((rol) => requisitoPermiso(rol, accion));

  it('las seis acciones de salón y cocina tienen la fila de 002', () => {
    expect(fila('ATENDER_MESA')).toEqual([
      'permitido',
      'permitido',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('MOVER_UNIR_MESAS')).toEqual([
      'permitido',
      'permitido',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('ANULAR_ITEM_ENVIADO')).toEqual([
      'clave',
      'clave',
      'prohibido',
      'permitido',
      'permitido',
    ]);
    expect(fila('ANULAR_ORDEN')).toEqual(['clave', 'clave', 'prohibido', 'permitido', 'permitido']);
    expect(fila('USAR_KDS')).toEqual([
      'prohibido',
      'prohibido',
      'permitido',
      'permitido',
      'permitido',
    ]);
    expect(fila('ADMINISTRAR')).toEqual([
      'prohibido',
      'prohibido',
      'prohibido',
      'prohibido',
      'permitido',
    ]);
  });
});

describe('criterio 78 · toda ruta de salón, órdenes, cocina, zonas y mesas está clasificada', () => {
  it('las rutas registradas en Nest son exactamente las de la tabla de endpoints y cada una tiene su acción y su módulo', async () => {
    await esc(); // la aplicación ya está arriba
    const registradas = rutasDeNest(ctx.app).filter((r) => esRutaDeSalon(r.ruta));
    const esperadas = new Map<string, RutaSalon>(RUTAS_SALON.map((r) => [r.clave, r]));
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
      const accion = leer<string>(PERMISO) ?? 'NINGUNA';
      const modulo = leer<string>(REQUIERE_MODULO) ?? null;
      const esperada = esperadas.get(clave);
      if (esperada === undefined) {
        problemas.push(`${clave}: ruta sin clasificar (tiene ${accion})`);
        continue;
      }
      if (accion !== esperada.accion) {
        problemas.push(`${clave}: debería ser ${esperada.accion} y es ${accion}`);
      }
      if (modulo !== esperada.modulo) {
        problemas.push(`${clave}: debería exigir el módulo ${esperada.modulo} y exige ${modulo}`);
      }
      // Las de operación implican sucursal activa (con el módulo); las de configuración no la exigen.
      const exigeSucursal = leer<boolean>(REQUIERE_SUCURSAL) ?? false;
      if (esperada.modulo !== null && !exigeSucursal) {
        problemas.push(`${clave}: falta la sucursal activa (lo implica @RequiereModulo)`);
      }
      if (esperada.modulo === null && exigeSucursal) {
        problemas.push(`${clave}: la configuración no exige sucursal activa`);
      }
      if (leer<boolean>(SOLO_ADMINISTRADOR) === true) {
        problemas.push(`${clave}: debe usar @Permiso, no @SoloAdministrador`);
      }
      if (leer<boolean>(PUBLICA) === true) problemas.push(`${clave}: no puede ser pública`);
    }
    for (const clave of esperadas.keys()) {
      if (!vistas.has(clave)) problemas.push(`${clave}: falta la ruta`);
    }
    expect(registradas.length).toBeGreaterThan(0);
    exigirSinFallos(problemas);
  });

  it('la tabla de endpoints tiene las 23 rutas de 3a y las seis acciones', () => {
    expect(RUTAS_SALON).toHaveLength(23);
    expect(new Set(RUTAS_SALON.map((r) => r.accion))).toEqual(
      new Set<AccionDeSalon>([
        'ADMINISTRAR',
        'ATENDER_MESA',
        'MOVER_UNIR_MESAS',
        'ANULAR_ITEM_ENVIADO',
        'ANULAR_ORDEN',
        'USAR_KDS',
      ]),
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 79 · Rechazos por rol
// ------------------------------------------------------------------------------------------------
type CasoDeRol = {
  rol: string;
  persona: (e: EscenarioP3) => PersonaConSesion;
  /** Acciones que el rol tiene como `prohibido`. */
  prohibidas: AccionDeSalon[];
};

const CASOS_DE_ROL: CasoDeRol[] = [
  {
    rol: 'Cocina/Barra',
    persona: (e) => e.A.cocina,
    prohibidas: [
      'ATENDER_MESA',
      'MOVER_UNIR_MESAS',
      'ANULAR_ITEM_ENVIADO',
      'ANULAR_ORDEN',
      'ADMINISTRAR',
    ],
  },
  { rol: 'Mozo', persona: (e) => e.A.mozo, prohibidas: ['USAR_KDS', 'ADMINISTRAR'] },
  { rol: 'Cajero', persona: (e) => e.A.cajero, prohibidas: ['USAR_KDS', 'ADMINISTRAR'] },
  { rol: 'Supervisor', persona: (e) => e.A.supervisor, prohibidas: ['ADMINISTRAR'] },
];

const rutasProhibidas = (caso: CasoDeRol) =>
  RUTAS_SALON.filter((r) => caso.prohibidas.includes(r.accion));

describe('criterio 79 · cada rol sin permiso recibe 403 PROHIBIDO en cada ruta (ids cualquiera)', () => {
  for (const caso of CASOS_DE_ROL) {
    for (const tipo of TIPOS_DE_SESION) {
      it(`${caso.rol} con sesión de ${tipo}: 403 en las rutas de ${caso.prohibidas.join(', ')}`, async () => {
        const e = await esc();
        const s = await sesiones(ctx, caso.persona(e), e.A.S1);
        const fallos: string[] = [];
        for (const ruta of rutasProhibidas(caso)) {
          // El 403 de rol sale antes de mirar si el recurso existe: los ids son cualquiera.
          const res = await llamar(ctx, s[tipo], ruta.construir(idsAleatoriosSalon(e.A.S1)));
          const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
          if (res.status !== 403 || codigo !== 'PROHIBIDO') {
            fallos.push(`${ruta.clave}: se esperaba 403 PROHIBIDO y fue ${res.status} ${codigo}`);
          }
        }
        exigirSinFallos(fallos);
      });
    }
  }

  it('el 403 tiene la forma { codigo, mensaje } y no deja ver detalles de la base', async () => {
    const e = await esc();
    const s = await sesiones(ctx, e.A.cocina, e.A.S1);
    const ruta = RUTAS_SALON.find((r) => r.clave === 'POST /ordenes/:p/envios')!;
    esperarError(await llamar(ctx, s.contrasena, ruta.construir(idsAleatoriosSalon(e.A.S1))), 403, 'PROHIBIDO');
  });
});

describe('criterio 79 · los rechazos no cambian filas ni auditoría, no llaman al inventario y no publican eventos', () => {
  for (const caso of CASOS_DE_ROL) {
    for (const tipo of TIPOS_DE_SESION) {
      it(`${caso.rol} con sesión de ${tipo}: con datos reales, nada cambia`, async () => {
        const e = await esc();
        const c = await carta();
        const mozo = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
        const pool = await mesasS1();
        const o = await ordenConItems(ctx, pool, c, mozo);
        const ids = await idsRealesSalon(admin, e.A.S1, o, await pool.siguiente(), c.gaseosaId);
        const s = await sesiones(ctx, caso.persona(e), e.A.S1);
        await asentar();
        ctx.publicador.limpiar();
        ctx.inventario.limpiar();
        const tablasAntes = await instantaneaSalon(admin, e.A.empresaId);
        const auditoriaAntes = await auditoriaSalon(admin, e.A.empresaId);
        const fallos: string[] = [];
        for (const ruta of rutasProhibidas(caso)) {
          const res = await llamar(ctx, s[tipo], ruta.construir(ids));
          const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
          if (res.status !== 403 || codigo !== 'PROHIBIDO') {
            fallos.push(`${ruta.clave}: se esperaba 403 PROHIBIDO y fue ${res.status} ${codigo}`);
          }
        }
        exigirSinFallos(fallos);
        expect(await instantaneaSalon(admin, e.A.empresaId)).toEqual(tablasAntes);
        expect(await auditoriaSalon(admin, e.A.empresaId)).toEqual(auditoriaAntes);
        expect(ctx.inventario.llamadas()).toEqual([]);
        await asentar();
        expect(ctx.publicador.eventos()).toEqual([]);
        // La orden sigue como estaba.
        const despues = await leerOrden(ctx, mozo, o.ordenId);
        expect(despues).toMatchObject({ estado: 'ABIERTA', comensales: 2, total: '161.20' });
      });
    }
  }

  it('Mozo y Cajero tampoco ven el KDS con datos reales: el KDS no cambia', async () => {
    const e = await esc();
    const c = await carta();
    const mozo = await sesiones(ctx, e.A.mozo, e.A.S1);
    const o = await ordenConItems(ctx, await mesasS1(), c, mozo.contrasena);
    const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
    const antes = await leerCocina(ctx, cocina);
    const ids = await idsRealesSalon(admin, e.A.S1, o, await (await mesasS1()).siguiente(), c.gaseosaId);
    for (const tipo of TIPOS_DE_SESION) {
      for (const [, persona] of [
        ['Mozo', e.A.mozo],
        ['Cajero', e.A.cajero],
      ] as const) {
        const s = await sesiones(ctx, persona, e.A.S1);
        for (const ruta of RUTAS_SALON.filter((r) => r.accion === 'USAR_KDS')) {
          esperarError(await llamar(ctx, s[tipo], ruta.construir(ids)), 403, 'PROHIBIDO');
        }
      }
    }
    const despues = await leerCocina(ctx, cocina);
    expect({ pendientes: despues.pendientes, recientes: despues.recientes }).toEqual({
      pendientes: antes.pendientes,
      recientes: antes.recientes,
    });
  });

  it('los roles con permiso no reciben 403 PROHIBIDO en sus propias rutas (Supervisor y Administrador en todas las de operación)', async () => {
    const e = await esc();
    const c = await carta();
    const mozo = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
    const o = await ordenConItems(ctx, await mesasS1(), c, mozo);
    const ids = await idsRealesSalon(admin, e.A.S1, o, await (await mesasS1()).siguiente(), c.gaseosaId);
    const fallos: string[] = [];
    for (const persona of [e.A.supervisor, e.A.base.admin]) {
      const s = await sesiones(ctx, persona, e.A.S1);
      // Solo las lecturas: no se consume la orden de ejemplo.
      for (const clave of ['GET /salon', 'GET /ordenes/:p', 'GET /cocina/comandas', 'GET /salon/stock']) {
        const ruta = RUTAS_SALON.find((r) => r.clave === clave)!;
        const res = await llamar(ctx, s.contrasena, ruta.construir(ids));
        if (res.status !== 200) fallos.push(`${clave}: se esperaba 200 y fue ${res.status}`);
      }
    }
    exigirSinFallos(fallos);
  });
});

// ------------------------------------------------------------------------------------------------
// 79 · El rol es el de la sucursal activa
// ------------------------------------------------------------------------------------------------
describe('criterio 79 · el rol es el de la sucursal activa', () => {
  for (const tipo of TIPOS_DE_SESION) {
    it(`Mozo en S1 y Cocina/Barra en S2 (sesión de ${tipo}): con S1 activa atiende mesas y no usa el KDS; con S2 activa recibe 403 al enviar y usa el KDS`, async () => {
      const e = await esc();
      const c = await carta();
      const mixto = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'MOZO' },
        { sucursalId: e.A.S2, rol: 'COCINA_BARRA' },
      ]);
      const enS1 = (await sesiones(ctx, mixto, e.A.S1))[tipo];
      const enS2 = (await sesiones(ctx, mixto, e.A.S2))[tipo];
      const pool = await mesasS1();
      const mesa = await pool.siguiente();

      // S1: es Mozo.
      const abrir = await abrirOrden(ctx, enS1, { mesaId: mesa.id });
      exigirEstado(abrir, 201, 'abrir con S1 activa');
      const ordenId = abrir.body.id as string;
      exigirEstado(await enviar(ctx, enS1, ordenId, [lineaGaseosa(c, 1)]), 201, 'enviar con S1 activa');
      esperarError(
        await llamar(ctx, enS1, { metodo: 'get', ruta: '/cocina/comandas' }),
        403,
        'PROHIBIDO',
      );

      // S2: es Cocina/Barra. Nada cambia en S1 ni en S2.
      await asentar();
      ctx.publicador.limpiar();
      ctx.inventario.limpiar();
      const tablasAntes = await instantaneaSalon(admin, e.A.empresaId);
      const auditoriaAntes = await auditoriaSalon(admin, e.A.empresaId);
      esperarError(await enviar(ctx, enS2, ordenId, [lineaGaseosa(c, 1)]), 403, 'PROHIBIDO');
      esperarError(await llamar(ctx, enS2, { metodo: 'get', ruta: '/salon' }), 403, 'PROHIBIDO');
      esperarError(await abrirOrden(ctx, enS2, { mesaId: mesa.id }), 403, 'PROHIBIDO');
      esperarError(await liberarMesa(ctx, enS2, ordenId), 403, 'PROHIBIDO');
      esperarError(await anularOrden(ctx, enS2, ordenId), 403, 'PROHIBIDO');
      esperarError(
        await anularItem(ctx, enS2, ordenId, randomUUID(), cuerpoDeAnulacion()),
        403,
        'PROHIBIDO',
      );
      const kds = await llamar(ctx, enS2, { metodo: 'get', ruta: '/cocina/comandas' });
      exigirEstado(kds, 200, 'el KDS con S2 activa');
      expect(await instantaneaSalon(admin, e.A.empresaId)).toEqual(tablasAntes);
      expect(await auditoriaSalon(admin, e.A.empresaId)).toEqual(auditoriaAntes);
      expect(ctx.inventario.llamadas()).toEqual([]);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);
    });

    it(`Cocina/Barra en S1 y Mozo en S2 (sesión de ${tipo}): con S1 activa no atiende mesas; con S2 activa sí`, async () => {
      const e = await esc();
      const mixto = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'COCINA_BARRA' },
        { sucursalId: e.A.S2, rol: 'MOZO' },
      ]);
      const enS1 = (await sesiones(ctx, mixto, e.A.S1))[tipo];
      const enS2 = (await sesiones(ctx, mixto, e.A.S2))[tipo];
      esperarError(await llamar(ctx, enS1, { metodo: 'get', ruta: '/salon' }), 403, 'PROHIBIDO');
      exigirEstado(await llamar(ctx, enS1, { metodo: 'get', ruta: '/cocina/comandas' }), 200, 'KDS en S1');
      exigirEstado(await llamar(ctx, enS2, { metodo: 'get', ruta: '/salon' }), 200, 'salón en S2');
      esperarError(await llamar(ctx, enS2, { metodo: 'get', ruta: '/cocina/comandas' }), 403, 'PROHIBIDO');
    });
  }

  it('cambiar de sucursal en la misma sesión cambia lo que puede hacer desde la siguiente petición', async () => {
    const e = await esc();
    const mixto = await crearPersona(ctx, e.A.tokenAdmin, [
      { sucursalId: e.A.S1, rol: 'MOZO' },
      { sucursalId: e.A.S2, rol: 'COCINA_BARRA' },
    ]);
    const s = await abrirSesiones(ctx, mixto, e.A.S1);
    for (const tipo of TIPOS_DE_SESION) {
      const token = s[tipo];
      exigirEstado(await llamar(ctx, token, { metodo: 'get', ruta: '/salon' }), 200, 'salón en S1');
      exigirEstado(
        await llamar(ctx, token, { metodo: 'put', ruta: '/sesion/sucursal', cuerpo: { sucursalId: e.A.S2 } }),
        200,
        'elegir S2',
      );
      esperarError(await llamar(ctx, token, { metodo: 'get', ruta: '/salon' }), 403, 'PROHIBIDO');
      exigirEstado(await llamar(ctx, token, { metodo: 'get', ruta: '/cocina/comandas' }), 200, 'KDS en S2');
      exigirEstado(
        await llamar(ctx, token, { metodo: 'put', ruta: '/sesion/sucursal', cuerpo: { sucursalId: e.A.S1 } }),
        200,
        'elegir S1',
      );
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 79 · Sin sucursal activa
// ------------------------------------------------------------------------------------------------
describe('criterio 79 · sin sucursal activa, 409 SUCURSAL_NO_ELEGIDA', () => {
  it.each(TIPOS_DE_SESION)(
    'un Mozo con dos sucursales y ninguna activa (sesión de %s): toda ruta de operación de salón responde 409 y no cambia nada',
    async (tipo) => {
      const e = await esc();
      const mozo2s = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'MOZO' },
        { sucursalId: e.A.S2, rol: 'MOZO' },
      ]);
      const token = (await sesiones(ctx, mozo2s, null))[tipo];
      const sesion = await llamar(ctx, token, { metodo: 'get', ruta: '/sesion' });
      expect(sesion.body.sucursal, 'entra sin sucursal activa').toBeNull();
      await asentar();
      ctx.publicador.limpiar();
      const tablasAntes = await instantaneaSalon(admin, e.A.empresaId);
      const fallos: string[] = [];
      for (const ruta of RUTAS_SALON.filter((r) => r.modulo === 'SALON')) {
        const res = await llamar(ctx, token, ruta.construir(idsAleatoriosSalon(e.A.S1)));
        const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
        // Anular pide clave al Mozo, pero la sucursal activa se exige antes.
        if (res.status !== 409 || codigo !== 'SUCURSAL_NO_ELEGIDA') {
          fallos.push(`${ruta.clave}: se esperaba 409 SUCURSAL_NO_ELEGIDA y fue ${res.status} ${codigo}`);
        }
      }
      exigirSinFallos(fallos);
      expect(await instantaneaSalon(admin, e.A.empresaId)).toEqual(tablasAntes);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);
    },
  );

  it.each(TIPOS_DE_SESION)(
    'Cocina/Barra con dos sucursales y ninguna activa (sesión de %s): las rutas del KDS responden 409',
    async (tipo) => {
      const e = await esc();
      const cocina2s = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'COCINA_BARRA' },
        { sucursalId: e.A.S2, rol: 'COCINA_BARRA' },
      ]);
      const token = (await sesiones(ctx, cocina2s, null))[tipo];
      const fallos: string[] = [];
      for (const ruta of RUTAS_SALON.filter((r) => r.modulo === 'COCINA')) {
        const res = await llamar(ctx, token, ruta.construir(idsAleatoriosSalon(e.A.S1)));
        const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
        if (res.status !== 409 || codigo !== 'SUCURSAL_NO_ELEGIDA') {
          fallos.push(`${ruta.clave}: se esperaba 409 SUCURSAL_NO_ELEGIDA y fue ${res.status} ${codigo}`);
        }
      }
      exigirSinFallos(fallos);
    },
  );

  it('el Administrador sin sucursal activa recibe 409 en las rutas de operación, pero configura el mapa de cualquier sucursal', async () => {
    const e = await esc();
    const token = (await sesiones(ctx, e.A.base.admin, null)).contrasena;
    const sesion = await llamar(ctx, token, { metodo: 'get', ruta: '/sesion' });
    expect(sesion.body.sucursal, 'el Administrador entra sin sucursal activa').toBeNull();
    for (const ruta of RUTAS_SALON.filter((r) => r.modulo !== null)) {
      esperarError(await llamar(ctx, token, ruta.construir(idsAleatoriosSalon(e.A.S1))), 409, 'SUCURSAL_NO_ELEGIDA');
    }
    const lista = await llamar(ctx, token, { metodo: 'get', ruta: `/sucursales/${e.A.S2}/zonas` });
    exigirEstado(lista, 200, 'listar zonas de S2 sin sucursal activa');
    const crear = await llamar(ctx, token, {
      metodo: 'post',
      ruta: `/sucursales/${e.A.S2}/zonas`,
      cuerpo: { nombre: unico('Terraza'), columnas: 4, filas: 3 },
    });
    exigirEstado(crear, 201, 'crear una zona en S2 sin sucursal activa');
  });
});

// ------------------------------------------------------------------------------------------------
// 79 · Módulo fuera del plan
// ------------------------------------------------------------------------------------------------
describe('criterio 79 · con el módulo SALON o COCINA fuera del plan, 403 MODULO_NO_INCLUIDO', () => {
  let sucursalS3 = '';

  async function crearPlan(modulos: string[]): Promise<string> {
    const e = await esc();
    const res = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(e.sa.token))
      .send({
        codigo: `P-${randomUUID().slice(0, 8)}`,
        nombre: 'Plan de prueba de módulos',
        diasGracia: 7,
        modulos,
        porDefecto: false,
        activo: true,
        motivo: unico('plan'),
      });
    exigirEstado(res, 201, 'crear el plan');
    return res.body.id as string;
  }

  async function ponerPlan(modulos: string[]): Promise<void> {
    const e = await esc();
    const planId = await crearPlan(modulos);
    const res = await ctx
      .http()
      .patch(`/plataforma/suscripciones/${e.A.base.suscripciones[sucursalS3]!.id}`)
      .set(bearer(e.sa.token))
      .send({ planId, motivo: 'Cambio de plan de prueba' });
    exigirEstado(res, 200, 'cambiar el plan de S3');
  }

  async function personasDeS3() {
    const e = await esc();
    sucursalS3 = e.A.S3!;
    const supervisor = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: sucursalS3, rol: 'SUPERVISOR' }]);
    const mozo = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: sucursalS3, rol: 'MOZO' }]);
    const cocina = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: sucursalS3, rol: 'COCINA_BARRA' }]);
    return { supervisor, mozo, cocina };
  }

  /** Claves de las rutas que deben responder 403 MODULO_NO_INCLUIDO y las que no. */
  async function probar(
    token: string,
    rutas: RutaSalon[],
    ids: IdsDeRutaSalon,
    seBloquean: (r: RutaSalon) => boolean,
  ): Promise<string[]> {
    const fallos: string[] = [];
    for (const ruta of rutas) {
      const res = await llamar(ctx, token, ruta.construir(ids));
      const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
      if (seBloquean(ruta)) {
        if (res.status !== 403 || codigo !== 'MODULO_NO_INCLUIDO') {
          fallos.push(`${ruta.clave}: se esperaba 403 MODULO_NO_INCLUIDO y fue ${res.status} ${codigo}`);
        }
      } else if (codigo === 'MODULO_NO_INCLUIDO' || res.status >= 500) {
        fallos.push(`${ruta.clave}: no debía depender de ese módulo y fue ${res.status} ${codigo}`);
      }
    }
    return fallos;
  }

  it.each(TIPOS_DE_SESION)(
    'un plan sin SALON ni COCINA bloquea todas las rutas de operación y no cambia nada; el mapa se sigue configurando (sesión de %s)',
    async (tipo) => {
      const e = await esc();
      const { supervisor, mozo, cocina } = await personasDeS3();
      await ponerPlan(['CAJA', 'REPORTES']);
      const ids = idsAleatoriosSalon(sucursalS3);
      await asentar();
      ctx.publicador.limpiar();
      ctx.inventario.limpiar();
      const tablasAntes = await instantaneaSalon(admin, e.A.empresaId);
      const auditoriaAntes = await auditoriaSalon(admin, e.A.empresaId);
      const fallos: string[] = [];
      const operacion = RUTAS_SALON.filter((r) => r.modulo !== null);
      fallos.push(...(await probar((await sesiones(ctx, supervisor, sucursalS3))[tipo], operacion, ids, () => true)));
      // Cada rol con permiso, en su propio módulo.
      fallos.push(
        ...(await probar(
          (await sesiones(ctx, mozo, sucursalS3))[tipo],
          operacion.filter((r) => r.modulo === 'SALON'),
          ids,
          () => true,
        )),
      );
      fallos.push(
        ...(await probar(
          (await sesiones(ctx, cocina, sucursalS3))[tipo],
          operacion.filter((r) => r.modulo === 'COCINA'),
          ids,
          () => true,
        )),
      );
      const adminS3 = (await sesiones(ctx, e.A.base.admin, sucursalS3))[tipo];
      fallos.push(...(await probar(adminS3, operacion, ids, () => true)));
      exigirSinFallos(fallos);
      expect(await instantaneaSalon(admin, e.A.empresaId)).toEqual(tablasAntes);
      expect(await auditoriaSalon(admin, e.A.empresaId)).toEqual(auditoriaAntes);
      expect(ctx.inventario.llamadas()).toEqual([]);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);

      // La configuración del mapa no depende del plan (criterio 5 de la sección).
      const zona = await llamar(ctx, adminS3, {
        metodo: 'post',
        ruta: `/sucursales/${sucursalS3}/zonas`,
        cuerpo: { nombre: unico('Zona sin módulo'), columnas: 3, filas: 3 },
      });
      exigirEstado(zona, 201, 'crear una zona en una sucursal sin el módulo SALON');
      exigirEstado(
        await llamar(ctx, adminS3, { metodo: 'get', ruta: `/sucursales/${sucursalS3}/zonas` }),
        200,
        'listar zonas sin el módulo SALON',
      );
    },
  );

  it.each(TIPOS_DE_SESION)(
    'un plan con SALON y sin COCINA bloquea solo las rutas del KDS, y al revés (sesión de %s)',
    async (tipo) => {
      const { supervisor } = await personasDeS3();
      const token = (await sesiones(ctx, supervisor, sucursalS3))[tipo];
      const ids = idsAleatoriosSalon(sucursalS3);
      const operacion = RUTAS_SALON.filter((r) => r.modulo !== null);

      await ponerPlan(['SALON', 'CAJA']);
      exigirSinFallos(await probar(token, operacion, ids, (r) => r.modulo === 'COCINA'));

      await ponerPlan(['COCINA', 'CAJA']);
      exigirSinFallos(await probar(token, operacion, ids, (r) => r.modulo === 'SALON'));

      // El cambio de plan rige desde la siguiente petición, también al devolver los dos módulos.
      await ponerPlan(['SALON', 'COCINA']);
      exigirSinFallos(await probar(token, operacion, ids, () => false));
    },
  );
});

// ------------------------------------------------------------------------------------------------
// 79 · Soporte
// ------------------------------------------------------------------------------------------------
describe('criterio 79 · la sesión de soporte es Administrador y queda trazada con el superadministrador', () => {
  async function abrirSoporte(): Promise<{ token: string; sesionId: string }> {
    const e = await esc();
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${e.A.empresaId}/soporte`)
      .set(bearer(e.sa.token))
      .send({ motivo: unico('Soporte del salón'), sucursalId: e.A.S1 });
    exigirEstado(res, 201, 'abrir soporte');
    const token = res.body.token as string;
    return { token, sesionId: partesDeToken(token).sesionId };
  }

  it('configura el mapa, abre una mesa (con mozoId), envía, anula y libera; cada fila y cada auditoría llevan al superadministrador', async () => {
    const e = await esc();
    const c = await carta();
    const { token, sesionId } = await abrirSoporte();
    const pool = await mesasS1();

    // Configuración: crear una zona deja la fila de auditoría con el superadministrador.
    const antesZona = await auditoriaSalon(admin, e.A.empresaId);
    const zona = await llamar(ctx, token, {
      metodo: 'post',
      ruta: `/sucursales/${e.A.S1}/zonas`,
      cuerpo: { nombre: unico('Zona de soporte'), columnas: 3, filas: 3 },
    });
    exigirEstado(zona, 201, 'soporte crea una zona');
    const filaZona = unaFilaDe(await auditoriaNueva(admin, e.A.empresaId, antesZona), 'crear_zona');
    expect(filaZona).toMatchObject({
      actor_superadministrador_id: e.sa.id,
      actor_usuario_id: null,
      entidad_id: zona.body.id,
      sesion_id: sesionId,
    });
    expect((await autorDeFila(admin, 'zona', zona.body.id as string)).superadministradorId).toBe(e.sa.id);

    // Sin `mozoId` la apertura se rechaza: soporte no es una persona de la empresa.
    const mesa = await pool.siguiente();
    const sinMozo = await abrirOrden(ctx, token, { mesaId: mesa.id });
    expect(sinMozo.status, JSON.stringify(sinMozo.body)).toBe(422);
    expect(JSON.stringify(sinMozo.body.campos)).toContain('mozoId');
    expect((await filasDe(admin, 'orden_mesa', 'mesa_id = $1', [mesa.id])).length).toBe(0);

    // Con `mozoId` abre: la orden queda creada por el superadministrador y a nombre del mozo elegido.
    const abrir = await abrirOrden(ctx, token, { mesaId: mesa.id, mozoId: e.A.mozo.id });
    exigirEstado(abrir, 201, 'soporte abre la mesa');
    const ordenId = abrir.body.id as string;
    expect(abrir.body.mozo.id).toBe(e.A.mozo.id);
    expect(await autorDeFila(admin, 'orden', ordenId)).toEqual({
      usuarioId: null,
      equipoId: null,
      superadministradorId: e.sa.id,
      sistema: null,
    });
    const { rows: mozoRows } = await admin.query<{ mozo_id: string }>(
      `SELECT mozo_id FROM orden WHERE id = $1`,
      [ordenId],
    );
    expect(mozoRows[0]!.mozo_id).toBe(e.A.mozo.id);

    // Envía: cada ítem queda creado por el superadministrador y `comandadoPor` es nulo.
    const envio = await enviar(ctx, token, ordenId, [lineaGaseosa(c, 2)]);
    exigirEstado(envio, 201, 'soporte envía');
    expect(envio.body.items).toHaveLength(1);
    expect(envio.body.items[0].comandadoPor).toBeNull();
    const itemId = envio.body.items[0].id as string;
    expect((await autorDeFila(admin, 'item', itemId)).superadministradorId).toBe(e.sa.id);
    expect((await autorDeFila(admin, 'item', itemId)).usuarioId).toBeNull();
    expect((await autorDeFila(admin, 'envio', envio.body.id as string)).superadministradorId).toBe(e.sa.id);

    // Anula un ítem sin clave: es Administrador. La auditoría lleva al superadministrador y su sesión.
    const antesAnular = await auditoriaSalon(admin, e.A.empresaId);
    const anular = await anularItem(ctx, token, ordenId, itemId, cuerpoDeAnulacion({ cantidad: 1 }));
    exigirEstado(anular, 201, 'soporte anula un ítem sin clave');
    expect(anular.body.autorizadoPor).toBeNull();
    const filaAnular = unaFilaDe(await auditoriaNueva(admin, e.A.empresaId, antesAnular), 'anular_item');
    expect(filaAnular).toMatchObject({
      actor_superadministrador_id: e.sa.id,
      actor_usuario_id: null,
      autorizado_por_id: null,
      sesion_id: sesionId,
      entidad_id: itemId,
    });

    // Anula la orden.
    const antesOrden = await auditoriaSalon(admin, e.A.empresaId);
    exigirEstado(await anularOrden(ctx, token, ordenId), 200, 'soporte anula la orden');
    const filaOrden = unaFilaDe(await auditoriaNueva(admin, e.A.empresaId, antesOrden), 'anular_orden');
    expect(filaOrden).toMatchObject({
      actor_superadministrador_id: e.sa.id,
      actor_usuario_id: null,
      sesion_id: sesionId,
      entidad_id: ordenId,
    });

    // Libera otra mesa sin consumo.
    const otraMesa = await pool.siguiente();
    const otra = await abrirOrden(ctx, token, { mesaId: otraMesa.id, mozoId: e.A.mozo.id });
    exigirEstado(otra, 201, 'soporte abre otra mesa');
    const antesLiberar = await auditoriaSalon(admin, e.A.empresaId);
    exigirEstado(await liberarMesa(ctx, token, otra.body.id as string), 200, 'soporte libera la mesa');
    const filaLiberar = unaFilaDe(await auditoriaNueva(admin, e.A.empresaId, antesLiberar), 'liberar_mesa');
    expect(filaLiberar).toMatchObject({
      actor_superadministrador_id: e.sa.id,
      actor_usuario_id: null,
      sesion_id: sesionId,
    });
  });

  it('usa el KDS y el salón de la sucursal de la sesión, y su mozoId debe ser alguien que atiende mesas', async () => {
    const e = await esc();
    const { token } = await abrirSoporte();
    exigirEstado(await llamar(ctx, token, { metodo: 'get', ruta: '/salon' }), 200, 'salón');
    exigirEstado(await llamar(ctx, token, { metodo: 'get', ruta: '/cocina/comandas' }), 200, 'KDS');
    const mesa = await (await mesasS1()).siguiente();
    // Cocina/Barra no atiende mesas: tampoco puede ser el mozo responsable que elija soporte.
    const res = await abrirOrden(ctx, token, { mesaId: mesa.id, mozoId: e.A.cocina.id });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body.campos)).toContain('mozoId');
  });

  it('las rutas de operación con una sesión de soporte sin sucursal elegida responden 409 como a cualquier Administrador', async () => {
    const e = await esc();
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${e.A.empresaId}/soporte`)
      .set(bearer(e.sa.token))
      .send({ motivo: unico('Soporte sin sucursal') });
    exigirEstado(res, 201, 'abrir soporte sin sucursal');
    esperarError(
      await llamar(ctx, res.body.token as string, { metodo: 'get', ruta: '/salon' }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
    esperarError(
      await llamar(ctx, res.body.token as string, { metodo: 'get', ruta: '/cocina/comandas' }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
  });
});
