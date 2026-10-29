// spec: 002-plataforma-y-acceso (pruebas protegidas)
// Ajustado por 003-carta, decisión del usuario 5 (2026-10-28): EDITAR_CARTA permitido para el Cajero.
// Ajustado por 004-salon-cocina, decisión 11 (2026-10-29): inactividad aparte para Cocina/Barra.
//
// P5 · Criterios 33 a 42 (ingreso con PIN, cambio rápido e inactividad): el PIN solo sirve en equipos
// que recuerdan a la persona, bloqueo por persona en el equipo (5.º y 10.º fallo) y olvido al 15.º,
// sucursal inicial, sesión atada al equipo, cambio rápido de usuario, inactividad por sucursal activa,
// configuración de la inactividad, límites de la sesión PIN y `GET /sesion`. App real con
// `RelojManual`; empresas y usuarios creados por HTTP; sin `EMPRESA_POR_HEADER`.
import { ingresoRespuestaSchema, sesionRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLAVES_SECRETAS,
  MINUTO,
  agregarAEquipo,
  altaEmpresa,
  consultar,
  crearEntorno,
  crearPersona,
  crearSuperadminDePrueba,
  equipoCon,
  esperarError,
  filasAuditoria,
  ingresarSuperadmin,
  llamar,
  loginContrasena,
  loginPin,
  motivoDeRevocacion,
  nuevoEquipo,
  partesDeToken,
  pinDistinto,
  pinOk,
  secretoFalso,
  secretosEn,
  sesionDeSoporte,
  tokenAdmin,
  type Empresa,
  type Libre,
  type Entorno,
  type Persona,
  type Superadmin,
} from './fabrica-equipos';

let entorno: Entorno;
let sa: Superadmin;
let A: Empresa;
let B: Empresa;
let personaDeB: Persona;
let mozoS1: Persona;
let mozoV: Persona;
let mozoMulti: Persona;
let mozoCfg: Persona;
let mozoS5: Persona;
let cajero: Persona;

const app = () => entorno.app;
const S = (i: number) => A.sucursales[i - 1]!.id;
const mozoEn = (...sucursales: number[]) =>
  crearPersona(app(), A, {
    accesos: sucursales.map((i) => ({ sucursalId: S(i), rol: 'MOZO' as const })),
  });

const verSesion = (token: string, equipo?: string) =>
  llamar(app(), 'get', '/sesion', { token, ...(equipo ? { equipo } : {}) });

async function fallos(tokenEquipo: string, persona: Persona, veces: number): Promise<number[]> {
  const estados: number[] = [];
  for (let i = 0; i < veces; i++) {
    estados.push((await loginPin(app(), tokenEquipo, persona.id, pinDistinto(persona.pin))).status);
  }
  return estados;
}

async function configurarInactividad(sucursalId: string, minutos: number): Promise<void> {
  const res = await llamar(app(), 'patch', `/sucursales/${sucursalId}/acceso`, {
    token: await tokenAdmin(app(), A),
    cuerpo: { minutosInactividad: minutos },
  });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  entorno = await crearEntorno();
  sa = await crearSuperadminDePrueba();
  const tokenSa = await ingresarSuperadmin(app(), sa);
  A = await altaEmpresa(app(), tokenSa, { sucursales: 5 });
  B = await altaEmpresa(app(), tokenSa, { sucursales: 2 });
  mozoS1 = await mozoEn(1);
  mozoV = await mozoEn(1);
  mozoMulti = await mozoEn(1, 2);
  mozoCfg = await mozoEn(3, 4);
  mozoS5 = await mozoEn(5);
  cajero = await crearPersona(app(), A, { accesos: [{ sucursalId: S(1), rol: 'CAJERO' }] });
  personaDeB = await crearPersona(app(), B, {
    accesos: [{ sucursalId: B.sucursales[0]!.id, rol: 'MOZO' }],
  });
}, 120_000);

afterAll(async () => {
  await entorno?.cerrar();
});

