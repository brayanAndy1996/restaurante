// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P2 · Ingreso con usuario y contraseña, bloqueo por intentos, inactividad, contraseña temporal,
// cambio de contraseña, sucursal activa y salida (criterios 10 a 17).
// Las pruebas con etiqueta [C2] o [C3] dependen de funciones de grupos posteriores de la fase C.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { rutasRegistradas } from '../utilidades';
import {
  CONTRASENA_DEFINITIVA,
  CONTRASENA_TEMPORAL,
  HORA_INICIAL,
  MINUTO,
  Api,
  auditoriaDe,
  capturarSalida,
  crearUsuario,
  enIso,
  escenarioPerezoso,
  esperarError,
  filas,
  iniciarSoporte,
  ingresar,
  ingresarConPin,
  ingresarOk,
  nombreUnico,
  recordarEquipoDe,
  rutaConId,
  rutasDeEmpresa,
  sesionAdmin,
  sesionesDe,
  type AccesoPrueba,
  type Escenario,
  type UsuarioPrueba,
} from './fabrica-sesiones';

const sc = escenarioPerezoso({ poolMax: 2 });
afterAll(async () => {
  await sc.cerrar();
});
beforeEach(async () => {
  const esc = await sc.obtener();
  esc.reloj.fijar(HORA_INICIAL);
});

const INCORRECTA = 'Incorrecta-Prueba-9';
const CLAVE_CORTA = 'Ab1!xyz';
const TOKEN_SESION = /^se\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/;

/** Usuario activo con los accesos indicados (por defecto Cajero en la primera sucursal). */
async function nuevo(esc: Escenario, accesos?: AccesoPrueba[]): Promise<UsuarioPrueba> {
  return crearUsuario(esc, esc.A, { accesos: accesos ?? [{ sucursal: 0, rol: 'CAJERO' }] });
}

async function fallar(esc: Escenario, usuario: string, veces: number): Promise<void> {
  for (let i = 0; i < veces; i++) {
    const res = await ingresar(esc.api, usuario, INCORRECTA);
    expect(res.status, `fallo ${i + 1}: ${res.text}`).toBe(401);
  }
}

describe('criterio 10 · ingreso correcto', () => {
  it('responde 201 { token, sesion } con una sesión CONTRASENA y la única sucursal a la que tiene acceso', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(res.status, res.text).toBe(201);
    expect(res.body.token).toMatch(TOKEN_SESION);
    expect(res.body.token.split('.')[1]).toBe(esc.A.id);
    expect(res.body.sesion).toMatchObject({
      tipo: 'CONTRASENA',
      empresaId: esc.A.id,
      usuario: { id: u.id, nombreUsuario: u.nombreUsuario },
      superadministrador: null,
      esAdministrador: false,
      rol: 'CAJERO',
      sucursal: { id: esc.A.sucursales[0]!.id },
      equipo: null,
      debeCambiarContrasena: false,
      expiraPorInactividadEn: enIso(esc.reloj, 30 * MINUTO),
    });
    expect(res.body.sesion.sucursales.map((s: any) => s.id)).toEqual([esc.A.sucursales[0]!.id]);
    expect(res.body.tokenEquipo).toBeUndefined();
  });

  it('el nombre de usuario no distingue mayúsculas', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const res = await ingresar(esc.api, u.nombreUsuario.toUpperCase(), u.contrasena);
    expect(res.status, res.text).toBe(201);
    expect(res.body.sesion.usuario.id).toBe(u.id);
  });

  it('con varias sucursales la sucursal activa es null y se listan las que puede elegir', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc, [
      { sucursal: 0, rol: 'CAJERO' },
      { sucursal: 1, rol: 'MOZO' },
    ]);
    const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(res.status, res.text).toBe(201);
    expect(res.body.sesion.sucursal).toBeNull();
    expect(res.body.sesion.rol).toBeNull();
    const elegibles = res.body.sesion.sucursales.map((s: any) => [s.id, s.rol]);
    expect(elegibles).toHaveLength(2);
    expect(elegibles).toContainEqual([esc.A.sucursales[0]!.id, 'CAJERO']);
    expect(elegibles).toContainEqual([esc.A.sucursales[1]!.id, 'MOZO']);
  });

  it('el Administrador tiene acceso a todas las sucursales de la empresa y ninguna activa', async () => {
    const esc = await sc.obtener();
    const res = await ingresar(esc.api, esc.A.admin.nombreUsuario, esc.A.admin.contrasena);
    expect(res.status, res.text).toBe(201);
    expect(res.body.sesion.esAdministrador).toBe(true);
    expect(res.body.sesion.sucursal).toBeNull();
    expect(res.body.sesion.sucursales.map((s: any) => s.id).sort()).toEqual(
      esc.A.sucursales.map((s) => s.id).sort(),
    );
  });

  it('funciona desde cualquier equipo: con o sin X-Equipo (incluso uno inválido) y no crea ningún equipo', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const sin = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    const basura = await ingresar(esc.api, u.nombreUsuario, u.contrasena, { equipo: 'eq.basura' });
    expect(sin.status, sin.text).toBe(201);
    expect(basura.status, basura.text).toBe(201);
    expect(basura.body.sesion.equipo).toBeNull();
    expect(basura.body.tokenEquipo).toBeUndefined();
  });

  it('la sesión recién creada sirve en las rutas de la empresa del usuario', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const res = await esc.api.get('/sucursales', { token });
    expect(res.status, res.text).toBe(200);
  });

  it('un usuario de B ingresa con su propia empresa aunque el nombre exista solo allí', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuario(esc, esc.B, { accesos: [{ sucursal: 0, rol: 'MOZO' }] });
    const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(res.status, res.text).toBe(201);
    expect(res.body.sesion.empresaId).toBe(esc.B.id);
    expect(res.body.token.split('.')[1]).toBe(esc.B.id);
  });
});

