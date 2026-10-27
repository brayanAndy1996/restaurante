// Pruebas del desarrollador (no protegidas) de T38: lo que `test/acceso/clave-supervisor.spec.ts` no alcanza.
// Idempotencia de `POST /autorizaciones`, intentos concurrentes que no evaden el quinto fallo, el actor de las
// filas de auditoría (solicitante en el rechazo, `autenticacion` en el bloqueo), la acción que se audita con la
// autorización consumida y la migración de autorizaciones (subir, bajar con datos y volver a subir). App real
// con `RelojManual`, sin `EMPRESA_POR_HEADER`.
import { Controller, HttpCode, Post } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enTransaccion } from '../aislamiento/fabrica';
import {
  crearBaseNueva,
  migracionesEjecutadas,
  migrarHasta,
  revertirHasta,
} from '../acceso/fabrica-plataforma';
import {
  MINUTO,
  altaEmpresa,
  consultar,
  crearEntorno,
  crearPersona,
  crearSuperadminDePrueba,
  esperarError,
  filasAuditoria,
  ingresarSuperadmin,
  llamar,
  loginContrasena,
  nuevoEquipo,
  type Empresa,
  type Entorno,
  type Persona,
} from '../acceso/fabrica-equipos';
import { Permiso, RequiereSucursal } from '../../src/modulos/seguridad';
import { abrirCliente } from '../utilidades';

const PREFIJO_AUTORIZACIONES = '202610280006';
const ACCION = 'ANULAR_ITEM_ENVIADO';
const MOTIVO = 'El cliente reclamó el plato';

@Controller('sonda-clave')
class SondaClaveController {
  @Post('anular')
  @HttpCode(200)
  @RequiereSucursal()
  @Permiso('ANULAR_ITEM_ENVIADO')
  anular() {
    return { ejecutado: true };
  }
}

let entorno: Entorno;
let A: Empresa;
let supervisor: Persona;

const app = () => entorno.app;
const S1 = () => A.sucursales[0]!.id;
const cajero = () => crearPersona(app(), A, { accesos: [{ sucursalId: S1(), rol: 'CAJERO' }] });
const pinInexistente = () => {
  for (;;) {
    const pin = String(randomInt(100_000, 1_000_000));
    if (pin !== supervisor.pin && pin !== A.admin.pin) return pin;
  }
};
const autorizar = (
  token: string,
  pin: string,
  cabeceras: Record<string, string> = {},
  accion = ACCION,
) =>
  llamar(app(), 'post', '/autorizaciones', {
    token,
    cabeceras,
    cuerpo: { accion, motivo: MOTIVO, pin },
  });
const sesionDe = async (p: Persona) => (await loginContrasena(app(), p)).token;

beforeAll(async () => {
  entorno = await crearEntorno({ controladoresExtra: [SondaClaveController] });
  const sa = await crearSuperadminDePrueba();
  A = await altaEmpresa(app(), await ingresarSuperadmin(app(), sa));
  supervisor = await crearPersona(app(), A, {
    accesos: [{ sucursalId: S1(), rol: 'SUPERVISOR' }],
  });
}, 120_000);

afterAll(async () => {
  await entorno?.cerrar();
});

