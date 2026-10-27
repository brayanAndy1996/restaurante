// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P8 (parte 2) · Criterios 66 a 68 (soporte del superadministrador, RF-07, ruta crítica):
// - 66 `POST /plataforma/empresas/:id/soporte`: sesión SOPORTE con permisos de Administrador, inactividad de
//   30 minutos y duración máxima de 2 horas, auditada (inicio, acciones y fin) y visible para la empresa;
// - 67 soporte aislado (token adulterado, empresa inexistente, motivo vacío);
// - 68 sin mezcla de credenciales (no sirve en /plataforma/*, no crea sesiones PIN, autorizaciones ni equipos
//   y no cuenta como usuario de la empresa); desactivar al superadministrador cierra sus sesiones de soporte
//   en cualquier empresa (criterios 61 y 62).
// La API real con `RelojManual`, sin `EMPRESA_POR_HEADER`.
import { ingresoRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { abrirCliente } from '../utilidades';
import { enTransaccion, rucAleatorio, textoUnico } from '../aislamiento/fabrica';
import {
  MINUTO,
  UUID_RE,
  altaEmpresa,
  arrancar,
  bearer,
  conEmpresa,
  contrasenaUnica,
  desactivarSuperadministrador,
  exigirEstado,
  filasDeAuditoria,
  nuevoSuperadmin,
  partesDeToken,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from './fabrica-plataforma';

/** Martes 5 de febrero de 2030, 11:00 en Lima. */
const INICIO = '2030-02-05T11:00:00-05:00';

let ctx: AppDePrueba;
let admin: Client;
let api: Client;
let sembradoPendiente:
  Promise<{ sa: SuperadminDePrueba; A: EmpresaDePrueba; B: EmpresaDePrueba }> | undefined;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO });
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO);
});

function sembrado() {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    return { sa, A: await altaEmpresa(ctx, sa), B: await altaEmpresa(ctx, sa) };
  })();
  return sembradoPendiente;
}

/** Abre una sesión de soporte (`POST /plataforma/empresas/:id/soporte`) y exige 201. */
async function abrirSoporte(
  sa: SuperadminDePrueba,
  empresaId: string,
  opciones: { motivo?: string; sucursalId?: string } = {},
) {
  const res = await ctx
    .http()
    .post(`/plataforma/empresas/${empresaId}/soporte`)
    .set(bearer(sa.token))
    .send({
      motivo: opciones.motivo ?? textoUnico('motivo-soporte'),
      ...(opciones.sucursalId ? { sucursalId: opciones.sucursalId } : {}),
    });
  exigirEstado(res, 201, 'abrir soporte');
  return res.body as { token: string; sesion: Record<string, unknown> };
}

const contarSesionesDeSoporte = async (empresaId: string) =>
  Number(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM sesion WHERE empresa_id = $1 AND tipo = 'SOPORTE'",
        [empresaId],
      )
    ).rows[0].n,
  );