describe('criterio 11 · fallo sin pistas', () => {
  it('contraseña incorrecta, usuario inexistente y usuario inactivo responden 401 CREDENCIALES_INVALIDAS con el mismo cuerpo y no crean sesión', async () => {
    const esc = await sc.obtener();
    const activo = await nuevo(esc);
    const inactivo = await nuevo(esc);
    const admin = await sesionAdmin(esc, esc.A);
    const baja = await esc.api.patch(`/usuarios/${inactivo.id}`, {
      token: admin.token,
      cuerpo: { activo: false },
    });
    expect(baja.status, baja.text).toBe(200);

    const antesActivo = (await sesionesDe(activo.id)).length;
    const antesInactivo = (await sesionesDe(inactivo.id)).length;
    const casos = [
      await ingresar(esc.api, activo.nombreUsuario, INCORRECTA),
      await ingresar(esc.api, nombreUnico('no-existe'), activo.contrasena),
      await ingresar(esc.api, inactivo.nombreUsuario, inactivo.contrasena),
      await ingresar(esc.api, inactivo.nombreUsuario, INCORRECTA),
    ];
    for (const res of casos) esperarError(res, 401, 'CREDENCIALES_INVALIDAS');
    for (const res of casos) expect(res.body).toEqual(casos[0]!.body);
    expect((await sesionesDe(activo.id)).length).toBe(antesActivo);
    expect((await sesionesDe(inactivo.id)).length).toBe(antesInactivo);
  });

  it('un nombre con formato inválido o con comodines es solo un usuario inexistente (401, no 400)', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const referencia = await ingresar(esc.api, nombreUnico('no-existe'), u.contrasena);
    esperarError(referencia, 401, 'CREDENCIALES_INVALIDAS');
    const nombres = [
      '%',
      '_',
      `${u.nombreUsuario.slice(0, 6)}%`,
      u.nombreUsuario.replace(/.$/, '_'),
      `${u.nombreUsuario} `,
      ` ${u.nombreUsuario}`,
      'ab',
      'con espacios dentro',
      'x'.repeat(50),
    ];
    for (const nombre of nombres) {
      const res = await ingresar(esc.api, nombre, u.contrasena);
      esperarError(res, 401, 'CREDENCIALES_INVALIDAS');
      expect(res.body, JSON.stringify(nombre)).toEqual(referencia.body);
    }
  });

  it('el PIN usado como contraseña es solo una contraseña incorrecta', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const res = await ingresar(esc.api, u.nombreUsuario, u.pin);
    esperarError(res, 401, 'CREDENCIALES_INVALIDAS');
    const corta = await ingresar(esc.api, u.nombreUsuario, '1234');
    esperarError(corta, 401, 'CREDENCIALES_INVALIDAS');
    expect(corta.body).toEqual(res.body);
  });

  it('el cuerpo del ingreso es estricto: faltan campos o sobran campos responde 400 DATOS_INVALIDOS', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    for (const cuerpo of [
      {},
      { usuario: u.nombreUsuario },
      { contrasena: u.contrasena },
      { usuario: u.nombreUsuario, contrasena: u.contrasena, empresaId: esc.A.id },
      { usuario: 123, contrasena: u.contrasena },
    ]) {
      const res = await esc.api.post('/sesiones/contrasena', { cuerpo });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
  });
});

