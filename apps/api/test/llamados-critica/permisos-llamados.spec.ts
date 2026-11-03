// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P4 (parte 1) · Permisos de las rutas de la carta web, los QR y los llamados (ruta crítica), criterios 58 y 59 (y
// el 11 en lo que toca a la clasificación de las rutas públicas; el 5 en lo que toca a la configuración):
// - 58: toda ruta registrada en Nest de `/llamados…` lleva `ATENDER_MESA` y el módulo `SALON` (con sucursal activa);
//   `/carta-web…`, `/sucursales/:sucursalId/qr-mesas` y `/sucursales/:sucursalId/mesas/:mesaId/qr`, `ADMINISTRAR`
//   sin módulo ni sucursal activa; `/publico/*`, `@Publica()`. Las rutas se recorren en Nest (no desde una lista
//   fija de la prueba): falla si una no está clasificada o tiene otra acción. La matriz de permisos no cambia;
// - 59: cada rol sin permiso, con sesión de contraseña y de PIN, recibe 403 `PROHIBIDO` sin cambiar filas, sin
//   auditoría y sin eventos (Cocina/Barra en `/llamados…`; todos salvo el Administrador en la configuración); el rol
//   es el de la sucursal activa; sin sucursal activa, 409 `SUCURSAL_NO_ELEGIDA`; sin `SALON` en el plan, 403
//   `MODULO_NO_INCLUIDO`; las sesiones de soporte son Administrador.
// Hoy las rutas existen sin `@Permiso`, `@RequiereModulo` ni `@Publica` y lanzan "No implementado": las pruebas
// fallan por la clasificación y con 500 `ERROR_INTERNO` en lugar de 403, 409 o 2xx.
import { randomUUID } from 'node:crypto';
import { ACCIONES, requisitoPermiso, type Rol } from '@restaurante/dominio';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PERMISO,
  PUBLICA,
  REQUIERE_MODULO,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
} from '../../src/modulos/seguridad';
import { bearer } from '../acceso/fabrica-plataforma';
import { pngValido } from '../carta-critica/fabrica-permisos-carta';
import {
  TIPOS_DE_SESION,
  abrirSesiones,
  crearEscenarioP3,
  crearPersona,
  type EscenarioP3,
  type PersonaConSesion,
} from '../salon-critica/fabrica-p3';
import { abrirCliente, rutasDeNest } from '../utilidades';
import {
  CUERPO_404_PUBLICO,
  arrancarAislamiento,
  asentar,
  auditoria005,
  clientePublico,
  crearLlamadoOk,
  crearMundo,
  esperarError,
  exigirEstado,
  exigirSinFallos,
  instantanea005,
  llamar,
  llamarAlMozo,
  pedidoDeLomo,
  sesiones,
  unico,
  type AppP4,
  type Mundo,
} from './fabrica-aislamiento';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP4;
let admin: Client;
let mundoPendiente: Promise<Mundo & { real: IdsDeRuta; pendiente: string }> | undefined;

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2 });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

// ------------------------------------------------------------------------------------------------
// Las rutas de la sección y su clasificación (tabla de endpoints de `spec.md`)
// ------------------------------------------------------------------------------------------------
type Acceso = 'ATENDER_MESA' | 'ADMINISTRAR' | 'PUBLICA';

interface IdsDeRuta {
  sucursalId: string;
  mesaId: string;
  llamadoId: string;
}

interface Ruta005 {
  /** `MÉTODO /ruta` con todos los parámetros escritos `:p` (así se comparan con las que registra Nest). */
  clave: string;
  acceso: Acceso;
  /** El módulo del plan que exige la ruta (`null` en las de configuración y en las públicas). */
  modulo: 'SALON' | null;
  construir: (ids: IdsDeRuta) => Parameters<typeof llamar>[2];
}

const conClave = (): Record<string, string> => ({ 'Idempotency-Key': randomUUID() });