describe('POST /autorizaciones · idempotencia (criterio 85)', () => {
  it('la misma clave con el mismo cuerpo devuelve la misma autorización y no crea otra', async () => {
    const c = await cajero();
    const token = await sesionDe(c);
    const clave = randomUUID();
    const primera = await autorizar(token, supervisor.pin, { 'Idempotency-Key': clave });
    const segunda = await autorizar(token, supervisor.pin, { 'Idempotency-Key': clave });
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primera.body);
    const filas = await consultar(`SELECT 1 FROM autorizacion WHERE solicitante_id = $1`, [c.id]);
    expect(filas).toHaveLength(1);
    const otorgadas = (await filasAuditoria(A.id, 'autorizacion_otorgada')).filter(
      (f) => f.actor_usuario_id === c.id,
    );
    expect(otorgadas).toHaveLength(1);
  });

  it('la misma clave con otro cuerpo responde 422 y la de otra persona no se mezcla', async () => {
    const [c, d] = [await cajero(), await cajero()];
    const [tc, td] = [await sesionDe(c), await sesionDe(d)];
    const clave = randomUUID();
    expect((await autorizar(tc, supervisor.pin, { 'Idempotency-Key': clave })).status).toBe(201);
    esperarError(
      await autorizar(tc, supervisor.pin, { 'Idempotency-Key': clave }, 'APLICAR_DESCUENTO'),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    esperarError(
      await autorizar(td, supervisor.pin, { 'Idempotency-Key': clave }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
  });

  it('una respuesta de error no se guarda: la clave sirve después con el PIN correcto', async () => {
    const c = await cajero();
    const token = await sesionDe(c);
    const clave = randomUUID();
    esperarError(
      await autorizar(token, pinInexistente(), { 'Idempotency-Key': clave }),
      403,
      'CLAVE_INVALIDA',
    );
    const reintento = await autorizar(token, supervisor.pin, { 'Idempotency-Key': clave });
    expect(reintento.status).toBe(201);
  });

  it('peticiones simultáneas con la misma clave crean una sola autorización', async () => {
    const c = await cajero();
    const token = await sesionDe(c);
    const clave = randomUUID();
    const respuestas = await Promise.all(
      [1, 2, 3].map(() => autorizar(token, supervisor.pin, { 'Idempotency-Key': clave })),
    );
    expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(respuestas.map((r) => r.body.autorizacionId)).size).toBe(1);
    expect(
      await consultar(`SELECT 1 FROM autorizacion WHERE solicitante_id = $1`, [c.id]),
    ).toHaveLength(1);
  });

  it('una clave que no es un UUID responde 400', async () => {
    const token = await sesionDe(await cajero());
    esperarError(
      await autorizar(token, supervisor.pin, { 'Idempotency-Key': 'no-es-uuid' }),
      400,
      'DATOS_INVALIDOS',
    );
  });
});

describe('POST /autorizaciones · intentos concurrentes (criterio 47)', () => {
  it('diez PIN malos a la vez no evaden el quinto fallo: cinco 403, cinco 429 y un solo bloqueo', async () => {
    const c = await cajero();
    const token = await sesionDe(c);
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () => autorizar(token, pinInexistente())),
    );
    const estados = respuestas.map((r) => r.status).sort();
    expect(estados).toEqual([403, 403, 403, 403, 403, 429, 429, 429, 429, 429]);
    const bloqueos = (await filasAuditoria(A.id, 'bloqueo_clave')).filter((f) =>
      f.texto.includes(c.id),
    );
    expect(bloqueos).toHaveLength(1);
    const rechazos = (await filasAuditoria(A.id, 'autorizacion_rechazada')).filter(
      (f) => f.actor_usuario_id === c.id,
    );
    expect(rechazos).toHaveLength(5);
  });

  it('los fallos de varias personas de un equipo, a la vez, bloquean al equipo una sola vez', async () => {
    const [c1, c2] = [await cajero(), await cajero()];
    const e1 = await nuevoEquipo(app(), c1);
    // La segunda persona entra por el mismo equipo (token de equipo ya conocido).
    const sesion2 = await sesionDe(c2);
    const e2 = await llamar(app(), 'post', '/sesion/equipo', {
      token: sesion2,
      equipo: e1.tokenEquipo,
      cuerpo: {},
    });
    expect(e2.status).toBe(200);
    const sesiones = [e1.sesion, sesion2];
    const respuestas = await Promise.all(
      Array.from({ length: 8 }, (_, i) => autorizar(sesiones[i % 2]!, pinInexistente())),
    );
    expect(respuestas.filter((r) => r.status === 403)).toHaveLength(5);
    expect(respuestas.filter((r) => r.status === 429)).toHaveLength(3);
  });
});

