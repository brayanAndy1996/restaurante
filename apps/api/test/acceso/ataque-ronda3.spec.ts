// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ataque, ronda 3 (reportado por el adversarial). Cada bloque nace de una falla reproducida:
// - F1 · criterio 5 y RNF-03: una ráfaga de ingresos fallidos contra un usuario (inactivo o activo) de una
//   empresa no puede dejar sin servicio a otra empresa. Con un pool de 10 conexiones, 300 `POST
//   /sesiones/contrasena` concurrentes con contraseña mala; 500 ms después, `GET /sucursales` y un ingreso
//   correcto del Administrador de B responden su código normal (200 y 201), nunca 500, en menos de 2 s, y la
//   propia ráfaga no produce ningún 5xx.
// - F2 · criterios 45, 47 y 86: con el bloqueo de la clave de supervisor vigente, la clave de idempotencia
//   no puede servir de oráculo del PIN: todo intento (con cualquier PIN, el correcto incluido) responde el
//   mismo 429 `BLOQUEO_TEMPORAL`. Sin bloqueo, la misma clave con otro PIN es otro cuerpo (criterio 86: 422
//   `CLAVE_IDEMPOTENCIA_REUTILIZADA` sin evaluar el PIN) o cuenta como fallo; nunca se prueban PIN gratis.
// - F3 · criterio 61: la carrera entre el ingreso del superadministrador y su desactivación no deja una
//   sesión abierta (ni un token que funcione) después de desactivarlo.
// - F4 · criterio 61: un ingreso correcto concurrente no borra un bloqueo puesto por otros fallos de la
//   ráfaga: si quedó auditado un `bloqueo_superadministrador`, los intentos siguientes responden 429.
// - Desbloqueo operativo del superadministrador (`desbloquearSuperadministrador({ usuario })` en
//   `scripts/lib/superadministrador.ts`, decisión del orquestador): tras el bloqueo, el desbloqueo permite
//   entrar de nuevo y queda auditado con el actor `cli:superadmin`.
// La API real con `RelojManual` (el reloj no avanza solo: ningún bloqueo expira durante una prueba) y un
// pool de 10 conexiones que escucha en un puerto propio.
import { randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as scriptsSuperadmin from '../../scripts/lib/superadministrador';
import { consultar, type Libre } from './fabrica-equipos';
import {
  MINUTO,
  altaEmpresa,
  arrancar,
  bearer,
  contrasenaUnica,
  crearUsuarioConSesion,
  desactivarSuperadministrador,
  exigirEstado,
  nuevoSuperadmin,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
  type UsuarioDePrueba,
} from './fabrica-plataforma';

const { crearSuperadministrador } = scriptsSuperadmin;

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
// F1 · criterio 5 y RNF-03 · denegación de servicio con un usuario de otra empresa
// ------------------------------------------------------------------------------------------------
describe('F1 · criterio 5 y RNF-03 · una ráfaga de ingresos fallidos en A no deja sin servicio a B', () => {
  interface Cruda {
    status: number;
    ms: number;
    texto: string;
  }

  /** Petición por un socket propio (sin agente compartido): 300 peticiones son 300 conexiones reales. */
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
          respuesta.on('end', () =>
            resolver({ status: respuesta.statusCode ?? 0, ms: Date.now() - inicio, texto }),
          );
        },
      );
      peticion.on('error', (error) =>
        resolver({ status: -1, ms: Date.now() - inicio, texto: String(error) }),
      );
      if (datos) peticion.write(datos);
      peticion.end();
    });
  }

  const RAFAGA = 300;
  const LIMITE_MS = 2000;

  async function mozoDeA(): Promise<UsuarioDePrueba> {
    return crearUsuarioConSesion(ctx, A.admin.token, {
      accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
    });
  }

  /** Ráfaga contra `usuario` (en mayúsculas) y, a los 500 ms, las dos peticiones de B. */
  async function atacar(usuario: string) {
    const rafaga = Promise.all(
      Array.from({ length: RAFAGA }, () =>
        pedir('POST', '/sesiones/contrasena', {
          usuario: usuario.toUpperCase(),
          contrasena: 'mala-contrasena',
        }),
      ),
    );
    await dormir(500);
    const [sucursales, ingreso] = await Promise.all([
      pedir('GET', '/sucursales', undefined, bearer(B.admin.token)),
      pedir('POST', '/sesiones/contrasena', {
        usuario: B.admin.usuario,
        contrasena: B.admin.contrasena,
      }),
    ]);
    const respuestas = await rafaga;
    const conteo: Record<string, number> = {};
    for (const r of respuestas) conteo[r.status] = (conteo[r.status] ?? 0) + 1;
    return { sucursales, ingreso, respuestas, conteo };
  }

  function exigirServicioDeB(resultado: Awaited<ReturnType<typeof atacar>>): void {
    const { sucursales, ingreso, respuestas, conteo } = resultado;
    const diagnostico = JSON.stringify({
      sucursales: { status: sucursales.status, ms: sucursales.ms },
      ingreso: { status: ingreso.status, ms: ingreso.ms },
      rafaga: conteo,
    });
    // B responde su código normal, sin 500.
    expect(sucursales.status, `GET /sucursales de B: ${diagnostico}`).toBe(200);
    expect(ingreso.status, `ingreso del Administrador de B: ${diagnostico}`).toBe(201);
    // Y rápido: la ráfaga de A no le quita el servicio.
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

  it('con un usuario DESACTIVADO de A (nombre en mayúsculas): B responde 200 y 201 en menos de 2 s y ningún 500', async () => {
    const mozo = await mozoDeA();
    const desactivado = await ctx
      .http()
      .patch(`/usuarios/${mozo.id}`)
      .set(bearer(A.admin.token))
      .send({ activo: false });
    exigirEstado(desactivado, 200, 'desactivar al Mozo');
    exigirServicioDeB(await atacar(mozo.usuario));
  }, 240_000);

  it('con un usuario ACTIVO de A: B responde 200 y 201 en menos de 2 s y ningún 500', async () => {
    const mozo = await mozoDeA();
    exigirServicioDeB(await atacar(mozo.usuario));
  }, 240_000);
});