describe('criterio 33 · ingreso con PIN', () => {
  it('crea una sesión PIN atada al equipo recordado, con la única sucursal de la persona y su rol', async () => {
    const equipo = await nuevoEquipo(app(), mozoS1, 'Celular de prueba');
    const res = await loginPin(app(), equipo.tokenEquipo, mozoS1.id, mozoS1.pin);
    expect(res.status).toBe(201);
    const cuerpo = ingresoRespuestaSchema.parse(res.body);
    expect(cuerpo.token).toMatch(new RegExp(`^se\\.${A.id}\\.`));
    expect(cuerpo.sesion).toMatchObject({
      tipo: 'PIN',
      empresaId: A.id,
      rol: 'MOZO',
      esAdministrador: false,
      debeCambiarContrasena: false,
      sucursal: { id: S(1) },
      usuario: { id: mozoS1.id },
      equipo: {
        id: equipo.equipoId,
        nombre: 'Celular de prueba',
        equipoRecordadoId: equipo.equipoRecordadoId,
      },
    });
    expect(JSON.stringify(res.body)).not.toContain(mozoS1.pin);
    const sesion = await verSesion(cuerpo.token, equipo.tokenEquipo);
    expect(sesion.status).toBe(200);
  });

  it('con varias sucursales entra sin sucursal activa y retoma la última que eligió en ese equipo', async () => {
    const e1 = await nuevoEquipo(app(), mozoMulti);
    const primera = await pinOk(app(), e1.tokenEquipo, mozoMulti);
    expect(primera.sesion.sucursal).toBeNull();
    expect(primera.sesion.sucursales.map((s: Libre) => s.id).sort()).toEqual([S(1), S(2)].sort());
    // Una ruta que necesita sucursal activa responde 409 hasta que la elija.
    const sinSucursal = await llamar(app(), 'post', '/autorizaciones', {
      token: primera.token,
      equipo: e1.tokenEquipo,
      cuerpo: { accion: 'ANULAR_ITEM_ENVIADO', motivo: 'Prueba', pin: '123456' },
    });
    esperarError(sinSucursal, 409, 'SUCURSAL_NO_ELEGIDA');

    const elegir = await llamar(app(), 'put', '/sesion/sucursal', {
      token: primera.token,
      equipo: e1.tokenEquipo,
      cuerpo: { sucursalId: S(2) },
    });
    expect(elegir.status).toBe(200);
    expect(elegir.body).toMatchObject({ sucursal: { id: S(2) }, rol: 'MOZO' });
    expect(
      (await llamar(app(), 'delete', '/sesion', { token: primera.token, equipo: e1.tokenEquipo }))
        .status,
    ).toBe(204);

    const segunda = await pinOk(app(), e1.tokenEquipo, mozoMulti);
    expect(segunda.sesion.sucursal?.id).toBe(S(2));
    expect(segunda.sesion.rol).toBe('MOZO');

    // La última sucursal es por equipo: en otro equipo de la misma persona no hay ninguna.
    const e2 = await nuevoEquipo(app(), mozoMulti);
    const otroEquipo = await pinOk(app(), e2.tokenEquipo, mozoMulti);
    expect(otroEquipo.sesion.sucursal).toBeNull();
  });

  it('si la última sucursal ya no tiene acceso entra sin sucursal; con un solo acceso, esa', async () => {
    const x = await mozoEn(1, 2);
    const equipo = await nuevoEquipo(app(), x);
    const sesion = await pinOk(app(), equipo.tokenEquipo, x);
    await llamar(app(), 'put', '/sesion/sucursal', {
      token: sesion.token,
      equipo: equipo.tokenEquipo,
      cuerpo: { sucursalId: S(2) },
    });
    await llamar(app(), 'delete', '/sesion', { token: sesion.token, equipo: equipo.tokenEquipo });

    const admin = await tokenAdmin(app(), A);
    // Pierde S2 y gana S3: sigue con dos accesos y la última (S2) ya no sirve.
    let cambio = await llamar(app(), 'patch', `/usuarios/${x.id}`, {
      token: admin,
      cuerpo: {
        accesos: [
          { sucursalId: S(1), rol: 'MOZO' },
          { sucursalId: S(3), rol: 'MOZO' },
        ],
      },
    });
    expect(cambio.status).toBe(200);
    expect(cambio.body.pin).toBeUndefined();
    const sinUltima = await pinOk(app(), equipo.tokenEquipo, x);
    expect(sinUltima.sesion.sucursal).toBeNull();
    await llamar(app(), 'delete', '/sesion', {
      token: sinUltima.token,
      equipo: equipo.tokenEquipo,
    });

    cambio = await llamar(app(), 'patch', `/usuarios/${x.id}`, {
      token: admin,
      cuerpo: { accesos: [{ sucursalId: S(1), rol: 'MOZO' }] },
    });
    expect(cambio.status).toBe(200);
    const unica = await pinOk(app(), equipo.tokenEquipo, x);
    expect(unica.sesion.sucursal?.id).toBe(S(1));
  });

  it('el Administrador entra con su PIN de 6 dígitos, sin sucursal, y retoma la última', async () => {
    const equipo = await nuevoEquipo(app(), A.admin);
    const entrada = await pinOk(app(), equipo.tokenEquipo, A.admin);
    expect(entrada.sesion.tipo).toBe('PIN');
    expect(entrada.sesion.esAdministrador).toBe(true);
    expect(entrada.sesion.sucursal).toBeNull();
    expect(entrada.sesion.sucursales).toHaveLength(5);
    expect(entrada.sesion.sucursales.every((s: Libre) => s.rol === 'ADMINISTRADOR')).toBe(true);
    await llamar(app(), 'put', '/sesion/sucursal', {
      token: entrada.token,
      equipo: equipo.tokenEquipo,
      cuerpo: { sucursalId: S(4) },
    });
    await llamar(app(), 'delete', '/sesion', { token: entrada.token, equipo: equipo.tokenEquipo });
    const otra = await pinOk(app(), equipo.tokenEquipo, A.admin);
    expect(otra.sesion.sucursal?.id).toBe(S(4));
  });

  it('actualiza el último uso de la persona en el equipo (pasa al principio de GET /equipo)', async () => {
    const a = await mozoEn(1);
    const b = await mozoEn(1);
    const equipo = await equipoCon(app(), [a, b]);
    const antes = await llamar(app(), 'get', '/equipo', { equipo: equipo.tokenEquipo });
    expect(antes.body.personas.map((p: Libre) => p.usuarioId)).toEqual([b.id, a.id]);
    entorno.reloj.avanzar(MINUTO);
    await pinOk(app(), equipo.tokenEquipo, a);
    const despues = await llamar(app(), 'get', '/equipo', { equipo: equipo.tokenEquipo });
    expect(despues.body.personas.map((p: Libre) => p.usuarioId)).toEqual([a.id, b.id]);
  });
});

