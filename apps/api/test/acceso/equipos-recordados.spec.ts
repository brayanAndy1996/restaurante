// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P4 · Criterios 27 a 32b (equipos recordados): recordar el equipo con y sin `X-Equipo`, consultar
// el equipo (`GET /equipo`), el máximo de 5 personas con reemplazo, revocar (Administrador), olvidar
// (la propia persona), auditoría sin el token y revocaciones automáticas al desactivar y al
// restablecer la contraseña. App real con `RelojManual`, empresas creadas por HTTP de plataforma y
// usuarios creados por `POST /usuarios`; sin `EMPRESA_POR_HEADER`.
import {
  equipoActualRespuestaSchema,
  equipoRecordadoRespuestaSchema,
  recordarEquipoRespuestaSchema,
} from '@restaurante/contratos';
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
  crearPersonaConContrasenaTemporal,
  crearSuperadminDePrueba,
  equipoCon,
  equipoRecordadoActivo,
  esperarError,
  filasAuditoria,
  ingresarSuperadmin,
  llamar,
  loginContrasena,
  loginPin,
  motivoDeRevocacion,
  nuevoEquipo,
  partesDeToken,
  personasActivasDelEquipo,
  pinOk,
  secretoFalso,
  secretosEn,
  sesionDeSoporte,
  textoAuditoria,
  tokenAdmin,
  type Empresa,
  type Libre,
  type Entorno,
  type Persona,
} from './fabrica-equipos';

let entorno: Entorno;
let A: Empresa;
let B: Empresa;
let tokenSa: string;
/** personas[0] es Cajero (PIN de 6 dígitos); el resto, Mozos (PIN de 4). Todas en la primera sucursal de A. */
let personas: Persona[];
let personaDeB: Persona;

const app = () => entorno.app;
const cajero = () => personas[0] as Persona;
const mozo = (i: number) => personas[i] as Persona;

beforeAll(async () => {
  entorno = await crearEntorno();
  const sa = await crearSuperadminDePrueba();
  tokenSa = await ingresarSuperadmin(app(), sa);
  A = await altaEmpresa(app(), tokenSa);
  B = await altaEmpresa(app(), tokenSa);
  const s1 = A.sucursales[0]!.id;
  personas = [await crearPersona(app(), A, { accesos: [{ sucursalId: s1, rol: 'CAJERO' }] })];
  for (let i = 1; i <= 7; i++) {
    personas.push(await crearPersona(app(), A, { accesos: [{ sucursalId: s1, rol: 'MOZO' }] }));
  }
  personaDeB = await crearPersona(app(), B, {
    accesos: [{ sucursalId: B.sucursales[0]!.id, rol: 'MOZO' }],
  });
}, 120_000);

afterAll(async () => {
  await entorno?.cerrar();
});

/** Una persona nueva de A (para pruebas que cambian su estado). */
const personaNueva = (rol: 'MOZO' | 'CAJERO' = 'MOZO') =>
  crearPersona(app(), A, { accesos: [{ sucursalId: A.sucursales[0]!.id, rol }] });

