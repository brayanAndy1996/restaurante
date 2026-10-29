// spec: 004-salon-cocina (pruebas protegidas)
//
// P0 · Criterios 63b y 63c (decisión 11): la inactividad de las sesiones de Cocina/Barra, de PIN y de
// contraseña, y su configuración por sucursal. Cambia los criterios 14, 39 y 40 de 002 solo para el rol
// Cocina/Barra: una sesión cuyo rol en su sucursal activa es Cocina/Barra vale `minutosInactividadCocina`
// (60 por defecto, de 1 a 720) desde su última actividad, en lugar de `minutosInactividad` (PIN) o de los 30
// minutos fijos (contraseña). Siguen iguales el máximo de 12 horas, `X-Actividad: segundo-plano`, el 401
// `SESION_EXPIRADA` con la sesión cerrada y los demás roles, las sesiones sin sucursal activa y las de soporte.
//
// App real con `RelojManual` y Socket.IO habilitado; empresas por `POST /plataforma/empresas` y usuarios por
// `POST /usuarios`. Cada caso corre con una sesión de PIN y con una de contraseña. Las sucursales de A que
// cambian su configuración son propias de cada caso (S3, S4, S6, S7 y S8), así los casos no se pisan.
import { sesionRespuestaSchema } from '@restaurante/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServidorTiempoReal } from '../../src/nucleo/tiempo-real';
import {
  consultar,
  crearPersona,
  elegirSucursal,
  esperarError,
  filasAuditoria,
  ingresarSuperadmin,
  llamar,
  loginContrasena,
  nuevoEquipo,
  partesDeToken,
  pinOk,
  sesionDeSoporte,
  tokenAdmin,
  type Libre,
  type Persona,
} from '../acceso/fabrica-equipos';
import { ClienteTiempoReal } from '../soporte';
import {
  MINUTO,
  clavesDe,
  crearEmpresas,
  crearEntornoSalon,
  exigir,
  personaConRol,
  type EmpresasDePrueba,
  type EntornoSalon,
  type RolPrueba,
} from './fabrica-p0p1';

type Tipo = 'PIN' | 'CONTRASENA';
const TIPOS: Tipo[] = ['PIN', 'CONTRASENA'];

let entorno: EntornoSalon;
let emp: EmpresasDePrueba;
/** Sucursales de A: `S(1)` es la primera. */
const S = (i: number): string => emp.A.sucursales[i - 1]!.id;

let cocina1: Persona;
let mozo1: Persona;
let cajero1: Persona;
let supervisor1: Persona;
/** Cocina/Barra en S1 y en S2: entra sin sucursal activa. */
let cocinaDoble: Persona;
/** Cocina/Barra en S1 y Mozo en S2. */
let mixto: Persona;
let cocina3: Persona;
let cocina4: Persona;
let mozo4: Persona;
let cajero4: Persona;
let supervisor4: Persona;
let cocina6: Persona;

const app = () => entorno.app;
const reloj = () => entorno.reloj;

beforeAll(async () => {
  entorno = await crearEntornoSalon({ tiempoReal: true });
  emp = await crearEmpresas(entorno, 8, 2);
  const crear = (rol: RolPrueba, i: number) => personaConRol(entorno, emp.A, rol, S(i));
  cocina1 = await crear('COCINA_BARRA', 1);
  mozo1 = await crear('MOZO', 1);
  cajero1 = await crear('CAJERO', 1);
  supervisor1 = await crear('SUPERVISOR', 1);
  cocina3 = await crear('COCINA_BARRA', 3);
  cocina4 = await crear('COCINA_BARRA', 4);
  mozo4 = await crear('MOZO', 4);
  cajero4 = await crear('CAJERO', 4);
  supervisor4 = await crear('SUPERVISOR', 4);
  cocina6 = await crear('COCINA_BARRA', 6);
  cocinaDoble = await crearPersona(app(), emp.A, {
    accesos: [
      { sucursalId: S(1), rol: 'COCINA_BARRA' },
      { sucursalId: S(2), rol: 'COCINA_BARRA' },
    ],
  });
  mixto = await crearPersona(app(), emp.A, {
    accesos: [
      { sucursalId: S(1), rol: 'COCINA_BARRA' },
      { sucursalId: S(2), rol: 'MOZO' },
    ],
  });
}, 180_000);

afterAll(async () => {
  await entorno?.cerrar();
});

// ---------------------------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------------------------

interface Sesion {
  tipo: Tipo;
  token: string;
  /** Token del equipo (solo en las sesiones de PIN). */
  equipo?: string;
  /** La sesión que devolvió el ingreso (o el cambio de sucursal). */
  sesion: Libre;
  persona: Persona;
}

