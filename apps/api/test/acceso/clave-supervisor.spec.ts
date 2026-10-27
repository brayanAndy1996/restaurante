// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P6 · Criterios 44 a 53 (clave de supervisor): `POST /autorizaciones` con PIN de 6 dígitos y su
// auditoría, PIN rechazado en cada caso del criterio 45 (con la cuenta y la auditoría guardadas
// aunque responda 403), validaciones previas que no cuentan fallo, bloqueo por solicitante y por
// equipo, controlador sonda con `@Permiso` (prohibido, permitido, clave sin y con autorización,
// consumo y auditoría de la acción), autorizaciones inválidas, atomicidad y concurrencia, cambio de
// usuario, soporte y búsqueda del PIN en respuestas, auditoría, autorizaciones y registros.
// Las pruebas de la matriz están en `packages/dominio/test/permisos.spec.ts`.
import { Controller, HttpCode, Post } from '@nestjs/common';
import { autorizacionRespuestaSchema } from '@restaurante/contratos';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Permiso, RequiereSucursal } from '../../src/modulos/seguridad';
import {
  CLAVES_SECRETAS,
  MINUTO,
  altaEmpresa,
  consultar,
  contienePin,
  crearEntorno,
  crearPersona,
  crearSuperadminDePrueba,
  elegirSucursal,
  equipoCon,
  esperarError,
  filasAuditoria,
  ingresarSuperadmin,
  llamar,
  loginContrasena,
  nuevoEquipo,
  pinOk,
  sesionDeSoporte,
  textoAuditoria,
  tokenAdmin,
  type Empresa,
  type Entorno,
  type Persona,
  type Superadmin,
} from './fabrica-equipos';

// ---------------------------------------------------------------------------------------------
// Controlador sonda: rutas marcadas con `@Permiso` (las acciones reales llegan con sus historias)
// ---------------------------------------------------------------------------------------------

const EJECUCIONES = new Map<string, number>();
const ejecuciones = (ruta: string) => EJECUCIONES.get(ruta) ?? 0;
const contar = (ruta: string) => EJECUCIONES.set(ruta, ejecuciones(ruta) + 1);

@Controller('sonda-permiso')
class SondaPermisoController {
  @Post('prohibido')
  @HttpCode(200)
  @RequiereSucursal()
  @Permiso('EDITAR_CARTA')
  prohibido() {
    contar('prohibido');
    return { ejecutado: true };
  }

  @Post('permitido')
  @HttpCode(200)
  @RequiereSucursal()
  @Permiso('ATENDER_MESA')
  permitido() {
    contar('permitido');
    return { ejecutado: true };
  }

  @Post('clave')
  @HttpCode(200)
  @RequiereSucursal()
  @Permiso('ANULAR_ITEM_ENVIADO')
  clave() {
    contar('clave');
    return { ejecutado: true };
  }

  @Post('descuento')
  @HttpCode(200)
  @RequiereSucursal()
  @Permiso('APLICAR_DESCUENTO')
  descuento() {
    contar('descuento');
    return { ejecutado: true };
  }

  /** Falla después de que el interceptor consumió la autorización. */
  @Post('falla')
  @HttpCode(200)
  @RequiereSucursal()
  @Permiso('ANULAR_ITEM_ENVIADO')
  falla() {
    contar('falla');
    throw new Error('Falla de la sonda después de consumir la autorización');
  }

  /** Tarda un poco, para que dos peticiones concurrentes se crucen. */
  @Post('lenta')
  @HttpCode(200)
  @RequiereSucursal()
  @Permiso('ANULAR_ITEM_ENVIADO')
  async lenta() {
    contar('lenta');
    await new Promise<void>((resolver) => setTimeout(resolver, 150));
    return { ejecutado: true };
  }
}

// ---------------------------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------------------------

const MOTIVO = 'El cliente reclamó el plato';
const ACCION = 'ANULAR_ITEM_ENVIADO';

let entorno: Entorno;
let sa: Superadmin;
let A: Empresa;
let B: Empresa;
let supervisor: Persona;
let supervisorS2: Persona;
let supervisorInactivo: Persona;
let cajeroOtro: Persona;
let cajero1: Persona;
let cajeroMulti: Persona;
let mozo: Persona;
let supervisorB: Persona;
let cajeroB: Persona;

const TRAZA: string[] = [];
const PINES_USADOS = new Set<string>();
const LOGS: string[] = [];
const escrituras: { restaurar: () => void }[] = [];

const app = () => entorno.app;
const S1 = () => A.sucursales[0]!.id;
const S2 = () => A.sucursales[1]!.id;
const ahora = () => entorno.reloj.ahora().getTime();
const cerca = (valor: string | Date, esperadoMs: number, tolerancia = 1500) =>
  Math.abs(new Date(valor).getTime() - esperadoMs) <= tolerancia;

const nuevoCajero = () =>
  crearPersona(app(), A, { accesos: [{ sucursalId: S1(), rol: 'CAJERO' }] });