describe('POST /autorizaciones · actor de la auditoría', () => {
  it('el rechazo queda a nombre del solicitante y el bloqueo, del sistema autenticacion', async () => {
    const c = await cajero();
    const token = await sesionDe(c);
    for (let i = 0; i < 5; i++) {
      esperarError(await autorizar(token, pinInexistente()), 403, 'CLAVE_INVALIDA');
    }
    const rechazos = (await filasAuditoria(A.id, 'autorizacion_rechazada')).filter(
      (f) => f.actor_usuario_id === c.id,
    );
    expect(rechazos).toHaveLength(5);
    expect(rechazos[0]).toMatchObject({ sucursal_id: S1(), motivo: MOTIVO });
    expect(rechazos[0]!.detalle).toMatchObject({
      accion: ACCION,
      motivoRechazo: 'PIN_INEXISTENTE',
      solicitanteId: c.id,
    });
    const [bloqueo] = (await filasAuditoria(A.id, 'bloqueo_clave')).filter((f) =>
      f.texto.includes(c.id),
    );
    expect(bloqueo).toMatchObject({ actor_sistema: 'autenticacion', actor_usuario_id: null });
    expect(bloqueo!.detalle).toMatchObject({ ambito: 'CLAVE_USUARIO', solicitanteId: c.id });
  });

  it('el motivo interno distingue cada rechazo en la auditoría, no en la respuesta', async () => {
    const c = await cajero();
    const otroCajero = await cajero();
    const token = await sesionDe(c);
    for (const pin of [otroCajero.pin, c.pin, pinInexistente()]) {
      esperarError(await autorizar(token, pin), 403, 'CLAVE_INVALIDA');
      expect((await autorizar(token, supervisor.pin)).status).toBe(201); // reinicia la cuenta
    }
    const motivos = (await filasAuditoria(A.id, 'autorizacion_rechazada'))
      .filter((f) => f.actor_usuario_id === c.id)
      .map((f) => f.detalle.motivoRechazo);
    expect([...motivos].sort()).toEqual(
      ['PIN_INEXISTENTE', 'PROPIO_SOLICITANTE', 'SIN_ROL_AUTORIZADOR'].sort(),
    );
  });
});

describe('@Permiso · la acción auditada', () => {
  it('queda una sola fila de la acción con el solicitante como actor, el autorizador y el equipo', async () => {
    const c = await cajero();
    const equipo = await nuevoEquipo(app(), c);
    const { body } = await autorizar(equipo.sesion, supervisor.pin);
    const res = await llamar(app(), 'post', '/sonda-clave/anular', {
      token: equipo.sesion,
      cabeceras: { 'X-Autorizacion': body.autorizacionId },
    });
    expect(res.status).toBe(200);
    const filas = (await filasAuditoria(A.id, ACCION)).filter(
      (f) => f.autorizacion_id === body.autorizacionId,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_usuario_id: c.id,
      equipo_id: equipo.equipoId,
      autorizado_por_id: supervisor.id,
      motivo: MOTIVO,
      sucursal_id: S1(),
    });
  });

  it('una X-Autorizacion que no es un UUID responde 403 AUTORIZACION_INVALIDA y una vacía, CLAVE_REQUERIDA', async () => {
    const token = await sesionDe(await cajero());
    esperarError(
      await llamar(app(), 'post', '/sonda-clave/anular', {
        token,
        cabeceras: { 'X-Autorizacion': 'no-es-uuid' },
      }),
      403,
      'AUTORIZACION_INVALIDA',
    );
    esperarError(
      await llamar(app(), 'post', '/sonda-clave/anular', { token }),
      403,
      'CLAVE_REQUERIDA',
    );
  });

  it('una autorización vencida con el reloj no se consume', async () => {
    const token = await sesionDe(await cajero());
    const { body } = await autorizar(token, supervisor.pin);
    entorno.reloj.avanzar(2 * MINUTO);
    esperarError(
      await llamar(app(), 'post', '/sonda-clave/anular', {
        token,
        cabeceras: { 'X-Autorizacion': body.autorizacionId },
      }),
      403,
      'AUTORIZACION_INVALIDA',
    );
  });
});