// ------------------------------------------------------------------------------------------------
// 66 · Soporte
// ------------------------------------------------------------------------------------------------
describe('criterio 66 · sesión de soporte', () => {
  it('responde 201 { token, sesion } con una sesión SOPORTE de esa empresa y permisos de Administrador', async () => {
    const { sa, A } = await sembrado();
    const sucursalId = A.sucursales[0]!.id;
    const motivo = textoUnico('motivo-soporte');
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo, sucursalId });
    exigirEstado(res, 201, 'soporte');
    const cuerpo = ingresoRespuestaSchema.parse(res.body);
    expect(cuerpo.token.startsWith(`se.${A.empresaId}.`)).toBe(true);
    expect(cuerpo.sesion).toMatchObject({
      tipo: 'SOPORTE',
      empresaId: A.empresaId,
      usuario: null,
      superadministrador: { id: sa.id, nombre: sa.nombre },
      esAdministrador: true,
      rol: 'ADMINISTRADOR',
      sucursal: { id: sucursalId },
    });
    expect(cuerpo.sesion.sucursales.map((s) => s.id).sort()).toEqual(
      A.sucursales.map((s) => s.id).sort(),
    );
    expect(cuerpo.sesion.debeCambiarContrasena).toBe(false);
  });

  it('la sesión de soporte hace lo que hace un Administrador de la empresa y solo de esa empresa', async () => {
    const { sa, A, B } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId, { sucursalId: A.sucursales[0]!.id });

    const sucursales = await ctx.http().get('/sucursales').set(bearer(token));
    exigirEstado(sucursales, 200, 'GET /sucursales');
    expect((sucursales.body as { id: string }[]).map((s) => s.id).sort()).toEqual(
      A.sucursales.map((s) => s.id).sort(),
    );

    const usuarios = await ctx.http().get('/usuarios').set(bearer(token));
    exigirEstado(usuarios, 200, 'GET /usuarios');
    expect((usuarios.body as { id: string }[]).map((u) => u.id)).toContain(A.admin.id);

    const nuevoUsuario = usuarioUnico('desde-soporte');
    const creado = await ctx
      .http()
      .post('/usuarios')
      .set(bearer(token))
      .send({
        nombre: 'Creado en soporte',
        nombreUsuario: nuevoUsuario,
        esAdministrador: false,
        accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
        contrasenaTemporal: contrasenaUnica(),
      });
    exigirEstado(creado, 201, 'POST /usuarios en soporte');

    const emisor = await ctx
      .http()
      .post('/emisores')
      .set(bearer(token))
      .send({ ruc: rucAleatorio(), razonSocial: 'Emisor de soporte SAC', regimen: 'GENERAL' });
    exigirEstado(emisor, 201, 'POST /emisores en soporte');

    // De B no se ve nada.
    const ajena = await ctx.http().get(`/sucursales/${B.sucursales[0]!.id}`).set(bearer(token));
    expect(ajena.status).toBe(404);
  });

  it('GET /sesion describe la sesión de soporte (sin usuario, con el superadministrador)', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId, { sucursalId: A.sucursales[0]!.id });
    const res = await ctx.http().get('/sesion').set(bearer(token));
    exigirEstado(res, 200, 'GET /sesion');
    expect(res.body).toMatchObject({
      tipo: 'SOPORTE',
      usuario: null,
      superadministrador: { id: sa.id },
      esAdministrador: true,
    });
  });

  it('deja la fila inicio_soporte (origen plataforma, con la empresa) y el Administrador de la empresa la puede ver', async () => {
    const { sa, A, B } = await sembrado();
    const motivo = textoUnico('motivo-visible');
    await abrirSoporte(sa, A.empresaId, { motivo });
    const filas = await filasDeAuditoria(admin, "accion = 'inicio_soporte' AND motivo = $1", [
      motivo,
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      origen: 'plataforma',
      empresa_id: A.empresaId,
      actor_superadministrador_id: sa.id,
      actor_usuario_id: null,
    });

    // Con el contexto de A (como la API) la fila se ve; con el de B, no.
    await enTransaccion(api, A.empresaId, async () => {
      const { rows } = await api.query(
        "SELECT id FROM auditoria WHERE accion = 'inicio_soporte' AND motivo = $1",
        [motivo],
      );
      expect(rows).toHaveLength(1);
    });
    await enTransaccion(api, B.empresaId, async () => {
      const { rows } = await api.query(
        "SELECT id FROM auditoria WHERE accion = 'inicio_soporte' AND motivo = $1",
        [motivo],
      );
      expect(rows).toEqual([]);
    });
  });

  it('toda acción hecha con la sesión se audita con el id del superadministrador y el sesion_id de soporte', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId, { sucursalId: A.sucursales[0]!.id });
    const sesionId = partesDeToken(token).sesionId;
    expect(sesionId).toMatch(UUID_RE);
    const cambio = await ctx
      .http()
      .patch(`/sucursales/${A.sucursales[0]!.id}`)
      .set(bearer(token))
      .send({ direccion: textoUnico('Dirección de soporte') });
    exigirEstado(cambio, 200, 'PATCH /sucursales/:id en soporte');
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'configurar_sucursal' AND sesion_id = $2",
      [A.empresaId, sesionId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_superadministrador_id: sa.id,
      actor_usuario_id: null,
      equipo_id: null,
    });
  });

  it('DELETE /sesion cierra la sesión de soporte (204), el token deja de valer y queda fin_soporte', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId);
    const sesionId = partesDeToken(token).sesionId;
    const salida = await ctx.http().delete('/sesion').set(bearer(token));
    exigirEstado(salida, 204, 'DELETE /sesion');
    const despues = await ctx.http().get('/sesion').set(bearer(token));
    expect(despues.status).toBe(401);
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'fin_soporte' AND sesion_id = $2",
      [A.empresaId, sesionId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ actor_superadministrador_id: sa.id });
  });

  it('vale 30 minutos de inactividad: a los 29 minutos sigue y se renueva; a los 30 sin peticiones expira', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId);
    const consulta = () => ctx.http().get('/sesion').set(bearer(token));
    ctx.reloj.avanzar(29 * MINUTO);
    exigirEstado(await consulta(), 200, 'a los 29 minutos');
    ctx.reloj.avanzar(29 * MINUTO); // 29 minutos desde la última actividad
    exigirEstado(await consulta(), 200, 'otra vez a los 29 minutos de la última actividad');
    ctx.reloj.avanzar(30 * MINUTO);
    const expirada = await consulta();
    expect(expirada.status).toBe(401);
    expect(expirada.body).toMatchObject({ codigo: 'SESION_EXPIRADA' });
    const siguiente = await consulta();
    expect(siguiente.status).toBe(401);
  });

  it('vale 2 horas como máximo aunque no haya inactividad', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId);
    const consulta = () => ctx.http().get('/sesion').set(bearer(token));
    for (let i = 0; i < 5; i++) {
      ctx.reloj.avanzar(20 * MINUTO);
      exigirEstado(await consulta(), 200, `a los ${(i + 1) * 20} minutos`);
    }
    ctx.reloj.avanzar(19 * MINUTO); // 1 h 59 min
    exigirEstado(await consulta(), 200, 'a 1 h 59 min');
    ctx.reloj.avanzar(2 * MINUTO); // 2 h 01 min, con actividad reciente
    const vencida = await consulta();
    expect(vencida.status).toBe(401);
    expect(vencida.body).toMatchObject({ codigo: 'SESION_EXPIRADA' });
  });
});