/** `POST /autorizaciones`; guarda la respuesta y el PIN usado para la búsqueda final (criterio 53). */
async function autorizar(
  token: string,
  pin: string,
  extra: {
    accion?: string;
    motivo?: string;
    equipo?: string;
    cuerpo?: Record<string, unknown>;
  } = {},
) {
  PINES_USADOS.add(pin);
  const res = await llamar(app(), 'post', '/autorizaciones', {
    token,
    ...(extra.equipo ? { equipo: extra.equipo } : {}),
    cuerpo: extra.cuerpo ?? { accion: extra.accion ?? ACCION, motivo: extra.motivo ?? MOTIVO, pin },
  });
  TRAZA.push(JSON.stringify({ cuerpo: res.body, cabeceras: res.headers }));
  return res;
}

/** Autorización que debe salir bien. */
async function autorizacionOk(
  token: string,
  pin: string = supervisor.pin,
  extra: { accion?: string; equipo?: string } = {},
): Promise<{ autorizacionId: string; expiraEn: string }> {
  const res = await autorizar(token, pin, extra);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function sonda(ruta: string, token: string, autorizacionId?: string, equipo?: string) {
  const res = await llamar(app(), 'post', `/sonda-permiso/${ruta}`, {
    token,
    ...(equipo ? { equipo } : {}),
    ...(autorizacionId ? { cabeceras: { 'X-Autorizacion': autorizacionId } } : {}),
  });
  TRAZA.push(JSON.stringify({ cuerpo: res.body }));
  return res;
}

const sesionDe = async (persona: Persona) => (await loginContrasena(app(), persona)).token;

function pinInexistente(): string {
  const conocidos = new Set([
    supervisor.pin,
    supervisorS2.pin,
    supervisorInactivo.pin,
    cajeroOtro.pin,
    cajero1.pin,
    cajeroMulti.pin,
    supervisorB.pin,
    cajeroB.pin,
    A.admin.pin,
    B.admin.pin,
  ]);
  for (;;) {
    const pin = String(randomInt(100_000, 1_000_000));
    if (!conocidos.has(pin)) return pin;
  }
}

beforeAll(async () => {
  // Captura lo que la API escriba en su registro (criterio 53). Se instala antes de crearla.
  for (const flujo of [process.stdout, process.stderr]) {
    const espia = vi.spyOn(flujo, 'write').mockImplementation(((trozo: unknown) => {
      LOGS.push(typeof trozo === 'string' ? trozo : Buffer.from(trozo as Uint8Array).toString());
      return true;
    }) as typeof flujo.write);
    escrituras.push({ restaurar: () => espia.mockRestore() });
  }
  entorno = await crearEntorno({
    controladoresExtra: [SondaPermisoController],
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  sa = await crearSuperadminDePrueba();
  const tokenSa = await ingresarSuperadmin(app(), sa);
  A = await altaEmpresa(app(), tokenSa, { sucursales: 3 });
  B = await altaEmpresa(app(), tokenSa, { sucursales: 2 });
  const en = (rol: 'CAJERO' | 'MOZO' | 'SUPERVISOR', ...indices: number[]) =>
    crearPersona(app(), A, {
      accesos: indices.map((i) => ({ sucursalId: A.sucursales[i]!.id, rol })),
    });
  supervisor = await en('SUPERVISOR', 0);
  supervisorS2 = await en('SUPERVISOR', 1);
  supervisorInactivo = await en('SUPERVISOR', 0);
  cajeroOtro = await en('CAJERO', 0);
  cajero1 = await en('CAJERO', 0);
  cajeroMulti = await en('CAJERO', 0, 1);
  mozo = await en('MOZO', 0);
  supervisorB = await crearPersona(app(), B, {
    accesos: [{ sucursalId: B.sucursales[0]!.id, rol: 'SUPERVISOR' }],
  });
  cajeroB = await crearPersona(app(), B, {
    accesos: [{ sucursalId: B.sucursales[0]!.id, rol: 'CAJERO' }],
  });
  // El Supervisor inactivo conserva su PIN pero ya no puede autorizar.
  const desactivar = await llamar(app(), 'patch', `/usuarios/${supervisorInactivo.id}`, {
    token: await tokenAdmin(app(), A),
    cuerpo: { activo: false },
  });
  expect(desactivar.status).toBe(200);
}, 180_000);

afterAll(async () => {
  await entorno?.cerrar();
  for (const e of escrituras) e.restaurar();
});

// ---------------------------------------------------------------------------------------------
// Criterio 44
// ---------------------------------------------------------------------------------------------

describe('criterio 44 · autorizar', () => {
  it('un Cajero obtiene una autorización de 2 minutos con el PIN de un Supervisor, y queda auditada', async () => {
    const c = await nuevoCajero();
    const token = await sesionDe(c);
    const res = await autorizar(token, supervisor.pin);
    expect(res.status).toBe(201);
    const cuerpo = autorizacionRespuestaSchema.parse(res.body);
    expect(cuerpo.accion).toBe(ACCION);
    expect(cuerpo.autorizadoPor).toEqual({ id: supervisor.id, nombre: supervisor.nombre });
    expect(cerca(cuerpo.expiraEn, ahora() + 2 * MINUTO)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(supervisor.pin);

    // El solicitante es nuevo: su única autorización deja exactamente una fila.
    const filas = (await filasAuditoria(A.id, 'autorizacion_otorgada')).filter(
      (f) => f.actor_usuario_id === c.id,
    );
    expect(filas).toHaveLength(1);
    const fila = filas[0]!;
    expect(fila.actor_usuario_id).toBe(c.id);
    expect(fila.autorizado_por_id).toBe(supervisor.id);
    expect(fila.motivo).toBe(MOTIVO);
    expect(fila.sucursal_id).toBe(S1());
    expect(fila.texto).toContain(ACCION);
    expect(cerca(fila.ocurrido_en, ahora())).toBe(true);

    const [guardada] = await consultar(
      `SELECT solicitante_id, autorizador_id, usada_en FROM autorizacion WHERE id = $1`,
      [cuerpo.autorizacionId],
    );
    expect(guardada).toMatchObject({
      solicitante_id: c.id,
      autorizador_id: supervisor.id,
      usada_en: null,
    });
  });

  it('el Administrador también autoriza con su PIN; el Supervisor no necesita que el equipo lo recuerde', async () => {
    const c = await nuevoCajero();
    const token = await sesionDe(c);
    const res = await autorizar(token, A.admin.pin);
    expect(res.status).toBe(201);
    expect(res.body.autorizadoPor.id).toBe(A.admin.id);
    const equiposDelSupervisor = await consultar(
      `SELECT 1 FROM equipo_recordado WHERE usuario_id = $1`,
      [supervisor.id],
    );
    expect(equiposDelSupervisor).toHaveLength(0);
  });

  it('registra el equipo de la sesión del solicitante', async () => {
    const c = await nuevoCajero();
    const equipo = await nuevoEquipo(app(), c);
    const res = await autorizar(equipo.sesion, supervisor.pin);
    expect(res.status).toBe(201);
    const fila = (await filasAuditoria(A.id, 'autorizacion_otorgada')).find(
      (f) => f.actor_usuario_id === c.id,
    )!;
    expect(fila.equipo_id).toBe(equipo.equipoId);
    const [guardada] = await consultar(`SELECT equipo_id FROM autorizacion WHERE id = $1`, [
      res.body.autorizacionId,
    ]);
    expect(guardada!.equipo_id).toBe(equipo.equipoId);
  });

  it('un Mozo (acción con clave) y una sesión PIN también pueden pedir la autorización', async () => {
    const mozoSesion = await sesionDe(mozo);
    expect((await autorizar(mozoSesion, supervisor.pin)).status).toBe(201);

    const c = await nuevoCajero();
    const equipo = await nuevoEquipo(app(), c);
    const pin = await pinOk(app(), equipo.tokenEquipo, c);
    const res = await autorizar(pin.token, supervisor.pin, { equipo: equipo.tokenEquipo });
    expect(res.status).toBe(201);
  });

  it('exige sesión', async () => {
    const res = await llamar(app(), 'post', '/autorizaciones', {
      cuerpo: { accion: ACCION, motivo: MOTIVO, pin: supervisor.pin },
    });
    esperarError(res, 401, 'NO_AUTENTICADO');
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 45
// ---------------------------------------------------------------------------------------------

describe('criterio 45 · PIN rechazado', () => {
  it('responde 403 CLAVE_INVALIDA con el mismo cuerpo, sin autorización, y deja su fila de auditoría', async () => {
    const c = await nuevoCajero();
    const token = await sesionDe(c);
    const casos: { quien: string; pin: string }[] = [
      { quien: 'PIN inexistente', pin: pinInexistente() },
      { quien: 'PIN de un Cajero', pin: cajeroOtro.pin },
      { quien: 'PIN de un Supervisor de otra sucursal', pin: supervisorS2.pin },
      { quien: 'PIN de un usuario inactivo', pin: supervisorInactivo.pin },
      { quien: 'PIN de un Supervisor de B', pin: supervisorB.pin },
      { quien: 'PIN del propio solicitante', pin: c.pin },
    ];
    const rechazosDe = async () =>
      (await filasAuditoria(A.id, 'autorizacion_rechazada')).filter(
        (f) => f.actor_usuario_id === c.id,
      );
    const creadasDe = async () =>
      (await consultar(`SELECT 1 FROM autorizacion WHERE solicitante_id = $1`, [c.id])).length;

    const cuerpos: unknown[] = [];
    for (const { quien, pin } of casos) {
      const rechazosAntes = (await rechazosDe()).length;
      const creadasAntes = await creadasDe();
      const res = await autorizar(token, pin);
      expect(res.status, quien).toBe(403);
      expect(res.body.codigo, quien).toBe('CLAVE_INVALIDA');
      expect(JSON.stringify(res.body), quien).not.toContain(pin);
      cuerpos.push(res.body);

      // No se creó ninguna autorización y quedó la fila de auditoría del rechazo (guardada aunque haya error).
      expect(await creadasDe(), quien).toBe(creadasAntes);
      const rechazos = await rechazosDe();
      expect(rechazos, quien).toHaveLength(rechazosAntes + 1);
      const fila = rechazos[rechazos.length - 1]!;
      expect(fila.motivo, quien).toBe(MOTIVO);
      expect(fila.texto, quien).toContain(ACCION);
      expect(contienePin(fila.texto, pin), quien).toBe(false);
      expect(fila.texto, quien).not.toMatch(CLAVES_SECRETAS);

      // Una autorización correcta reinicia la cuenta, para que el siguiente caso no se bloquee.
      await autorizacionOk(token);
    }
    for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
  });

  it('cada rechazo cuenta un fallo y se guarda aunque la respuesta sea un error', async () => {
    const c = await nuevoCajero();
    const token = await sesionDe(c);
    for (let i = 0; i < 3; i++) {
      esperarError(await autorizar(token, pinInexistente()), 403, 'CLAVE_INVALIDA');
    }
    const rechazos = (await filasAuditoria(A.id, 'autorizacion_rechazada')).filter(
      (f) => f.actor_usuario_id === c.id,
    );
    expect(rechazos).toHaveLength(3);
    // La cuenta quedó guardada: dos fallos más (5 en total) bloquean.
    esperarError(await autorizar(token, pinInexistente()), 403, 'CLAVE_INVALIDA');
    esperarError(await autorizar(token, pinInexistente()), 403, 'CLAVE_INVALIDA');
    esperarError(await autorizar(token, supervisor.pin), 429, 'BLOQUEO_TEMPORAL');
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 46
// ---------------------------------------------------------------------------------------------

describe('criterio 46 · validaciones previas (no cuentan fallo)', () => {
  it('acción desconocida, PIN que no tiene 6 dígitos y motivo inválido responden 400 sin contar ni auditar', async () => {
    const c = await nuevoCajero();
    const token = await sesionDe(c);
    const valido = { accion: ACCION, motivo: MOTIVO, pin: supervisor.pin };
    const cuerpos: Record<string, unknown>[] = [
      { ...valido, accion: 'NO_EXISTE' },
      { ...valido, accion: undefined },
      { ...valido, pin: '1234' }, // 4 dígitos
      { ...valido, pin: mozo.pin },
      { ...valido, pin: '12345' },
      { ...valido, pin: '1234567' },
      { ...valido, pin: 'abcdef' },
      { ...valido, pin: 123456 },
      { ...valido, pin: undefined },
      { ...valido, motivo: '' },
      { ...valido, motivo: '   ' },
      { ...valido, motivo: 'x'.repeat(301) },
      { ...valido, motivo: 'con\u0000nul' },
      { ...valido, motivo: 'suelto\uD800' },
      { ...valido, motivo: undefined },
      { ...valido, extra: 'campo desconocido' },
    ];
    for (const cuerpo of cuerpos) {
      const res = await autorizar(token, supervisor.pin, { cuerpo });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    // 16 validaciones fallidas no bloquean ni cuentan: la autorización correcta sale.
    expect((await autorizar(token, supervisor.pin)).status).toBe(201);
    const rechazos = (await filasAuditoria(A.id, 'autorizacion_rechazada')).filter(
      (f) => f.actor_usuario_id === c.id,
    );
    expect(rechazos).toHaveLength(0);
  });

  it('una acción prohibida para el rol responde 403 PROHIBIDO y una permitida, 409 CLAVE_INNECESARIA, sin contar', async () => {
    const c = await nuevoCajero();
    const token = await sesionDe(c);
    for (let i = 0; i < 6; i++) {
      esperarError(
        await autorizar(token, supervisor.pin, { accion: 'EDITAR_CARTA' }),
        403,
        'PROHIBIDO',
      );
      esperarError(
        await autorizar(token, supervisor.pin, { accion: 'ATENDER_MESA' }),
        409,
        'CLAVE_INNECESARIA',
      );
    }
    expect((await autorizar(token, supervisor.pin)).status).toBe(201);
    const creadas = await consultar(`SELECT 1 FROM autorizacion WHERE solicitante_id = $1`, [c.id]);
    expect(creadas).toHaveLength(1);
    const rechazos = (await filasAuditoria(A.id, 'autorizacion_rechazada')).filter(
      (f) => f.actor_usuario_id === c.id,
    );
    expect(rechazos).toHaveLength(0);
  });

  it('una sesión sin sucursal activa responde 409 SUCURSAL_NO_ELEGIDA', async () => {
    const token = await sesionDe(cajeroMulti);
    const res = await autorizar(token, supervisor.pin);
    esperarError(res, 409, 'SUCURSAL_NO_ELEGIDA');
    expect(
      (await filasAuditoria(A.id, 'autorizacion_rechazada')).filter(
        (f) => f.actor_usuario_id === cajeroMulti.id,
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 47
// ---------------------------------------------------------------------------------------------

describe('criterio 47 · bloqueo', () => {
  it('5 fallos seguidos del mismo solicitante lo bloquean 5 minutos en cualquier equipo, sin evaluar el PIN', async () => {
    const c = await nuevoCajero();
    const otra = await nuevoCajero();
    const token = await sesionDe(c);
    for (let i = 0; i < 5; i++) {
      esperarError(await autorizar(token, pinInexistente()), 403, 'CLAVE_INVALIDA');
    }
    const bloqueada = await autorizar(token, supervisor.pin);
    esperarError(bloqueada, 429, 'BLOQUEO_TEMPORAL');
    expect(bloqueada.body.reintentarEnSegundos).toBeGreaterThan(0);
    expect(bloqueada.body.reintentarEnSegundos).toBeLessThanOrEqual(300);
    expect(
      await consultar(`SELECT 1 FROM autorizacion WHERE solicitante_id = $1`, [c.id]),
    ).toHaveLength(0);

    // También desde otra sesión (otro equipo) de la misma persona.
    const enOtroEquipo = await nuevoEquipo(app(), c);
    esperarError(await autorizar(enOtroEquipo.sesion, supervisor.pin), 429, 'BLOQUEO_TEMPORAL');
    // Otra persona no se ve afectada.
    expect((await autorizar(await sesionDe(otra), supervisor.pin)).status).toBe(201);

    const bloqueos = (await filasAuditoria(A.id, 'bloqueo_clave')).filter((f) =>
      f.texto.includes(c.id),
    );
    expect(bloqueos.length).toBeGreaterThanOrEqual(1);
    expect(bloqueos[0]!.texto).not.toMatch(CLAVES_SECRETAS);
    for (const pin of PINES_USADOS)
      if (pin.length === 6) expect(contienePin(bloqueos[0]!.texto, pin)).toBe(false);

    // Pasados los 5 minutos, vuelve a funcionar.
    entorno.reloj.avanzar(5 * MINUTO + 1000);
    expect((await autorizar(await sesionDe(c), supervisor.pin)).status).toBe(201);
  });

  it('5 fallos seguidos en el mismo equipo (de cualquier solicitante) bloquean a todos los de ese equipo', async () => {
    const [c1, c2, c3, libre] = [
      await nuevoCajero(),
      await nuevoCajero(),
      await nuevoCajero(),
      await nuevoCajero(),
    ] as [Persona, Persona, Persona, Persona];
    const equipo = await equipoCon(app(), [c1, c2, c3]);
    const t = (p: Persona) => equipo.porPersona[p.id]!.sesion;
    for (const solicitante of [c1, c2, c1, c2, c1]) {
      esperarError(await autorizar(t(solicitante), pinInexistente()), 403, 'CLAVE_INVALIDA');
    }
    // c3 no falló nunca, pero su sesión es de ese equipo.
    esperarError(await autorizar(t(c3), supervisor.pin), 429, 'BLOQUEO_TEMPORAL');
    expect(
      await consultar(`SELECT 1 FROM autorizacion WHERE solicitante_id = $1`, [c3.id]),
    ).toHaveLength(0);
    // Quien no tiene equipo, o está en otro, no se ve afectado.
    expect((await autorizar(await sesionDe(libre), supervisor.pin)).status).toBe(201);
    const otroEquipo = await nuevoEquipo(app(), libre);
    expect((await autorizar(otroEquipo.sesion, supervisor.pin)).status).toBe(201);

    const bloqueos = (await filasAuditoria(A.id, 'bloqueo_clave')).filter((f) =>
      f.texto.includes(equipo.equipoId),
    );
    expect(bloqueos.length).toBeGreaterThanOrEqual(1);

    entorno.reloj.avanzar(5 * MINUTO + 1000);
    expect((await autorizar(t(c3), supervisor.pin)).status).toBe(201);
  });

  it('una autorización correcta reinicia la cuenta del solicitante', async () => {
    const c = await nuevoCajero();
    const token = await sesionDe(c);
    for (let ronda = 0; ronda < 2; ronda++) {
      for (let i = 0; i < 4; i++) {
        esperarError(await autorizar(token, pinInexistente()), 403, 'CLAVE_INVALIDA');
      }
      expect((await autorizar(token, supervisor.pin)).status).toBe(201);
    }
  });

  it('una autorización correcta reinicia también la cuenta del equipo', async () => {
    const [c1, c2, c3] = [await nuevoCajero(), await nuevoCajero(), await nuevoCajero()] as [
      Persona,
      Persona,
      Persona,
    ];
    const equipo = await equipoCon(app(), [c1, c2, c3]);
    const t = (p: Persona) => equipo.porPersona[p.id]!.sesion;
    const fallar = async (p: Persona, veces: number) => {
      for (let i = 0; i < veces; i++) {
        esperarError(await autorizar(t(p), pinInexistente()), 403, 'CLAVE_INVALIDA');
      }
    };
    await fallar(c1, 2);
    await fallar(c2, 2); // el equipo lleva 4 fallos
    expect((await autorizar(t(c1), supervisor.pin)).status).toBe(201); // reinicia el equipo
    await fallar(c3, 2);
    await fallar(c2, 2); // sin el reinicio serían 8 en el equipo; con él, 4
    expect((await autorizar(t(c3), supervisor.pin)).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 48
// ---------------------------------------------------------------------------------------------

describe('criterio 48 · consumo en la acción (@Permiso)', () => {
  it('prohibido para el rol: 403 PROHIBIDO y la acción no se ejecuta', async () => {
    const token = await sesionDe(cajero1);
    const antes = ejecuciones('prohibido');
    esperarError(await sonda('prohibido', token), 403, 'PROHIBIDO');
    const { autorizacionId } = await autorizacionOk(token);
    esperarError(await sonda('prohibido', token, autorizacionId), 403, 'PROHIBIDO');
    expect(ejecuciones('prohibido')).toBe(antes);
  });

  it('permitido: se ejecuta sin autorización', async () => {
    const token = await sesionDe(cajero1);
    const antes = ejecuciones('permitido');
    const res = await sonda('permitido', token);
    expect(res.status).toBe(200);
    expect(ejecuciones('permitido')).toBe(antes + 1);
  });

  it('con clave y sin X-Autorizacion: 403 CLAVE_REQUERIDA y no se ejecuta', async () => {
    const token = await sesionDe(cajero1);
    const antes = ejecuciones('clave');
    esperarError(await sonda('clave', token), 403, 'CLAVE_REQUERIDA');
    expect(ejecuciones('clave')).toBe(antes);
  });

  it('con una autorización válida se ejecuta, la deja usada y audita la acción con quién pidió y quién autorizó', async () => {
    const token = await sesionDe(cajero1);
    const antes = ejecuciones('clave');
    const { autorizacionId } = await autorizacionOk(token);
    const res = await sonda('clave', token, autorizacionId);
    expect(res.status).toBe(200);
    expect(ejecuciones('clave')).toBe(antes + 1);

    const [guardada] = await consultar(`SELECT usada_en FROM autorizacion WHERE id = $1`, [
      autorizacionId,
    ]);
    expect(guardada!.usada_en).not.toBeNull();
    expect(cerca(guardada!.usada_en, ahora())).toBe(true);

    const filas = (await filasAuditoria(A.id, ACCION)).filter(
      (f) => f.autorizacion_id === autorizacionId,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_usuario_id: cajero1.id,
      autorizado_por_id: supervisor.id,
      motivo: MOTIVO,
      sucursal_id: S1(),
    });
    expect(cerca(filas[0]!.ocurrido_en, ahora())).toBe(true);
  });

  it('un Supervisor (permitido) ejecuta la acción sin autorización, y un Mozo la ejecuta con la suya', async () => {
    const supervisorSesion = await sesionDe(supervisor);
    const antes = ejecuciones('clave');
    expect((await sonda('clave', supervisorSesion)).status).toBe(200);
    const mozoSesion = await sesionDe(mozo);
    const { autorizacionId } = await autorizacionOk(mozoSesion);
    expect((await sonda('clave', mozoSesion, autorizacionId)).status).toBe(200);
    expect(ejecuciones('clave')).toBe(antes + 2);
    const filas = (await filasAuditoria(A.id, ACCION)).filter(
      (f) => f.autorizacion_id === autorizacionId,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.actor_usuario_id).toBe(mozo.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 49
// ---------------------------------------------------------------------------------------------

describe('criterio 49 · autorización inválida', () => {
  it('usada, vencida, de otra acción, de otra sesión, de otra sucursal, de B o inexistente: 403 AUTORIZACION_INVALIDA idéntico', async () => {
    const cuerpos: unknown[] = [];
    const invalida = async (que: string, ruta: string, token: string, id: string) => {
      const antes = ejecuciones(ruta);
      const res = await sonda(ruta, token, id);
      expect(res.status, que).toBe(403);
      expect(res.body.codigo, que).toBe('AUTORIZACION_INVALIDA');
      expect(ejecuciones(ruta), que).toBe(antes);
      cuerpos.push(res.body);
    };

    const token = await sesionDe(cajero1);
    // Ya usada.
    const usada = await autorizacionOk(token);
    expect((await sonda('clave', token, usada.autorizacionId)).status).toBe(200);
    await invalida('usada', 'clave', token, usada.autorizacionId);

    // Vencida: ahora >= expiraEn (a los 2 minutos exactos ya no vale; a 1 min 59 s sí).
    const aTiempo = await autorizacionOk(token);
    entorno.reloj.avanzar(2 * MINUTO - 1000);
    expect((await sonda('clave', token, aTiempo.autorizacionId)).status).toBe(200);
    const vencida = await autorizacionOk(token);
    entorno.reloj.avanzar(2 * MINUTO);
    await invalida('vencida', 'clave', token, vencida.autorizacionId);

    // De otra acción.
    const deAnular = await autorizacionOk(token);
    await invalida('otra acción', 'descuento', token, deAnular.autorizacionId);
    expect((await sonda('clave', token, deAnular.autorizacionId)).status).toBe(200); // no se consumió

    // De otra sesión: la del mismo usuario en otro equipo, y la de otro Cajero.
    const e1 = await nuevoEquipo(app(), cajero1);
    const e2 = await nuevoEquipo(app(), cajero1);
    const deE1 = await autorizacionOk(e1.sesion);
    await invalida(
      'mismo usuario, otra sesión (otro equipo)',
      'clave',
      e2.sesion,
      deE1.autorizacionId,
    );
    await invalida(
      'mismo usuario, otra sesión (sin equipo)',
      'clave',
      await sesionDe(cajero1),
      deE1.autorizacionId,
    );
    await invalida('otro Cajero', 'clave', await sesionDe(cajeroOtro), deE1.autorizacionId);
    expect((await sonda('clave', e1.sesion, deE1.autorizacionId)).status).toBe(200); // la suya sí

    // De otra sucursal: se pidió en S1 y se usa en S2 (mismo usuario y misma sesión).
    const multi = await sesionDe(cajeroMulti);
    expect((await elegirSucursal(app(), multi, S1())).status).toBe(200);
    const deS1 = await autorizacionOk(multi);
    expect((await elegirSucursal(app(), multi, S2())).status).toBe(200);
    await invalida('otra sucursal', 'clave', multi, deS1.autorizacionId);
    expect((await elegirSucursal(app(), multi, S1())).status).toBe(200);
    expect((await sonda('clave', multi, deS1.autorizacionId)).status).toBe(200);

    // De B: una autorización real de B usada en A.
    const sesionB = await sesionDe(cajeroB);
    const deB = await autorizacionOk(sesionB, supervisorB.pin);
    await invalida('de B', 'clave', token, deB.autorizacionId);

    // Inexistente.
    await invalida('inexistente', 'clave', token, randomUUID());

    for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 50
// ---------------------------------------------------------------------------------------------

describe('criterio 50 · atomicidad y concurrencia', () => {
  it('si la acción falla después de consumir la autorización se revierten el consumo y la auditoría', async () => {
    const token = await sesionDe(cajero1);
    const { autorizacionId, expiraEn } = await autorizacionOk(token);
    const antes = ejecuciones('falla');
    const res = await sonda('falla', token, autorizacionId);
    expect(res.status).toBe(500);
    expect(ejecuciones('falla')).toBe(antes + 1);

    const [guardada] = await consultar(
      `SELECT usada_en, expira_en FROM autorizacion WHERE id = $1`,
      [autorizacionId],
    );
    expect(guardada!.usada_en).toBeNull();
    expect(new Date(guardada!.expira_en).toISOString()).toBe(expiraEn);
    const filas = (await filasAuditoria(A.id, ACCION)).filter(
      (f) => f.autorizacion_id === autorizacionId,
    );
    expect(filas).toHaveLength(0);

    // Sigue disponible hasta que venza.
    const bien = await sonda('clave', token, autorizacionId);
    expect(bien.status).toBe(200);
  });

  it('dos peticiones concurrentes con la misma autorización: exactamente una se ejecuta', async () => {
    const token = await sesionDe(cajero1);
    const { autorizacionId } = await autorizacionOk(token);
    const antes = ejecuciones('lenta');
    const respuestas = await Promise.all(
      [1, 2, 3, 4].map(() => sonda('lenta', token, autorizacionId)),
    );
    const exitosas = respuestas.filter((r) => r.status === 200);
    const rechazadas = respuestas.filter((r) => r.status !== 200);
    expect(exitosas).toHaveLength(1);
    expect(rechazadas).toHaveLength(3);
    for (const r of rechazadas) esperarError(r, 403, 'AUTORIZACION_INVALIDA');
    expect(ejecuciones('lenta')).toBe(antes + 1);
    const filas = (await filasAuditoria(A.id, ACCION)).filter(
      (f) => f.autorizacion_id === autorizacionId,
    );
    expect(filas).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 51
// ---------------------------------------------------------------------------------------------

describe('criterio 51 · cambio de usuario', () => {
  it('al cerrarse la sesión (cambio rápido, salida, revocación del equipo) sus autorizaciones sin usar ya no sirven', async () => {
    const c = await nuevoCajero();
    const equipo = await nuevoEquipo(app(), c);

    // Cambio rápido: la misma persona entra de nuevo con PIN y cierra la sesión anterior.
    const primera = await pinOk(app(), equipo.tokenEquipo, c);
    const deLaPrimera = await autorizacionOk(primera.token, supervisor.pin, {
      equipo: equipo.tokenEquipo,
    });
    const segunda = await pinOk(app(), equipo.tokenEquipo, c);
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: primera.token, equipo: equipo.tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );
    const reutilizada = await sonda(
      'clave',
      segunda.token,
      deLaPrimera.autorizacionId,
      equipo.tokenEquipo,
    );
    esperarError(reutilizada, 403, 'AUTORIZACION_INVALIDA');

    // Salida: DELETE /sesion y una sesión nueva.
    const deLaSegunda = await autorizacionOk(segunda.token, supervisor.pin, {
      equipo: equipo.tokenEquipo,
    });
    expect(
      (
        await llamar(app(), 'delete', '/sesion', {
          token: segunda.token,
          equipo: equipo.tokenEquipo,
        })
      ).status,
    ).toBe(204);
    const tercera = await pinOk(app(), equipo.tokenEquipo, c);
    esperarError(
      await sonda('clave', tercera.token, deLaSegunda.autorizacionId, equipo.tokenEquipo),
      403,
      'AUTORIZACION_INVALIDA',
    );

    // Revocación del equipo: se cierra la sesión asociada y su autorización deja de servir.
    const deLaSesionDeContrasena = await autorizacionOk(equipo.sesion);
    const revocar = await llamar(
      app(),
      'delete',
      `/usuarios/${c.id}/equipos/${equipo.equipoRecordadoId}`,
      {
        token: await tokenAdmin(app(), A),
      },
    );
    expect(revocar.status).toBe(204);
    esperarError(
      await llamar(app(), 'get', '/sesion', { token: equipo.sesion }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(
      await sonda('clave', await sesionDe(c), deLaSesionDeContrasena.autorizacionId),
      403,
      'AUTORIZACION_INVALIDA',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 52
// ---------------------------------------------------------------------------------------------

describe('criterio 52 · soporte', () => {
  it('una sesión de soporte tiene las acciones protegidas como permitidas y POST /autorizaciones responde 409', async () => {
    const soporte = await sesionDeSoporte(app(), await ingresarSuperadmin(app(), sa), A.id, S1());
    const res = await autorizar(soporte, supervisor.pin);
    esperarError(res, 409, 'CLAVE_INNECESARIA');
    expect(
      await consultar(
        `SELECT 1 FROM autorizacion WHERE sesion_id IN (SELECT id FROM sesion WHERE tipo = 'SOPORTE' AND empresa_id = $1)`,
        [A.id],
      ),
    ).toHaveLength(0);

    const antes = ejecuciones('clave');
    expect((await sonda('clave', soporte)).status).toBe(200);
    expect(ejecuciones('clave')).toBe(antes + 1);
    // EDITAR_CARTA es permitido al Administrador, y la sesión de soporte lo es.
    expect((await sonda('prohibido', soporte)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 53
// ---------------------------------------------------------------------------------------------

describe('criterio 53 · el PIN no se guarda', () => {
  it('ni el PIN ni su huella aparecen en respuestas, auditoría, autorizaciones ni registros de la API', async () => {
    const auditoria = await textoAuditoria(A.id);
    const autorizaciones = (
      await consultar<{ texto: string }>(
        `SELECT row_to_json(a)::text AS texto FROM autorizacion a WHERE a.empresa_id = $1`,
        [A.id],
      )
    )
      .map((f) => f.texto)
      .join('\n');
    const respuestas = TRAZA.join('\n');
    const registros = LOGS.join('');
    expect(auditoria.length).toBeGreaterThan(0);
    expect(autorizaciones.length).toBeGreaterThan(0);

    const pines = new Set<string>([
      ...[...PINES_USADOS].filter((pin) => pin.length === 6),
      supervisor.pin,
      supervisorS2.pin,
      supervisorInactivo.pin,
      cajeroOtro.pin,
      A.admin.pin,
    ]);
    const huellas = (
      await consultar<{ huella: string }>(
        `SELECT encode(huella_pin, 'hex') AS huella FROM usuario WHERE empresa_id = $1`,
        [A.id],
      )
    ).map((f) => f.huella);
    expect(huellas.length).toBeGreaterThan(0);

    const textos: Record<string, string> = { auditoria, autorizaciones, respuestas, registros };
    for (const [donde, texto] of Object.entries(textos)) {
      for (const pin of pines) {
        expect(contienePin(texto, pin), `${donde} contiene el PIN ${pin.slice(0, 1)}*****`).toBe(
          false,
        );
      }
      for (const huella of huellas) {
        expect(
          texto.toLowerCase().includes(huella.toLowerCase()),
          `${donde} contiene una huella`,
        ).toBe(false);
      }
    }
    expect(auditoria).not.toMatch(CLAVES_SECRETAS);
    expect(autorizaciones).not.toMatch(CLAVES_SECRETAS);
  });
});