describe('migración de autorizaciones (up, down con datos y up otra vez)', () => {
  it('baja y vuelve a subir conservando la auditoría que nombra autorizaciones', async () => {
    const base = await crearBaseNueva('autorizaciones');
    const plataforma = await abrirCliente('plataforma', base.base);
    const api = await abrirCliente('api', base.base);
    const admin = await abrirCliente('admin', base.base);
    try {
      await migrarHasta(base.base);
      const empresa = await enTransaccion(
        plataforma,
        null,
        async () =>
          (
            await plataforma.query(
              `INSERT INTO empresa (nombre, creado_en, actualizado_en) VALUES ('Empresa-au', now(), now()) RETURNING id`,
            )
          ).rows[0].id as string,
        { confirmar: true },
      );
      const sucursal = await enTransaccion(
        plataforma,
        null,
        async () => {
          const emisor = (
            await plataforma.query(
              `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
               VALUES ($1, '20100070970', 'Emisor SAC', 'GENERAL', now(), now()) RETURNING id`,
              [empresa],
            )
          ).rows[0].id;
          return (
            await plataforma.query(
              `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
               VALUES ($1, $2, 'Sucursal', '0001', 'Av. 1', now(), now()) RETURNING id`,
              [empresa, emisor],
            )
          ).rows[0].id as string;
        },
        { confirmar: true },
      );
      const nuevoUsuario = (huella: number) =>
        api
          .query(
            `INSERT INTO usuario (empresa_id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal,
                                  huella_pin, largo_pin, creado_en, actualizado_en)
             VALUES ($1, 'Persona', $2, 'x', false, $3, 6, now(), now()) RETURNING id`,
            [empresa, `p-${randomUUID().slice(0, 10)}`, Buffer.alloc(32, huella)],
          )
          .then((r) => r.rows[0].id as string);
      const [solicitante, autorizador] = await enTransaccion(
        api,
        empresa,
        async () => [await nuevoUsuario(1), await nuevoUsuario(2)] as const,
        { confirmar: true },
      );
      const autorizacion = randomUUID();
      await enTransaccion(
        api,
        empresa,
        async () => {
          await api.query('SELECT fijar_contexto_actor($1, NULL, NULL, NULL)', [solicitante]);
          const sesion = (
            await api.query(
              `INSERT INTO sesion (empresa_id, tipo, usuario_id, huella_secreto, ultima_actividad_en, expira_en,
                                   minutos_inactividad)
               VALUES ($1, 'CONTRASENA', $2, $3, now(), now() + interval '1 hour', 30) RETURNING id`,
              [empresa, solicitante, Buffer.alloc(32, 3)],
            )
          ).rows[0].id;
          await api.query(
            `INSERT INTO autorizacion (id, empresa_id, sesion_id, solicitante_id, autorizador_id, sucursal_id,
                                       accion, motivo, expira_en)
             VALUES ($1, $2, $3, $4, $5, $6, 'ANULAR_ITEM_ENVIADO', 'Motivo', now() + interval '2 minutes')`,
            [autorizacion, empresa, sesion, solicitante, autorizador, sucursal],
          );
          await api.query(
            `INSERT INTO auditoria (empresa_id, ocurrido_en, origen, accion, autorizacion_id)
             VALUES ($1, now(), 'empresa', 'autorizacion_otorgada', $2)`,
            [empresa, autorizacion],
          );
        },
        { confirmar: true, actor: false },
      );
      // La llave de la auditoría exige que la autorización exista.
      await expect(
        enTransaccion(api, empresa, () =>
          api.query(
            `INSERT INTO auditoria (empresa_id, ocurrido_en, origen, accion, autorizacion_id)
             VALUES ($1, now(), 'empresa', 'x', $2)`,
            [empresa, randomUUID()],
          ),
        ),
      ).rejects.toThrow(/auditoria_autorizacion_fk/);

      await revertirHasta(base.base, PREFIJO_AUTORIZACIONES);
      expect(
        (await migracionesEjecutadas(base.base)).some((m) => m.startsWith(PREFIJO_AUTORIZACIONES)),
      ).toBe(false);
      expect(
        (await admin.query(`SELECT to_regclass('public.autorizacion') AS t`)).rows[0].t,
      ).toBeNull();
      // La auditoría conserva su fila, que sigue nombrando la autorización.
      expect(
        (
          await admin.query(
            `SELECT autorizacion_id FROM auditoria WHERE accion = 'autorizacion_otorgada'`,
          )
        ).rows,
      ).toEqual([{ autorizacion_id: autorizacion }]);

      await migrarHasta(base.base);
      const llave = await admin.query(
        `SELECT convalidated FROM pg_constraint WHERE conname = 'auditoria_autorizacion_fk'`,
      );
      expect(llave.rows).toEqual([{ convalidated: false }]);
    } finally {
      for (const c of [plataforma, api, admin]) await c.end().catch(() => undefined);
      await base.eliminar();
    }
  }, 180_000);
});