// ------------------------------------------------------------------------------------------------
// F2 · criterios 45, 47 y 86 · la clave de idempotencia no es un oráculo del PIN
// ------------------------------------------------------------------------------------------------
describe('F2 · criterios 45, 47 y 86 · la idempotencia de POST /autorizaciones no revela el PIN', () => {
  const ACCION = 'ANULAR_ITEM_ENVIADO';
  const MOTIVO = 'El cliente reclamó el plato';

  interface Escenario {
    cajero: UsuarioDePrueba;
    supervisor: UsuarioDePrueba;
    otroSupervisor: UsuarioDePrueba;
    conocidos: Set<string>;
  }

  async function escenario(): Promise<Escenario> {
    const sucursalId = A.sucursales[0]!.id;
    const cajero = await crearUsuarioConSesion(ctx, A.admin.token, {
      accesos: [{ sucursalId, rol: 'CAJERO' }],
    });
    const supervisor = await crearUsuarioConSesion(ctx, A.admin.token, {
      accesos: [{ sucursalId, rol: 'SUPERVISOR' }],
    });
    const otroSupervisor = await crearUsuarioConSesion(ctx, A.admin.token, {
      accesos: [{ sucursalId, rol: 'SUPERVISOR' }],
    });
    const conocidos = new Set<string>([
      cajero.pin,
      supervisor.pin,
      otroSupervisor.pin,
      A.admin.pin,
    ]);
    return { cajero, supervisor, otroSupervisor, conocidos };
  }

  /** Un PIN de 6 dígitos que no es el de nadie de la empresa de prueba ni se repite. */
  function pinsEquivocados(e: Escenario, cuantos: number): string[] {
    const pines = new Set<string>();
    while (pines.size < cuantos) {
      const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (!e.conocidos.has(pin)) pines.add(pin);
    }
    return [...pines];
  }

  const autorizar = (token: string, pin: string, clave?: string) => {
    let peticion = ctx.http().post('/autorizaciones').set(bearer(token));
    if (clave) peticion = peticion.set('Idempotency-Key', clave);
    return peticion.send({ accion: ACCION, motivo: MOTIVO, pin });
  };

  const autorizacionesDe = async (solicitanteId: string) =>
    (await consultar('SELECT id FROM autorizacion WHERE solicitante_id = $1', [solicitanteId]))
      .length;

  const fallosDeClave = async (solicitanteId: string): Promise<number> => {
    const filas = await consultar<Libre>(
      `SELECT COALESCE(sum(fallos_seguidos), 0)::int AS n
         FROM bloqueo_intentos WHERE objetivo_id = $1`,
      [solicitanteId],
    );
    return Number(filas[0]?.n ?? 0);
  };

  it('con el bloqueo vigente, K con cualquier PIN (el correcto incluido) responde el mismo 429 BLOQUEO_TEMPORAL', async () => {
    const e = await escenario();
    const K = randomUUID();

    // K ya tiene guardada una respuesta 201 con el PIN correcto.
    const primera = await autorizar(e.cajero.token, e.supervisor.pin, K);
    expect(primera.status, JSON.stringify(primera.body)).toBe(201);

    // Cinco fallos sin clave dejan bloqueado al solicitante; el siguiente intento ya es 429.
    for (const pin of pinsEquivocados(e, 5)) {
      const fallo = await autorizar(e.cajero.token, pin);
      expect(fallo.status, JSON.stringify(fallo.body)).toBe(403);
      expect(fallo.body).toMatchObject({ codigo: 'CLAVE_INVALIDA' });
    }
    const referencia = await autorizar(e.cajero.token, pinsEquivocados(e, 1)[0]!);
    expect(referencia.status, JSON.stringify(referencia.body)).toBe(429);
    expect(referencia.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });

    // Con el bloqueo vigente: varios PIN distintos con K, la misma acción y el mismo motivo, y al final el
    // correcto con K. Todos responden igual que cualquier intento bloqueado.
    const intentos: [string, string][] = [
      ...pinsEquivocados(e, 8).map((pin): [string, string] => [`PIN equivocado ${pin}`, pin]),
      ['PIN válido de otro supervisor', e.otroSupervisor.pin],
      [
        'PIN correcto del cuerpo original (réplica exacta de la primera petición)',
        e.supervisor.pin,
      ],
    ];
    for (const [nombre, pin] of intentos) {
      const res = await autorizar(e.cajero.token, pin, K);
      expect({ nombre, estado: res.status, codigo: res.body?.codigo }).toEqual({
        nombre,
        estado: 429,
        codigo: 'BLOQUEO_TEMPORAL',
      });
      expect(
        res.body,
        `${nombre}: debe ser la misma respuesta que cualquier intento bloqueado`,
      ).toEqual(referencia.body);
      expect(res.headers['retry-after'], nombre).toEqual(referencia.headers['retry-after']);
      expect(res.body.autorizacionId, nombre).toBeUndefined();
    }

    // Ninguno de esos intentos creó nada: sigue la autorización de la primera petición.
    expect(await autorizacionesDe(e.cajero.id)).toBe(1);

    // Pasado el bloqueo, la clave vuelve a servir como siempre (criterio 85): la réplica devuelve lo guardado.
    ctx.reloj.avanzar(5 * MINUTO + 1000);
    const replica = await autorizar(e.cajero.token, e.supervisor.pin, K);
    expect(replica.status, JSON.stringify(replica.body)).toBe(201);
    expect(replica.body).toEqual(primera.body);
    expect(await autorizacionesDe(e.cajero.id)).toBe(1);
  }, 180_000);

  it('sin bloqueo, K con un PIN distinto del original no prueba PIN gratis: 422 sin evaluar o cuenta como fallo', async () => {
    const e = await escenario();
    const K = randomUUID();
    const primera = await autorizar(e.cajero.token, e.supervisor.pin, K);
    expect(primera.status, JSON.stringify(primera.body)).toBe(201);

    const fallosAntes = await fallosDeClave(e.cajero.id);
    const rechazosAntes = (
      await consultar(
        `SELECT id FROM auditoria
          WHERE empresa_id = $1 AND accion = 'autorizacion_rechazada' AND actor_usuario_id = $2`,
        [A.empresaId, e.cajero.id],
      )
    ).length;

    // El primero es el PIN válido de otro supervisor: si se evaluara, otorgaría una autorización.
    const pines = [e.otroSupervisor.pin, ...pinsEquivocados(e, 5)];
    const respuestas = [];
    for (const pin of pines) respuestas.push(await autorizar(e.cajero.token, pin, K));
    const resumen = respuestas.map((r) => `${r.status}:${r.body?.codigo}`).join(' ');

    // Nunca se autoriza con otro PIN ni se crea otra autorización.
    expect(
      respuestas.filter((r) => r.status === 201),
      resumen,
    ).toHaveLength(0);
    expect(await autorizacionesDe(e.cajero.id)).toBe(1);

    const fallosDespues = await fallosDeClave(e.cajero.id);
    const rechazosDespues = (
      await consultar(
        `SELECT id FROM auditoria
          WHERE empresa_id = $1 AND accion = 'autorizacion_rechazada' AND actor_usuario_id = $2`,
        [A.empresaId, e.cajero.id],
      )
    ).length;

    // Opción (a), la del criterio 86: otro cuerpo con la misma clave es 422 y el PIN ni se evalúa.
    const sinEvaluar =
      respuestas.every(
        (r) => r.status === 422 && r.body?.codigo === 'CLAVE_IDEMPOTENCIA_REUTILIZADA',
      ) &&
      fallosDespues === fallosAntes &&
      rechazosDespues === rechazosAntes;
    // Opción (b): cada intento cuenta como fallo de clave y, tras cinco, el siguiente es 429.
    const cuentaComoFallo =
      fallosDespues - fallosAntes >= 5 &&
      respuestas[5]!.status === 429 &&
      respuestas[5]!.body?.codigo === 'BLOQUEO_TEMPORAL';
    expect(
      sinEvaluar || cuentaComoFallo,
      `la clave sirvió para probar PIN sin que cuenten (${resumen}; fallos ${fallosAntes} -> ${fallosDespues})`,
    ).toBe(true);
  }, 180_000);
});