describe('criterio 12 · bloqueo por intentos', () => {
  it('5 fallos seguidos bloquean 15 minutos aunque la contraseña sea correcta; pasados, funciona', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    await fallar(esc, u.nombreUsuario, 5);

    const bloqueado = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    esperarError(bloqueado, 429, 'BLOQUEO_TEMPORAL');
    expect(bloqueado.body.reintentarEnSegundos).toBe(15 * 60);
    expect(String(bloqueado.headers['retry-after'])).toBe('900');

    esc.reloj.avanzar(14 * MINUTO + 59_000);
    const casi = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    esperarError(casi, 429, 'BLOQUEO_TEMPORAL');
    expect(casi.body.reintentarEnSegundos).toBe(1);

    esc.reloj.avanzar(2_000);
    const libre = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(libre.status, libre.text).toBe(201);
  });

  it('los fallos quedan registrados aunque la respuesta sea un error', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    await fallar(esc, u.nombreUsuario, 3);
    const [fila] = await filas<{ fallos_seguidos: number }>(
      `SELECT fallos_seguidos FROM bloqueo_intentos
        WHERE empresa_id = $1 AND ambito = 'CONTRASENA_USUARIO' AND objetivo_id = $2`,
      [esc.A.id, u.id],
    );
    expect(fila?.fallos_seguidos).toBe(3);
  });

  it('un ingreso correcto antes del quinto fallo reinicia la cuenta', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    await fallar(esc, u.nombreUsuario, 4);
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
    await fallar(esc, u.nombreUsuario, 4); // sin reinicio, el quinto fallo en total ya habría bloqueado
    const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(res.status, res.text).toBe(201);
  });

  it('el bloqueo deja exactamente una fila de auditoría, sin la contraseña', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    await fallar(esc, u.nombreUsuario, 5);
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 429, 'BLOQUEO_TEMPORAL');
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 429, 'BLOQUEO_TEMPORAL');
    const filasDelBloqueo = (await auditoriaDe(esc.A.id, 'bloqueo_contrasena')).filter((f) =>
      JSON.stringify(f).includes(u.id),
    );
    expect(filasDelBloqueo).toHaveLength(1);
    expect(filasDelBloqueo[0]!.actor_sistema).toBe('autenticacion');
    expect(filasDelBloqueo[0]!.origen).toBe('empresa');
    const texto = JSON.stringify(filasDelBloqueo[0]);
    expect(texto).not.toContain(INCORRECTA);
    expect(texto).not.toContain(u.contrasena);
  });

  it('el bloqueo de un usuario no afecta a otros usuarios de A ni de B', async () => {
    const esc = await sc.obtener();
    const bloqueado = await nuevo(esc);
    const otroDeA = await nuevo(esc);
    const deB = await crearUsuario(esc, esc.B, { accesos: [{ sucursal: 0, rol: 'MOZO' }] });
    await fallar(esc, bloqueado.nombreUsuario, 5);
    esperarError(
      await ingresar(esc.api, bloqueado.nombreUsuario, bloqueado.contrasena),
      429,
      'BLOQUEO_TEMPORAL',
    );
    expect((await ingresar(esc.api, otroDeA.nombreUsuario, otroDeA.contrasena)).status).toBe(201);
    expect((await ingresar(esc.api, deB.nombreUsuario, deB.contrasena)).status).toBe(201);
    expect(
      (await ingresar(esc.api, esc.A.admin.nombreUsuario, esc.A.admin.contrasena)).status,
    ).toBe(201);
  });

  it('las mayúsculas en el nombre no evaden el bloqueo: los fallos se cuentan por usuario', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    for (const nombre of [
      u.nombreUsuario,
      u.nombreUsuario.toUpperCase(),
      u.nombreUsuario,
      u.nombreUsuario.toUpperCase(),
      u.nombreUsuario,
    ]) {
      expect((await ingresar(esc.api, nombre, INCORRECTA)).status).toBe(401);
    }
    esperarError(
      await ingresar(esc.api, u.nombreUsuario.toUpperCase(), u.contrasena),
      429,
      'BLOQUEO_TEMPORAL',
    );
  });

  it('un usuario inexistente nunca se bloquea: sigue respondiendo 401 CREDENCIALES_INVALIDAS', async () => {
    const esc = await sc.obtener();
    const nombre = nombreUnico('fantasma');
    for (let i = 0; i < 8; i++) {
      esperarError(await ingresar(esc.api, nombre, INCORRECTA), 401, 'CREDENCIALES_INVALIDAS');
    }
  });
});