/** Abre una sesión del tipo pedido. Con `sucursalId`, la deja con esa sucursal activa. */
async function abrir(tipo: Tipo, persona: Persona, sucursalId: string | null): Promise<Sesion> {
  let token: string;
  let equipo: string | undefined;
  let sesion: Libre;
  if (tipo === 'PIN') {
    const e = await nuevoEquipo(app(), persona);
    const r = await pinOk(app(), e.tokenEquipo, persona);
    token = r.token;
    equipo = e.tokenEquipo;
    sesion = r.sesion;
  } else {
    const r = await loginContrasena(app(), persona);
    token = r.token;
    sesion = r.sesion;
  }
  if (sucursalId !== null && sesion.sucursal?.id !== sucursalId) {
    const res = await elegirSucursal(app(), token, sucursalId, equipo);
    exigir(res, 200, 'Elegir la sucursal activa');
    sesion = res.body as Libre;
  }
  return { tipo, token, ...(equipo ? { equipo } : {}), sesion, persona };
}

/** `GET /sesion` con la sesión (renueva la actividad salvo en segundo plano). */
function ver(s: Sesion, opciones: { segundoPlano?: boolean } = {}) {
  return llamar(app(), 'get', '/sesion', {
    token: s.token,
    ...(s.equipo ? { equipo: s.equipo } : {}),
    ...(opciones.segundoPlano ? { cabeceras: { 'X-Actividad': 'segundo-plano' } } : {}),
  });
}

/** La sesión sigue válida a `minutos` menos un segundo y expira en el instante exacto de `minutos`. */
async function validaHastaYExpiraEn(
  tipo: Tipo,
  persona: Persona,
  sucursalId: string | null,
  minutos: number,
  etiqueta: string,
): Promise<void> {
  const antes = await abrir(tipo, persona, sucursalId);
  reloj().avanzar(minutos * MINUTO - 1000);
  const aun = await ver(antes);
  expect(aun.status, `${etiqueta}: a ${minutos} min menos 1 s (${aun.text})`).toBe(200);

  const despues = await abrir(tipo, persona, sucursalId);
  reloj().avanzar(minutos * MINUTO);
  const expirada = await ver(despues);
  expect(expirada.status, `${etiqueta}: a ${minutos} min exactos (${expirada.text})`).toBe(401);
  expect(expirada.body.codigo, etiqueta).toBe('SESION_EXPIRADA');
  await expectCerrada(despues);
}

async function expectCerrada(s: Sesion): Promise<void> {
  const filas = await consultar<{ cerrada_en: Date | null }>(
    'SELECT cerrada_en FROM sesion WHERE id = $1',
    [partesDeToken(s.token).id],
  );
  expect(filas).toHaveLength(1);
  expect(filas[0]!.cerrada_en, 'la sesión queda cerrada').not.toBeNull();
  const otra = await ver(s);
  expect(otra.status).toBe(401);
  expect(['NO_AUTENTICADO', 'SESION_EXPIRADA']).toContain(otra.body.codigo);
}

/** `PATCH /sucursales/:id/acceso` como Administrador; exige 200 y devuelve el cuerpo. */
async function configurar(sucursalId: string, cuerpo: Libre): Promise<Libre> {
  const res = await llamar(app(), 'patch', `/sucursales/${sucursalId}/acceso`, {
    token: await tokenAdmin(app(), emp.A),
    cuerpo,
  });
  exigir(res, 200, `Configurar el acceso de la sucursal con ${JSON.stringify(cuerpo)}`);
  return res.body as Libre;
}

const leerAcceso = async (sucursalId: string) =>
  llamar(app(), 'get', `/sucursales/${sucursalId}/acceso`, {
    token: await tokenAdmin(app(), emp.A),
  });

const instante = (texto: string): number => new Date(texto).getTime();
/** Tolerancia de las pruebas de vencimiento: igual que las de 002 (1,5 s). */
const TOLERANCIA_MS = 1500;

function esperarVencimiento(texto: string, desdeMs: number, minutos: number, etiqueta: string) {
  expect(typeof texto, `${etiqueta}: expiraPorInactividadEn`).toBe('string');
  expect(Math.abs(instante(texto) - (desdeMs + minutos * MINUTO)), etiqueta).toBeLessThanOrEqual(
    TOLERANCIA_MS,
  );
}

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

// ---------------------------------------------------------------------------------------------
// Criterio 63b · su propio tiempo de inactividad
// ---------------------------------------------------------------------------------------------