// ------------------------------------------------------------------------------------------------
// F3 · criterio 61 · carrera entre el ingreso y la desactivación del superadministrador
// ------------------------------------------------------------------------------------------------
describe('F3 · criterio 61 · el ingreso concurrente con la desactivación no deja una sesión abierta', () => {
  const DEMORAS_MS = [0, 3, 8, 15, 25, 40, 60, 80];
  const REPETICIONES = 3;

  it.each(DEMORAS_MS)(
    'ingreso y desactivación con %i ms de diferencia: o 401 sin sesión, o la sesión queda cerrada',
    async (demora) => {
      for (let vuelta = 0; vuelta < REPETICIONES; vuelta++) {
        const usuario = usuarioUnico('sar');
        const contrasena = contrasenaUnica();
        const { id } = await crearSuperadministrador({
          usuario,
          nombre: 'SA de la carrera',
          contrasena,
        });

        const ingreso = ctx
          .http()
          .post('/plataforma/sesiones')
          .send({ usuario, contrasena })
          .then((r) => r);
        await dormir(demora);
        await desactivarSuperadministrador({ usuario });
        const res = await ingreso;
        const etiqueta = `demora ${demora} ms, vuelta ${vuelta}: ingreso ${res.status}`;

        expect([201, 401], `${etiqueta} ${JSON.stringify(res.body)}`).toContain(res.status);

        // Terminada la desactivación no queda ninguna sesión abierta de ese superadministrador.
        const abiertas = await consultar<Libre>(
          `SELECT id FROM sesion_superadministrador
            WHERE superadministrador_id = $1 AND cerrada_en IS NULL`,
          [id],
        );
        expect(abiertas, `${etiqueta}: quedó una sesión abierta tras desactivarlo`).toHaveLength(0);

        // Y un token que se haya entregado ya no sirve.
        if (res.status === 201) {
          const uso = await ctx.http().get('/plataforma/empresas').set(bearer(res.body.token));
          expect(uso.status, `${etiqueta}: el token siguió sirviendo`).toBe(401);
        } else {
          expect(res.body).toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS' });
        }

        // Desactivado, no vuelve a entrar.
        const despues = await ctx.http().post('/plataforma/sesiones').send({ usuario, contrasena });
        expect(despues.status, etiqueta).toBe(401);
        expect(despues.body).toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS' });
      }
    },
    180_000,
  );
});

