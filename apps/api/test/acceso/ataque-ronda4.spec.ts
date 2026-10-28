// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ataque, ronda 4 (reportado por el adversarial). Cada bloque nace de una falla reproducida:
// - R4-F2 · RNF-03 (y criterio 5): la ráfaga de ingresos fallidos repartida entre MUCHOS nombres reales de A
//   no puede dejar sin servicio a B. Mismo molde que F1 de la ronda 3 (300 `POST /sesiones/contrasena` con
//   contraseña mala, pool de 10 conexiones), pero con 60 y con 30 nombres de usuarios activos: a los 500 ms
//   (y, en otra variante, a los 100 ms) `GET /sucursales` y el ingreso del Administrador de B responden 200 y
//   201 en menos de 2 s, y la ráfaga no produce ningún 5xx.
// - R4-F1 · criterios 11, 12 y 61: los ingresos CORRECTOS simultáneos de una misma persona no la bloquean ni
//   reciben un 429 con 900 s. Cada uno responde 201 o, por exceso de los topes por proceso (criterio 11),
//   429 `BLOQUEO_TEMPORAL` con `reintentarEnSegundos` de 1 como mucho; al terminar no hay bloqueo (ni fila de
//   auditoría de bloqueo) y el siguiente ingreso correcto, solo, responde 201. También tras un error de
//   tipeo (varias contraseñas malas y un doble envío de la correcta) y para el superadministrador.
// - R4-F3 · criterios 11 y 61: el tope de scrypt falso no puede servir de oráculo de nombres. Con los cupos
//   del scrypt falso ocupados por dos nombres inexistentes, la respuesta de la sonda (código y
//   `reintentarEnSegundos`) no puede distinguir un usuario activo de uno inexistente o inactivo (ni un
//   superadministrador existente de uno inexistente).
// - R4-F4 · criterio 10 y plan ("un reintento normal siempre consulta la base"): la memoria de 2 s de una
//   ráfaga solo recorta ráfagas; un usuario reactivado o recién creado tras una ráfaga entra enseguida.
// La API real con `RelojManual` (el reloj no avanza solo: ningún bloqueo expira durante una prueba) y un
// pool de 10 conexiones que escucha en un puerto propio.
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearSuperadministrador } from '../../scripts/lib/superadministrador';
import { consultar, type Libre } from './fabrica-equipos';
import {
  MINUTO,
  altaEmpresa,
  arrancar,
  bearer,
  contrasenaUnica,
  crearUsuario,
  crearUsuarioConSesion,
  desactivarSuperadministrador,
  exigirEstado,
  ingresarOk,
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

beforeAll(async () => {
  ctx = await arrancar({ poolMax: 10 });
  await ctx.app.listen(0);
  puerto = (ctx.app.getHttpServer().address() as { port: number }).port;
  sa = await nuevoSuperadmin(ctx);
  A = await altaEmpresa(ctx, sa);
  B = await altaEmpresa(ctx, sa);
}, 180_000);

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

const RUTA_USUARIOS = '/sesiones/contrasena';
const RUTA_PLATAFORMA = '/plataforma/sesiones';

const ingresoUsuario = (usuario: string, contrasena: string) =>
  pedir('POST', RUTA_USUARIOS, { usuario, contrasena });

const ingresoPlataforma = (usuario: string, contrasena: string) =>
  pedir('POST', RUTA_PLATAFORMA, { usuario, contrasena });

const conteoDe = (respuestas: Cruda[]): Record<string, number> => {
  const conteo: Record<string, number> = {};
  for (const r of respuestas) conteo[r.status] = (conteo[r.status] ?? 0) + 1;
  return conteo;
};

/** Texto corto de una respuesta para los mensajes de error. */
const corta = (r: Cruda): string =>
  r.status === 429 ? `429/${r.cuerpo?.reintentarEnSegundos}` : String(r.status);

const crearMozoDeA = (): Promise<UsuarioDePrueba> =>
  crearUsuario(ctx, A.admin.token, {
    accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
  });

const crearMozoConSesionDeA = (): Promise<UsuarioDePrueba> =>
  crearUsuarioConSesion(ctx, A.admin.token, {
    accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
  });

/** Pasa el bloqueo de 15 minutos y deja que venza cualquier memoria de 2 s de los topes. */
async function dejarPasarBloqueos(): Promise<void> {
  ctx.reloj.avanzar(16 * MINUTO);
  await dormir(2500);
  // Las sesiones de los dos Administradores vencieron por inactividad al avanzar el reloj: se abren de nuevo.
  A.admin.token = (await ingresarOk(ctx, A.admin.usuario, A.admin.contrasena)).token;
  B.admin.token = (await ingresarOk(ctx, B.admin.usuario, B.admin.contrasena)).token;
}

// ------------------------------------------------------------------------------------------------
// R4-F2 · RNF-03 · ráfaga repartida entre muchos nombres reales de A
// ------------------------------------------------------------------------------------------------
describe('R4-F2 · RNF-03 · una ráfaga de ingresos fallidos repartida entre muchos usuarios de A no deja sin servicio a B', () => {
  const RAFAGA = 300;
  const LIMITE_MS = 2000;
  const usuariosDeA: UsuarioDePrueba[] = [];

  beforeAll(async () => {
    // Solo hacen falta los nombres (la ráfaga usa una contraseña mala): se crean sin abrir sesión.
    for (let i = 0; i < 60; i += 6) {
      usuariosDeA.push(...(await Promise.all(Array.from({ length: 6 }, () => crearMozoDeA()))));
    }
  }, 300_000);

  /** Ráfaga repartida entre `nombres` (en mayúsculas) y, a los `demoraMs`, las dos peticiones de B. */
  async function atacar(nombres: string[], demoraMs: number) {
    const rafaga = Promise.all(
      Array.from({ length: RAFAGA }, (_, i) =>
        ingresoUsuario(nombres[i % nombres.length]!.toUpperCase(), 'mala-contrasena'),
      ),
    );
    await dormir(demoraMs);
    const [sucursales, ingreso] = await Promise.all([
      pedir('GET', '/sucursales', undefined, bearer(B.admin.token)),
      ingresoUsuario(B.admin.usuario, B.admin.contrasena),
    ]);
    const respuestas = await rafaga;
    return { sucursales, ingreso, respuestas, conteo: conteoDe(respuestas) };
  }

  function exigirServicioDeB(resultado: Awaited<ReturnType<typeof atacar>>): void {
    const { sucursales, ingreso, respuestas, conteo } = resultado;
    const diagnostico = JSON.stringify({
      sucursales: { status: sucursales.status, ms: sucursales.ms },
      ingreso: { status: ingreso.status, ms: ingreso.ms },
      rafaga: conteo,
    });
    expect(sucursales.status, `GET /sucursales de B: ${diagnostico}`).toBe(200);
    expect(ingreso.status, `ingreso del Administrador de B: ${diagnostico}`).toBe(201);
    expect(sucursales.ms, `GET /sucursales de B tardó demasiado: ${diagnostico}`).toBeLessThan(
      LIMITE_MS,
    );
    expect(ingreso.ms, `el ingreso de B tardó demasiado: ${diagnostico}`).toBeLessThan(LIMITE_MS);
    // La ráfaga misma solo recibe rechazos de credenciales o de bloqueo, nunca un error del servidor.
    const inesperadas = respuestas.filter((r) => r.status !== 401 && r.status !== 429);
    expect(
      inesperadas.slice(0, 3).map((r) => `${r.status} ${r.texto.slice(0, 120)}`),
      `la ráfaga produjo ${inesperadas.length} respuestas distintas de 401 y 429: ${diagnostico}`,
    ).toEqual([]);
  }

  it.each([
    { nombres: 60, demora: 500 },
    { nombres: 60, demora: 100 },
    { nombres: 30, demora: 500 },
    { nombres: 30, demora: 100 },
  ])(
    '300 ingresos malos repartidos en $nombres usuarios activos de A; B a los $demora ms: 200 y 201 en menos de 2 s y ningún 5xx',
    async ({ nombres, demora }) => {
      try {
        const elegidos = usuariosDeA.slice(0, nombres).map((u) => u.usuario);
        expect(elegidos).toHaveLength(nombres);
        exigirServicioDeB(await atacar(elegidos, demora));
      } finally {
        // Los usuarios quedan bloqueados por la ráfaga: el reloj pasa el bloqueo para la prueba siguiente.
        await dejarPasarBloqueos();
      }
    },
    240_000,
  );
});

// ------------------------------------------------------------------------------------------------
// R4-F1 · criterios 11, 12 y 61 · ingresos correctos simultáneos
// ------------------------------------------------------------------------------------------------
describe('R4-F1 · criterios 11, 12 y 61 · los ingresos correctos simultáneos no bloquean a la persona', () => {
  const REPETICIONES = 5;

  /** Cada respuesta es 201 o un 429 por exceso de topes (1 s como mucho); ninguno con 900; algún 201. */
  function exigirSoloExitosOExceso(respuestas: Cruda[], etiqueta: string): void {
    const resumen = respuestas.map(corta).sort().join(',');
    for (const r of respuestas) {
      if (r.status === 201) continue;
      expect(r.status, `${etiqueta}: ${resumen} · ${r.texto.slice(0, 150)}`).toBe(429);
      expect(r.cuerpo?.codigo, `${etiqueta}: ${resumen}`).toBe('BLOQUEO_TEMPORAL');
      expect(
        r.cuerpo?.reintentarEnSegundos,
        `${etiqueta}: un ingreso correcto recibió un bloqueo largo (${resumen})`,
      ).toBeLessThanOrEqual(1);
      expect(r.cuerpo?.reintentarEnSegundos, etiqueta).toBeGreaterThanOrEqual(1);
    }
    expect(
      respuestas.filter((r) => r.status === 201).length,
      `${etiqueta}: ningún ingreso correcto fue admitido (${resumen})`,
    ).toBeGreaterThanOrEqual(1);
  }

  /** Sin bloqueo en la base (cuenta y auditoría) y el siguiente ingreso correcto, solo, responde 201. */
  async function exigirSinBloqueoDeUsuario(u: UsuarioDePrueba, etiqueta: string): Promise<void> {
    await dormir(150);
    const bloqueos = await consultar<Libre>(
      `SELECT bloqueado_hasta FROM bloqueo_intentos
        WHERE empresa_id = $1 AND ambito = 'CONTRASENA_USUARIO' AND objetivo_id = $2
          AND bloqueado_hasta IS NOT NULL`,
      [A.empresaId, u.id],
    );
    expect(
      bloqueos,
      `${etiqueta}: quedó un bloqueo (bloqueado_hasta) por ingresos correctos`,
    ).toEqual([]);
    const auditados = await consultar<Libre>(
      `SELECT a.id FROM auditoria a
        WHERE a.accion = 'bloqueo_contrasena'
          AND (a.entidad_id = $1 OR row_to_json(a)::text LIKE '%' || $1::text || '%')`,
      [u.id],
    );
    expect(auditados, `${etiqueta}: quedó una fila de auditoría bloqueo_contrasena`).toHaveLength(
      0,
    );
    const siguiente = await ingresoUsuario(u.usuario, u.contrasena);
    expect(
      siguiente.status,
      `${etiqueta}: el siguiente ingreso correcto, solo, respondió ${corta(siguiente)} ${siguiente.texto.slice(0, 150)}`,
    ).toBe(201);
  }

  it.each([6, 7, 10])(
    '(a) %i ingresos correctos en paralelo del mismo usuario nuevo (varias veces): 201 o 429 de 1 s, sin bloqueo y el siguiente ingresa',
    async (K) => {
      for (let vuelta = 1; vuelta <= REPETICIONES; vuelta++) {
        const u = await crearMozoConSesionDeA();
        const etiqueta = `K=${K}, vuelta ${vuelta}`;
        const respuestas = await Promise.all(
          Array.from({ length: K }, () => ingresoUsuario(u.usuario, u.contrasena)),
        );
        exigirSoloExitosOExceso(respuestas, etiqueta);
        await exigirSinBloqueoDeUsuario(u, etiqueta);
      }
    },
    180_000,
  );

  it.each([
    { malas: 4, simultaneas: 2 },
    { malas: 3, simultaneas: 3 },
    { malas: 2, simultaneas: 4 },
  ])(
    '(b) $malas contraseñas malas seguidas y $simultaneas envíos simultáneos de la correcta: algún 201, el resto 201 o 429 de 1 s, y sin bloqueo',
    async ({ malas, simultaneas }) => {
      for (let vuelta = 1; vuelta <= 4; vuelta++) {
        const u = await crearMozoConSesionDeA();
        const etiqueta = `${malas} malas + ${simultaneas} correctas, vuelta ${vuelta}`;
        for (let i = 0; i < malas; i++) {
          const fallo = await ingresoUsuario(u.usuario, 'mala-contrasena');
          expect(fallo.status, `${etiqueta}: el error de tipeo ${i + 1}`).toBe(401);
        }
        const respuestas = await Promise.all(
          Array.from({ length: simultaneas }, () => ingresoUsuario(u.usuario, u.contrasena)),
        );
        exigirSoloExitosOExceso(respuestas, etiqueta);
        await exigirSinBloqueoDeUsuario(u, etiqueta);
      }
    },
    180_000,
  );

  it('(c) superadministrador: 6 ingresos correctos en paralelo (varias veces): 201 o 429 de 1 s, sin bloqueo y el siguiente ingresa', async () => {
    for (let vuelta = 1; vuelta <= REPETICIONES; vuelta++) {
      const usuario = usuarioUnico('sac');
      const contrasena = contrasenaUnica();
      const { id } = await crearSuperadministrador({
        usuario,
        nombre: 'SA de los ingresos correctos',
        contrasena,
      });
      const etiqueta = `superadministrador K=6, vuelta ${vuelta}`;
      const respuestas = await Promise.all(
        Array.from({ length: 6 }, () => ingresoPlataforma(usuario, contrasena)),
      );
      exigirSoloExitosOExceso(respuestas, etiqueta);

      await dormir(150);
      const [fila] = await consultar<Libre>(
        'SELECT bloqueado_hasta FROM superadministrador WHERE id = $1',
        [id],
      );
      expect(fila?.bloqueado_hasta, `${etiqueta}: quedó un bloqueo (bloqueado_hasta)`).toBeNull();
      const auditados = await consultar<Libre>(
        `SELECT a.id FROM auditoria a
          WHERE a.accion = 'bloqueo_superadministrador'
            AND (a.entidad_id = $1 OR a.actor_superadministrador_id = $1
                 OR row_to_json(a)::text LIKE '%' || $1::text || '%')`,
        [id],
      );
      expect(auditados, `${etiqueta}: quedó una fila bloqueo_superadministrador`).toHaveLength(0);

      const siguiente = await ingresoPlataforma(usuario, contrasena);
      expect(
        siguiente.status,
        `${etiqueta}: el siguiente ingreso correcto, solo, respondió ${corta(siguiente)} ${siguiente.texto.slice(0, 150)}`,
      ).toBe(201);
    }
  }, 180_000);
});

// ------------------------------------------------------------------------------------------------
// R4-F3 · criterios 11 y 61 · el tope de scrypt falso no es un oráculo de nombres
// ------------------------------------------------------------------------------------------------
describe('R4-F3 · criterios 11 y 61 · la respuesta bajo ráfaga no distingue nombres existentes de inexistentes', () => {
  const REPETICIONES = 8;

  /**
   * Dos ingresos con nombres inexistentes aleatorios distintos ocupan los cupos del scrypt falso; unos 15 ms
   * después llega la sonda con `nombre` y una contraseña cualquiera. Devuelve la respuesta de la sonda.
   */
  async function sondear(ruta: string, nombre: string): Promise<string> {
    const senuelos = [0, 1].map(() =>
      pedir('POST', ruta, { usuario: usuarioUnico('senuelo'), contrasena: 'mala-contrasena' }),
    );
    await dormir(15);
    const sonda = await pedir('POST', ruta, { usuario: nombre, contrasena: 'mala-contrasena-x' });
    await Promise.all(senuelos);
    await dormir(150); // los cupos se liberan antes de la siguiente sonda
    return `${sonda.status}:${sonda.cuerpo?.codigo ?? ''}:${sonda.cuerpo?.reintentarEnSegundos ?? ''}`;
  }

  /** Respuesta más frecuente (código y espera); en un empate, la menor en orden alfabético. */
  function mayoritaria(respuestas: string[]): string {
    const cuenta = new Map<string, number>();
    for (const r of respuestas) cuenta.set(r, (cuenta.get(r) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  }

  function exigirIndistinguibles(distribuciones: Record<string, string[]>): void {
    const mayorias = Object.fromEntries(
      Object.entries(distribuciones).map(([variante, rs]) => [variante, mayoritaria(rs)]),
    );
    const diagnostico = JSON.stringify(distribuciones);
    const distintas = new Set(Object.values(mayorias));
    expect(
      distintas.size,
      `la respuesta mayoritaria de la sonda depende de si el nombre existe (${JSON.stringify(mayorias)}); distribuciones: ${diagnostico}`,
    ).toBe(1);
  }

  it('empresa: la sonda responde lo mismo con un usuario activo de A, uno inexistente y uno inactivo', async () => {
    const distribuciones: Record<string, string[]> = { activo: [], inexistente: [], inactivo: [] };
    for (let i = 0; i < REPETICIONES; i++) {
      // Un usuario nuevo por repetición: cada sonda cuenta un fallo y el activo no debe llegar a bloquearse.
      const activo = await crearMozoDeA();
      const inactivo = await crearMozoDeA();
      exigirEstado(
        await ctx
          .http()
          .patch(`/usuarios/${inactivo.id}`)
          .set(bearer(A.admin.token))
          .send({ activo: false }),
        200,
        'desactivar al usuario de la sonda',
      );
      distribuciones.activo!.push(await sondear(RUTA_USUARIOS, activo.usuario));
      distribuciones.inexistente!.push(await sondear(RUTA_USUARIOS, usuarioUnico('nadie')));
      distribuciones.inactivo!.push(await sondear(RUTA_USUARIOS, inactivo.usuario));
    }
    exigirIndistinguibles(distribuciones);
  }, 240_000);

  it('plataforma: la sonda responde lo mismo con un superadministrador existente, uno inexistente y uno inactivo', async () => {
    const distribuciones: Record<string, string[]> = {
      existente: [],
      inexistente: [],
      inactivo: [],
    };
    for (let i = 0; i < REPETICIONES; i++) {
      const existente = usuarioUnico('saex');
      await crearSuperadministrador({
        usuario: existente,
        nombre: 'SA de la sonda',
        contrasena: contrasenaUnica(),
      });
      const inactivo = usuarioUnico('sain');
      await crearSuperadministrador({
        usuario: inactivo,
        nombre: 'SA inactivo de la sonda',
        contrasena: contrasenaUnica(),
      });
      await desactivarSuperadministrador({ usuario: inactivo });
      distribuciones.existente!.push(await sondear(RUTA_PLATAFORMA, existente));
      distribuciones.inexistente!.push(await sondear(RUTA_PLATAFORMA, usuarioUnico('sanadie')));
      distribuciones.inactivo!.push(await sondear(RUTA_PLATAFORMA, inactivo));
    }
    exigirIndistinguibles(distribuciones);
  }, 240_000);
});

// ------------------------------------------------------------------------------------------------
// R4-F4 · criterio 10 y plan · la memoria de 2 s no afecta a un reintento normal
// ------------------------------------------------------------------------------------------------
describe('R4-F4 · criterio 10 · tras una ráfaga, un usuario reactivado o recién creado entra enseguida', () => {
  it.each([0, 500])(
    '(a) usuario desactivado, ráfaga de 4 ingresos malos y reactivado con PATCH: el ingreso correcto %i ms después responde 201',
    async (espera) => {
      for (let vuelta = 1; vuelta <= 2; vuelta++) {
        const u = await crearMozoDeA();
        const etiqueta = `espera ${espera} ms, vuelta ${vuelta}`;
        exigirEstado(
          await ctx
            .http()
            .patch(`/usuarios/${u.id}`)
            .set(bearer(A.admin.token))
            .send({ activo: false }),
          200,
          `${etiqueta}: desactivar`,
        );
        const rafaga = await Promise.all(
          Array.from({ length: 4 }, () => ingresoUsuario(u.usuario, 'mala-contrasena')),
        );
        for (const r of rafaga) {
          expect([401, 429], `${etiqueta}: la ráfaga respondió ${corta(r)}`).toContain(r.status);
        }
        exigirEstado(
          await ctx
            .http()
            .patch(`/usuarios/${u.id}`)
            .set(bearer(A.admin.token))
            .send({ activo: true }),
          200,
          `${etiqueta}: reactivar`,
        );
        await dormir(espera);
        const ingreso = await ingresoUsuario(u.usuario, u.contrasena);
        expect(
          ingreso.status,
          `${etiqueta}: el usuario reactivado respondió ${corta(ingreso)} ${ingreso.texto.slice(0, 150)}`,
        ).toBe(201);
      }
    },
    120_000,
  );

  it('(b) ráfaga de 3 ingresos contra un nombre inexistente, luego POST /usuarios con ese nombre: el ingreso con la contraseña temporal responde 201', async () => {
    for (let vuelta = 1; vuelta <= 3; vuelta++) {
      const nombre = usuarioUnico('nuevo');
      const etiqueta = `vuelta ${vuelta}`;
      const rafaga = await Promise.all(
        Array.from({ length: 3 }, () => ingresoUsuario(nombre, 'mala-contrasena')),
      );
      for (const r of rafaga) {
        expect([401, 429], `${etiqueta}: la ráfaga respondió ${corta(r)}`).toContain(r.status);
      }
      const u = await crearUsuario(ctx, A.admin.token, {
        nombreUsuario: nombre,
        accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
      });
      const ingreso = await ingresoUsuario(u.usuario, u.contrasenaTemporal);
      expect(
        ingreso.status,
        `${etiqueta}: el usuario recién creado respondió ${corta(ingreso)} ${ingreso.texto.slice(0, 150)}`,
      ).toBe(201);
    }
  }, 120_000);
});