describe('criterio 27 · recordar el equipo (POST /sesion/equipo)', () => {
  it('sin X-Equipo crea un equipo nuevo: 201 con equipo y token, que solo se muestra ahí', async () => {
    const { token } = await loginContrasena(app(), mozo(1));
    const res = await llamar(app(), 'post', '/sesion/equipo', { token, cuerpo: {} });
    expect(res.status).toBe(201);
    const cuerpo = recordarEquipoRespuestaSchema.parse(res.body);
    expect(cuerpo.equipo.nombre).toBe('Equipo sin nombre');
    expect(cuerpo.tokenEquipo).toMatch(
      new RegExp(`^eq\\.${A.id}\\.${cuerpo.equipo.id}\\.[A-Za-z0-9_-]{43}$`),
    );
    expect(await equipoRecordadoActivo(cuerpo.equipo.id, mozo(1).id)).toBe(true);
    // La sesión queda asociada al equipo (criterio 42) y marcada como la actual (criterio 31).
    const sesion = await llamar(app(), 'get', '/sesion', { token });
    expect(sesion.body.equipo).toMatchObject({ id: cuerpo.equipo.id, nombre: 'Equipo sin nombre' });
    const propios = await llamar(app(), 'get', '/sesion/equipos', { token });
    expect(propios.body.find((e: Libre) => e.equipo.id === cuerpo.equipo.id)?.actual).toBe(true);
  });

  it('usa el nombre indicado (1 a 60 caracteres) y rechaza uno vacío, de 61 o con campos de más', async () => {
    const { token } = await loginContrasena(app(), mozo(2));
    const bueno = await llamar(app(), 'post', '/sesion/equipo', {
      token,
      cuerpo: { nombre: 'Celular de Ana' },
    });
    expect(bueno.status).toBe(201);
    expect(bueno.body.equipo.nombre).toBe('Celular de Ana');
    const otra = await loginContrasena(app(), mozo(2));
    for (const cuerpo of [
      { nombre: '' },
      { nombre: 'x'.repeat(61) },
      { nombre: 'ok', empresaId: B.id },
      { nombre: 5 },
    ]) {
      const res = await llamar(app(), 'post', '/sesion/equipo', { token: otra.token, cuerpo });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
  });

  it('con el X-Equipo válido de la empresa responde 200 con el equipo y sin token; solo se actualiza el último uso', async () => {
    const persona = mozo(3);
    const inicial = await nuevoEquipo(app(), persona);
    const antes = await llamar(app(), 'get', '/sesion/equipos', { token: inicial.sesion });
    const filaAntes = antes.body.find((e: Libre) => e.equipo.id === inicial.equipoId);

    entorno.reloj.avanzar(10 * MINUTO);
    const { token } = await loginContrasena(app(), persona);
    const res = await llamar(app(), 'post', '/sesion/equipo', {
      token,
      equipo: inicial.tokenEquipo,
      cuerpo: {},
    });
    expect(res.status).toBe(200);
    expect(recordarEquipoRespuestaSchema.parse(res.body).equipo.id).toBe(inicial.equipoId);
    expect(res.body.tokenEquipo).toBeUndefined();

    // Sigue habiendo un solo equipo recordado activo (equipo, persona).
    const filas = await consultar(
      `SELECT 1 FROM equipo_recordado WHERE equipo_id = $1 AND usuario_id = $2 AND revocado_en IS NULL`,
      [inicial.equipoId, persona.id],
    );
    expect(filas).toHaveLength(1);
    const despues = await llamar(app(), 'get', '/sesion/equipos', { token });
    const filaDespues = despues.body.find((e: Libre) => e.equipo.id === inicial.equipoId);
    expect(filaDespues.id).toBe(filaAntes.id);
    expect(filaDespues.recordadoEn).toBe(filaAntes.recordadoEn);
    expect(new Date(filaDespues.ultimoUsoEn).getTime()).toBeGreaterThan(
      new Date(filaAntes.ultimoUsoEn).getTime(),
    );
  });

  it('con X-Equipo mal formado, adulterado o de otra empresa crea un equipo nuevo de la empresa de la sesión', async () => {
    const persona = mozo(4);
    const inicial = await nuevoEquipo(app(), persona);
    const partes = partesDeToken(inicial.tokenEquipo);
    const deB = await nuevoEquipo(app(), personaDeB);
    const invalidos: Record<string, string> = {
      'mal formado': 'esto-no-es-un-token',
      'con tres partes': `eq.${A.id}.${partes.id}`,
      'secreto distinto': `eq.${A.id}.${partes.id}.${secretoFalso()}`,
      'empresa cambiada a B': `eq.${B.id}.${partes.id}.${partes.secreto}`,
      'id de un equipo de B': `eq.${A.id}.${deB.equipoId}.${partes.secreto}`,
      'token válido de B': deB.tokenEquipo,
    };
    const vistos = new Set<string>([inicial.equipoId]);
    for (const [caso, tokenEquipo] of Object.entries(invalidos)) {
      const { token } = await loginContrasena(app(), persona);
      const res = await llamar(app(), 'post', '/sesion/equipo', {
        token,
        equipo: tokenEquipo,
        cuerpo: {},
      });
      expect(res.status, caso).toBe(201);
      expect(res.body.equipo.id, caso).not.toBe(inicial.equipoId);
      expect(res.body.tokenEquipo, caso).toMatch(new RegExp(`^eq\\.${A.id}\\.`));
      expect(vistos.has(res.body.equipo.id), caso).toBe(false);
      vistos.add(res.body.equipo.id);
    }
    // El equipo de B no recordó a nadie de A.
    const delB = await llamar(app(), 'get', '/equipo', { equipo: deB.tokenEquipo });
    expect(delB.body.personas.map((p: Libre) => p.usuarioId)).toEqual([personaDeB.id]);
  });

  it('repetirlo en la misma sesión con el mismo equipo responde 200; con otro equipo, 409 CONFLICTO', async () => {
    const persona = mozo(5);
    const otro = await nuevoEquipo(app(), persona, 'Otro equipo');
    const { token } = await loginContrasena(app(), persona);
    const primero = await llamar(app(), 'post', '/sesion/equipo', { token, cuerpo: {} });
    expect(primero.status).toBe(201);
    const repetido = await llamar(app(), 'post', '/sesion/equipo', {
      token,
      equipo: primero.body.tokenEquipo,
      cuerpo: {},
    });
    expect(repetido.status).toBe(200);
    expect(repetido.body.equipo.id).toBe(primero.body.equipo.id);
    expect(repetido.body.tokenEquipo).toBeUndefined();

    const conflicto = await llamar(app(), 'post', '/sesion/equipo', {
      token,
      equipo: otro.tokenEquipo,
      cuerpo: {},
    });
    esperarError(conflicto, 409, 'CONFLICTO');
    const sesion = await llamar(app(), 'get', '/sesion', { token });
    expect(sesion.body.equipo.id).toBe(primero.body.equipo.id);
  });

  it('en una sesión PIN responde 403 PROHIBIDO', async () => {
    const persona = mozo(6);
    const equipo = await nuevoEquipo(app(), persona);
    const pin = await pinOk(app(), equipo.tokenEquipo, persona);
    const res = await llamar(app(), 'post', '/sesion/equipo', {
      token: pin.token,
      equipo: equipo.tokenEquipo,
      cuerpo: {},
    });
    esperarError(res, 403, 'PROHIBIDO');
  });

  it('en una sesión de soporte responde 403 PROHIBIDO', async () => {
    const soporte = await sesionDeSoporte(app(), tokenSa, A.id, A.sucursales[0]!.id);
    const res = await llamar(app(), 'post', '/sesion/equipo', { token: soporte, cuerpo: {} });
    esperarError(res, 403, 'PROHIBIDO');
  });

  it('con contraseña temporal responde 403 CAMBIO_CONTRASENA_REQUERIDO y no crea ningún equipo', async () => {
    const temporal = await crearPersonaConContrasenaTemporal(app(), A, {
      accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
    });
    const { token, sesion } = await loginContrasena(app(), temporal);
    expect(sesion.debeCambiarContrasena).toBe(true);
    const antes = await consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM equipo WHERE empresa_id = $1`,
      [A.id],
    );
    const res = await llamar(app(), 'post', '/sesion/equipo', { token, cuerpo: {} });
    esperarError(res, 403, 'CAMBIO_CONTRASENA_REQUERIDO');
    const despues = await consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM equipo WHERE empresa_id = $1`,
      [A.id],
    );
    expect(despues[0]!.n).toBe(antes[0]!.n);
    expect(
      await consultar(`SELECT 1 FROM equipo_recordado WHERE usuario_id = $1`, [temporal.id]),
    ).toHaveLength(0);
  });

  it('sin sesión, un token cualquiera responde 401 NO_AUTENTICADO', async () => {
    const res = await llamar(app(), 'post', '/sesion/equipo', { cuerpo: {} });
    esperarError(res, 401, 'NO_AUTENTICADO');
  });
});