describe('criterio 13 · contraseña', () => {
  it('se guarda con scrypt (formato del plan), nunca en claro, con sal distinta por usuario', async () => {
    const esc = await sc.obtener();
    const a = await nuevo(esc);
    const b = await nuevo(esc);
    const resultado = await filas<{ id: string; hash_contrasena: string }>(
      'SELECT id, hash_contrasena FROM usuario WHERE id = ANY($1::uuid[])',
      [[a.id, b.id]],
    );
    expect(resultado).toHaveLength(2);
    for (const fila of resultado) {
      expect(fila.hash_contrasena).toMatch(
        /^scrypt\$15\$8\$1\$[A-Za-z0-9+/=_-]+\$[A-Za-z0-9+/=_-]+$/,
      );
      expect(fila.hash_contrasena).not.toContain(CONTRASENA_DEFINITIVA);
      expect(fila.hash_contrasena).not.toContain(CONTRASENA_TEMPORAL);
    }
    // Misma contraseña definitiva, hashes distintos (sal aleatoria).
    expect(resultado[0]!.hash_contrasena).not.toBe(resultado[1]!.hash_contrasena);
  });

  it('ninguna fila de auditoría de la empresa contiene una contraseña usada en las pruebas', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    await fallar(esc, u.nombreUsuario, 5); // deja filas de bloqueo
    const todas = JSON.stringify(await auditoriaDe(esc.A.id));
    for (const secreto of [CONTRASENA_DEFINITIVA, CONTRASENA_TEMPORAL, INCORRECTA]) {
      expect(todas).not.toContain(secreto);
    }
  });

  it('ni las respuestas ni el registro de la API contienen la contraseña', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const nueva = 'Clave-Con-Registro-7';
    const app = await crearAplicacion({
      reloj: esc.reloj,
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });
    try {
      await app.listen(0);
      const api = new Api(app);
      const { resultado, salida } = await capturarSalida(async () => {
        const mala = await ingresar(api, u.nombreUsuario, INCORRECTA);
        const buena = await ingresar(api, u.nombreUsuario, u.contrasena);
        const cambio = await api.put('/sesion/contrasena', {
          token: buena.body.token,
          cuerpo: { actual: u.contrasena, nueva },
        });
        const invalida = await api.put('/sesion/contrasena', {
          token: buena.body.token,
          cuerpo: { actual: nueva, nueva: CLAVE_CORTA },
        });
        return { mala, buena, cambio, invalida };
      });
      expect(resultado.buena.status).toBe(201);
      expect(resultado.cambio.status).toBe(204);
      for (const secreto of [u.contrasena, INCORRECTA, nueva, CLAVE_CORTA]) {
        expect(salida, `el registro contiene "${secreto}"`).not.toContain(secreto);
        for (const res of Object.values(resultado)) expect(res.text).not.toContain(secreto);
      }
      expect(salida).not.toContain(resultado.buena.body.token);
    } finally {
      await app.close();
    }
  });

  it('PUT /sesion/contrasena exige de 8 a 128 caracteres, sin NUL ni sustitutos sueltos', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    let actual = u.contrasena;
    for (const invalida of ['1234567', 'x'.repeat(129), 'abc\u0000defgh']) {
      const res = await esc.api.put('/sesion/contrasena', {
        token,
        cuerpo: { actual, nueva: invalida },
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    const sustituto = await esc.api.put('/sesion/contrasena', {
      token,
      crudo: JSON.stringify({ actual, nueva: 'abcdefgh' }).replace('abcdefgh', '\\ud800abcdefg'),
    });
    esperarError(sustituto, 400, 'DATOS_INVALIDOS');
    for (const valida of ['12345678', 'y'.repeat(128), CONTRASENA_DEFINITIVA]) {
      const res = await esc.api.put('/sesion/contrasena', {
        token,
        cuerpo: { actual, nueva: valida },
      });
      expect(res.status, `${valida.length}: ${res.text}`).toBe(204);
      actual = valida;
    }
    // Los rechazos por formato no cuentan como fallo de contraseña.
    expect((await ingresar(esc.api, u.nombreUsuario, actual)).status).toBe(201);
  });
});