// ------------------------------------------------------------------------------------------------
// 67 · Soporte aislado
// ------------------------------------------------------------------------------------------------
describe('criterio 67 · soporte aislado', () => {
  it('el token de soporte de A, adulterado con la empresa B, responde 401', async () => {
    const { sa, A, B } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId);
    const bueno = await ctx.http().get('/sesion').set(bearer(token));
    exigirEstado(bueno, 200, 'token sin adulterar');
    const adulterado = await ctx
      .http()
      .get('/sesion')
      .set(bearer(conEmpresa(token, B.empresaId)));
    expect(adulterado.status).toBe(401);
    expect(adulterado.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    const sucursales = await ctx
      .http()
      .get('/sucursales')
      .set(bearer(conEmpresa(token, B.empresaId)));
    expect(sucursales.status).toBe(401);
  });

  it('una empresa inexistente responde 404 NO_ENCONTRADO y no crea nada', async () => {
    const { sa } = await sembrado();
    const motivo = textoUnico('motivo-fantasma');
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${randomUUID()}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(await filasDeAuditoria(admin, 'motivo = $1', [motivo])).toHaveLength(0);
  });

  it.each([
    ['vacío', ''],
    ['solo con espacios', '   '],
    ['ausente', undefined],
    ['de más de 300 caracteres', 'x'.repeat(301)],
  ])('un motivo %s responde 400 y no crea sesión ni fila de auditoría', async (_nombre, motivo) => {
    const { sa, A } = await sembrado();
    const antes = await contarSesionesDeSoporte(A.empresaId);
    const iniciosAntes = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'inicio_soporte'",
      [A.empresaId],
    );
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send(motivo === undefined ? {} : { motivo });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await contarSesionesDeSoporte(A.empresaId)).toBe(antes);
    expect(
      await filasDeAuditoria(admin, "empresa_id = $1 AND accion = 'inicio_soporte'", [A.empresaId]),
    ).toHaveLength(iniciosAntes.length);
  });

  it('una sucursal de otra empresa no vale como sucursal de soporte y no crea sesión', async () => {
    const { sa, A, B } = await sembrado();
    const antes = await contarSesionesDeSoporte(A.empresaId);
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: textoUnico('motivo-sucursal-ajena'), sucursalId: B.sucursales[0]!.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await contarSesionesDeSoporte(A.empresaId)).toBe(antes);
  });

  it('sin sesión de superadministrador no se puede abrir soporte', async () => {
    const { A } = await sembrado();
    const antes = await contarSesionesDeSoporte(A.empresaId);
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/soporte`)
      .send({ motivo: 'sin sesión' });
    expect(res.status).toBe(401);
    expect(await contarSesionesDeSoporte(A.empresaId)).toBe(antes);
  });
});

// ------------------------------------------------------------------------------------------------
// 68 · Sin mezcla de credenciales
// ------------------------------------------------------------------------------------------------
describe('criterio 68 · la sesión de soporte no se mezcla con otras credenciales', () => {
  it('no sirve en /plataforma/*: 401 NO_AUTENTICADO', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId);
    for (const ruta of [
      '/plataforma/empresas',
      `/plataforma/empresas/${A.empresaId}`,
      '/plataforma/planes',
    ]) {
      const res = await ctx.http().get(ruta).set(bearer(token));
      expect(res.status, ruta).toBe(401);
      expect(res.body, ruta).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    }
  });

  it('[C2] no puede recordar equipos (403 PROHIBIDO) ni cambiar contraseñas (403 PROHIBIDO)', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId, { sucursalId: A.sucursales[0]!.id });
    const equiposAntes = Number(
      (
        await admin.query('SELECT count(*)::int AS n FROM equipo WHERE empresa_id = $1', [
          A.empresaId,
        ])
      ).rows[0].n,
    );
    const equipo = await ctx.http().post('/sesion/equipo').set(bearer(token)).send({});
    expect(equipo.status).toBe(403);
    expect(equipo.body).toMatchObject({ codigo: 'PROHIBIDO' });
    const equiposDespues = Number(
      (
        await admin.query('SELECT count(*)::int AS n FROM equipo WHERE empresa_id = $1', [
          A.empresaId,
        ])
      ).rows[0].n,
    );
    expect(equiposDespues).toBe(equiposAntes);

    const clave = await ctx
      .http()
      .put('/sesion/contrasena')
      .set(bearer(token))
      .send({ actual: contrasenaUnica(), nueva: contrasenaUnica() });
    expect(clave.status).toBe(403);
    expect(clave.body).toMatchObject({ codigo: 'PROHIBIDO' });
  });

  it('[C3] no crea autorizaciones: las acciones protegidas son permitidas y POST /autorizaciones responde 409 CLAVE_INNECESARIA', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId, { sucursalId: A.sucursales[0]!.id });
    const res = await ctx
      .http()
      .post('/autorizaciones')
      .set(bearer(token))
      .send({ accion: 'ANULAR_ITEM_ENVIADO', motivo: 'Prueba de soporte', pin: A.admin.pin });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'CLAVE_INNECESARIA' });
    const filas = await admin.query('SELECT 1 FROM autorizacion WHERE empresa_id = $1', [
      A.empresaId,
    ]);
    expect(filas.rows).toHaveLength(0);
  });

  it('[C2] no puede crear sesiones PIN: POST /sesiones/pin con su token no le da acceso', async () => {
    const { sa, A } = await sembrado();
    const { token } = await abrirSoporte(sa, A.empresaId);
    // Un token de empresa no es un token de equipo: el ingreso con PIN exige X-Equipo y una persona recordada.
    const antes = Number(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM sesion WHERE empresa_id = $1 AND tipo = 'PIN'",
          [A.empresaId],
        )
      ).rows[0].n,
    );
    const res = await ctx
      .http()
      .post('/sesiones/pin')
      .set('X-Equipo', token)
      .set(bearer(token))
      .send({ usuarioId: A.admin.id, pin: A.admin.pin });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ codigo: 'EQUIPO_NO_RECONOCIDO' });
    const despues = Number(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM sesion WHERE empresa_id = $1 AND tipo = 'PIN'",
          [A.empresaId],
        )
      ).rows[0].n,
    );
    expect(despues).toBe(antes);
  });

  it('no cuenta como usuario de la empresa: abrir soporte y actuar no agrega usuarios ni aparece en la lista', async () => {
    const { sa, A } = await sembrado();
    const antes = Number(
      (
        await admin.query('SELECT count(*)::int AS n FROM usuario WHERE empresa_id = $1', [
          A.empresaId,
        ])
      ).rows[0].n,
    );
    const { token } = await abrirSoporte(sa, A.empresaId);
    const lista = await ctx.http().get('/usuarios').set(bearer(token));
    exigirEstado(lista, 200, 'GET /usuarios');
    const texto = JSON.stringify(lista.body);
    expect(texto).not.toContain(sa.usuario);
    expect(texto).not.toContain(sa.id);
    expect((lista.body as unknown[]).length).toBe(antes);
    const despues = Number(
      (
        await admin.query('SELECT count(*)::int AS n FROM usuario WHERE empresa_id = $1', [
          A.empresaId,
        ])
      ).rows[0].n,
    );
    expect(despues).toBe(antes);
  });
});

// ------------------------------------------------------------------------------------------------
// 61/62 · Desactivar al superadministrador cierra sus sesiones de soporte en cualquier empresa
// ------------------------------------------------------------------------------------------------
describe('criterios 61 y 62 · desactivar al superadministrador cierra sus sesiones de soporte', () => {
  it('sus sesiones de soporte en todas las empresas y su propia sesión dejan de valer; las de otro superadministrador siguen', async () => {
    const { A, B } = await sembrado();
    const sa = await nuevoSuperadmin(ctx);
    const otro = await nuevoSuperadmin(ctx);
    const soporteA = await abrirSoporte(sa, A.empresaId);
    const soporteB = await abrirSoporte(sa, B.empresaId);
    const deOtro = await abrirSoporte(otro, A.empresaId);

    for (const t of [soporteA.token, soporteB.token, deOtro.token]) {
      exigirEstado(await ctx.http().get('/sesion').set(bearer(t)), 200, 'antes de desactivar');
    }
    await desactivarSuperadministrador({ usuario: sa.usuario });

    for (const [nombre, t] of [
      ['soporte en A', soporteA.token],
      ['soporte en B', soporteB.token],
    ] as const) {
      const res = await ctx.http().get('/sesion').set(bearer(t));
      expect(res.status, nombre).toBe(401);
    }
    const propia = await ctx.http().get('/plataforma/empresas').set(bearer(sa.token));
    expect(propia.status).toBe(401);
    // La sesión de soporte de otro superadministrador no se toca.
    exigirEstado(
      await ctx.http().get('/sesion').set(bearer(deOtro.token)),
      200,
      'soporte de otro superadministrador',
    );
    // Quedaron cerradas en la base.
    const cerradas = await admin.query<{ cerrada: boolean }>(
      'SELECT cerrada_en IS NOT NULL AS cerrada FROM sesion WHERE id = ANY($1::uuid[])',
      [[partesDeToken(soporteA.token).sesionId, partesDeToken(soporteB.token).sesionId]],
    );
    expect(cerradas.rows).toEqual([{ cerrada: true }, { cerrada: true }]);
  });
});