describe('criterio 28 · GET /equipo', () => {
  it('responde 200 con las personas activas, de la usada más recientemente a la más antigua', async () => {
    const [a, b, c] = [mozo(1), mozo(2), cajero()];
    const inicial = await nuevoEquipo(app(), a);
    entorno.reloj.avanzar(MINUTO);
    await agregarAEquipo(app(), b, inicial.tokenEquipo);
    entorno.reloj.avanzar(MINUTO);
    await agregarAEquipo(app(), c, inicial.tokenEquipo);

    let res = await llamar(app(), 'get', '/equipo', { equipo: inicial.tokenEquipo });
    expect(res.status).toBe(200);
    const cuerpo = equipoActualRespuestaSchema.parse(res.body);
    expect(cuerpo.equipo.id).toBe(inicial.equipoId);
    expect(cuerpo.personas.map((p) => p.usuarioId)).toEqual([c.id, b.id, a.id]);
    expect(cuerpo.personas.map((p) => p.largoPin)).toEqual([6, 4, 4]);
    expect(cuerpo.personas.map((p) => p.nombre)).toEqual([c.nombre, b.nombre, a.nombre]);
    expect(cuerpo.personas.every((p) => p.bloqueadoHastaEn === null)).toBe(true);

    // La primera vuelve a usarse: pasa al principio.
    entorno.reloj.avanzar(MINUTO);
    await agregarAEquipo(app(), a, inicial.tokenEquipo);
    res = await llamar(app(), 'get', '/equipo', { equipo: inicial.tokenEquipo });
    expect(res.body.personas.map((p: Libre) => p.usuarioId)).toEqual([a.id, c.id, b.id]);
  });

  it('un equipo que no recuerda a nadie devuelve la lista vacía', async () => {
    const persona = mozo(3);
    const equipo = await nuevoEquipo(app(), persona);
    const olvidar = await llamar(app(), 'delete', `/sesion/equipos/${equipo.equipoRecordadoId}`, {
      token: equipo.sesion,
    });
    expect(olvidar.status).toBe(204);
    const res = await llamar(app(), 'get', '/equipo', { equipo: equipo.tokenEquipo });
    expect(res.status).toBe(200);
    expect(equipoActualRespuestaSchema.parse(res.body).personas).toEqual([]);
    expect(res.body.equipo.id).toBe(equipo.equipoId);
  });

  it('sin cabecera, mal formada o adulterada responde 401 EQUIPO_NO_RECONOCIDO con el mismo cuerpo', async () => {
    const equipo = await nuevoEquipo(app(), mozo(4));
    const deB = await nuevoEquipo(app(), personaDeB);
    const partes = partesDeToken(equipo.tokenEquipo);
    const casos: (string | undefined)[] = [
      undefined,
      '',
      'basura',
      `eq.${A.id}.${partes.id}`,
      `eq.${A.id}.${partes.id}.${secretoFalso()}`,
      `eq.${B.id}.${partes.id}.${partes.secreto}`,
      `eq.${A.id}.${deB.equipoId}.${partes.secreto}`,
      `eq.${B.id}.${deB.equipoId}.${partes.secreto}`,
      `eq.${A.id}.${randomUUID()}.${partes.secreto}`,
      `se.${A.id}.${partes.id}.${partes.secreto}`,
    ];
    const cuerpos: unknown[] = [];
    for (const tokenEquipo of casos) {
      const res = await llamar(app(), 'get', '/equipo', {
        ...(tokenEquipo !== undefined ? { cabeceras: { 'X-Equipo': tokenEquipo } } : {}),
      });
      esperarError(res, 401, 'EQUIPO_NO_RECONOCIDO');
      cuerpos.push(res.body);
    }
    for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
  });
});