describe('criterio 34 · el PIN solo sirve donde la persona entró con contraseña', () => {
  it('sin X-Equipo válido responde 401 EQUIPO_NO_RECONOCIDO con el mismo cuerpo, sin evaluar el PIN ni contar', async () => {
    const x = await mozoEn(1);
    const equipo = await nuevoEquipo(app(), x);
    const deB = await nuevoEquipo(app(), personaDeB);
    const partes = partesDeToken(equipo.tokenEquipo);
    const invalidos: (string | undefined)[] = [
      undefined,
      'basura',
      `eq.${A.id}.${partes.id}`,
      `eq.${A.id}.${partes.id}.${secretoFalso()}`,
      `eq.${B.id}.${partes.id}.${partes.secreto}`,
      `eq.${A.id}.${deB.equipoId}.${partes.secreto}`,
      `eq.${A.id}.${randomUUID()}.${partes.secreto}`,
    ];
    const cuerpos: unknown[] = [];
    for (const tokenEquipo of invalidos) {
      for (const pin of [x.pin, pinDistinto(x.pin)]) {
        const res = await loginPin(app(), tokenEquipo, x.id, pin);
        esperarError(res, 401, 'EQUIPO_NO_RECONOCIDO');
        cuerpos.push(res.body);
      }
    }
    for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
    // Ninguno de esos intentos contó como fallo de (equipo, persona): el PIN correcto entra.
    const res = await loginPin(app(), equipo.tokenEquipo, x.id, x.pin);
    expect(res.status).toBe(201);
  });

  it('con una persona que el equipo no recuerda responde 401 CREDENCIALES_INVALIDAS, igual que un PIN malo, sin contar', async () => {
    const recordada = await mozoEn(1);
    const nunca = await mozoEn(1);
    const revocada = await mozoEn(1);
    const olvidada = await mozoEn(1);
    const equipo = await equipoCon(app(), [recordada, revocada, olvidada]);

    const admin = await tokenAdmin(app(), A);
    const revocar = await llamar(
      app(),
      'delete',
      `/usuarios/${revocada.id}/equipos/${equipo.porPersona[revocada.id]!.equipoRecordadoId}`,
      { token: admin },
    );
    expect(revocar.status).toBe(204);
    const olvidar = await llamar(
      app(),
      'delete',
      `/sesion/equipos/${equipo.porPersona[olvidada.id]!.equipoRecordadoId}`,
      { token: equipo.porPersona[olvidada.id]!.sesion },
    );
    expect(olvidar.status).toBe(204);

    const referencia = await loginPin(
      app(),
      equipo.tokenEquipo,
      recordada.id,
      pinDistinto(recordada.pin),
    );
    esperarError(referencia, 401, 'CREDENCIALES_INVALIDAS');

    const noRecordadas = [
      { persona: nunca, quien: 'nunca entró con contraseña' },
      { persona: revocada, quien: 'revocada' },
      { persona: olvidada, quien: 'olvidada' },
      { persona: personaDeB, quien: 'usuario de B' },
      { persona: { id: randomUUID(), pin: '1234' }, quien: 'inexistente' },
    ];
    for (const { persona, quien } of noRecordadas) {
      // Con el PIN correcto de esa persona: igualmente rechazado, con el mismo cuerpo.
      for (let i = 0; i < 7; i++) {
        const res = await loginPin(app(), equipo.tokenEquipo, persona.id, persona.pin);
        expect(res.status, quien).toBe(401);
        expect(res.body, quien).toEqual(referencia.body);
      }
    }
    // Esos intentos no contaron: si ahora `nunca` entra con contraseña en el equipo, su PIN sirve de inmediato.
    await agregarAEquipo(app(), nunca, equipo.tokenEquipo);
    expect((await loginPin(app(), equipo.tokenEquipo, nunca.id, nunca.pin)).status).toBe(201);
  });

  it('POST /sesiones/pin no acepta usuario ni contraseña (400) y un PIN como contraseña es solo una contraseña incorrecta', async () => {
    const x = await mozoEn(1);
    const equipo = await nuevoEquipo(app(), x);
    const cuerpos: unknown[] = [
      { usuario: x.nombreUsuario, contrasena: x.contrasena },
      { usuarioId: x.id, pin: x.pin, contrasena: x.contrasena },
      { usuarioId: x.id, pin: x.pin, usuario: x.nombreUsuario },
      { pin: x.pin },
      { usuarioId: x.id },
      { usuarioId: 'no-es-uuid', pin: x.pin },
      { usuarioId: x.id, pin: 1234 },
      { usuarioId: x.id, pin: 'abcd' },
      { usuarioId: x.id, pin: '12345' },
    ];
    for (const cuerpo of cuerpos) {
      const res = await llamar(app(), 'post', '/sesiones/pin', {
        equipo: equipo.tokenEquipo,
        cuerpo,
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    const comoContrasena = await llamar(app(), 'post', '/sesiones/contrasena', {
      cuerpo: { usuario: x.nombreUsuario, contrasena: x.pin },
    });
    esperarError(comoContrasena, 401, 'CREDENCIALES_INVALIDAS');
  });
});

describe('criterio 35 · PIN rechazado', () => {
  it('un PIN que no es el de la persona (otro largo, o el de otra persona del equipo) responde 401 con el mismo cuerpo y sin sesión', async () => {
    const x = await mozoEn(1);
    const y = await mozoEn(1);
    const c = await crearPersona(app(), A, { accesos: [{ sucursalId: S(1), rol: 'CAJERO' }] });
    const equipo = await equipoCon(app(), [x, y, c]);
    const referencia = await loginPin(app(), equipo.tokenEquipo, x.id, pinDistinto(x.pin));
    esperarError(referencia, 401, 'CREDENCIALES_INVALIDAS');

    const intentos: [Persona, string][] = [
      [x, pinDistinto(x.pin)], // mismo largo, distinto
      [x, c.pin], // de otro largo (6 dígitos) y de otra persona
      [x, y.pin], // el PIN de otra persona del equipo
      [c, x.pin], // de otro largo (4 dígitos para un PIN de 6)
      [c, pinDistinto(c.pin)],
    ];
    for (const [persona, pin] of intentos) {
      const res = await loginPin(app(), equipo.tokenEquipo, persona.id, pin);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(referencia.body);
      expect(JSON.stringify(res.body)).not.toContain(persona.pin);
    }
    const abiertas = await consultar(
      `SELECT 1 FROM sesion WHERE equipo_id = $1 AND tipo = 'PIN' AND cerrada_en IS NULL`,
      [equipo.equipoId],
    );
    expect(abiertas).toHaveLength(0);
  });
});

describe('criterio 36 · bloqueo por persona en el equipo', () => {
  it('al 5.º fallo bloquea 5 minutos solo a esa persona en ese equipo; un PIN correcto reinicia la cuenta', async () => {
    const u = await mozoEn(1);
    const v = await mozoEn(1);
    const e = await equipoCon(app(), [u, v]);
    const otroEquipo = await nuevoEquipo(app(), u);

    expect(await fallos(e.tokenEquipo, u, 5)).toEqual([401, 401, 401, 401, 401]);
    // Dentro del lapso: 429 aunque el PIN sea el correcto, con los segundos que faltan.
    const bloqueada = await loginPin(app(), e.tokenEquipo, u.id, u.pin);
    esperarError(bloqueada, 429, 'BLOQUEO_TEMPORAL');
    expect(Number.isInteger(bloqueada.body.reintentarEnSegundos)).toBe(true);
    expect(bloqueada.body.reintentarEnSegundos).toBeGreaterThan(0);
    expect(bloqueada.body.reintentarEnSegundos).toBeLessThanOrEqual(300);
    expect(bloqueada.headers['retry-after']).toBe(String(bloqueada.body.reintentarEnSegundos));

    // GET /equipo muestra el bloqueo de U y no el de V.
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e.tokenEquipo });
    const deU = lista.body.personas.find((p: Libre) => p.usuarioId === u.id);
    const deV = lista.body.personas.find((p: Libre) => p.usuarioId === v.id);
    expect(deV.bloqueadoHastaEn).toBeNull();
    expect(
      Math.abs(
        new Date(deU.bloqueadoHastaEn).getTime() - (entorno.reloj.ahora().getTime() + 5 * MINUTO),
      ),
    ).toBeLessThanOrEqual(1500);

    // No afecta a V, ni a U en otro equipo, ni al ingreso con contraseña de U.
    expect((await loginPin(app(), e.tokenEquipo, v.id, v.pin)).status).toBe(201);
    expect((await loginPin(app(), otroEquipo.tokenEquipo, u.id, u.pin)).status).toBe(201);
    expect((await loginContrasena(app(), u)).token).toBeTruthy();

    const bloqueos = (await filasAuditoria(A.id, 'bloqueo_pin')).filter(
      (f) => f.texto.includes(u.id) && f.texto.includes(e.equipoId),
    );
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0]!.actor_sistema).toBe('autenticacion');
    expect(bloqueos[0]!.texto).not.toMatch(CLAVES_SECRETAS);

    // Pasado el lapso, el PIN correcto entra y reinicia la cuenta de fallos.
    entorno.reloj.avanzar(5 * MINUTO + 1000);
    expect((await loginPin(app(), e.tokenEquipo, u.id, u.pin)).status).toBe(201);
    expect(await fallos(e.tokenEquipo, u, 4)).toEqual([401, 401, 401, 401]);
    expect((await loginPin(app(), e.tokenEquipo, u.id, u.pin)).status).toBe(201);
    expect(await fallos(e.tokenEquipo, u, 4)).toEqual([401, 401, 401, 401]);
    expect((await loginPin(app(), e.tokenEquipo, u.id, u.pin)).status).toBe(201);
  });

  it('bloquea de nuevo al 10.º fallo y al 15.º el equipo olvida a la persona (motivo BLOQUEO)', async () => {
    const u = await mozoEn(1);
    const v = await mozoEn(1);
    const e = await equipoCon(app(), [u, v]);

    expect(await fallos(e.tokenEquipo, u, 5)).toEqual([401, 401, 401, 401, 401]);
    esperarError(await loginPin(app(), e.tokenEquipo, u.id, u.pin), 429, 'BLOQUEO_TEMPORAL');
    entorno.reloj.avanzar(5 * MINUTO + 1000);

    // Fallos 6 a 10: el 10.º bloquea otra vez. Ningún intento correcto en medio.
    expect(await fallos(e.tokenEquipo, u, 5)).toEqual([401, 401, 401, 401, 401]);
    esperarError(await loginPin(app(), e.tokenEquipo, u.id, u.pin), 429, 'BLOQUEO_TEMPORAL');
    entorno.reloj.avanzar(5 * MINUTO + 1000);

    // Fallos 11 a 15: al 15.º el equipo deja de recordar a U.
    expect(await fallos(e.tokenEquipo, u, 5)).toEqual([401, 401, 401, 401, 401]);
    const despues = await loginPin(app(), e.tokenEquipo, u.id, u.pin);
    esperarError(despues, 401, 'CREDENCIALES_INVALIDAS'); // como el criterio 34, no 429
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e.tokenEquipo });
    expect(lista.body.personas.map((p: Libre) => p.usuarioId)).toEqual([v.id]);
    expect(await motivoDeRevocacion(e.equipoId, u.id)).toBe('BLOQUEO');
    // Se cierran las sesiones de U asociadas al equipo; V sigue.
    esperarError(await verSesion(e.porPersona[u.id]!.sesion), 401, 'NO_AUTENTICADO');
    const pinV = await pinOk(app(), e.tokenEquipo, v);
    expect((await verSesion(pinV.token, e.tokenEquipo)).status).toBe(200);
    expect((await verSesion(e.porPersona[v.id]!.sesion)).status).toBe(200);

    const bloqueos = (await filasAuditoria(A.id, 'bloqueo_pin')).filter(
      (f) => f.texto.includes(u.id) && f.texto.includes(e.equipoId),
    );
    expect(bloqueos).toHaveLength(2);
    const olvidos = (await filasAuditoria(A.id, 'equipo_olvidado_por_bloqueo')).filter(
      (f) => f.texto.includes(u.id) && f.texto.includes(e.equipoId),
    );
    expect(olvidos).toHaveLength(1);
    expect(olvidos[0]!.actor_sistema).toBe('autenticacion');
    for (const fila of [...bloqueos, ...olvidos]) {
      expect(fila.texto).not.toMatch(CLAVES_SECRETAS);
      expect(secretosEn(fila.texto)).toEqual([]);
    }

    // U tiene que volver a entrar con contraseña en ese equipo; después su PIN vuelve a servir.
    await agregarAEquipo(app(), u, e.tokenEquipo);
    expect((await loginPin(app(), e.tokenEquipo, u.id, u.pin)).status).toBe(201);
  });
});