describe('criterio 14 · inactividad y duración', () => {
  it('vale mientras no pasen 30 minutos sin peticiones y cada petición renueva la actividad', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    esc.reloj.avanzar(30 * MINUTO - 1_000);
    const uno = await esc.api.get('/sesion', { token });
    expect(uno.status, uno.text).toBe(200);
    expect(uno.body.expiraPorInactividadEn).toBe(enIso(esc.reloj, 30 * MINUTO));
    esc.reloj.avanzar(30 * MINUTO - 1_000); // 59 min 58 s desde el ingreso, 29 min 59 s desde la última petición
    expect((await esc.api.get('/sesion', { token })).status).toBe(200);
  });

  it('a los 30 minutos exactos sin peticiones responde 401 SESION_EXPIRADA y la sesión queda cerrada', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    esc.reloj.avanzar(30 * MINUTO);
    esperarError(await esc.api.get('/sesion', { token }), 401, 'SESION_EXPIRADA');
    const siguiente = await esc.api.get('/sesion', { token });
    expect(siguiente.status).toBe(401);
    const cerradas = (await sesionesDe(u.id)).filter((s) => s.cerrada_en !== null);
    expect(cerradas.length).toBeGreaterThanOrEqual(1);
  });

  it('una sesión expirada no revive aunque el reloj vuelva atrás', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    esc.reloj.avanzar(31 * MINUTO);
    esperarError(await esc.api.get('/sesion', { token }), 401, 'SESION_EXPIRADA');
    esc.reloj.fijar(HORA_INICIAL);
    expect((await esc.api.get('/sesion', { token })).status).toBe(401);
  });

  it('X-Actividad: segundo-plano valida la sesión pero no renueva la actividad', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const vencimiento = enIso(esc.reloj, 30 * MINUTO);
    esc.reloj.avanzar(20 * MINUTO);
    const fondo = await esc.api.get('/sesion', { token, segundoPlano: true });
    expect(fondo.status, fondo.text).toBe(200);
    expect(fondo.body.expiraPorInactividadEn).toBe(vencimiento);
    esc.reloj.avanzar(10 * MINUTO); // 30 minutos desde la última actividad real
    esperarError(await esc.api.get('/sesion', { token }), 401, 'SESION_EXPIRADA');
  });

  it('una petición de segundo plano sobre una sesión vencida también responde 401 SESION_EXPIRADA', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    esc.reloj.avanzar(45 * MINUTO);
    esperarError(
      await esc.api.get('/sesion', { token, segundoPlano: true }),
      401,
      'SESION_EXPIRADA',
    );
  });

  it('dura como máximo 12 horas desde que se creó, aunque no haya inactividad (con y sin segundo plano)', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const normal = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const enFondo = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    for (let i = 0; i < 35; i++) {
      esc.reloj.avanzar(20 * MINUTO);
      for (const { token } of [normal, enFondo]) {
        const res = await esc.api.get('/sesion', { token });
        expect(res.status, `tras ${(i + 1) * 20} minutos: ${res.text}`).toBe(200);
      }
    }
    esc.reloj.avanzar(19 * MINUTO + 59_000); // 11 h 59 min 59 s desde el ingreso
    expect((await esc.api.get('/sesion', { token: normal.token })).status).toBe(200);
    expect(
      (await esc.api.get('/sesion', { token: enFondo.token, segundoPlano: true })).status,
    ).toBe(200);
    esc.reloj.avanzar(2_000); // 12 h 00 min 01 s
    esperarError(await esc.api.get('/sesion', { token: normal.token }), 401, 'SESION_EXPIRADA');
    esperarError(
      await esc.api.get('/sesion', { token: enFondo.token, segundoPlano: true }),
      401,
      'SESION_EXPIRADA',
    );
  });
});