describe('criterio 29 · máximo de 5 personas por equipo', () => {
  it('la sexta persona reemplaza a la de último uso más antiguo; a igualdad, a la recordada primero', async () => {
    const seis = [1, 2, 3, 4, 5, 6].map(mozo);
    // t0: seis[0] recuerda el equipo. t1: seis[1] lo recuerda y seis[0] vuelve a usarlo, así que las
    // dos quedan con el mismo último uso (t1) y la recordada primero es seis[0]. t2: las otras tres.
    const inicial = await nuevoEquipo(app(), seis[0]!);
    const sesiones: Record<string, string> = { [seis[0]!.id]: inicial.sesion };
    entorno.reloj.avanzar(MINUTO);
    sesiones[seis[1]!.id] = (await agregarAEquipo(app(), seis[1]!, inicial.tokenEquipo)).sesion;
    const otraDeLaPrimera = await agregarAEquipo(app(), seis[0]!, inicial.tokenEquipo);
    entorno.reloj.avanzar(MINUTO);
    for (const persona of seis.slice(2, 5)) {
      sesiones[persona.id] = (await agregarAEquipo(app(), persona, inicial.tokenEquipo)).sesion;
    }
    expect(await personasActivasDelEquipo(inicial.equipoId)).toBe(5);

    entorno.reloj.avanzar(MINUTO);
    const sexta = await agregarAEquipo(app(), seis[5]!, inicial.tokenEquipo);
    expect(sexta.equipoId).toBe(inicial.equipoId);
    expect(await personasActivasDelEquipo(inicial.equipoId)).toBe(5);

    const res = await llamar(app(), 'get', '/equipo', { equipo: inicial.tokenEquipo });
    const ids = res.body.personas.map((p: Libre) => p.usuarioId) as string[];
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain(seis[0]!.id);
    expect(ids).toContain(seis[5]!.id);

    // La reemplazada: motivo REEMPLAZADO, sesiones asociadas cerradas, PIN ya no sirve y auditoría.
    expect(await motivoDeRevocacion(inicial.equipoId, seis[0]!.id)).toBe('REEMPLAZADO');
    for (const token of [sesiones[seis[0]!.id]!, otraDeLaPrimera.sesion]) {
      esperarError(await llamar(app(), 'get', '/sesion', { token }), 401, 'NO_AUTENTICADO');
    }
    esperarError(
      await loginPin(app(), inicial.tokenEquipo, seis[0]!.id, seis[0]!.pin),
      401,
      'CREDENCIALES_INVALIDAS',
    );
    // Las demás conservan su sesión.
    const otra = await llamar(app(), 'get', '/sesion', { token: sesiones[seis[1]!.id]! });
    expect(otra.status).toBe(200);

    const filas = (await filasAuditoria(A.id, 'equipo_reemplazado')).filter(
      (f) => f.texto.includes(inicial.equipoId) && f.texto.includes(seis[0]!.id),
    );
    expect(filas).toHaveLength(1);
    expect(secretosEn(filas[0]!.texto)).toEqual([]);
  });

  it('reemplaza por el último uso, no por el orden de alta: usar de nuevo a la primera la salva', async () => {
    const seis = [1, 2, 3, 4, 5, 6].map(mozo);
    const inicial = await nuevoEquipo(app(), seis[0]!);
    for (const persona of seis.slice(1, 5)) {
      entorno.reloj.avanzar(MINUTO);
      await agregarAEquipo(app(), persona, inicial.tokenEquipo);
    }
    entorno.reloj.avanzar(MINUTO);
    await agregarAEquipo(app(), seis[0]!, inicial.tokenEquipo); // la primera se usa de nuevo
    entorno.reloj.avanzar(MINUTO);
    await agregarAEquipo(app(), seis[5]!, inicial.tokenEquipo); // llega la sexta

    const res = await llamar(app(), 'get', '/equipo', { equipo: inicial.tokenEquipo });
    const ids = res.body.personas.map((p: Libre) => p.usuarioId) as string[];
    expect(ids).toHaveLength(5);
    expect(ids).toContain(seis[0]!.id);
    expect(ids).not.toContain(seis[1]!.id);
    expect(await motivoDeRevocacion(inicial.equipoId, seis[1]!.id)).toBe('REEMPLAZADO');
  });

  it('recordatorios concurrentes en el mismo equipo nunca dejan más de 5 personas activas', async () => {
    const todas = [0, 1, 2, 3, 4, 5, 6, 7].map(mozo);
    const iniciales = todas.slice(0, 5);
    const nuevas = todas.slice(5);
    const inicial = await nuevoEquipo(app(), iniciales[0]!);
    for (const persona of iniciales.slice(1)) {
      await agregarAEquipo(app(), persona, inicial.tokenEquipo);
    }
    entorno.reloj.avanzar(MINUTO);
    const sesiones = await Promise.all(nuevas.map((p) => loginContrasena(app(), p)));
    const respuestas = await Promise.all(
      sesiones.map((s) =>
        llamar(app(), 'post', '/sesion/equipo', {
          token: s.token,
          equipo: inicial.tokenEquipo,
          cuerpo: {},
        }),
      ),
    );
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await personasActivasDelEquipo(inicial.equipoId)).toBe(5);
    const res = await llamar(app(), 'get', '/equipo', { equipo: inicial.tokenEquipo });
    const ids = res.body.personas.map((p: Libre) => p.usuarioId) as string[];
    expect(new Set(ids).size).toBe(5);
    for (const persona of nuevas) expect(ids).toContain(persona.id);
  });
});