// ------------------------------------------------------------------------------------------------
// F4 · criterio 61 · un ingreso correcto concurrente no borra un bloqueo puesto después
// ------------------------------------------------------------------------------------------------
describe('F4 · criterio 61 · un ingreso correcto en medio de la ráfaga no borra el bloqueo', () => {
  const MALAS = 30;

  it.each([0, 2, 5, 12, 25])(
    '30 ingresos malos y uno correcto en la posición %i: si quedó el bloqueo auditado, los 6 intentos siguientes son 429',
    async (posicion) => {
      const usuario = usuarioUnico('sab');
      const contrasena = contrasenaUnica();
      const { id } = await crearSuperadministrador({
        usuario,
        nombre: 'SA de la ráfaga',
        contrasena,
      });

      const peticiones: Promise<{ clase: string; status: number }>[] = [];
      for (let i = 0; i < MALAS; i++) {
        if (i === posicion) {
          peticiones.push(
            ctx
              .http()
              .post('/plataforma/sesiones')
              .send({ usuario, contrasena })
              .then((r) => ({ clase: 'correcta', status: r.status })),
          );
        }
        peticiones.push(
          ctx
            .http()
            .post('/plataforma/sesiones')
            .send({ usuario, contrasena: `mala-${i}-${randomUUID()}` })
            .then((r) => ({ clase: 'mala', status: r.status })),
        );
      }
      const respuestas = await Promise.all(peticiones);
      const conteo: Record<string, number> = {};
      for (const r of respuestas)
        conteo[`${r.clase}:${r.status}`] = (conteo[`${r.clase}:${r.status}`] ?? 0) + 1;
      const diagnostico = JSON.stringify(conteo);

      // Ninguna respuesta de la ráfaga es un error del servidor.
      const inesperadas = respuestas.filter((r) => ![201, 401, 429].includes(r.status));
      expect(inesperadas, diagnostico).toEqual([]);

      // Con 30 fallos y un solo ingreso correcto, la ráfaga tiene que haber dejado un bloqueo auditado.
      const bloqueos = await consultar<Libre>(
        `SELECT id FROM auditoria
          WHERE accion = 'bloqueo_superadministrador'
            AND (entidad_id = $1 OR actor_superadministrador_id = $1 OR detalle::text LIKE '%' || $1::text || '%')`,
        [id],
      );
      expect(
        bloqueos.length,
        `la ráfaga no dejó ningún bloqueo auditado: ${diagnostico}`,
      ).toBeGreaterThan(0);

      // El bloqueo sigue puesto en la fila del superadministrador (el reloj no avanzó).
      const [fila] = await consultar<Libre>(
        'SELECT bloqueado_hasta FROM superadministrador WHERE id = $1',
        [id],
      );
      expect(
        fila?.bloqueado_hasta,
        `el ingreso correcto borró el bloqueo: ${diagnostico}`,
      ).not.toBeNull();

      // Sin avanzar el reloj, seis intentos más: todos bloqueados, sin evaluarse.
      const siguientes: number[] = [];
      for (let j = 0; j < 6; j++) {
        const res = await ctx
          .http()
          .post('/plataforma/sesiones')
          .send({ usuario, contrasena: `otra-${j}-${randomUUID()}` });
        siguientes.push(res.status);
        expect(res.body, `intento ${j + 1}`).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
      }
      expect(siguientes, `intentos posteriores al bloqueo; ráfaga ${diagnostico}`).toEqual([
        429, 429, 429, 429, 429, 429,
      ]);

      // Ni siquiera la contraseña correcta entra mientras dure el bloqueo.
      const correcta = await ctx.http().post('/plataforma/sesiones').send({ usuario, contrasena });
      expect(correcta.status, JSON.stringify(correcta.body)).toBe(429);
      expect(correcta.body.token).toBeUndefined();
    },
    120_000,
  );
});

