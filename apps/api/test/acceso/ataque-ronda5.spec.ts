// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ataque, ronda 5 (reportado por el adversarial). Cada bloque nace de una falla reproducida:
// - R5-F1 · RNF-03 y criterios 11 y 61: una inundación de `POST /plataforma/sesiones` con nombres inventados
//   (uno distinto en cada petición, contraseña `x`) no impide que el superadministrador real ingrese. Con 30
//   conexiones propias sin pausa, 9 de 10 ingresos correctos (uno cada ~300 ms) responden 201 en menos de 2 s
//   y la inundación no recibe ningún 5xx. Hoy la cola del grupo `plataforma` del semáforo de scrypt se llena
//   con los nombres inventados y el superadministrador recibe 429 de 1 s.
// - R5-F2a · RNF-03 y criterios 10 y 11: unos 26 nombres REALES de A, cada uno atacado sin pausa por su
//   propia conexión con una contraseña mala, no impiden que el Administrador de A ingrese. Pasado el
//   calentamiento (las cuentas atacadas ya llegaron a su bloqueo), 28 de 30 ingresos correctos (93 %) responden
//   201 en menos de 2 s. Hoy las cuentas bloqueadas siguen ocupando la cola del grupo de A y el Administrador
//   recibe 429 de 1 s en cerca de uno de cada cuatro ingresos (al principio, en todos).
// - R5-F2b · RNF-03 y criterios 10, 11 y 16: un Mozo de A con sesión que repite sin pausa (60 bucles)
//   `PUT /sesion/contrasena` con la actual equivocada no impide que el Administrador de A ingrese (9 de 10 en
//   menos de 2 s). Además el cambio no evalúa sin límite: la actual equivocada cuenta para el bloqueo del
//   criterio 12 (a lo sumo 5 respuestas 401, el resto 429 `BLOQUEO_TEMPORAL`, ningún 5xx) y, ya bloqueado, ni
//   la actual correcta se evalúa.
// - R5-F3 · criterio 11: el exceso de cola no es un oráculo. Con la cola de A llena (por F2a y por F2b), una
//   sonda con una contraseña cualquiera da la misma respuesta mayoritaria con un nombre activo de A, uno
//   inactivo de A, uno de B y uno inexistente. Las sondas son nombres activos sin fallos previos (un nombre por
//   repetición): el bloqueo de un nombre ya bloqueado sí es una pista aceptada por el criterio 12 y no se usa.
// La API real con `RelojManual` (el reloj no avanza: ningún bloqueo expira durante el archivo), un pool de 10
// conexiones y un puerto propio; las cargas usan sockets propios (`agent: false`), uno por petición.
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaEmpresa,
  arrancar,
  bearer,
  crearUsuario,
  crearUsuarioConSesion,
  exigirEstado,
  nuevoSuperadmin,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
  type UsuarioDePrueba,
} from './fabrica-plataforma';

let ctx: AppDePrueba;
let puerto: number;
let sa: SuperadminDePrueba;
let A: EmpresaDePrueba;
let B: EmpresaDePrueba;

// Usuarios que cada prueba necesita (se crean una vez: la creación hace scrypt).
const NOMBRES_F2A = 26;
const NOMBRES_F3 = 26;
const SONDAS = 6;
const atacadosF2a: UsuarioDePrueba[] = [];
const atacadosF3: UsuarioDePrueba[] = [];
const sondasActivasA: UsuarioDePrueba[] = [];
const sondasInactivasA: UsuarioDePrueba[] = [];
const sondasDeB: UsuarioDePrueba[] = [];
let mozoF2b: UsuarioDePrueba;
let mozoF3: UsuarioDePrueba;

const crearMozoDeA = (): Promise<UsuarioDePrueba> =>
  crearUsuario(ctx, A.admin.token, {
    accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
  });

const crearMozoDeB = (): Promise<UsuarioDePrueba> =>
  crearUsuario(ctx, B.admin.token, {
    accesos: [{ sucursalId: B.sucursales[0]!.id, rol: 'MOZO' }],
  });