describe('criterio 30 · revocar (Administrador)', () => {
  it('lista los equipos recordados activos y revoca uno: cierra sus sesiones y no afecta a los demás', async () => {
    const x = await personaNueva();
    const y = await personaNueva();
    const e1 = await equipoCon(app(), [x, y], 'Equipo uno');
    const e2 = await nuevoEquipo(app(), x, 'Equipo dos');
    const pinX = await pinOk(app(), e1.tokenEquipo, x);
    const sesionX1 = e1.porPersona[x.id]!.sesion; // contraseña asociada a E1
    const admin = await tokenAdmin(app(), A);

    const lista = await llamar(app(), 'get', `/usuarios/${x.id}/equipos`, { token: admin });
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(2);
    for (const fila of lista.body) {
      expect(equipoRecordadoRespuestaSchema.parse(fila).equipo.id).toBeTruthy();
      expect(fila.actual).toBeUndefined();
    }
    expect(lista.body.map((f: Libre) => f.equipo.id).sort()).toEqual(
      [e1.equipoId, e2.equipoId].sort(),
    );

    const erE1 = e1.porPersona[x.id]!.equipoRecordadoId;
    const antesAuditoria = (await filasAuditoria(A.id, 'revocar_equipos')).length;
    const revocar = await llamar(app(), 'delete', `/usuarios/${x.id}/equipos/${erE1}`, {
      token: admin,
    });
    expect(revocar.status).toBe(204);

    // X: su sesión PIN y su sesión de contraseña asociadas a E1 quedan cerradas; el PIN ya no sirve.
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: pinX.token, equipo: e1.tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(await llamar(app(), 'get', '/sesion', { token: sesionX1 }), 401, 'NO_AUTENTICADO');
    esperarError(await loginPin(app(), e1.tokenEquipo, x.id, x.pin), 401, 'CREDENCIALES_INVALIDAS');
    // Su sesión asociada a E2 sigue, y también la persona Y en E1.
    expect((await llamar(app(), 'get', '/sesion', { token: e2.sesion })).status).toBe(200);
    expect(
      (await llamar(app(), 'get', '/sesion', { token: e1.porPersona[y.id]!.sesion })).status,
    ).toBe(200);
    expect((await loginPin(app(), e1.tokenEquipo, y.id, y.pin)).status).toBe(201);
    const enE1 = await llamar(app(), 'get', '/equipo', { equipo: e1.tokenEquipo });
    expect(enE1.body.personas.map((p: Libre) => p.usuarioId)).toEqual([y.id]);
    expect(await motivoDeRevocacion(e1.equipoId, x.id)).toBe('REVOCADO');

    const despues = await llamar(app(), 'get', `/usuarios/${x.id}/equipos`, { token: admin });
    expect(despues.body.map((f: Libre) => f.equipo.id)).toEqual([e2.equipoId]);

    // Auditoría: una fila con el Administrador como actor, la persona y el equipo, sin el token.
    const filas = await filasAuditoria(A.id, 'revocar_equipos');
    expect(filas).toHaveLength(antesAuditoria + 1);
    const fila = filas.find((f) => f.texto.includes(x.id) && f.texto.includes(e1.equipoId))!;
    expect(fila).toBeDefined();
    expect(fila.actor_usuario_id).toBe(A.admin.id);
    expect(secretosEn(fila.texto)).toEqual([]);

    // Repetirlo responde 204 sin otro efecto ni otra auditoría.
    const repetido = await llamar(app(), 'delete', `/usuarios/${x.id}/equipos/${erE1}`, {
      token: admin,
    });
    expect(repetido.status).toBe(204);
    expect(await filasAuditoria(A.id, 'revocar_equipos')).toHaveLength(antesAuditoria + 1);
  });

  it('revoca todos los equipos de la persona con DELETE /usuarios/:id/equipos', async () => {
    const x = await personaNueva();
    const e1 = await nuevoEquipo(app(), x);
    const e2 = await nuevoEquipo(app(), x);
    const pin = await pinOk(app(), e2.tokenEquipo, x);
    const admin = await tokenAdmin(app(), A);

    const res = await llamar(app(), 'delete', `/usuarios/${x.id}/equipos`, { token: admin });
    expect(res.status).toBe(204);
    const lista = await llamar(app(), 'get', `/usuarios/${x.id}/equipos`, { token: admin });
    expect(lista.body).toEqual([]);
    for (const equipo of [e1, e2]) {
      esperarError(
        await llamar(app(), 'get', '/sesion', { token: equipo.sesion }),
        401,
        'NO_AUTENTICADO',
      );
      esperarError(
        await loginPin(app(), equipo.tokenEquipo, x.id, x.pin),
        401,
        'CREDENCIALES_INVALIDAS',
      );
    }
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: pin.token, equipo: e2.tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );

    const filas = (await filasAuditoria(A.id, 'revocar_equipos')).filter((f) =>
      f.texto.includes(x.id),
    );
    expect(filas.length).toBeGreaterThanOrEqual(1);
    const texto = filas.map((f) => f.texto).join('\n');
    expect(texto).toContain(e1.equipoId);
    expect(texto).toContain(e2.equipoId);
    // Repetirlo: 204 y sin más auditoría.
    const repetido = await llamar(app(), 'delete', `/usuarios/${x.id}/equipos`, { token: admin });
    expect(repetido.status).toBe(204);
    expect(
      (await filasAuditoria(A.id, 'revocar_equipos')).filter((f) => f.texto.includes(x.id)),
    ).toHaveLength(filas.length);
  });

  it('un usuario de B, un equipo recordado de otro usuario o uno inexistente responden 404', async () => {
    const x = await personaNueva();
    const y = await personaNueva();
    const ex = await nuevoEquipo(app(), x);
    const ey = await nuevoEquipo(app(), y);
    const deB = await nuevoEquipo(app(), personaDeB);
    const admin = await tokenAdmin(app(), A);

    esperarError(
      await llamar(app(), 'get', `/usuarios/${personaDeB.id}/equipos`, { token: admin }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(app(), 'delete', `/usuarios/${personaDeB.id}/equipos`, { token: admin }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(app(), 'delete', `/usuarios/${personaDeB.id}/equipos/${deB.equipoRecordadoId}`, {
        token: admin,
      }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(app(), 'delete', `/usuarios/${x.id}/equipos/${ey.equipoRecordadoId}`, {
        token: admin,
      }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(app(), 'delete', `/usuarios/${x.id}/equipos/${randomUUID()}`, { token: admin }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(app(), 'get', `/usuarios/${randomUUID()}/equipos`, { token: admin }),
      404,
      'NO_ENCONTRADO',
    );
    // Nada cambió.
    expect(await equipoRecordadoActivo(ex.equipoId, x.id)).toBe(true);
    expect(await equipoRecordadoActivo(ey.equipoId, y.id)).toBe(true);
    expect(await equipoRecordadoActivo(deB.equipoId, personaDeB.id)).toBe(true);
  });
});

describe('criterio 31 · olvidar (la propia persona)', () => {
  it('GET /sesion/equipos lista los equipos propios y marca el de la sesión actual (contraseña y PIN)', async () => {
    const x = await personaNueva();
    const e1 = await nuevoEquipo(app(), x, 'Primero');
    const e2 = await nuevoEquipo(app(), x, 'Segundo');

    const enSesion1 = await llamar(app(), 'get', '/sesion/equipos', { token: e1.sesion });
    expect(enSesion1.status).toBe(200);
    expect(enSesion1.body).toHaveLength(2);
    for (const fila of enSesion1.body) equipoRecordadoRespuestaSchema.parse(fila);
    expect(enSesion1.body.filter((f: Libre) => f.actual).map((f: Libre) => f.equipo.id)).toEqual([
      e1.equipoId,
    ]);

    const enSesion2 = await llamar(app(), 'get', '/sesion/equipos', { token: e2.sesion });
    expect(enSesion2.body.filter((f: Libre) => f.actual).map((f: Libre) => f.equipo.id)).toEqual([
      e2.equipoId,
    ]);

    const pin = await pinOk(app(), e1.tokenEquipo, x);
    const enPin = await llamar(app(), 'get', '/sesion/equipos', {
      token: pin.token,
      equipo: e1.tokenEquipo,
    });
    expect(enPin.status).toBe(200);
    expect(enPin.body.filter((f: Libre) => f.actual).map((f: Libre) => f.equipo.id)).toEqual([
      e1.equipoId,
    ]);
    // Solo las propias: otra persona no ve las de X.
    const y = await personaNueva();
    const sesionY = await loginContrasena(app(), y);
    expect((await llamar(app(), 'get', '/sesion/equipos', { token: sesionY.token })).body).toEqual(
      [],
    );
  });

  it('olvidar otro equipo (desde una sesión PIN) cierra las sesiones de ese equipo y lo borra de la lista', async () => {
    const x = await personaNueva();
    const e1 = await nuevoEquipo(app(), x);
    const e2 = await nuevoEquipo(app(), x);
    const pin = await pinOk(app(), e1.tokenEquipo, x);

    const res = await llamar(app(), 'delete', `/sesion/equipos/${e2.equipoRecordadoId}`, {
      token: pin.token,
      equipo: e1.tokenEquipo,
    });
    expect(res.status).toBe(204);
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: e2.sesion }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(await loginPin(app(), e2.tokenEquipo, x.id, x.pin), 401, 'CREDENCIALES_INVALIDAS');
    expect(await motivoDeRevocacion(e2.equipoId, x.id)).toBe('OLVIDADO');
    // La sesión PIN actual y el otro equipo siguen.
    expect(
      (await llamar(app(), 'get', '/sesion', { token: pin.token, equipo: e1.tokenEquipo })).status,
    ).toBe(200);
    expect((await loginPin(app(), e1.tokenEquipo, x.id, x.pin)).status).toBe(201);

    const filas = (await filasAuditoria(A.id, 'olvidar_equipo')).filter(
      (f) => f.texto.includes(e2.equipoId) && f.texto.includes(x.id),
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.actor_usuario_id).toBe(x.id);
    expect(secretosEn(filas[0]!.texto)).toEqual([]);
  });

  it('olvidar el equipo de la sesión actual también cierra esa sesión (PIN y contraseña)', async () => {
    const x = await personaNueva();
    const y = await personaNueva();
    const e = await equipoCon(app(), [x, y]);
    const pin = await pinOk(app(), e.tokenEquipo, x);

    const res = await llamar(
      app(),
      'delete',
      `/sesion/equipos/${e.porPersona[x.id]!.equipoRecordadoId}`,
      {
        token: pin.token,
        equipo: e.tokenEquipo,
      },
    );
    expect(res.status).toBe(204);
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: pin.token, equipo: e.tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: e.porPersona[x.id]!.sesion }),
      401,
      'NO_AUTENTICADO',
    );
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e.tokenEquipo });
    expect(lista.body.personas.map((p: Libre) => p.usuarioId)).toEqual([y.id]);
    // Y no se ve afectada.
    expect(
      (await llamar(app(), 'get', '/sesion', { token: e.porPersona[y.id]!.sesion })).status,
    ).toBe(200);

    // Con una sesión de contraseña asociada, lo mismo.
    const z = await personaNueva();
    const ez = await nuevoEquipo(app(), z);
    const borrado = await llamar(app(), 'delete', `/sesion/equipos/${ez.equipoRecordadoId}`, {
      token: ez.sesion,
    });
    expect(borrado.status).toBe(204);
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: ez.sesion }),
      401,
      'NO_AUTENTICADO',
    );
  });

  it('un equipo recordado de otra persona, de B o inexistente responde 404 y no cambia nada', async () => {
    const x = await personaNueva();
    const y = await personaNueva();
    const ex = await nuevoEquipo(app(), x);
    const ey = await nuevoEquipo(app(), y);
    const deB = await nuevoEquipo(app(), personaDeB);

    for (const id of [ey.equipoRecordadoId, deB.equipoRecordadoId, randomUUID()]) {
      esperarError(
        await llamar(app(), 'delete', `/sesion/equipos/${id}`, { token: ex.sesion }),
        404,
        'NO_ENCONTRADO',
      );
    }
    expect(await equipoRecordadoActivo(ey.equipoId, y.id)).toBe(true);
    expect(await equipoRecordadoActivo(deB.equipoId, personaDeB.id)).toBe(true);
    expect((await llamar(app(), 'get', '/sesion', { token: ex.sesion })).status).toBe(200);
  });

  it('en una sesión de soporte responde 403 PROHIBIDO', async () => {
    const x = await personaNueva();
    const e = await nuevoEquipo(app(), x);
    const soporte = await sesionDeSoporte(app(), tokenSa, A.id, A.sucursales[0]!.id);
    esperarError(
      await llamar(app(), 'get', '/sesion/equipos', { token: soporte }),
      403,
      'PROHIBIDO',
    );
    esperarError(
      await llamar(app(), 'delete', `/sesion/equipos/${e.equipoRecordadoId}`, { token: soporte }),
      403,
      'PROHIBIDO',
    );
    expect(await equipoRecordadoActivo(e.equipoId, x.id)).toBe(true);
  });
});