const RUTAS: Ruta005[] = [
  // Llamados de la PWA: ATENDER_MESA y SALON.
  {
    clave: 'GET /llamados',
    acceso: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: () => ({ metodo: 'get', ruta: '/llamados' }),
  },
  {
    clave: 'GET /llamados/:p',
    acceso: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({ metodo: 'get', ruta: `/llamados/${ids.llamadoId}` }),
  },
  {
    clave: 'POST /llamados/:p/atencion',
    acceso: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/llamados/${ids.llamadoId}/atencion`,
      cuerpo: { ordenId: randomUUID(), comensales: 2 },
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'POST /llamados/:p/paso-a-cuenta',
    acceso: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/llamados/${ids.llamadoId}/paso-a-cuenta`,
      cuerpo: { lineas: [{ posicion: 0, cantidad: 1 }] },
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'POST /llamados/:p/descarte',
    acceso: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/llamados/${ids.llamadoId}/descarte`,
      cuerpo: { motivo: 'Pedido falso' },
      cabeceras: conClave(),
    }),
  },
  // Configuración de la carta web y de los QR: ADMINISTRAR, sin módulo ni sucursal activa.
  {
    clave: 'GET /carta-web',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: () => ({ metodo: 'get', ruta: '/carta-web' }),
  },
  {
    clave: 'PUT /carta-web',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: () => ({
      metodo: 'put',
      ruta: '/carta-web',
      cuerpo: {
        nombre: unico('Nombre ajeno'),
        slug: `ajena-${randomUUID().slice(0, 8)}`,
        colorPrincipal: '#112233',
      },
    }),
  },
  {
    clave: 'PUT /carta-web/logo',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: () => ({
      metodo: 'put',
      ruta: '/carta-web/logo',
      binario: { tipo: 'image/png', datos: pngValido(200, 200) },
    }),
  },
  {
    clave: 'DELETE /carta-web/logo',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: () => ({ metodo: 'delete', ruta: '/carta-web/logo' }),
  },
  {
    clave: 'PUT /carta-web/sucursales/:p',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/carta-web/sucursales/${ids.sucursalId}`,
      cuerpo: { slug: `ajena-${randomUUID().slice(0, 8)}`, publicada: false },
    }),
  },
  {
    clave: 'GET /sucursales/:p/qr-mesas',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({ metodo: 'get', ruta: `/sucursales/${ids.sucursalId}/qr-mesas` }),
  },
  {
    clave: 'POST /sucursales/:p/qr-mesas',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({ metodo: 'post', ruta: `/sucursales/${ids.sucursalId}/qr-mesas` }),
  },
  {
    clave: 'POST /sucursales/:p/mesas/:p/qr',
    acceso: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/sucursales/${ids.sucursalId}/mesas/${ids.mesaId}/qr`,
      cabeceras: conClave(),
    }),
  },
  // Públicas: @Publica(), sin permiso ni módulo.
  {
    clave: 'GET /publico/cartas/:p',
    acceso: 'PUBLICA',
    modulo: null,
    construir: () => ({ metodo: 'get', ruta: '/publico/cartas/no-existe' }),
  },
  {
    clave: 'GET /publico/cartas/:p/:p',
    acceso: 'PUBLICA',
    modulo: null,
    construir: () => ({ metodo: 'get', ruta: '/publico/cartas/no-existe/ninguna' }),
  },
  {
    clave: 'GET /publico/cartas/:p/:p/disponibilidad',
    acceso: 'PUBLICA',
    modulo: null,
    construir: () => ({ metodo: 'get', ruta: '/publico/cartas/no-existe/ninguna/disponibilidad' }),
  },
  {
    clave: 'GET /publico/mesas/:p',
    acceso: 'PUBLICA',
    modulo: null,
    construir: () => ({ metodo: 'get', ruta: `/publico/mesas/${'A'.repeat(22)}` }),
  },
  {
    clave: 'POST /publico/mesas/:p/llamados',
    acceso: 'PUBLICA',
    modulo: null,
    construir: () => ({
      metodo: 'post',
      ruta: `/publico/mesas/${'A'.repeat(22)}/llamados`,
      cuerpo: llamarAlMozo(),
    }),
  },
  {
    clave: 'GET /publico/mesas/:p/llamados/:p',
    acceso: 'PUBLICA',
    modulo: null,
    construir: () => ({
      metodo: 'get',
      ruta: `/publico/mesas/${'A'.repeat(22)}/llamados/${randomUUID()}`,
    }),
  },
];

const deLlamados = RUTAS.filter((r) => r.acceso === 'ATENDER_MESA');
const publicas = RUTAS.filter((r) => r.acceso === 'PUBLICA');

/** `:id`, `:sucursalId`, `:codigo`… valen lo mismo para comparar con la tabla de endpoints. */
const normal = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, ':p');

/** Las rutas que cubre el criterio 58. */
const esRutaDe005 = (ruta: string): boolean =>
  ruta === '/llamados' ||
  ruta.startsWith('/llamados/') ||
  ruta === '/carta-web' ||
  ruta.startsWith('/carta-web/') ||
  ruta.startsWith('/publico/') ||
  /^\/sucursales\/:[A-Za-z]+\/qr-mesas$/.test(ruta) ||
  /^\/sucursales\/:[A-Za-z]+\/mesas\/:[A-Za-z]+\/qr$/.test(ruta);

const idsAleatorios = (sucursalId: string): IdsDeRuta => ({
  sucursalId,
  mesaId: randomUUID(),
  llamadoId: randomUUID(),
});

// ------------------------------------------------------------------------------------------------
// El mundo: dos empresas, y en A un llamado pendiente real para que un permiso que se salte cambie algo
// ------------------------------------------------------------------------------------------------
let escPendiente: Promise<EscenarioP3> | undefined;
/** Solo las empresas y sus personas (sin carta web ni mapa): basta para los rechazos por rol y por plan. */
const esc = () => (escPendiente ??= crearEscenarioP3(ctx));

function mundo() {
  mundoPendiente ??= (async () => {
    const m = await crearMundo(ctx);
    const pendiente = randomUUID();
    await crearLlamadoOk(clientePublico(ctx), m.A.mesa12.codigo, llamarAlMozo(pendiente));
    const real: IdsDeRuta = { sucursalId: m.A.S1, mesaId: m.A.mesa4.id, llamadoId: pendiente };
    return { ...m, real, pendiente };
  })();
  return mundoPendiente;
}

// ------------------------------------------------------------------------------------------------
// 58 · La matriz y la clasificación de las rutas
// ------------------------------------------------------------------------------------------------
describe('criterio 58 · la matriz de permisos no cambia', () => {
  const ROLES: Rol[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'];
  const fila = (accion: Parameters<typeof requisitoPermiso>[1]) =>
    ROLES.map((rol) => requisitoPermiso(rol, accion));

  it('ATENDER_MESA y ADMINISTRAR tienen la fila de 002 y no hay acciones nuevas para los llamados ni la carta web', () => {
    expect(fila('ATENDER_MESA')).toEqual([
      'permitido',
      'permitido',
      'prohibido',
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
    const nuevas = (ACCIONES as readonly string[]).filter((a) =>
      /LLAMADO|QR|CARTA_WEB|MESA_PUBLICA/.test(a),
    );
    expect(nuevas, 'la matriz no gana acciones en 005').toEqual([]);
  });
});

describe('criterio 58 · toda ruta de llamados, carta web, QR y públicas está clasificada', () => {
  it('las rutas registradas en Nest son exactamente las de la tabla de endpoints y cada una tiene su acción y su módulo', async () => {
    const registradas = rutasDeNest(ctx.app).filter((r) => esRutaDe005(r.ruta));
    const esperadas = new Map<string, Ruta005>(RUTAS.map((r) => [r.clave, r]));
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
      const permiso = leer<string>(PERMISO) ?? 'NINGUNA';
      const modulo = leer<string>(REQUIERE_MODULO) ?? null;
      const esPublica = leer<boolean>(PUBLICA) === true;
      const esperada = esperadas.get(clave);
      if (esperada === undefined) {
        problemas.push(`${clave}: ruta sin clasificar (tiene ${permiso})`);
        continue;
      }
      if (leer<boolean>(SOLO_ADMINISTRADOR) === true) {
        problemas.push(`${clave}: debe usar @Permiso, no @SoloAdministrador`);
      }
      const exigeSucursal = leer<boolean>(REQUIERE_SUCURSAL) ?? false;
      if (esperada.acceso === 'PUBLICA') {
        if (!esPublica) problemas.push(`${clave}: debe ser @Publica()`);
        if (permiso !== 'NINGUNA')
          problemas.push(`${clave}: una ruta pública no lleva @Permiso (${permiso})`);
        if (modulo !== null)
          problemas.push(`${clave}: una ruta pública no exige módulo (${modulo})`);
        continue;
      }
      if (esPublica) problemas.push(`${clave}: no puede ser pública`);
      if (permiso !== esperada.acceso) {
        problemas.push(`${clave}: debería ser ${esperada.acceso} y es ${permiso}`);
      }
      if (modulo !== esperada.modulo) {
        problemas.push(`${clave}: debería exigir el módulo ${esperada.modulo} y exige ${modulo}`);
      }
      // Las de operación implican sucursal activa (con el módulo); las de configuración no la exigen.
      if (esperada.modulo !== null && !exigeSucursal) {
        problemas.push(`${clave}: falta la sucursal activa (lo implica @RequiereModulo)`);
      }
      if (esperada.modulo === null && exigeSucursal) {
        problemas.push(`${clave}: la configuración no exige sucursal activa`);
      }
    }
    for (const clave of esperadas.keys()) {
      if (!vistas.has(clave)) problemas.push(`${clave}: falta la ruta`);
    }
    expect(registradas.length).toBeGreaterThan(0);
    exigirSinFallos(problemas);
  });
});

// ------------------------------------------------------------------------------------------------
// 59 · Rechazos por rol
// ------------------------------------------------------------------------------------------------
interface CasoDeRol {
  rol: string;
  persona: (e: EscenarioP3) => PersonaConSesion;
  prohibidas: Acceso[];
}

const CASOS_DE_ROL: CasoDeRol[] = [
  { rol: 'Cocina/Barra', persona: (e) => e.A.cocina, prohibidas: ['ATENDER_MESA', 'ADMINISTRAR'] },
  { rol: 'Mozo', persona: (e) => e.A.mozo, prohibidas: ['ADMINISTRAR'] },
  { rol: 'Cajero', persona: (e) => e.A.cajero, prohibidas: ['ADMINISTRAR'] },
  { rol: 'Supervisor', persona: (e) => e.A.supervisor, prohibidas: ['ADMINISTRAR'] },
];

const rutasProhibidas = (caso: CasoDeRol) =>
  RUTAS.filter((r) => caso.prohibidas.includes(r.acceso));

describe('criterio 59 · cada rol sin permiso recibe 403 PROHIBIDO en cada ruta (ids cualquiera)', () => {
  for (const caso of CASOS_DE_ROL) {
    for (const tipo of TIPOS_DE_SESION) {
      it(`${caso.rol} con sesión de ${tipo}: 403 en las rutas de ${caso.prohibidas.join(' y ')}`, async () => {
        const e = await esc();
        const s = await sesiones(ctx, caso.persona(e), e.A.S1);
        const fallos: string[] = [];
        for (const ruta of rutasProhibidas(caso)) {
          // El 403 de rol sale antes de mirar si el recurso existe: los ids son cualquiera.
          const res = await llamar(ctx, s[tipo], ruta.construir(idsAleatorios(e.A.S1)));
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
    esperarError(
      await llamar(ctx, s.contrasena, {
        metodo: 'post',
        ruta: `/llamados/${randomUUID()}/atencion`,
        cuerpo: {},
        cabeceras: conClave(),
      }),
      403,
      'PROHIBIDO',
    );
    esperarError(
      await llamar(ctx, (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena, {
        metodo: 'get',
        ruta: '/carta-web',
      }),
      403,
      'PROHIBIDO',
    );
  });
});

describe('criterio 59 · los rechazos no cambian filas ni auditoría y no publican eventos', () => {
  for (const caso of CASOS_DE_ROL) {
    for (const tipo of TIPOS_DE_SESION) {
      it(`${caso.rol} con sesión de ${tipo}: con datos reales, nada cambia`, async () => {
        const m = await mundo();
        const s = await sesiones(ctx, caso.persona(m.e), m.A.S1);
        await asentar();
        ctx.publicador.limpiar();
        ctx.inventario.limpiar();
        const tablasAntes = await instantanea005(admin, m.A.empresaId);
        const auditoriaAntes = await auditoria005(admin, m.A.empresaId);
        const fallos: string[] = [];
        for (const ruta of rutasProhibidas(caso)) {
          const res = await llamar(ctx, s[tipo], ruta.construir(m.real));
          const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
          if (res.status !== 403 || codigo !== 'PROHIBIDO') {
            fallos.push(`${ruta.clave}: se esperaba 403 PROHIBIDO y fue ${res.status} ${codigo}`);
          }
        }
        exigirSinFallos(fallos);
        expect(await instantanea005(admin, m.A.empresaId)).toEqual(tablasAntes);
        expect(await auditoria005(admin, m.A.empresaId)).toEqual(auditoriaAntes);
        expect(ctx.inventario.llamadas()).toEqual([]);
        await asentar();
        expect(ctx.publicador.eventos()).toEqual([]);
        // El llamado sigue pendiente y la carta web, publicada.
        const estado = await clientePublico(ctx).get(
          `/publico/mesas/${m.A.mesa12.codigo}/llamados/${m.pendiente}`,
        );
        exigirEstado(estado, 200, 'el estado del llamado');
        expect(estado.body.estado).toBe('PENDIENTE');
        exigirEstado(
          await clientePublico(ctx).get(`/publico/cartas/${m.A.slug}/${m.A.slugS1}`),
          200,
          'la carta publicada',
        );
      });
    }
  }

  it('los roles con permiso no reciben 403 PROHIBIDO en sus rutas: la lista de llamados la ven Mozo, Cajero, Supervisor y Administrador; la configuración, el Administrador', async () => {
    const m = await mundo();
    const fallos: string[] = [];
    const personas: [string, PersonaConSesion][] = [
      ['Mozo', m.A.mozo],
      ['Cajero', m.A.cajero],
      ['Supervisor', m.A.supervisor],
      ['Administrador', m.e.A.base.admin],
    ];
    for (const tipo of TIPOS_DE_SESION) {
      for (const [nombre, persona] of personas) {
        const s = await sesiones(ctx, persona, m.A.S1);
        for (const clave of ['GET /llamados', 'GET /llamados/:p']) {
          const ruta = RUTAS.find((r) => r.clave === clave)!;
          const res = await llamar(ctx, s[tipo], ruta.construir(m.real));
          if (res.status !== 200)
            fallos.push(`${nombre} (${tipo}) ${clave}: ${res.status} ${res.text}`);
        }
      }
    }
    const admin1 = (await sesiones(ctx, m.e.A.base.admin, m.A.S1)).contrasena;
    for (const clave of ['GET /carta-web', 'GET /sucursales/:p/qr-mesas']) {
      const ruta = RUTAS.find((r) => r.clave === clave)!;
      const res = await llamar(ctx, admin1, ruta.construir(m.real));
      if (res.status !== 200) fallos.push(`Administrador ${clave}: ${res.status} ${res.text}`);
    }
    exigirSinFallos(fallos);
  });
});

// ------------------------------------------------------------------------------------------------
// 59 · El rol es el de la sucursal activa
// ------------------------------------------------------------------------------------------------
describe('criterio 59 · el rol es el de la sucursal activa', () => {
  for (const tipo of TIPOS_DE_SESION) {
    it(`Mozo en S1 y Cocina/Barra en S2 (sesión de ${tipo}): con S1 activa atiende llamados; con S2 activa recibe 403 al atender y nada cambia`, async () => {
      const e = await esc();
      const mixto = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'MOZO' },
        { sucursalId: e.A.S2, rol: 'COCINA_BARRA' },
      ]);
      const s1 = (await abrirSesiones(ctx, mixto, e.A.S1))[tipo];
      const s2 = (await abrirSesiones(ctx, mixto, e.A.S2))[tipo];
      exigirEstado(
        await llamar(ctx, s1, { metodo: 'get', ruta: '/llamados' }),
        200,
        'lista con S1',
      );
      await asentar();
      ctx.publicador.limpiar();
      const tablasAntes = await instantanea005(admin, e.A.empresaId);
      esperarError(await llamar(ctx, s2, { metodo: 'get', ruta: '/llamados' }), 403, 'PROHIBIDO');
      for (const ruta of deLlamados) {
        esperarError(
          await llamar(ctx, s2, ruta.construir(idsAleatorios(e.A.S1))),
          403,
          'PROHIBIDO',
        );
      }
      expect(await instantanea005(admin, e.A.empresaId)).toEqual(tablasAntes);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);
    });

    it(`Cocina/Barra en S1 y Mozo en S2 (sesión de ${tipo}): con S1 activa no atiende llamados; con S2 activa sí`, async () => {
      const e = await esc();
      const mixto = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'COCINA_BARRA' },
        { sucursalId: e.A.S2, rol: 'MOZO' },
      ]);
      const s = await abrirSesiones(ctx, mixto, e.A.S1);
      const enS2 = await abrirSesiones(ctx, mixto, e.A.S2);
      esperarError(
        await llamar(ctx, s[tipo], { metodo: 'get', ruta: '/llamados' }),
        403,
        'PROHIBIDO',
      );
      exigirEstado(
        await llamar(ctx, enS2[tipo], { metodo: 'get', ruta: '/llamados' }),
        200,
        'lista con S2',
      );
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
      exigirEstado(
        await llamar(ctx, token, { metodo: 'get', ruta: '/llamados' }),
        200,
        'lista en S1',
      );
      exigirEstado(
        await llamar(ctx, token, {
          metodo: 'put',
          ruta: '/sesion/sucursal',
          cuerpo: { sucursalId: e.A.S2 },
        }),
        200,
        'elegir S2',
      );
      esperarError(
        await llamar(ctx, token, { metodo: 'get', ruta: '/llamados' }),
        403,
        'PROHIBIDO',
      );
      exigirEstado(
        await llamar(ctx, token, {
          metodo: 'put',
          ruta: '/sesion/sucursal',
          cuerpo: { sucursalId: e.A.S1 },
        }),
        200,
        'elegir S1',
      );
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 59 · Sin sucursal activa
// ------------------------------------------------------------------------------------------------
describe('criterio 59 · sin sucursal activa, 409 SUCURSAL_NO_ELEGIDA', () => {
  it.each(TIPOS_DE_SESION)(
    'un Mozo con dos sucursales y ninguna activa (sesión de %s): toda ruta de llamados responde 409 y no cambia nada',
    async (tipo) => {
      const e = await esc();
      const mozo2s = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'MOZO' },
        { sucursalId: e.A.S2, rol: 'MOZO' },
      ]);
      const token = (await abrirSesiones(ctx, mozo2s, null))[tipo];
      const sesion = await llamar(ctx, token, { metodo: 'get', ruta: '/sesion' });
      expect(sesion.body.sucursal, 'entra sin sucursal activa').toBeNull();
      await asentar();
      ctx.publicador.limpiar();
      const tablasAntes = await instantanea005(admin, e.A.empresaId);
      const fallos: string[] = [];
      for (const ruta of deLlamados) {
        const res = await llamar(ctx, token, ruta.construir(idsAleatorios(e.A.S1)));
        const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
        if (res.status !== 409 || codigo !== 'SUCURSAL_NO_ELEGIDA') {
          fallos.push(
            `${ruta.clave}: se esperaba 409 SUCURSAL_NO_ELEGIDA y fue ${res.status} ${codigo}`,
          );
        }
      }
      exigirSinFallos(fallos);
      expect(await instantanea005(admin, e.A.empresaId)).toEqual(tablasAntes);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);
    },
  );

  it('el Administrador sin sucursal activa recibe 409 en los llamados, pero configura la carta web y los QR de cualquier sucursal', async () => {
    const e = await esc();
    const token = (await sesiones(ctx, e.A.base.admin, null)).contrasena;
    const sesion = await llamar(ctx, token, { metodo: 'get', ruta: '/sesion' });
    expect(sesion.body.sucursal, 'el Administrador entra sin sucursal activa').toBeNull();
    for (const ruta of deLlamados) {
      esperarError(
        await llamar(ctx, token, ruta.construir(idsAleatorios(e.A.S1))),
        409,
        'SUCURSAL_NO_ELEGIDA',
      );
    }
    exigirEstado(
      await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' }),
      200,
      'la carta web',
    );
    exigirEstado(
      await llamar(ctx, token, { metodo: 'get', ruta: `/sucursales/${e.A.S2}/qr-mesas` }),
      200,
      'los QR de S2 sin sucursal activa',
    );
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'put',
        ruta: '/carta-web',
        cuerpo: {
          nombre: unico('Carta sin sucursal activa'),
          slug: `sin-activa-${randomUUID().slice(0, 8)}`,
          colorPrincipal: '#1D4A9E',
        },
      }),
      200,
      'configurar la carta web sin sucursal activa',
    );
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'put',
        ruta: `/carta-web/sucursales/${e.A.S2}`,
        cuerpo: { slug: 'sur', publicada: true },
      }),
      200,
      'configurar S2 sin sucursal activa',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 59 · Módulo fuera del plan
// ------------------------------------------------------------------------------------------------
describe('criterio 59 · con el módulo SALON fuera del plan, 403 MODULO_NO_INCLUIDO', () => {
  let planId = '';

  async function ponerPlan(modulos: string[]): Promise<void> {
    const e = await esc();
    const plan = await ctx
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
    exigirEstado(plan, 201, 'crear el plan');
    planId = plan.body.id as string;
    const res = await ctx
      .http()
      .patch(`/plataforma/suscripciones/${e.A.base.suscripciones[e.A.S3!]!.id}`)
      .set(bearer(e.sa.token))
      .send({ planId, motivo: 'Cambio de plan de prueba' });
    exigirEstado(res, 200, 'cambiar el plan de S3');
  }

  it.each(TIPOS_DE_SESION)(
    'un plan sin SALON bloquea las rutas de llamados y no cambia nada; la configuración de la carta web y los QR sigue (sesión de %s)',
    async (tipo) => {
      const e = await esc();
      const S3 = e.A.S3!;
      const supervisor = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: S3, rol: 'SUPERVISOR' },
      ]);
      const mozo = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: S3, rol: 'MOZO' }]);
      await ponerPlan(['CAJA', 'COCINA', 'REPORTES']);
      const ids: IdsDeRuta = { sucursalId: S3, mesaId: randomUUID(), llamadoId: randomUUID() };
      await asentar();
      ctx.publicador.limpiar();
      const tablasAntes = await instantanea005(admin, e.A.empresaId);
      const auditoriaAntes = await auditoria005(admin, e.A.empresaId);
      const fallos: string[] = [];
      const adminS3 = (await sesiones(ctx, e.A.base.admin, S3))[tipo];
      for (const token of [
        (await sesiones(ctx, supervisor, S3))[tipo],
        (await sesiones(ctx, mozo, S3))[tipo],
        adminS3,
      ]) {
        for (const ruta of deLlamados) {
          const res = await llamar(ctx, token, ruta.construir(ids));
          const codigo = (res.body as { codigo?: string } | undefined)?.codigo;
          if (res.status !== 403 || codigo !== 'MODULO_NO_INCLUIDO') {
            fallos.push(
              `${ruta.clave}: se esperaba 403 MODULO_NO_INCLUIDO y fue ${res.status} ${codigo}`,
            );
          }
        }
      }
      exigirSinFallos(fallos);
      expect(await instantanea005(admin, e.A.empresaId)).toEqual(tablasAntes);
      expect(await auditoria005(admin, e.A.empresaId)).toEqual(auditoriaAntes);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);
      // La configuración no depende del plan (criterio 5 de la sección).
      exigirEstado(
        await llamar(ctx, adminS3, { metodo: 'get', ruta: '/carta-web' }),
        200,
        'la carta web',
      );
      exigirEstado(
        await llamar(ctx, adminS3, { metodo: 'get', ruta: `/sucursales/${S3}/qr-mesas` }),
        200,
        'los QR sin el módulo SALON',
      );
    },
  );

  it('el cambio de plan rige desde la siguiente petición, también al devolver el módulo', async () => {
    const e = await esc();
    const S3 = e.A.S3!;
    const supervisor = await crearPersona(ctx, e.A.tokenAdmin, [
      { sucursalId: S3, rol: 'SUPERVISOR' },
    ]);
    const token = (await sesiones(ctx, supervisor, S3)).contrasena;
    await ponerPlan(['CAJA', 'REPORTES']);
    esperarError(
      await llamar(ctx, token, { metodo: 'get', ruta: '/llamados' }),
      403,
      'MODULO_NO_INCLUIDO',
    );
    await ponerPlan(['SALON', 'COCINA', 'PEDIDOS_WEB']);
    exigirEstado(
      await llamar(ctx, token, { metodo: 'get', ruta: '/llamados' }),
      200,
      'con SALON otra vez',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 59 · Soporte
// ------------------------------------------------------------------------------------------------
describe('criterio 59 · la sesión de soporte es Administrador', () => {
  it('configura la carta web y los QR y ve los llamados de la sucursal elegida; sin sucursal elegida, 409 en los llamados', async () => {
    const e = await esc();
    const abrir = (sucursalId?: string) =>
      ctx
        .http()
        .post(`/plataforma/empresas/${e.A.empresaId}/soporte`)
        .set(bearer(e.sa.token))
        .send({ motivo: unico('Soporte de llamados'), ...(sucursalId ? { sucursalId } : {}) });
    const conSucursal = await abrir(e.A.S1);
    exigirEstado(conSucursal, 201, 'abrir soporte');
    const token = conSucursal.body.token as string;
    exigirEstado(
      await llamar(ctx, token, { metodo: 'get', ruta: '/llamados' }),
      200,
      'lista de soporte',
    );
    exigirEstado(
      await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' }),
      200,
      'carta web de soporte',
    );
    exigirEstado(
      await llamar(ctx, token, { metodo: 'get', ruta: `/sucursales/${e.A.S1}/qr-mesas` }),
      200,
      'QR de soporte',
    );
    const sin = await abrir();
    exigirEstado(sin, 201, 'abrir soporte sin sucursal');
    esperarError(
      await llamar(ctx, sin.body.token as string, { metodo: 'get', ruta: '/llamados' }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 11 · Las rutas públicas no piden sesión ni permiso
// ------------------------------------------------------------------------------------------------
describe('criterio 58 · las rutas públicas responden sin sesión (no 401 ni 403)', () => {
  it('cada ruta pública de la tabla, sin credenciales, no responde 401 ni 403', async () => {
    const cliente = clientePublico(ctx);
    const fallos: string[] = [];
    for (const ruta of publicas) {
      const l = ruta.construir(idsAleatorios(randomUUID()));
      const res =
        l.metodo === 'get' ? await cliente.get(l.ruta) : await cliente.post(l.ruta, l.cuerpo);
      if (res.status === 401 || res.status === 403 || res.status >= 500) {
        fallos.push(`${ruta.clave}: ${res.status} ${res.text}`);
      }
      // Con datos que no existen, el 404 público de siempre.
      if (res.status === 404) {
        expect(res.body, ruta.clave).toEqual(CUERPO_404_PUBLICO);
      }
    }
    exigirSinFallos(fallos);
  });

  it('crear un llamado y leer la carta no deja ninguna auditoría ni sesión: son actos del cliente, no de una persona', async () => {
    const m = await mundo();
    const antes = await auditoria005(admin, m.A.empresaId);
    const cliente = clientePublico(ctx);
    await crearLlamadoOk(cliente, m.A.mesaS2.codigo, pedidoDeLomo(m.A.carta));
    exigirEstado(await cliente.get(`/publico/cartas/${m.A.slug}/${m.A.slugS1}`), 200, 'la carta');
    expect(await auditoria005(admin, m.A.empresaId)).toEqual(antes);
  });
});