/** Crea `n` usuarios de a 6 en paralelo (el pool es de 10 conexiones). */
async function crearVarios(n: number, crear: () => Promise<UsuarioDePrueba>) {
  const creados: UsuarioDePrueba[] = [];
  for (let i = 0; i < n; i += 6) {
    creados.push(...(await Promise.all(Array.from({ length: Math.min(6, n - i) }, crear))));
  }
  return creados;
}

beforeAll(async () => {
  ctx = await arrancar({ poolMax: 10 });
  await ctx.app.listen(0);
  puerto = (ctx.app.getHttpServer().address() as { port: number }).port;
  sa = await nuevoSuperadmin(ctx);
  A = await altaEmpresa(ctx, sa);
  B = await altaEmpresa(ctx, sa);

  // Solo hacen falta los nombres de los atacados (la carga usa una contraseña mala): sin abrir sesión.
  atacadosF2a.push(...(await crearVarios(NOMBRES_F2A, crearMozoDeA)));
  atacadosF3.push(...(await crearVarios(NOMBRES_F3, crearMozoDeA)));
  sondasActivasA.push(...(await crearVarios(SONDAS, crearMozoDeA)));
  sondasDeB.push(...(await crearVarios(SONDAS, crearMozoDeB)));
  sondasInactivasA.push(...(await crearVarios(SONDAS, crearMozoDeA)));
  for (const inactivo of sondasInactivasA) {
    exigirEstado(
      await ctx
        .http()
        .patch(`/usuarios/${inactivo.id}`)
        .set(bearer(A.admin.token))
        .send({ activo: false }),
      200,
      'desactivar al usuario de la sonda',
    );
  }
  const mozos = await Promise.all(
    [0, 1].map(() =>
      crearUsuarioConSesion(ctx, A.admin.token, {
        accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
      }),
    ),
  );
  mozoF2b = mozos[0]!;
  mozoF3 = mozos[1]!;
}, 300_000);

afterAll(async () => {
  await ctx?.cerrar();
});

const dormir = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

// ------------------------------------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------------------------------------

interface Cruda {
  status: number;
  ms: number;
  texto: string;
  cuerpo: { codigo?: string; reintentarEnSegundos?: number; token?: string } | null;
}

/** Petición por un socket propio (sin agente compartido): N peticiones son N conexiones reales. */
function pedir(
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  cabeceras: Record<string, string> = {},
): Promise<Cruda> {
  const inicio = Date.now();
  return new Promise((resolver) => {
    const datos = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
    const peticion = http.request(
      {
        host: '127.0.0.1',
        port: puerto,
        method: metodo,
        path: ruta,
        agent: false,
        headers: {
          ...(datos
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(datos) }
            : {}),
          ...cabeceras,
        },
      },
      (respuesta) => {
        let texto = '';
        respuesta.on('data', (trozo) => (texto += trozo));
        respuesta.on('end', () => {
          let parseado: Cruda['cuerpo'] = null;
          try {
            parseado = JSON.parse(texto) as Cruda['cuerpo'];
          } catch {
            parseado = null;
          }
          resolver({
            status: respuesta.statusCode ?? 0,
            ms: Date.now() - inicio,
            texto,
            cuerpo: parseado,
          });
        });
      },
    );
    peticion.on('error', (error) =>
      resolver({ status: -1, ms: Date.now() - inicio, texto: String(error), cuerpo: null }),
    );
    if (datos) peticion.write(datos);
    peticion.end();
  });
}

const ingresoUsuario = (usuario: string, contrasena: string) =>
  pedir('POST', '/sesiones/contrasena', { usuario, contrasena });

const ingresoPlataforma = (usuario: string, contrasena: string) =>
  pedir('POST', '/plataforma/sesiones', { usuario, contrasena });

const ingresoDelAdministradorDeA = () => ingresoUsuario(A.admin.usuario, A.admin.contrasena);

/** Texto corto de una respuesta para los mensajes de error. */
const corta = (r: Cruda): string =>
  r.status === 429 ? `429/${r.cuerpo?.reintentarEnSegundos}(${r.ms}ms)` : `${r.status}(${r.ms}ms)`;