describe.each(TIPOS)('criterio 63b · sesión de %s de Cocina/Barra', (tipo) => {
  it('en S1 sigue válida a los 59 minutos sin uso y expira en el instante exacto de los 60 (401 SESION_EXPIRADA, sesión cerrada)', async () => {
    // A los 59 minutos exactos y a 59:59 sigue; a los 60:00 exactos, no.
    const a59 = await abrir(tipo, cocina1, S(1));
    reloj().avanzar(59 * MINUTO);
    expect((await ver(a59)).status).toBe(200);
    await validaHastaYExpiraEn(tipo, cocina1, S(1), 60, `Cocina/Barra ${tipo}`);
  });

  it('una petición normal renueva la actividad: 59 + 59 minutos con uso en medio siguen válidos', async () => {
    const s = await abrir(tipo, cocina1, S(1));
    reloj().avanzar(59 * MINUTO);
    expect((await ver(s)).status).toBe(200);
    reloj().avanzar(59 * MINUTO);
    expect((await ver(s)).status).toBe(200);
    reloj().avanzar(60 * MINUTO);
    esperarError(await ver(s), 401, 'SESION_EXPIRADA');
  });

  it('X-Actividad: segundo-plano valida sin renovar la actividad', async () => {
    const s = await abrir(tipo, cocina1, S(1));
    reloj().avanzar(30 * MINUTO);
    expect((await ver(s, { segundoPlano: true })).status).toBe(200);
    reloj().avanzar(30 * MINUTO); // 60 minutos desde la última actividad real
    esperarError(await ver(s), 401, 'SESION_EXPIRADA');

    // Control: la misma secuencia con una petición normal sí renueva.
    const control = await abrir(tipo, cocina1, S(1));
    reloj().avanzar(30 * MINUTO);
    expect((await ver(control)).status).toBe(200);
    reloj().avanzar(30 * MINUTO);
    expect((await ver(control)).status).toBe(200);
  });

  it('dura como máximo 12 horas desde que se creó, aunque se configuren 720 minutos', async () => {
    const configurado = await configurar(S(3), { minutosInactividadCocina: 720 });
    expect(configurado.minutosInactividadCocina).toBe(720);
    const s = await abrir(tipo, cocina3, S(3));
    reloj().avanzar(719 * MINUTO); // 11 h 59 min: dentro de los 720 minutos y de las 12 horas
    expect((await ver(s)).status).toBe(200);
    reloj().avanzar(2 * MINUTO); // 12 h 01 min desde que se creó
    esperarError(await ver(s), 401, 'SESION_EXPIRADA');
    await expectCerrada(s);
  });

  it('sin sucursal activa rige el tiempo de siempre (PIN 5, contraseña 30), aunque el rol en las sucursales sea Cocina/Barra', async () => {
    const minutos = tipo === 'PIN' ? 5 : 30;
    const sinSucursal = await abrir(tipo, cocinaDoble, null);
    expect(sinSucursal.sesion.sucursal).toBeNull();
    await validaHastaYExpiraEn(tipo, cocinaDoble, null, minutos, `sin sucursal activa ${tipo}`);
  });

  it('usa minutosInactividadCocina y no minutosInactividad de la sucursal', async () => {
    await configurar(S(4), { minutosInactividad: 12, minutosInactividadCocina: 90 });
    // Cocina/Barra: 90, aunque la sucursal tenga 12 (PIN) y la contraseña 30.
    await validaHastaYExpiraEn(tipo, cocina4, S(4), 90, `Cocina/Barra ${tipo} en S4`);
  });
});

describe.each(TIPOS)(
  'criterio 63b · los demás roles con sesión de %s siguen con su tiempo',
  (tipo) => {
    const base = (minutosPin: number) => (tipo === 'PIN' ? minutosPin : 30);

    it('Mozo, Cajero y Supervisor en S1: PIN 5 por defecto, contraseña 30', async () => {
      for (const [nombre, persona] of [
        ['Mozo', mozo1],
        ['Cajero', cajero1],
        ['Supervisor', supervisor1],
      ] as const) {
        await validaHastaYExpiraEn(tipo, persona, S(1), base(5), `${nombre} ${tipo} en S1`);
      }
    });

    it('el Administrador con S1 activa: PIN 5 por defecto, contraseña 30', async () => {
      await validaHastaYExpiraEn(tipo, emp.A.admin, S(1), base(5), `Administrador ${tipo} en S1`);
    });

    it('con minutosInactividad configurado, PIN usa ese valor y la contraseña sigue en 30 (Mozo, Cajero, Supervisor y Administrador)', async () => {
      await configurar(S(4), { minutosInactividad: 12, minutosInactividadCocina: 90 });
      for (const [nombre, persona] of [
        ['Mozo', mozo4],
        ['Cajero', cajero4],
        ['Supervisor', supervisor4],
        ['Administrador', emp.A.admin],
      ] as const) {
        await validaHastaYExpiraEn(tipo, persona, S(4), base(12), `${nombre} ${tipo} en S4`);
      }
    });

    it('sin sucursal activa: PIN 5, contraseña 30 (también el Administrador)', async () => {
      const s = await abrir(tipo, emp.A.admin, null);
      expect(s.sesion.sucursal).toBeNull();
      await validaHastaYExpiraEn(
        tipo,
        emp.A.admin,
        null,
        base(5),
        `Administrador ${tipo} sin sucursal`,
      );
    });
  },
);