describe('criterio 37 · la sesión PIN está atada al equipo', () => {
  it('exige el X-Equipo del mismo equipo en cada petición y que (equipo, persona) siga activo', async () => {
    const x = await mozoEn(1);
    const e1 = await nuevoEquipo(app(), x);
    const e2 = await nuevoEquipo(app(), x); // también recuerda a X, pero no es el de la sesión
    const pin = await pinOk(app(), e1.tokenEquipo, x);
    const partes = partesDeToken(e1.tokenEquipo);

    expect((await verSesion(pin.token, e1.tokenEquipo)).status).toBe(200);
    esperarError(await verSesion(pin.token), 401, 'NO_AUTENTICADO');
    esperarError(await verSesion(pin.token, e2.tokenEquipo), 401, 'NO_AUTENTICADO');
    esperarError(await verSesion(pin.token, 'basura'), 401, 'NO_AUTENTICADO');
    esperarError(
      await verSesion(pin.token, `eq.${A.id}.${partes.id}.${secretoFalso()}`),
      401,
      'NO_AUTENTICADO',
    );

    // Una sesión de contraseña asociada al equipo no exige la cabecera...
    expect((await verSesion(e1.sesion)).status).toBe(200);
    // ...pero se cierra cuando se revoca ese equipo recordado, igual que la PIN.
    const otraPin = await pinOk(app(), e1.tokenEquipo, x);
    expect((await verSesion(otraPin.token, e1.tokenEquipo)).status).toBe(200);
    const revocar = await llamar(
      app(),
      'delete',
      `/usuarios/${x.id}/equipos/${e1.equipoRecordadoId}`,
      {
        token: await tokenAdmin(app(), A),
      },
    );
    expect(revocar.status).toBe(204);
    esperarError(await verSesion(otraPin.token, e1.tokenEquipo), 401, 'NO_AUTENTICADO');
    esperarError(await verSesion(e1.sesion), 401, 'NO_AUTENTICADO');
    expect((await verSesion(e2.sesion)).status).toBe(200);
  });
});