describe('criterio 15 · cambio de contraseña obligatorio', () => {
  it('con contraseña temporal la sesión trae debeCambiarContrasena y toda ruta salvo tres responde 403 CAMBIO_CONTRASENA_REQUERIDO', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuario(esc, esc.A, { esAdministrador: true, activar: false });
    const ingreso = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(ingreso.status, ingreso.text).toBe(201);
    expect(ingreso.body.sesion.debeCambiarContrasena).toBe(true);
    const token = ingreso.body.token;

    const sesion = await esc.api.get('/sesion', { token });
    expect(sesion.status, sesion.text).toBe(200);
    expect(sesion.body.debeCambiarContrasena).toBe(true);

    const permitidas = new Set(['GET /sesion', 'PUT /sesion/contrasena', 'DELETE /sesion']);
    const rutas = rutasDeEmpresa(rutasRegistradas(esc.app)).filter(
      (r) => !permitidas.has(`${r.metodo} ${r.ruta}`),
    );
    expect(rutas.map((r) => `${r.metodo} ${r.ruta}`)).toContain('POST /sesion/equipo');
    for (const r of rutas) {
      const res = await esc.api.llamar(r.metodo.toLowerCase() as any, rutaConId(r.ruta), {
        token,
        cuerpo: r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : {},
      });
      expect(res.status, `${r.metodo} ${r.ruta}: ${res.text}`).toBe(403);
      expect(res.body, `${r.metodo} ${r.ruta}`).toMatchObject({
        codigo: 'CAMBIO_CONTRASENA_REQUERIDO',
      });
    }
  });

  it('después de cambiar la contraseña todo funciona según el rol', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc, [{ sucursal: 0, rol: 'MOZO' }]);
    const temporal = await crearUsuario(esc, esc.A, {
      accesos: [{ sucursal: 0, rol: 'MOZO' }],
      activar: false,
    });
    const ingreso = await ingresar(esc.api, temporal.nombreUsuario, temporal.contrasena);
    const token = ingreso.body.token;
    esperarError(await esc.api.get('/sucursales', { token }), 403, 'CAMBIO_CONTRASENA_REQUERIDO');

    const cambio = await esc.api.put('/sesion/contrasena', {
      token,
      cuerpo: { actual: temporal.contrasena, nueva: CONTRASENA_DEFINITIVA },
    });
    expect(cambio.status, cambio.text).toBe(204);
    expect((await esc.api.get('/sucursales', { token })).status).toBe(200);
    const sesion = await esc.api.get('/sesion', { token });
    expect(sesion.body.debeCambiarContrasena).toBe(false);

    // La temporal ya no sirve; la nueva no pide cambio.
    esperarError(
      await ingresar(esc.api, temporal.nombreUsuario, temporal.contrasena),
      401,
      'CREDENCIALES_INVALIDAS',
    );
    const nuevoIngreso = await ingresar(esc.api, temporal.nombreUsuario, CONTRASENA_DEFINITIVA);
    expect(nuevoIngreso.status, nuevoIngreso.text).toBe(201);
    expect(nuevoIngreso.body.sesion.debeCambiarContrasena).toBe(false);
    // Un usuario ya activo no tiene la marca.
    const activo = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(activo.body.sesion.debeCambiarContrasena).toBe(false);
  });

  it('con la contraseña temporal sí se puede salir con DELETE /sesion', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuario(esc, esc.A, { activar: false });
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    expect((await esc.api.delete('/sesion', { token })).status).toBe(204);
    esperarError(await esc.api.get('/sesion', { token }), 401, 'NO_AUTENTICADO');
  });

  it('[C2] el equipo no se recuerda hasta que la contraseña deja de ser temporal', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuario(esc, esc.A, { activar: false });
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    esperarError(
      await esc.api.post('/sesion/equipo', { token, cuerpo: {} }),
      403,
      'CAMBIO_CONTRASENA_REQUERIDO',
    );
    const cambio = await esc.api.put('/sesion/contrasena', {
      token,
      cuerpo: { actual: u.contrasena, nueva: CONTRASENA_DEFINITIVA },
    });
    expect(cambio.status).toBe(204);
    const ahora = await esc.api.post('/sesion/equipo', { token, cuerpo: {} });
    expect(ahora.status, ahora.text).toBe(201);
  });
});