describe.each(TIPOS)('criterio 63b · cambio de sucursal con sesión de %s', (tipo) => {
  const comoMozo = tipo === 'PIN' ? 5 : 30;

  it('Cocina/Barra en S1 que cambia a S2 (Mozo): rige el tiempo del rol nuevo desde la siguiente petición', async () => {
    // Control: en S1 vale el tiempo de Cocina/Barra.
    const enS1 = await abrir(tipo, mixto, S(1));
    reloj().avanzar(40 * MINUTO);
    expect((await ver(enS1)).status).toBe(200);

    // Cambia a S2: la petición del cambio corre con el rol de S1 y renueva la actividad.
    const cambio = await abrir(tipo, mixto, S(1));
    reloj().avanzar(10 * MINUTO);
    const alS2 = await llamar(app(), 'put', '/sesion/sucursal', {
      token: cambio.token,
      ...(cambio.equipo ? { equipo: cambio.equipo } : {}),
      cuerpo: { sucursalId: S(2) },
    });
    expect(alS2.status, alS2.text).toBe(200);
    expect(alS2.body).toMatchObject({ sucursal: { id: S(2) }, rol: 'MOZO' });
    reloj().avanzar(comoMozo * MINUTO - 1000);
    expect((await ver(cambio)).status).toBe(200);

    const otra = await abrir(tipo, mixto, S(1));
    const otraAlS2 = await llamar(app(), 'put', '/sesion/sucursal', {
      token: otra.token,
      ...(otra.equipo ? { equipo: otra.equipo } : {}),
      cuerpo: { sucursalId: S(2) },
    });
    expect(otraAlS2.status).toBe(200);
    reloj().avanzar(comoMozo * MINUTO);
    esperarError(await ver(otra), 401, 'SESION_EXPIRADA');
  });

  it('Mozo en S2 que cambia a S1 (Cocina/Barra): rige el tiempo de Cocina/Barra desde la siguiente petición', async () => {
    const s = await abrir(tipo, mixto, S(2));
    reloj().avanzar(2 * MINUTO);
    const alS1 = await llamar(app(), 'put', '/sesion/sucursal', {
      token: s.token,
      ...(s.equipo ? { equipo: s.equipo } : {}),
      cuerpo: { sucursalId: S(1) },
    });
    expect(alS1.status, alS1.text).toBe(200);
    expect(alS1.body).toMatchObject({ sucursal: { id: S(1) }, rol: 'COCINA_BARRA' });
    reloj().avanzar(59 * MINUTO); // con el rol de S2 ya habría expirado
    expect((await ver(s)).status).toBe(200);

    const otra = await abrir(tipo, mixto, S(2));
    const otraAlS1 = await llamar(app(), 'put', '/sesion/sucursal', {
      token: otra.token,
      ...(otra.equipo ? { equipo: otra.equipo } : {}),
      cuerpo: { sucursalId: S(1) },
    });
    expect(otraAlS1.status).toBe(200);
    reloj().avanzar(60 * MINUTO);
    esperarError(await ver(otra), 401, 'SESION_EXPIRADA');
  });
});

describe('criterio 63b · sesión de soporte', () => {
  it('sigue con 30 minutos de inactividad (criterio 66 de 002)', async () => {
    const abrirSoporte = async () =>
      sesionDeSoporte(app(), await ingresarSuperadmin(app(), emp.sa), emp.A.id, S(1));
    const antes = await abrirSoporte();
    reloj().avanzar(30 * MINUTO - 1000);
    expect((await llamar(app(), 'get', '/sesion', { token: antes })).status).toBe(200);
    // Más de 5 y de 30 minutos menos uno sirven; a los 30 exactos expira (no a los 60 de Cocina/Barra).
    const despues = await abrirSoporte();
    reloj().avanzar(30 * MINUTO);
    esperarError(await llamar(app(), 'get', '/sesion', { token: despues }), 401, 'SESION_EXPIRADA');
  });
});

// ---------------------------------------------------------------------------------------------
// `expiraPorInactividadEn`
// ---------------------------------------------------------------------------------------------