describe('criterio 38 · cambio rápido de usuario', () => {
  it('otra persona (o la misma) que entra con PIN cierra la sesión PIN anterior del equipo', async () => {
    const u = await mozoEn(1);
    const v = await mozoEn(1);
    const e = await equipoCon(app(), [u, v]);

    const deU = await pinOk(app(), e.tokenEquipo, u);
    expect((await verSesion(deU.token, e.tokenEquipo)).status).toBe(200);
    const deV = await pinOk(app(), e.tokenEquipo, v);
    esperarError(await verSesion(deU.token, e.tokenEquipo), 401, 'NO_AUTENTICADO');
    expect((await verSesion(deV.token, e.tokenEquipo)).status).toBe(200);
    // Las sesiones de contraseña no cuentan: la de U sigue abierta.
    expect((await verSesion(e.porPersona[u.id]!.sesion)).status).toBe(200);

    const otraDeV = await pinOk(app(), e.tokenEquipo, v);
    esperarError(await verSesion(deV.token, e.tokenEquipo), 401, 'NO_AUTENTICADO');
    expect((await verSesion(otraDeV.token, e.tokenEquipo)).status).toBe(200);

    const abiertas = await consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM sesion WHERE equipo_id = $1 AND tipo = 'PIN' AND cerrada_en IS NULL`,
      [e.equipoId],
    );
    expect(abiertas[0]!.n).toBe('1');
  });

  it('DELETE /sesion cierra la sesión y el equipo sigue recordando a la persona', async () => {
    const u = await mozoEn(1);
    const e = await nuevoEquipo(app(), u);
    const pin = await pinOk(app(), e.tokenEquipo, u);
    const salir = await llamar(app(), 'delete', '/sesion', {
      token: pin.token,
      equipo: e.tokenEquipo,
    });
    expect(salir.status).toBe(204);
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'NO_AUTENTICADO');
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e.tokenEquipo });
    expect(lista.body.personas.map((p: Libre) => p.usuarioId)).toEqual([u.id]);
    expect((await loginPin(app(), e.tokenEquipo, u.id, u.pin)).status).toBe(201);
  });
});

describe('criterio 39 · inactividad de la sesión PIN', () => {
  it('vale 5 minutos por defecto desde la última actividad; en el instante exacto ya expiró', async () => {
    const x = await mozoEn(1);
    const e = await nuevoEquipo(app(), x);
    const pin = await pinOk(app(), e.tokenEquipo, x);
    entorno.reloj.avanzar(5 * MINUTO - 1000);
    expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200); // renueva
    entorno.reloj.avanzar(5 * MINUTO - 1000);
    expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200); // vale porque se renovó
    entorno.reloj.avanzar(5 * MINUTO);
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'SESION_EXPIRADA');
    const otra = await verSesion(pin.token, e.tokenEquipo);
    expect(otra.status).toBe(401);
    expect(['NO_AUTENTICADO', 'SESION_EXPIRADA']).toContain(otra.body.codigo);
    // La persona sigue recordada y puede volver a entrar.
    expect((await loginPin(app(), e.tokenEquipo, x.id, x.pin)).status).toBe(201);
  });

  it('X-Actividad: segundo-plano valida la sesión sin renovar la actividad', async () => {
    const x = await mozoEn(1);
    const e = await nuevoEquipo(app(), x);
    const pin = await pinOk(app(), e.tokenEquipo, x);
    entorno.reloj.avanzar(3 * MINUTO);
    const fondo = await llamar(app(), 'get', '/sesion', {
      token: pin.token,
      equipo: e.tokenEquipo,
      cabeceras: { 'X-Actividad': 'segundo-plano' },
    });
    expect(fondo.status).toBe(200);
    entorno.reloj.avanzar(2 * MINUTO);
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'SESION_EXPIRADA');

    // Control: la misma secuencia con una petición normal sí renueva.
    const pin2 = await pinOk(app(), e.tokenEquipo, x);
    entorno.reloj.avanzar(3 * MINUTO);
    expect((await verSesion(pin2.token, e.tokenEquipo)).status).toBe(200);
    entorno.reloj.avanzar(2 * MINUTO);
    expect((await verSesion(pin2.token, e.tokenEquipo)).status).toBe(200);
  });

  it('sin sucursal activa también rigen 5 minutos', async () => {
    const x = await mozoEn(1, 2);
    const e = await nuevoEquipo(app(), x);
    const pin = await pinOk(app(), e.tokenEquipo, x);
    expect(pin.sesion.sucursal).toBeNull();
    entorno.reloj.avanzar(5 * MINUTO - 1000);
    expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200);
    entorno.reloj.avanzar(5 * MINUTO);
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'SESION_EXPIRADA');
  });

  it('al cambiar de sucursal rigen los minutos de la nueva desde la siguiente petición', async () => {
    await configurarInactividad(S(3), 3);
    await configurarInactividad(S(4), 8);
    const e = await nuevoEquipo(app(), mozoCfg);
    const pin = await pinOk(app(), e.tokenEquipo, mozoCfg);
    const elegir = (sucursal: string) =>
      llamar(app(), 'put', '/sesion/sucursal', {
        token: pin.token,
        equipo: e.tokenEquipo,
        cuerpo: { sucursalId: sucursal },
      });
    expect((await elegir(S(3))).status).toBe(200); // S3: 3 minutos
    entorno.reloj.avanzar(2 * MINUTO);
    expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200);
    expect((await elegir(S(4))).status).toBe(200); // S4: 8 minutos
    entorno.reloj.avanzar(5 * MINUTO); // con S3 ya habría expirado
    expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200);
    entorno.reloj.avanzar(8 * MINUTO);
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'SESION_EXPIRADA');
  });

  it('un cambio de minutos de la sucursal se aplica a las sesiones PIN abiertas desde su siguiente petición', async () => {
    const e = await nuevoEquipo(app(), mozoS5);
    // Alarga: 5 -> 10.
    let pin = await pinOk(app(), e.tokenEquipo, mozoS5);
    expect(pin.sesion.sucursal.id).toBe(S(5));
    await configurarInactividad(S(5), 10);
    entorno.reloj.avanzar(7 * MINUTO);
    expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200);
    entorno.reloj.avanzar(10 * MINUTO);
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'SESION_EXPIRADA');
    // Acorta: 10 -> 2.
    pin = await pinOk(app(), e.tokenEquipo, mozoS5);
    await configurarInactividad(S(5), 2);
    entorno.reloj.avanzar(3 * MINUTO);
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'SESION_EXPIRADA');
    await configurarInactividad(S(5), 5);
  });

  it('dura como máximo 12 horas desde que se creó, aunque no haya inactividad', async () => {
    await configurarInactividad(S(5), 120);
    const e = await nuevoEquipo(app(), mozoS5);
    const pin = await pinOk(app(), e.tokenEquipo, mozoS5);
    for (let i = 0; i < 7; i++) {
      entorno.reloj.avanzar(100 * MINUTO);
      expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200);
    }
    entorno.reloj.avanzar(19 * MINUTO); // 11 h 59 min desde que se creó
    expect((await verSesion(pin.token, e.tokenEquipo)).status).toBe(200);
    entorno.reloj.avanzar(2 * MINUTO); // 12 h 01 min
    esperarError(await verSesion(pin.token, e.tokenEquipo), 401, 'SESION_EXPIRADA');
    await configurarInactividad(S(5), 5);
  });
});

describe('criterio 40 · configurar la inactividad de la sucursal', () => {
  it('GET devuelve 5 por defecto y PATCH cambia el valor con auditoría', async () => {
    const admin = await tokenAdmin(app(), A);
    const inicial = await llamar(app(), 'get', `/sucursales/${S(2)}/acceso`, { token: admin });
    expect(inicial.status).toBe(200);
    expect(inicial.body).toEqual({
      sucursalId: S(2),
      minutosInactividad: 5,
      minutosInactividadCocina: 60,
    });

    const deEstaSucursal = async () =>
      (await filasAuditoria(A.id, 'configurar_acceso_sucursal')).filter(
        (f) => f.sucursal_id === S(2),
      );
    const previas = await deEstaSucursal();
    const antes = previas.length;
    const cambio = await llamar(app(), 'patch', `/sucursales/${S(2)}/acceso`, {
      token: admin,
      cuerpo: { minutosInactividad: 10 },
    });
    expect(cambio.status).toBe(200);
    expect(cambio.body).toEqual({
      sucursalId: S(2),
      minutosInactividad: 10,
      minutosInactividadCocina: 60,
    });
    const leido = await llamar(app(), 'get', `/sucursales/${S(2)}/acceso`, { token: admin });
    expect(leido.body.minutosInactividad).toBe(10);

    const filas = await deEstaSucursal();
    expect(filas).toHaveLength(antes + 1);
    const idsPrevios = new Set(previas.map((f) => f.id));
    const nuevas = filas.filter((f) => !idsPrevios.has(f.id));
    expect(nuevas).toHaveLength(1);
    const ultima = nuevas[0]!;
    expect(ultima.actor_usuario_id).toBe(A.admin.id);
    expect(ultima.sucursal_id).toBe(S(2));

    for (const limite of [1, 120]) {
      const res = await llamar(app(), 'patch', `/sucursales/${S(2)}/acceso`, {
        token: admin,
        cuerpo: { minutosInactividad: limite },
      });
      expect(res.body.minutosInactividad).toBe(limite);
    }
    await llamar(app(), 'patch', `/sucursales/${S(2)}/acceso`, {
      token: admin,
      cuerpo: { minutosInactividad: 5 },
    });
  });

  it('rechaza valores fuera de 1 a 120, no enteros, otros tipos y campos de más', async () => {
    const admin = await tokenAdmin(app(), A);
    const antes = await llamar(app(), 'get', `/sucursales/${S(2)}/acceso`, { token: admin });
    const cuerpos: unknown[] = [
      { minutosInactividad: 0 },
      { minutosInactividad: 121 },
      { minutosInactividad: -5 },
      { minutosInactividad: 1.5 },
      { minutosInactividad: '10' },
      { minutosInactividad: null },
      {},
      { minutosInactividad: 10, otro: 1 },
    ];
    for (const cuerpo of cuerpos) {
      const res = await llamar(app(), 'patch', `/sucursales/${S(2)}/acceso`, {
        token: admin,
        cuerpo,
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    const despues = await llamar(app(), 'get', `/sucursales/${S(2)}/acceso`, { token: admin });
    expect(despues.body).toEqual(antes.body);
  });

  it('solo el Administrador: otros roles (contraseña o PIN) reciben 403 PROHIBIDO y nada cambia', async () => {
    const sesionCajero = await loginContrasena(app(), cajero);
    const e = await nuevoEquipo(app(), mozoV);
    const pinMozo = await pinOk(app(), e.tokenEquipo, mozoV);
    const antes = await llamar(app(), 'get', `/sucursales/${S(1)}/acceso`, {
      token: await tokenAdmin(app(), A),
    });
    const intentos = [
      { token: sesionCajero.token },
      { token: pinMozo.token, equipo: e.tokenEquipo },
    ];
    for (const sesion of intentos) {
      esperarError(
        await llamar(app(), 'get', `/sucursales/${S(1)}/acceso`, sesion),
        403,
        'PROHIBIDO',
      );
      esperarError(
        await llamar(app(), 'patch', `/sucursales/${S(1)}/acceso`, {
          ...sesion,
          cuerpo: { minutosInactividad: 60 },
        }),
        403,
        'PROHIBIDO',
      );
    }
    const despues = await llamar(app(), 'get', `/sucursales/${S(1)}/acceso`, {
      token: await tokenAdmin(app(), A),
    });
    expect(despues.body).toEqual(antes.body);
  });

  it('una sucursal de B o inexistente responde 404 NO_ENCONTRADO idéntico', async () => {
    const admin = await tokenAdmin(app(), A);
    const deB = B.sucursales[0]!.id;
    const inexistente = randomUUID();
    const respuestas = [];
    for (const id of [deB, inexistente]) {
      respuestas.push(await llamar(app(), 'get', `/sucursales/${id}/acceso`, { token: admin }));
      respuestas.push(
        await llamar(app(), 'patch', `/sucursales/${id}/acceso`, {
          token: admin,
          cuerpo: { minutosInactividad: 7 },
        }),
      );
    }
    for (const res of respuestas) esperarError(res, 404, 'NO_ENCONTRADO');
    for (const res of respuestas) expect(res.body).toEqual(respuestas[0]!.body);
    // La sucursal de B no cambió.
    const adminB = await tokenAdmin(app(), B);
    const deBLeida = await llamar(app(), 'get', `/sucursales/${deB}/acceso`, { token: adminB });
    expect(deBLeida.body.minutosInactividad).toBe(5);
  });
});

describe('criterio 41 · límites de la sesión PIN', () => {
  it('no puede cambiar la contraseña ni recordar equipos (403 PROHIBIDO); sí cambiar de sucursal', async () => {
    const x = await mozoEn(1, 2);
    const e = await nuevoEquipo(app(), x);
    const pin = await pinOk(app(), e.tokenEquipo, x);
    const sesion = { token: pin.token, equipo: e.tokenEquipo };

    esperarError(
      await llamar(app(), 'put', '/sesion/contrasena', {
        ...sesion,
        cuerpo: { actual: x.contrasena, nueva: 'Otra-contrasena-2026' },
      }),
      403,
      'PROHIBIDO',
    );
    esperarError(
      await llamar(app(), 'post', '/sesion/equipo', { ...sesion, cuerpo: {} }),
      403,
      'PROHIBIDO',
    );
    // La contraseña sigue siendo la misma.
    expect((await loginContrasena(app(), x)).token).toBeTruthy();

    const elegir = await llamar(app(), 'put', '/sesion/sucursal', {
      ...sesion,
      cuerpo: { sucursalId: S(1) },
    });
    expect(elegir.status).toBe(200);
    expect(elegir.body.sucursal.id).toBe(S(1));
    // Sucursal sin acceso, de B o inexistente: 404 idéntico.
    const rechazos = [];
    for (const id of [S(3), B.sucursales[0]!.id, randomUUID()]) {
      rechazos.push(
        await llamar(app(), 'put', '/sesion/sucursal', { ...sesion, cuerpo: { sucursalId: id } }),
      );
    }
    for (const res of rechazos) {
      esperarError(res, 404, 'NO_ENCONTRADO');
      expect(res.body).toEqual(rechazos[0]!.body);
    }
    // Sigue en la sucursal que tenía.
    expect((await verSesion(pin.token, e.tokenEquipo)).body.sucursal.id).toBe(S(1));
  });
});

/** Matriz de un Mozo, copiada de la especificación. */
const PERMISOS_MOZO = {
  ATENDER_MESA: 'permitido',
  MOVER_UNIR_MESAS: 'permitido',
  ANULAR_ITEM_ENVIADO: 'clave',
  APLICAR_DESCUENTO: 'clave',
  APLICAR_CORTESIA: 'clave',
  ANULAR_ORDEN: 'clave',
  GESTIONAR_PEDIDOS_WEB: 'prohibido',
  COBRAR: 'prohibido',
  EMITIR_NOTA_CREDITO: 'prohibido',
  OPERAR_CAJA: 'prohibido',
  USAR_KDS: 'prohibido',
  GESTIONAR_DISPONIBILIDAD: 'prohibido',
  REGISTRAR_INGRESO_MERCADERIA: 'prohibido',
  AJUSTAR_STOCK: 'prohibido',
  EDITAR_CARTA: 'prohibido',
  ADMINISTRAR: 'prohibido',
};

describe('criterio 42 · GET /sesion de una sesión PIN', () => {
  it('devuelve la sesión actual completa según sesionRespuestaSchema', async () => {
    const x = await mozoEn(1);
    const e = await nuevoEquipo(app(), x, 'Mi celular');
    const pin = await pinOk(app(), e.tokenEquipo, x);
    const res = await verSesion(pin.token, e.tokenEquipo);
    expect(res.status).toBe(200);
    const cuerpo = sesionRespuestaSchema.parse(res.body);
    expect(cuerpo).toMatchObject({
      tipo: 'PIN',
      empresaId: A.id,
      usuario: { id: x.id, nombre: x.nombre, nombreUsuario: x.nombreUsuario },
      superadministrador: null,
      rol: 'MOZO',
      esAdministrador: false,
      sucursal: { id: S(1) },
      equipo: { id: e.equipoId, nombre: 'Mi celular', equipoRecordadoId: e.equipoRecordadoId },
      avisoSuscripcion: null,
      debeCambiarContrasena: false,
    });
    expect(cuerpo.sucursales).toEqual([expect.objectContaining({ id: S(1), rol: 'MOZO' })]);
    expect(cuerpo.permisos).toEqual(PERMISOS_MOZO);
    expect(Array.isArray(cuerpo.modulos)).toBe(true);
    // `expiraPorInactividadEn` = última actividad + 5 minutos (reloj de la API).
    expect(
      Math.abs(
        new Date(cuerpo.expiraPorInactividadEn!).getTime() -
          (entorno.reloj.ahora().getTime() + 5 * MINUTO),
      ),
    ).toBeLessThanOrEqual(1500);
    expect(JSON.stringify(res.body)).not.toContain(x.pin);
  });

  it('sin sucursal elegida no hay rol ni permisos; al elegirla aparecen los de ese rol', async () => {
    const e = await nuevoEquipo(app(), mozoMulti);
    const pin = await pinOk(app(), e.tokenEquipo, mozoMulti);
    const antes = (await verSesion(pin.token, e.tokenEquipo)).body;
    sesionRespuestaSchema.parse(antes);
    expect(antes.sucursal).toBeNull();
    expect(antes.rol).toBeNull();
    expect(antes.permisos).toBeNull();
    expect(antes.sucursales.map((s: Libre) => s.id).sort()).toEqual([S(1), S(2)].sort());
    const elegir = await llamar(app(), 'put', '/sesion/sucursal', {
      token: pin.token,
      equipo: e.tokenEquipo,
      cuerpo: { sucursalId: S(1) },
    });
    expect(elegir.status).toBe(200);
    const despues = (await verSesion(pin.token, e.tokenEquipo)).body;
    expect(despues.rol).toBe('MOZO');
    expect(despues.permisos).toEqual(PERMISOS_MOZO);
  });

  it('un Cajero ve la matriz de su rol (clave para anular, permitido para cobrar)', async () => {
    const e = await nuevoEquipo(app(), cajero);
    const pin = await pinOk(app(), e.tokenEquipo, cajero);
    const cuerpo = (await verSesion(pin.token, e.tokenEquipo)).body;
    expect(cuerpo.rol).toBe('CAJERO');
    expect(cuerpo.permisos).toMatchObject({
      ANULAR_ITEM_ENVIADO: 'clave',
      EMITIR_NOTA_CREDITO: 'clave',
      COBRAR: 'permitido',
      OPERAR_CAJA: 'permitido',
      USAR_KDS: 'prohibido',
      EDITAR_CARTA: 'permitido',
    });
  });

  it('una sesión de soporte no obtiene equipo ni cuenta como usuario de la empresa', async () => {
    const soporte = await sesionDeSoporte(app(), await ingresarSuperadmin(app(), sa), A.id, S(1));
    const cuerpo = (await verSesion(soporte)).body;
    sesionRespuestaSchema.parse(cuerpo);
    expect(cuerpo).toMatchObject({
      tipo: 'SOPORTE',
      usuario: null,
      equipo: null,
      esAdministrador: true,
    });
    expect(cuerpo.superadministrador).toMatchObject({ id: sa.id });
  });
});