describe('criterio 16 · cambiar la propia contraseña', () => {
  it('con la actual incorrecta responde 401 CREDENCIALES_INVALIDAS y cuenta para el bloqueo del criterio 12', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    await fallar(esc, u.nombreUsuario, 3);
    for (let i = 0; i < 2; i++) {
      const res = await esc.api.put('/sesion/contrasena', {
        token,
        cuerpo: { actual: INCORRECTA, nueva: 'Nueva-Clave-123' },
      });
      esperarError(res, 401, 'CREDENCIALES_INVALIDAS');
    }
    // Cinco fallos en total entre el ingreso y el cambio: bloqueada la cuenta.
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 429, 'BLOQUEO_TEMPORAL');
    const sexto = await esc.api.put('/sesion/contrasena', {
      token,
      cuerpo: { actual: u.contrasena, nueva: 'Nueva-Clave-123' },
    });
    esperarError(sexto, 429, 'BLOQUEO_TEMPORAL');
  });

  it('con nueva inválida o igual a la actual responde 400 DATOS_INVALIDOS y no cambia nada', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    for (const nueva of ['corta', u.contrasena]) {
      const res = await esc.api.put('/sesion/contrasena', {
        token,
        cuerpo: { actual: u.contrasena, nueva },
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
  });

  it('si es correcta responde 204, cierra las demás sesiones del usuario y la actual sigue', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const a = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const b = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const otro = await nuevo(esc);
    const deOtro = await ingresarOk(esc.api, otro.nombreUsuario, otro.contrasena);
    const nueva = 'Clave-Nueva-Prueba-5';
    const res = await esc.api.put('/sesion/contrasena', {
      token: a.token,
      cuerpo: { actual: u.contrasena, nueva },
    });
    expect(res.status, res.text).toBe(204);
    expect(res.text).toBe('');
    expect((await esc.api.get('/sesion', { token: a.token })).status).toBe(200);
    esperarError(await esc.api.get('/sesion', { token: b.token }), 401, 'NO_AUTENTICADO');
    // Las sesiones de otras personas no se tocan.
    expect((await esc.api.get('/sesion', { token: deOtro.token })).status).toBe(200);
    // La contraseña vieja ya no sirve y la nueva sí.
    esperarError(
      await ingresar(esc.api, u.nombreUsuario, u.contrasena),
      401,
      'CREDENCIALES_INVALIDAS',
    );
    expect((await ingresar(esc.api, u.nombreUsuario, nueva)).status).toBe(201);
  });

  it('en una sesión de soporte responde 403 PROHIBIDO', async () => {
    const esc = await sc.obtener();
    const soporte = await iniciarSoporte(esc, esc.A);
    const res = await esc.api.put('/sesion/contrasena', {
      token: soporte.token,
      cuerpo: { actual: 'Cualquiera-123', nueva: 'Otra-Clave-1234' },
    });
    esperarError(res, 403, 'PROHIBIDO');
  });

  it('[C2] los equipos recordados se conservan y el PIN sigue sirviendo', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc, [{ sucursal: 0, rol: 'MOZO' }]);
    const { tokenEquipo, token } = await recordarEquipoDe(esc, u);
    const admin = await sesionAdmin(esc, esc.A);
    const antes = await esc.api.get(`/usuarios/${u.id}/equipos`, { token: admin.token });
    expect(antes.body).toHaveLength(1);
    const cambio = await esc.api.put('/sesion/contrasena', {
      token,
      cuerpo: { actual: u.contrasena, nueva: 'Clave-Nueva-Prueba-5' },
    });
    expect(cambio.status, cambio.text).toBe(204);
    const despues = await esc.api.get(`/usuarios/${u.id}/equipos`, { token: admin.token });
    expect(despues.body).toHaveLength(1);
    const pin = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    expect(pin.status, pin.text).toBe(201);
  });

  it('[C2] en una sesión de PIN responde 403 PROHIBIDO', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc, [{ sucursal: 0, rol: 'MOZO' }]);
    const { tokenEquipo } = await recordarEquipoDe(esc, u);
    const pin = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    expect(pin.status, pin.text).toBe(201);
    const res = await esc.api.put('/sesion/contrasena', {
      token: pin.body.token,
      equipo: tokenEquipo,
      cuerpo: { actual: u.contrasena, nueva: 'Clave-Nueva-Prueba-5' },
    });
    esperarError(res, 403, 'PROHIBIDO');
  });
});