// ------------------------------------------------------------------------------------------------
// Desbloqueo operativo del superadministrador (criterio 61, decisión del orquestador)
// ------------------------------------------------------------------------------------------------
describe('desbloqueo del superadministrador · criterio 61', () => {
  type Desbloquear = (datos: { usuario: string }) => Promise<void>;
  // Import de espacio de nombres: el archivo compila aunque la función todavía no exista y la prueba falla a la vista.
  const desbloquear = (
    scriptsSuperadmin as unknown as { desbloquearSuperadministrador?: Desbloquear }
  ).desbloquearSuperadministrador;

  it('tras 5 fallos queda bloqueado (429); desbloquearlo permite entrar con la contraseña correcta y queda auditado con cli:superadmin', async () => {
    expect(
      desbloquear,
      'falta la función pública desbloquearSuperadministrador({ usuario }) en scripts/lib/superadministrador.ts',
    ).toBeTypeOf('function');

    const usuario = usuarioUnico('sad');
    const contrasena = contrasenaUnica();
    const { id } = await crearSuperadministrador({
      usuario,
      nombre: 'SA a desbloquear',
      contrasena,
    });

    for (let i = 0; i < 5; i++) {
      const fallo = await ctx
        .http()
        .post('/plataforma/sesiones')
        .send({ usuario, contrasena: `mala-${i}` });
      expect(fallo.status, JSON.stringify(fallo.body)).toBe(401);
    }
    const bloqueado = await ctx.http().post('/plataforma/sesiones').send({ usuario, contrasena });
    expect(bloqueado.status, JSON.stringify(bloqueado.body)).toBe(429);
    expect(bloqueado.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });

    await desbloquear!({ usuario });

    const entrada = await ctx.http().post('/plataforma/sesiones').send({ usuario, contrasena });
    expect(entrada.status, JSON.stringify(entrada.body)).toBe(201);
    expect(typeof entrada.body.token).toBe('string');

    // La cuenta de fallos se reinició: un fallo nuevo es un 401, no sigue bloqueado.
    const fallo = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario, contrasena: 'mala-despues' });
    expect(fallo.status, JSON.stringify(fallo.body)).toBe(401);

    // El desbloqueo queda auditado, sin empresa, con el actor de sistema `cli:superadmin` y sin secretos.
    const filas = await consultar<Libre>(
      `SELECT a.accion, a.actor_sistema, a.empresa_id, row_to_json(a)::text AS texto
         FROM auditoria a
        WHERE a.actor_sistema = 'cli:superadmin'
          AND a.accion ILIKE '%desbloque%'
          AND (a.entidad_id = $1 OR a.detalle::text LIKE '%' || $1::text || '%')`,
      [id],
    );
    expect(
      filas,
      'el desbloqueo no dejó su fila de auditoría con el actor cli:superadmin',
    ).toHaveLength(1);
    expect(filas[0]!.empresa_id).toBeNull();
    expect(filas[0]!.texto).not.toContain(contrasena);
  }, 120_000);
});