/** Lo que una carga sostenida vio: conteo por estado y las respuestas que no deben existir (5xx). */
interface Carga {
  conteo: Record<string, number>;
  cincoXX: string[];
  /** Por trabajador: vio un bloqueo de verdad (429 con más de 1 s de espera). */
  vioBloqueo: boolean[];
  /** Respuestas 401 y 429 con código distinto de `BLOQUEO_TEMPORAL`, para los que las exigen. */
  rechazosAjenos: string[];
  total: number;
}

/**
 * `n` trabajadores, cada uno con su socket por petición, que repiten `peticion` sin pausa hasta que se llama
 * a `terminar()`. Solo guarda un resumen: la carga puede ser de miles de peticiones por segundo.
 */
function cargar(n: number, peticion: (trabajador: number) => Promise<Cruda>) {
  let seguir = true;
  const carga: Carga = {
    conteo: {},
    cincoXX: [],
    vioBloqueo: Array.from({ length: n }, () => false),
    rechazosAjenos: [],
    total: 0,
  };
  const trabajadores = Array.from({ length: n }, async (_, i) => {
    while (seguir) {
      const r = await peticion(i);
      carga.total++;
      carga.conteo[r.status] = (carga.conteo[r.status] ?? 0) + 1;
      if (r.status >= 500 && carga.cincoXX.length < 3) {
        carga.cincoXX.push(`${r.status} ${r.texto.slice(0, 120)}`);
      }
      if (r.status === 429) {
        if ((r.cuerpo?.reintentarEnSegundos ?? 0) > 1) carga.vioBloqueo[i] = true;
        if (r.cuerpo?.codigo !== 'BLOQUEO_TEMPORAL' && carga.rechazosAjenos.length < 3) {
          carga.rechazosAjenos.push(`429 ${r.texto.slice(0, 120)}`);
        }
      }
    }
  });
  return {
    carga,
    async terminar(): Promise<Carga> {
      seguir = false;
      await Promise.all(trabajadores);
      return carga;
    },
  };
}

/** `veces` ingresos secuenciales, uno cada ~`cadaMs` ms (se espera la respuesta y luego la pausa). */
async function ingresarVarias(
  veces: number,
  cadaMs: number,
  ingreso: () => Promise<Cruda>,
): Promise<Cruda[]> {
  const respuestas: Cruda[] = [];
  for (let i = 0; i < veces; i++) {
    respuestas.push(await ingreso());
    await dormir(cadaMs);
  }
  return respuestas;
}

const LIMITE_MS = 2000;

/** Al menos `minimo` ingresos correctos (201) y cada uno en menos de `LIMITE_MS`. */
function exigirIngresos(etiqueta: string, respuestas: Cruda[], minimo: number, carga: Carga): void {
  const buenas = respuestas.filter((r) => r.status === 201 && r.ms < LIMITE_MS);
  expect(
    buenas.length,
    `${etiqueta}: solo ${buenas.length} de ${respuestas.length} ingresos correctos respondieron 201 en menos de ` +
      `${LIMITE_MS} ms (se exigen ${minimo}): ${respuestas.map(corta).join(', ')}; carga: ${JSON.stringify(carga.conteo)}`,
  ).toBeGreaterThanOrEqual(minimo);
}

function exigirSinCincoXX(etiqueta: string, carga: Carga): void {
  expect(
    carga.cincoXX,
    `${etiqueta}: la carga recibió respuestas 5xx; conteo ${JSON.stringify(carga.conteo)}`,
  ).toEqual([]);
}

/**
 * Calentamiento de F2a y F3: espera a que cada cuenta atacada haya visto su bloqueo (429 de más de 1 s) o,
 * como mucho, `maxMs`. La fase inicial, con fallos todavía por evaluar, no es la que se exige.
 */
async function calentar(
  carga: Carga,
  maxMs: number,
  minMs: number,
): Promise<{ bloqueadas: number; ms: number }> {
  const inicio = Date.now();
  await dormir(minMs);
  while (Date.now() - inicio < maxMs && carga.vioBloqueo.some((visto) => !visto)) {
    await dormir(200);
  }
  return { bloqueadas: carga.vioBloqueo.filter(Boolean).length, ms: Date.now() - inicio };
}