describe('criterio 17 · sucursal activa y salida', () => {
  it('PUT /sesion/sucursal con acceso responde 200 con la sesión y el rol de esa sucursal', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc, [
      { sucursal: 0, rol: 'CAJERO' },
      { sucursal: 1, rol: 'MOZO' },
    ]);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const uno = await esc.api.put('/sesion/sucursal', {
      token,
      cuerpo: { sucursalId: esc.A.sucursales[1]!.id },
    });
    expect(uno.status, uno.text).toBe(200);
    expect(uno.body).toMatchObject({
      tipo: 'CONTRASENA',
      rol: 'MOZO',
      sucursal: { id: esc.A.sucursales[1]!.id },
    });
    const dos = await esc.api.put('/sesion/sucursal', {
      token,
      cuerpo: { sucursalId: esc.A.sucursales[0]!.id },
    });
    expect(dos.status, dos.text).toBe(200);
    expect(dos.body).toMatchObject({ rol: 'CAJERO', sucursal: { id: esc.A.sucursales[0]!.id } });
    const actual = await esc.api.get('/sesion', { token });
    expect(actual.body.sucursal.id).toBe(esc.A.sucursales[0]!.id);
  });

  it('el Administrador puede elegir cualquier sucursal de su empresa', async () => {
    const esc = await sc.obtener();
    const { token } = await sesionAdmin(esc, esc.A);
    for (const sucursal of esc.A.sucursales) {
      const res = await esc.api.put('/sesion/sucursal', {
        token,
        cuerpo: { sucursalId: sucursal.id },
      });
      expect(res.status, res.text).toBe(200);
      expect(res.body.sucursal.id).toBe(sucursal.id);
      expect(res.body.rol).toBe('ADMINISTRADOR');
    }
  });

  it('sin acceso, de B o inexistente responde 404 NO_ENCONTRADO idéntico y la sesión no cambia', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc); // solo la primera sucursal
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const admin = await sesionAdmin(esc, esc.A);
    const respuestas = [
      await esc.api.put('/sesion/sucursal', {
        token,
        cuerpo: { sucursalId: esc.A.sucursales[1]!.id },
      }),
      await esc.api.put('/sesion/sucursal', {
        token,
        cuerpo: { sucursalId: esc.B.sucursales[0]!.id },
      }),
      await esc.api.put('/sesion/sucursal', { token, cuerpo: { sucursalId: randomUUID() } }),
      await esc.api.put('/sesion/sucursal', {
        token: admin.token,
        cuerpo: { sucursalId: esc.B.sucursales[0]!.id },
      }),
    ];
    for (const res of respuestas) esperarError(res, 404, 'NO_ENCONTRADO');
    for (const res of respuestas) expect(res.body).toEqual(respuestas[0]!.body);
    const actual = await esc.api.get('/sesion', { token });
    expect(actual.body.sucursal?.id).toBe(esc.A.sucursales[0]!.id);
  });

  it('un cuerpo inválido responde 400 DATOS_INVALIDOS', async () => {
    const esc = await sc.obtener();
    const { token } = await sesionAdmin(esc, esc.A);
    for (const cuerpo of [
      {},
      { sucursalId: 'no-es-uuid' },
      { sucursalId: esc.A.sucursales[0]!.id, extra: 1 },
    ]) {
      esperarError(
        await esc.api.put('/sesion/sucursal', { token, cuerpo }),
        400,
        'DATOS_INVALIDOS',
      );
    }
  });

  it('una ruta que necesita sucursal activa, sin sucursal elegida, responde 409 SUCURSAL_NO_ELEGIDA', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc, [
      { sucursal: 0, rol: 'CAJERO' },
      { sucursal: 1, rol: 'CAJERO' },
    ]);
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const cuerpo = { accion: 'ANULAR_ITEM_ENVIADO', motivo: 'Prueba de sucursal', pin: '123456' };
    esperarError(
      await esc.api.post('/autorizaciones', { token, cuerpo }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
    // Las rutas que no dependen de la sucursal funcionan igual.
    expect((await esc.api.get('/sucursales', { token })).status).toBe(200);
  });

  it('en una sesión de soporte también se elige la sucursal activa', async () => {
    const esc = await sc.obtener();
    const soporte = await iniciarSoporte(esc, esc.A);
    const res = await esc.api.put('/sesion/sucursal', {
      token: soporte.token,
      cuerpo: { sucursalId: esc.A.sucursales[1]!.id },
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ tipo: 'SOPORTE', sucursal: { id: esc.A.sucursales[1]!.id } });
    esperarError(
      await esc.api.put('/sesion/sucursal', {
        token: soporte.token,
        cuerpo: { sucursalId: esc.B.sucursales[0]!.id },
      }),
      404,
      'NO_ENCONTRADO',
    );
  });

  it('DELETE /sesion responde 204 y el token deja de valer', async () => {
    const esc = await sc.obtener();
    const u = await nuevo(esc);
    const a = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const b = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const res = await esc.api.delete('/sesion', { token: a.token });
    expect(res.status, res.text).toBe(204);
    esperarError(await esc.api.get('/sesion', { token: a.token }), 401, 'NO_AUTENTICADO');
    esperarError(await esc.api.delete('/sesion', { token: a.token }), 401, 'NO_AUTENTICADO');
    // Otra sesión del mismo usuario no se toca.
    expect((await esc.api.get('/sesion', { token: b.token })).status).toBe(200);
    // Los accesos nuevos siguen funcionando.
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
  });
});