describe('criterio 32 · auditoría de recordar', () => {
  it('recordar un equipo deja su fila con la persona y el equipo, sin el token', async () => {
    const x = await personaNueva();
    const e = await nuevoEquipo(app(), x);
    const filas = (await filasAuditoria(A.id, 'recordar_equipo')).filter(
      (f) => f.texto.includes(e.equipoId) && f.texto.includes(x.id),
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.actor_usuario_id).toBe(x.id);
    expect(secretosEn(filas[0]!.texto)).toEqual([]);
    expect(filas[0]!.texto).not.toMatch(CLAVES_SECRETAS);
  });
});

describe('criterio 32b · revocaciones automáticas', () => {
  it('desactivar a un usuario revoca sus equipos con motivo DESACTIVADO; reactivarlo no los recupera', async () => {
    const x = await personaNueva();
    const e1 = await nuevoEquipo(app(), x);
    const e2 = await nuevoEquipo(app(), x);
    const admin = await tokenAdmin(app(), A);

    const res = await llamar(app(), 'patch', `/usuarios/${x.id}`, {
      token: admin,
      cuerpo: { activo: false },
    });
    expect(res.status).toBe(200);
    for (const e of [e1, e2]) {
      expect(await motivoDeRevocacion(e.equipoId, x.id)).toBe('DESACTIVADO');
      esperarError(
        await llamar(app(), 'get', '/sesion', { token: e.sesion }),
        401,
        'NO_AUTENTICADO',
      );
    }
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e1.tokenEquipo });
    expect(lista.body.personas.map((p: Libre) => p.usuarioId)).not.toContain(x.id);

    const reactivar = await llamar(app(), 'patch', `/usuarios/${x.id}`, {
      token: admin,
      cuerpo: { activo: true },
    });
    expect(reactivar.status).toBe(200);
    for (const e of [e1, e2]) {
      expect(await equipoRecordadoActivo(e.equipoId, x.id)).toBe(false);
      esperarError(
        await loginPin(app(), e.tokenEquipo, x.id, x.pin),
        401,
        'CREDENCIALES_INVALIDAS',
      );
    }
    expect(await llamar(app(), 'get', `/usuarios/${x.id}/equipos`, { token: admin })).toMatchObject(
      { body: [] },
    );

    // Los equipos revocados quedan en el detalle de la auditoría de modificar_usuario.
    const filas = (await filasAuditoria(A.id, 'modificar_usuario')).filter(
      (f) => f.entidad_id === x.id || f.texto.includes(x.id),
    );
    const texto = filas.map((f) => f.texto).join('\n');
    expect(texto).toContain(e1.equipoId);
    expect(texto).toContain(e2.equipoId);
  });

  it('restablecer la contraseña revoca sus equipos con motivo CONTRASENA_RESTABLECIDA', async () => {
    const x = await personaNueva();
    const e1 = await nuevoEquipo(app(), x);
    const pin = await pinOk(app(), e1.tokenEquipo, x);
    const admin = await tokenAdmin(app(), A);

    const res = await llamar(app(), 'post', `/usuarios/${x.id}/contrasena`, {
      token: admin,
      cuerpo: { contrasenaTemporal: 'Otra-temporal-2026' },
    });
    expect(res.status).toBe(204);
    expect(await motivoDeRevocacion(e1.equipoId, x.id)).toBe('CONTRASENA_RESTABLECIDA');
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: pin.token, equipo: e1.tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: e1.sesion }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(await loginPin(app(), e1.tokenEquipo, x.id, x.pin), 401, 'CREDENCIALES_INVALIDAS');
    const lista = await llamar(app(), 'get', '/equipo', { equipo: e1.tokenEquipo });
    expect(lista.body.personas).toEqual([]);

    // La persona vuelve a entrar con la contraseña temporal; con ella aún no puede recordar el equipo.
    const { token, sesion } = await loginContrasena(app(), {
      nombreUsuario: x.nombreUsuario,
      contrasena: 'Otra-temporal-2026',
    });
    expect(sesion.debeCambiarContrasena).toBe(true);
    esperarError(
      await llamar(app(), 'post', '/sesion/equipo', { token, equipo: e1.tokenEquipo, cuerpo: {} }),
      403,
      'CAMBIO_CONTRASENA_REQUERIDO',
    );
  });
});

describe('criterio 32 · sin secretos en la auditoría', () => {
  it('ninguna fila de auditoría de la empresa contiene tokens de equipo ni de sesión', async () => {
    const texto = await textoAuditoria(A.id);
    expect(texto.length).toBeGreaterThan(0);
    expect(secretosEn(texto)).toEqual([]);
    expect(texto).not.toMatch(CLAVES_SECRETAS);
  });
});