// ------------------------------------------------------------------------------------------------
// R5-F1 · criterio 61 · nombres inventados no impiden el ingreso del superadministrador
// ------------------------------------------------------------------------------------------------
describe('R5-F1 · criterio 61 · una inundación de nombres inventados no impide que el superadministrador ingrese', () => {
  it('30 conexiones repiten POST /plataforma/sesiones con un nombre distinto cada vez: 9 de 10 ingresos del superadministrador real, 201 en menos de 2 s, y ningún 5xx', async () => {
    const inundacion = cargar(30, () => ingresoPlataforma(usuarioUnico('nadie'), 'x'));
    await dormir(1000);
    const ingresos = await ingresarVarias(10, 300, () =>
      ingresoPlataforma(sa.usuario, sa.contrasena),
    );
    const carga = await inundacion.terminar();
    exigirIngresos('superadministrador', ingresos, 9, carga);
    exigirSinCincoXX('inundación de plataforma', carga);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
// R5-F2a · criterios 10 y 11 · nombres reales de A no impiden ingresar al Administrador de A
// ------------------------------------------------------------------------------------------------
describe('R5-F2a · criterios 10 y 11 · los nombres reales de A bajo ataque no impiden ingresar al Administrador de A', () => {
  it('26 usuarios activos de A, cada uno atacado sin pausa con una contraseña mala; ya bloqueados, el Administrador de A ingresa en al menos 28 de 30 intentos (93 %) con 201 en menos de 2 s', async () => {
    const ataque = cargar(NOMBRES_F2A, (i) =>
      ingresoUsuario(atacadosF2a[i]!.usuario, `mala-${randomUUID().slice(0, 8)}`),
    );
    const calentamiento = await calentar(ataque.carga, 20_000, 1000);
    // Con las cuentas ya bloqueadas la cola de A se llena solo a ratos (hoy rechaza cerca de uno de cada
    // cuatro ingresos): se miden 30 ingresos para que la proporción (93 %, algo más estricta que en F1 y F2b) distinga la falla.
    const ingresos = await ingresarVarias(30, 100, ingresoDelAdministradorDeA);
    const carga = await ataque.terminar();
    exigirIngresos(
      `Administrador de A (calentamiento ${JSON.stringify(calentamiento)})`,
      ingresos,
      28,
      carga,
    );
    exigirSinCincoXX('ataque a los nombres de A', carga);
    expect(carga.rechazosAjenos, 'el ataque recibió un 429 que no es BLOQUEO_TEMPORAL').toEqual([]);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
// R5-F2b · criterios 10, 11 y 16 · una sesión interna no impide ingresar a los demás de su empresa
// ------------------------------------------------------------------------------------------------
describe('R5-F2b · criterios 10, 11 y 16 · un Mozo de A con sesión no impide que el Administrador de A ingrese', () => {
  it('60 bucles de PUT /sesion/contrasena con la actual equivocada: el Administrador de A ingresa 9 de 10 veces con 201 en menos de 2 s, el cambio cuenta para el bloqueo y no hay 5xx', async () => {
    const mozo = mozoF2b;
    const ataque = cargar(60, () =>
      pedir(
        'PUT',
        '/sesion/contrasena',
        { actual: `equivocada-${randomUUID().slice(0, 8)}`, nueva: `Nueva-${randomUUID()}` },
        bearer(mozo.token),
      ),
    );
    await dormir(1000);
    const ingresos = await ingresarVarias(10, 300, ingresoDelAdministradorDeA);
    const carga = await ataque.terminar();
    exigirIngresos('Administrador de A', ingresos, 9, carga);
    exigirSinCincoXX('PUT /sesion/contrasena del Mozo', carga);

    // El cambio de contraseña no evalúa sin límite (criterios 12 y 16): a lo sumo 5 respuestas 401 (las 5
    // evaluaciones que bloquean la cuenta) y todo lo demás es 429 BLOQUEO_TEMPORAL.
    const rechazadas = carga.conteo['401'] ?? 0;
    const bloqueadas = carga.conteo['429'] ?? 0;
    expect(
      rechazadas,
      `solo 5 actuales equivocadas pueden evaluarse antes del bloqueo; conteo ${JSON.stringify(carga.conteo)}`,
    ).toBeLessThanOrEqual(5);
    expect(
      rechazadas + bloqueadas,
      `el cambio respondió algo distinto de 401 y 429; conteo ${JSON.stringify(carga.conteo)}`,
    ).toBe(carga.total);
    expect(carga.rechazosAjenos, 'un 429 del cambio no es BLOQUEO_TEMPORAL').toEqual([]);

    // Ya bloqueado, ni la actual correcta se evalúa (criterio 12): 429 con el tiempo que falta.
    const correcta = await pedir(
      'PUT',
      '/sesion/contrasena',
      { actual: mozo.contrasena, nueva: `Nueva-${randomUUID()}` },
      bearer(mozo.token),
    );
    expect(correcta.status, `cambio con la actual correcta: ${correcta.texto.slice(0, 150)}`).toBe(
      429,
    );
    expect(correcta.cuerpo?.codigo).toBe('BLOQUEO_TEMPORAL');
    expect(
      correcta.cuerpo?.reintentarEnSegundos,
      'el bloqueo de 15 minutos debe informar el tiempo que falta',
    ).toBeGreaterThan(1);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
// R5-F3 · criterio 11 · el exceso de cola no es un oráculo de nombres
// ------------------------------------------------------------------------------------------------
describe('R5-F3 · criterio 11 · con la cola de A llena, la respuesta de la sonda no distingue nombres', () => {
  const llenadoras = [
    {
      via: 'F2a: 26 nombres reales de A atacados con una contraseña mala',
      iniciar: () =>
        cargar(NOMBRES_F3, (i) =>
          ingresoUsuario(atacadosF3[i]!.usuario, `mala-${randomUUID().slice(0, 8)}`),
        ),
    },
    {
      via: 'F2b: 60 bucles de PUT /sesion/contrasena de un Mozo de A',
      iniciar: () =>
        cargar(60, () =>
          pedir(
            'PUT',
            '/sesion/contrasena',
            { actual: `equivocada-${randomUUID().slice(0, 8)}`, nueva: `Nueva-${randomUUID()}` },
            bearer(mozoF3.token),
          ),
        ),
    },
  ];

  /** Respuesta de la sonda: estado, código y espera (lo que un atacante vería). */
  async function sondear(nombre: string): Promise<string> {
    const sonda = await ingresoUsuario(nombre, 'contrasena-cualquiera');
    return `${sonda.status}:${sonda.cuerpo?.codigo ?? ''}:${sonda.cuerpo?.reintentarEnSegundos ?? ''}`;
  }

  /** Respuesta más frecuente; en un empate, la menor en orden alfabético. */
  function mayoritaria(respuestas: string[]): string {
    const cuenta = new Map<string, number>();
    for (const r of respuestas) cuenta.set(r, (cuenta.get(r) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  }

  it.each(llenadoras)(
    'llenada la cola de A por $via: nombre activo de A, inactivo de A, de B e inexistente reciben la misma respuesta mayoritaria',
    async ({ iniciar }) => {
      const llenado = iniciar();
      const distribuciones: Record<string, string[]> = {
        activoDeA: [],
        inactivoDeA: [],
        deB: [],
        inexistente: [],
      };
      try {
        await dormir(1500);
        for (let i = 0; i < SONDAS; i++) {
          distribuciones.activoDeA!.push(await sondear(sondasActivasA[i]!.usuario));
          distribuciones.inactivoDeA!.push(await sondear(sondasInactivasA[i]!.usuario));
          distribuciones.deB!.push(await sondear(sondasDeB[i]!.usuario));
          distribuciones.inexistente!.push(await sondear(usuarioUnico('nadie')));
        }
      } finally {
        const carga = await llenado.terminar();
        exigirSinCincoXX('carga que llena la cola de A', carga);
      }
      const mayorias = Object.fromEntries(
        Object.entries(distribuciones).map(([variante, rs]) => [variante, mayoritaria(rs)]),
      );
      expect(
        new Set(Object.values(mayorias)).size,
        `la respuesta mayoritaria de la sonda depende de a quién pertenece el nombre (${JSON.stringify(mayorias)}); ` +
          `distribuciones: ${JSON.stringify(distribuciones)}`,
      ).toBe(1);
    },
    120_000,
  );
});