describe.each(TIPOS)('criterio 63b · expiraPorInactividadEn con sesión de %s', (tipo) => {
  it('el ingreso y GET /sesion de Cocina/Barra dicen 60 minutos desde la última actividad', async () => {
    const desde = reloj().ahora().getTime();
    const s = await abrir(tipo, cocina1, S(1));
    esperarVencimiento(s.sesion.expiraPorInactividadEn, desde, 60, `ingreso ${tipo}`);

    reloj().avanzar(10 * MINUTO);
    const ahora = reloj().ahora().getTime();
    const consulta = await ver(s);
    expect(consulta.status, consulta.text).toBe(200);
    sesionRespuestaSchema.parse(consulta.body);
    expect(consulta.body.rol).toBe('COCINA_BARRA');
    esperarVencimiento(consulta.body.expiraPorInactividadEn, ahora, 60, `GET /sesion ${tipo}`);
  });

  it('GET /sesion en segundo plano no mueve el vencimiento', async () => {
    const s = await abrir(tipo, cocina1, S(1));
    const normal = await ver(s);
    const vencimiento = normal.body.expiraPorInactividadEn as string;
    reloj().avanzar(7 * MINUTO);
    const fondo = await ver(s, { segundoPlano: true });
    expect(fondo.status).toBe(200);
    expect(fondo.body.expiraPorInactividadEn).toBe(vencimiento);
  });

  it('los demás roles siguen diciendo su tiempo (PIN 5, contraseña 30) y el configurado de Cocina/Barra manda en la suya', async () => {
    const minutosMozo = tipo === 'PIN' ? 5 : 30;
    const desdeMozo = reloj().ahora().getTime();
    const mozo = await abrir(tipo, mozo1, S(1));
    esperarVencimiento(mozo.sesion.expiraPorInactividadEn, desdeMozo, minutosMozo, `Mozo ${tipo}`);
    const consultaMozo = await ver(mozo);
    esperarVencimiento(
      consultaMozo.body.expiraPorInactividadEn,
      reloj().ahora().getTime(),
      minutosMozo,
      `GET /sesion de Mozo ${tipo}`,
    );

    await configurar(S(4), { minutosInactividad: 12, minutosInactividadCocina: 90 });
    const desdeCocina = reloj().ahora().getTime();
    const cocina = await abrir(tipo, cocina4, S(4));
    esperarVencimiento(cocina.sesion.expiraPorInactividadEn, desdeCocina, 90, `Cocina S4 ${tipo}`);
    const consultaCocina = await ver(cocina);
    esperarVencimiento(
      consultaCocina.body.expiraPorInactividadEn,
      reloj().ahora().getTime(),
      90,
      `GET /sesion de Cocina S4 ${tipo}`,
    );
  });

  it('una sesión sin sucursal activa dice 5 minutos (PIN) o 30 (contraseña)', async () => {
    const minutos = tipo === 'PIN' ? 5 : 30;
    const desde = reloj().ahora().getTime();
    const s = await abrir(tipo, cocinaDoble, null);
    expect(s.sesion.sucursal).toBeNull();
    esperarVencimiento(s.sesion.expiraPorInactividadEn, desde, minutos, `sin sucursal ${tipo}`);
  });

  it('al cambiar de sucursal el vencimiento pasa al tiempo del rol nuevo', async () => {
    const s = await abrir(tipo, mixto, S(1));
    esperarVencimiento(
      s.sesion.expiraPorInactividadEn,
      reloj().ahora().getTime(),
      60,
      `S1 ${tipo}`,
    );
    const alS2 = await llamar(app(), 'put', '/sesion/sucursal', {
      token: s.token,
      ...(s.equipo ? { equipo: s.equipo } : {}),
      cuerpo: { sucursalId: S(2) },
    });
    expect(alS2.status).toBe(200);
    const consulta = await ver(s);
    esperarVencimiento(
      consulta.body.expiraPorInactividadEn,
      reloj().ahora().getTime(),
      tipo === 'PIN' ? 5 : 30,
      `S2 ${tipo}`,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Un cambio de minutosInactividadCocina rige desde la siguiente petición
// ---------------------------------------------------------------------------------------------

describe.each(TIPOS)(
  'criterio 63c · cambiar minutosInactividadCocina con sesión de %s abierta',
  (tipo) => {
    it('alargarlo rige desde la siguiente petición de la sesión abierta', async () => {
      try {
        const s = await abrir(tipo, cocina6, S(6));
        reloj().avanzar(50 * MINUTO);
        const nuevo = await configurar(S(6), { minutosInactividadCocina: 120 });
        expect(nuevo.minutosInactividadCocina).toBe(120);
        reloj().avanzar(20 * MINUTO); // 70 minutos sin uso: con los 60 de antes ya habría expirado
        expect((await ver(s)).status).toBe(200);
        reloj().avanzar(120 * MINUTO); // 120 desde la última actividad: expira en el instante exacto
        esperarError(await ver(s), 401, 'SESION_EXPIRADA');
      } finally {
        // Restaura sin tapar el error de la prueba si el PATCH todavía no existe.
        await configurar(S(6), { minutosInactividadCocina: 60 }).catch(() => undefined);
      }
    });

    it('acortarlo rige desde la siguiente petición: 30 minutos sin uso y 10 configurados expiran', async () => {
      try {
        const s = await abrir(tipo, cocina6, S(6));
        reloj().avanzar(30 * MINUTO);
        const nuevo = await configurar(S(6), { minutosInactividadCocina: 10 });
        expect(nuevo.minutosInactividadCocina).toBe(10);
        esperarError(await ver(s), 401, 'SESION_EXPIRADA');
        await expectCerrada(s);

        // Una sesión nueva con el valor nuevo: 9 minutos 59 segundos sirven, 10 no.
        await validaHastaYExpiraEn(tipo, cocina6, S(6), 10, `Cocina/Barra ${tipo} con 10`);
      } finally {
        // Restaura sin tapar el error de la prueba si el PATCH todavía no existe.
        await configurar(S(6), { minutosInactividadCocina: 60 }).catch(() => undefined);
      }
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Socket.IO: la revisión periódica aplica la misma regla
// ---------------------------------------------------------------------------------------------

describe.each(TIPOS)('criterio 63b · revisión periódica de Socket.IO con sesión de %s', (tipo) => {
  const revisar = () => app().get(ServidorTiempoReal).revisarAhora();
  const authDe = (s: Sesion) => ({ token: s.token, ...(s.equipo ? { equipo: s.equipo } : {}) });

  it('desconecta la sesión de Cocina/Barra a los 60 minutos y no a los 5 ni a los 30', async () => {
    const s = await abrir(tipo, cocina1, S(1));
    const cliente = await ClienteTiempoReal.conectar(app(), authDe(s));
    try {
      for (const minutos of [5, 30]) {
        reloj().avanzar(minutos === 5 ? 5 * MINUTO : 25 * MINUTO);
        await revisar();
        await pausa(300);
        expect(cliente.conectado, `a los ${minutos} minutos sigue conectado`).toBe(true);
      }
      reloj().avanzar(30 * MINUTO - 1000); // 59 min 59 s sin uso: la conexión no renueva la actividad
      await revisar();
      await pausa(300);
      expect(cliente.conectado, 'a los 59 min 59 s sigue conectado').toBe(true);

      reloj().avanzar(1000); // 60 minutos exactos
      await revisar();
      await cliente.esperarDesconexion();
      expect(cliente.conectado).toBe(false);
    } finally {
      cliente.cerrar();
    }
  });

  it('desconecta a los demás roles a su tiempo: Mozo a los 5 (PIN) o 30 (contraseña)', async () => {
    const minutos = tipo === 'PIN' ? 5 : 30;
    const s = await abrir(tipo, mozo1, S(1));
    const cliente = await ClienteTiempoReal.conectar(app(), authDe(s));
    try {
      reloj().avanzar(minutos * MINUTO - 1000);
      await revisar();
      await pausa(300);
      expect(cliente.conectado).toBe(true);
      reloj().avanzar(1000);
      await revisar();
      await cliente.esperarDesconexion();
    } finally {
      cliente.cerrar();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 63c · configuración
// ---------------------------------------------------------------------------------------------

describe('criterio 63c · configurar minutosInactividadCocina', () => {
  it('GET devuelve 60 por defecto, sin fila y con la fila creada por un PATCH de minutosInactividad', async () => {
    const sinFila = await leerAcceso(S(5));
    expect(sinFila.status, sinFila.text).toBe(200);
    expect(sinFila.body).toEqual({
      sucursalId: S(5),
      minutosInactividad: 5,
      minutosInactividadCocina: 60,
    });

    const cambio = await configurar(S(5), { minutosInactividad: 20 });
    expect(cambio).toEqual({
      sucursalId: S(5),
      minutosInactividad: 20,
      minutosInactividadCocina: 60,
    });
    const conFila = await leerAcceso(S(5));
    expect(conFila.body).toEqual({
      sucursalId: S(5),
      minutosInactividad: 20,
      minutosInactividadCocina: 60,
    });
  });

  it('PATCH con cada campo solo deja el otro igual y con los dos cambia ambos', async () => {
    const base = await configurar(S(7), { minutosInactividad: 9, minutosInactividadCocina: 90 });
    expect(base).toEqual({ sucursalId: S(7), minutosInactividad: 9, minutosInactividadCocina: 90 });

    const soloCocina = await configurar(S(7), { minutosInactividadCocina: 120 });
    expect(soloCocina).toEqual({
      sucursalId: S(7),
      minutosInactividad: 9,
      minutosInactividadCocina: 120,
    });

    const soloPin = await configurar(S(7), { minutosInactividad: 11 });
    expect(soloPin).toEqual({
      sucursalId: S(7),
      minutosInactividad: 11,
      minutosInactividadCocina: 120,
    });
    expect((await leerAcceso(S(7))).body).toEqual(soloPin);

    const ambos = await configurar(S(7), { minutosInactividad: 15, minutosInactividadCocina: 200 });
    expect(ambos).toEqual({
      sucursalId: S(7),
      minutosInactividad: 15,
      minutosInactividadCocina: 200,
    });
    expect((await leerAcceso(S(7))).body).toEqual(ambos);
  });

  it('los límites 1 y 720 de minutosInactividadCocina se aceptan; minutosInactividad sigue de 1 a 120', async () => {
    for (const minutos of [1, 720]) {
      const res = await configurar(S(8), { minutosInactividadCocina: minutos });
      expect(res.minutosInactividadCocina).toBe(minutos);
    }
    for (const minutos of [1, 120]) {
      const res = await configurar(S(8), { minutosInactividad: minutos });
      expect(res.minutosInactividad).toBe(minutos);
    }
    await configurar(S(8), { minutosInactividad: 5, minutosInactividadCocina: 60 });
  });

  it('rechaza con 400 DATOS_INVALIDOS: {}, 0, 721, 1.5, "10", null, un campo desconocido y minutosInactividad fuera de 1 a 120; nada cambia', async () => {
    const antes = await configurar(S(8), { minutosInactividad: 6, minutosInactividadCocina: 77 });
    const auditoriaAntes = (await filasAuditoria(emp.A.id, 'configurar_acceso_sucursal')).length;
    const admin = await tokenAdmin(app(), emp.A);

    const deCocina: unknown[] = [0, -1, 721, 1.5, '10', null, true, [], {}];
    const cuerpos: { cuerpo: unknown; campo?: string }[] = [
      { cuerpo: {} },
      ...deCocina.map((v) => ({
        cuerpo: { minutosInactividadCocina: v },
        campo: 'minutosInactividadCocina',
      })),
      { cuerpo: { minutosInactividadCocina: 10, otro: 1 } },
      { cuerpo: { minutosInactividad: 10, desconocido: true } },
      { cuerpo: { minutosInactividad: 121 }, campo: 'minutosInactividad' },
      { cuerpo: { minutosInactividad: 0 }, campo: 'minutosInactividad' },
      { cuerpo: { minutosInactividad: 1.5 }, campo: 'minutosInactividad' },
      { cuerpo: { minutosInactividad: null }, campo: 'minutosInactividad' },
      // Un campo válido junto a uno inválido: no se aplica ninguno.
      {
        cuerpo: { minutosInactividad: 30, minutosInactividadCocina: 721 },
        campo: 'minutosInactividadCocina',
      },
      {
        cuerpo: { minutosInactividad: 121, minutosInactividadCocina: 30 },
        campo: 'minutosInactividad',
      },
    ];
    for (const { cuerpo, campo } of cuerpos) {
      const res = await llamar(app(), 'patch', `/sucursales/${S(8)}/acceso`, {
        token: admin,
        cuerpo,
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
      if (campo !== undefined) {
        const campos = ((res.body.campos ?? []) as { campo: string }[]).map((c) => c.campo);
        expect(campos, JSON.stringify(cuerpo)).toContain(campo);
      }
    }

    const despues = await leerAcceso(S(8));
    expect(despues.body).toEqual(antes);
    expect((await filasAuditoria(emp.A.id, 'configurar_acceso_sucursal')).length).toBe(
      auditoriaAntes,
    );
  });

  it('deja una fila configurar_acceso_sucursal por cambio, con el antes y el después de los campos cambiados', async () => {
    await configurar(S(8), { minutosInactividad: 5, minutosInactividadCocina: 60 });
    const deEstaSucursal = async () =>
      (await filasAuditoria(emp.A.id, 'configurar_acceso_sucursal')).filter(
        (f) => f.sucursal_id === S(8),
      );
    const numerosDe = (valor: unknown, acumulado: number[] = []): number[] => {
      if (typeof valor === 'number') acumulado.push(valor);
      else if (Array.isArray(valor)) valor.forEach((v) => numerosDe(v, acumulado));
      else if (valor !== null && typeof valor === 'object') {
        Object.values(valor).forEach((v) => numerosDe(v, acumulado));
      }
      return acumulado;
    };

    // Solo minutosInactividadCocina: 60 -> 137.
    let previas = new Set((await deEstaSucursal()).map((f) => f.id));
    await configurar(S(8), { minutosInactividadCocina: 137 });
    let nuevas = (await deEstaSucursal()).filter((f) => !previas.has(f.id));
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]!.actor_usuario_id).toBe(emp.A.admin.id);
    expect(nuevas[0]!.sucursal_id).toBe(S(8));
    expect(clavesDe(nuevas[0]!.detalle)).toContain('minutosinactividadcocina');
    expect(numerosDe(nuevas[0]!.detalle)).toEqual(expect.arrayContaining([60, 137]));

    // Los dos: 5 -> 41 y 137 -> 233.
    previas = new Set((await deEstaSucursal()).map((f) => f.id));
    await configurar(S(8), { minutosInactividad: 41, minutosInactividadCocina: 233 });
    nuevas = (await deEstaSucursal()).filter((f) => !previas.has(f.id));
    expect(nuevas).toHaveLength(1);
    const claves = clavesDe(nuevas[0]!.detalle);
    expect(claves).toContain('minutosinactividad');
    expect(claves).toContain('minutosinactividadcocina');
    expect(numerosDe(nuevas[0]!.detalle)).toEqual(expect.arrayContaining([5, 41, 137, 233]));

    // Solo minutosInactividad: 41 -> 18.
    previas = new Set((await deEstaSucursal()).map((f) => f.id));
    await configurar(S(8), { minutosInactividad: 18 });
    nuevas = (await deEstaSucursal()).filter((f) => !previas.has(f.id));
    expect(nuevas).toHaveLength(1);
    expect(numerosDe(nuevas[0]!.detalle)).toEqual(expect.arrayContaining([41, 18]));
  });

  it('los demás roles (con contraseña y con PIN) reciben 403 PROHIBIDO y no cambia nada ni se audita', async () => {
    const antes = await leerAcceso(S(1));
    const auditoriaAntes = (await filasAuditoria(emp.A.id, 'configurar_acceso_sucursal')).length;
    for (const tipo of TIPOS) {
      for (const [nombre, persona] of [
        ['Mozo', mozo1],
        ['Cajero', cajero1],
        ['Cocina/Barra', cocina1],
        ['Supervisor', supervisor1],
      ] as const) {
        const s = await abrir(tipo, persona, S(1));
        const credenciales = { token: s.token, ...(s.equipo ? { equipo: s.equipo } : {}) };
        esperarError(
          await llamar(app(), 'get', `/sucursales/${S(1)}/acceso`, credenciales),
          403,
          'PROHIBIDO',
        );
        for (const cuerpo of [{ minutosInactividadCocina: 30 }, { minutosInactividad: 30 }]) {
          const res = await llamar(app(), 'patch', `/sucursales/${S(1)}/acceso`, {
            ...credenciales,
            cuerpo,
          });
          expect(res.status, `${nombre} ${tipo}: ${res.text}`).toBe(403);
          expect(res.body.codigo, `${nombre} ${tipo}`).toBe('PROHIBIDO');
        }
      }
    }
    expect((await leerAcceso(S(1))).body).toEqual(antes.body);
    expect((await filasAuditoria(emp.A.id, 'configurar_acceso_sucursal')).length).toBe(
      auditoriaAntes,
    );
  });

  it('una sucursal de B o inexistente responde 404 NO_ENCONTRADO idéntico y la de B no cambia', async () => {
    const deB = emp.B.sucursales[0]!.id;
    const adminB = await tokenAdmin(app(), emp.B);
    const antesB = await llamar(app(), 'get', `/sucursales/${deB}/acceso`, { token: adminB });
    expect(antesB.status, antesB.text).toBe(200);
    expect(antesB.body.minutosInactividadCocina).toBe(60);
    const auditoriaB = (await filasAuditoria(emp.B.id, 'configurar_acceso_sucursal')).length;

    const admin = await tokenAdmin(app(), emp.A);
    const inexistente = '7b0f6e0e-3c1d-4a53-9a6f-0d6a1f1d2c11';
    const respuestas = [];
    for (const id of [deB, inexistente]) {
      respuestas.push(await llamar(app(), 'get', `/sucursales/${id}/acceso`, { token: admin }));
      respuestas.push(
        await llamar(app(), 'patch', `/sucursales/${id}/acceso`, {
          token: admin,
          cuerpo: { minutosInactividadCocina: 33 },
        }),
      );
    }
    for (const res of respuestas) {
      esperarError(res, 404, 'NO_ENCONTRADO');
      expect(res.body).toEqual(respuestas[0]!.body);
    }

    const despuesB = await llamar(app(), 'get', `/sucursales/${deB}/acceso`, { token: adminB });
    expect(despuesB.body).toEqual(antesB.body);
    expect((await filasAuditoria(emp.B.id, 'configurar_acceso_sucursal')).length).toBe(auditoriaB);
  });
});
