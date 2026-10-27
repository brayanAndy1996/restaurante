// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P8 (parte 1) · Criterios 61 a 65 (superadministrador y plataforma por HTTP, RF-01, RF-07, ruta crítica):
// - 61 superadministradores: solo se crean y desactivan con las funciones del script; ingreso, fallos
//   indistinguibles, bloqueo de 15 minutos, sesión de 8 horas y salida; todo auditado sin empresa;
// - 62 toda ruta `/plataforma/*` salvo `POST /plataforma/sesiones` exige una sesión de superadministrador;
// - 63 alta de empresa por HTTP (todo o nada, errores, primer Administrador con PIN de 6 dígitos);
// - 64 emisores y sucursales por plataforma; 65 consultas.
// La API real con `RelojManual`, sin `EMPRESA_POR_HEADER`.
import {
  altaEmpresaRespuestaSchema,
  empresaPlataformaDetalleSchema,
  empresaPlataformaResumenSchema,
  ingresoSuperadministradorRespuestaSchema,
} from '@restaurante/contratos';
import { randomInt, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { abrirCliente } from '../utilidades';
import { rutasRegistradas } from '../utilidades';
import { rucAleatorio, textoUnico } from '../aislamiento/fabrica';
import {
  HORA,
  MINUTO,
  UUID_RE,
  altaEmpresa,
  arrancar,
  bearer,
  contrasenaUnica,
  crearUsuario,
  cuerpoDeAlta,
  desactivarSuperadministrador,
  exigirEstado,
  filasDeAuditoria,
  ingresarOk,
  nuevoSuperadmin,
  recordarEquipo,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from './fabrica-plataforma';
import { crearSuperadministrador } from '../../scripts/lib/superadministrador';

/** Lunes 4 de febrero de 2030, 10:00 en Lima. */
const INICIO = '2030-02-04T10:00:00-05:00';

let ctx: AppDePrueba;
let admin: Client;
let api: Client;

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

/** Superadministrador y dos empresas con sesión de Administrador, creados la primera vez que se piden. */
let basePendiente:
  Promise<{ sa: SuperadminDePrueba; A: EmpresaDePrueba; B: EmpresaDePrueba }> | undefined;
function sembrado() {
  basePendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    return { sa, A: await altaEmpresa(ctx, sa), B: await altaEmpresa(ctx, sa) };
  })();
  return basePendiente;
}

/** Filas de auditoría de un superadministrador: por su id o porque su usuario aparece en el detalle. */
const auditoriaDe = (accion: string, sa: SuperadminDePrueba) =>
  filasDeAuditoria(
    admin,
    `accion = $1 AND empresa_id IS NULL AND origen = 'plataforma'
     AND (actor_superadministrador_id = $2 OR detalle::text LIKE '%' || $3 || '%')`,
    [accion, sa.id, sa.usuario],
  );

// ------------------------------------------------------------------------------------------------
// 61 · Superadministradores
// ------------------------------------------------------------------------------------------------
describe('criterio 61 · crear y desactivar superadministradores', () => {
  it('no hay ninguna ruta HTTP para crearlos ni desactivarlos', () => {
    const rutas = rutasRegistradas(ctx.app).map((r) => `${r.metodo} ${r.ruta}`);
    const sospechosas = rutas.filter(
      (r) =>
        /superadmin/i.test(r) ||
        (/^(POST|PATCH|PUT|DELETE) \/plataforma\//.test(r) && /usuario/i.test(r)),
    );
    expect(sospechosas).toEqual([]);
  });

  it('crearSuperadministrador devuelve su id; el nombre de usuario es único sin distinguir mayúsculas', async () => {
    const usuario = usuarioUnico('sa-unico');
    const { id } = await crearSuperadministrador({
      usuario,
      nombre: 'Primero',
      contrasena: contrasenaUnica(),
    });
    expect(id).toMatch(UUID_RE);
    await expect(
      crearSuperadministrador({
        usuario: usuario.toUpperCase(),
        nombre: 'Segundo',
        contrasena: contrasenaUnica(),
      }),
    ).rejects.toThrow();
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM superadministrador WHERE usuario = $1',
      [usuario],
    );
    expect(rows[0].n).toBe(1);
  });

  it('el nombre de usuario de un superadministrador es independiente del de los usuarios de empresa', async () => {
    const { A } = await sembrado();
    const compartido = usuarioUnico('compartido');
    const delSuper = await crearSuperadministrador({
      usuario: compartido,
      nombre: 'Super con nombre compartido',
      contrasena: contrasenaUnica(),
    });
    expect(delSuper.id).toMatch(UUID_RE);
    // Un usuario de empresa puede llamarse igual que un superadministrador (y no hay conflicto en ningún sentido).
    const deEmpresa = await crearUsuario(ctx, A.admin.token, {
      nombreUsuario: compartido,
      accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
    });
    expect(deEmpresa.id).toMatch(UUID_RE);
    const otro = usuarioUnico('compartido-2');
    const usuarioPrimero = await crearUsuario(ctx, A.admin.token, {
      nombreUsuario: otro,
      accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
    });
    expect(usuarioPrimero.id).toMatch(UUID_RE);
    const superDespues = await crearSuperadministrador({
      usuario: otro,
      nombre: 'Super creado después',
      contrasena: contrasenaUnica(),
    });
    expect(superDespues.id).toMatch(UUID_RE);
  });

  it('POST /plataforma/sesiones con datos correctos responde 201 { token, superadministrador }', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const res = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: sa.usuario.toUpperCase(), contrasena: sa.contrasena });
    exigirEstado(res, 201, 'ingreso');
    const cuerpo = ingresoSuperadministradorRespuestaSchema.parse(res.body);
    expect(cuerpo.token.startsWith('sa.')).toBe(true);
    expect(cuerpo.superadministrador).toEqual({ id: sa.id, nombre: sa.nombre });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|huella|contrasena/i);
  });

  it('contraseña equivocada, usuario inexistente y usuario inactivo responden lo mismo: 401 CREDENCIALES_INVALIDAS', async () => {
    const activo = await nuevoSuperadmin(ctx);
    const inactivo = await nuevoSuperadmin(ctx);
    await desactivarSuperadministrador({ usuario: inactivo.usuario });
    const intento = (usuario: string, contrasena: string) =>
      ctx.http().post('/plataforma/sesiones').send({ usuario, contrasena });
    const respuestas = [
      await intento(activo.usuario, contrasenaUnica()),
      await intento(usuarioUnico('no-existe'), contrasenaUnica()),
      await intento(inactivo.usuario, inactivo.contrasena),
    ];
    for (const res of respuestas) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS' });
    }
    expect(respuestas[1]!.body).toEqual(respuestas[0]!.body);
    expect(respuestas[2]!.body).toEqual(respuestas[0]!.body);
  });

  it('5 fallos seguidos lo bloquean 15 minutos (429 BLOQUEO_TEMPORAL) aunque la contraseña sea correcta, y los fallos quedan guardados', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const otro = await nuevoSuperadmin(ctx);
    for (let i = 0; i < 5; i++) {
      const res = await ctx
        .http()
        .post('/plataforma/sesiones')
        .send({ usuario: sa.usuario, contrasena: contrasenaUnica() });
      expect(res.status, `fallo ${i + 1}`).toBe(401);
    }
    const bloqueado = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: sa.usuario, contrasena: sa.contrasena });
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
    expect(bloqueado.body.reintentarEnSegundos).toBeGreaterThan(0);
    expect(bloqueado.body.reintentarEnSegundos).toBeLessThanOrEqual(15 * 60);
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);

    // Los fallos y el bloqueo quedaron guardados aunque las respuestas fueron errores.
    expect(await auditoriaDe('ingreso_superadministrador_fallido', sa)).toHaveLength(5);
    expect(await auditoriaDe('bloqueo_superadministrador', sa)).toHaveLength(1);

    // El bloqueo de una persona no afecta a otra.
    const deOtro = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: otro.usuario, contrasena: otro.contrasena });
    exigirEstado(deOtro, 201, 'otro superadministrador');

    // Pasados 14 minutos 59 segundos sigue bloqueado; a los 15 minutos la contraseña correcta funciona.
    ctx.reloj.avanzar(15 * MINUTO - 1000);
    const aunBloqueado = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: sa.usuario, contrasena: sa.contrasena });
    expect(aunBloqueado.status).toBe(429);
    ctx.reloj.avanzar(1000);
    const libre = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: sa.usuario, contrasena: sa.contrasena });
    exigirEstado(libre, 201, 'después de 15 minutos');
  });

  it('un ingreso correcto antes del quinto fallo reinicia la cuenta', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const fallar = () =>
      ctx
        .http()
        .post('/plataforma/sesiones')
        .send({ usuario: sa.usuario, contrasena: contrasenaUnica() });
    for (let i = 0; i < 4; i++) expect((await fallar()).status).toBe(401);
    const bien = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: sa.usuario, contrasena: sa.contrasena });
    exigirEstado(bien, 201, 'ingreso entre fallos');
    for (let i = 0; i < 4; i++) expect((await fallar()).status).toBe(401);
    const otraVez = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: sa.usuario, contrasena: sa.contrasena });
    exigirEstado(otraVez, 201, 'sin bloqueo tras reiniciar');
  });

  it('la sesión vale 8 horas desde que se crea', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const consulta = () => ctx.http().get('/plataforma/empresas').set(bearer(sa.token));
    exigirEstado(await consulta(), 200, 'recién creada');
    ctx.reloj.avanzar(8 * HORA - 1000);
    exigirEstado(await consulta(), 200, 'a 7 h 59 min 59 s');
    ctx.reloj.avanzar(2000);
    const vencida = await consulta();
    expect(vencida.status).toBe(401);
    expect(['NO_AUTENTICADO', 'SESION_EXPIRADA']).toContain(vencida.body.codigo);
  });

  it('DELETE /plataforma/sesion la cierra (204), el token deja de valer y la salida se audita', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const salida = await ctx.http().delete('/plataforma/sesion').set(bearer(sa.token));
    exigirEstado(salida, 204, 'salida');
    const despues = await ctx.http().get('/plataforma/empresas').set(bearer(sa.token));
    expect(despues.status).toBe(401);
    expect(despues.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    expect(await auditoriaDe('salida_superadministrador', sa)).toHaveLength(1);
  });

  it('el ingreso correcto se audita sin empresa y sin la contraseña', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const filas = await auditoriaDe('ingreso_superadministrador', sa);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.empresa_id).toBeNull();
    expect(JSON.stringify(filas[0])).not.toContain(sa.contrasena);
  });

  it('desactivarSuperadministrador cierra sus sesiones y le impide volver a entrar', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const antes = await ctx.http().get('/plataforma/empresas').set(bearer(sa.token));
    exigirEstado(antes, 200, 'antes de desactivar');
    await desactivarSuperadministrador({ usuario: sa.usuario });
    const despues = await ctx.http().get('/plataforma/empresas').set(bearer(sa.token));
    expect(despues.status).toBe(401);
    const ingreso = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: sa.usuario, contrasena: sa.contrasena });
    expect(ingreso.status).toBe(401);
    expect(ingreso.body).toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS' });
    const filas = await filasDeAuditoria(
      admin,
      "accion = 'desactivar_superadministrador' AND actor_sistema = 'cli:superadmin' AND (entidad_id::text = $1 OR detalle::text LIKE '%' || $2 || '%')",
      [sa.id, sa.usuario],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.empresa_id).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// 62 · Rutas de plataforma
// ------------------------------------------------------------------------------------------------
describe('criterio 62 · toda ruta /plataforma/* exige una sesión de superadministrador', () => {
  it('sin token, con token mal formado, de empresa, de soporte o de equipo, responde 401 NO_AUTENTICADO y no se ejecuta', async () => {
    const { sa, A } = await sembrado();
    const soporte = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Para probar las rutas de plataforma' });
    exigirEstado(soporte, 201, 'soporte');
    const equipo = await recordarEquipo(ctx, A.admin.token);
    expect(equipo.tokenEquipo, 'el equipo nuevo devuelve su token').toBeTruthy();

    const intentos: [string, Record<string, string>][] = [
      ['sin token', {}],
      ['token mal formado', bearer('esto-no-es-un-token')],
      ['token de sesión de empresa', bearer(A.admin.token)],
      ['token de soporte', bearer(soporte.body.token as string)],
      ['token de equipo como Authorization', bearer(equipo.tokenEquipo!)],
      ['token de equipo en X-Equipo', { 'X-Equipo': equipo.tokenEquipo! }],
    ];
    const marca = textoUnico('motivo-sin-sesion');
    const rutas = rutasRegistradas(ctx.app).filter(
      (r) =>
        r.ruta.startsWith('/plataforma') &&
        !(r.metodo === 'POST' && r.ruta === '/plataforma/sesiones'),
    );
    expect(rutas.length).toBeGreaterThanOrEqual(12);

    for (const ruta of rutas) {
      const path = ruta.ruta.replace(/:[A-Za-z]+/g, () => randomUUID());
      for (const [nombre, cabeceras] of intentos) {
        const peticion = ctx.http()[ruta.metodo.toLowerCase() as 'get'](path).set(cabeceras);
        const res = ['GET', 'DELETE'].includes(ruta.metodo)
          ? await peticion
          : await peticion.send({ motivo: marca });
        expect(res.status, `${ruta.metodo} ${ruta.ruta} (${nombre})`).toBe(401);
        expect(res.body, `${ruta.metodo} ${ruta.ruta} (${nombre})`).toMatchObject({
          codigo: 'NO_AUTENTICADO',
        });
      }
    }
    // Nada se ejecutó: no hay filas de auditoría con esa marca.
    expect(await filasDeAuditoria(admin, 'motivo = $1', [marca])).toHaveLength(0);
  });

  it('un token de superadministrador (sa.…) en una ruta de empresa responde 401 NO_AUTENTICADO', async () => {
    const { sa } = await sembrado();
    for (const ruta of ['/sucursales', '/emisores', '/usuarios', '/sesion']) {
      const res = await ctx.http().get(ruta).set(bearer(sa.token));
      expect(res.status, ruta).toBe(401);
      expect(res.body, ruta).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    }
  });

  it('con la sesión de superadministrador válida las rutas de consulta responden', async () => {
    const { sa } = await sembrado();
    exigirEstado(
      await ctx.http().get('/plataforma/empresas').set(bearer(sa.token)),
      200,
      'empresas',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 63 · Alta de empresa por HTTP
// ------------------------------------------------------------------------------------------------
describe('criterio 63 · POST /plataforma/empresas', () => {
  const contar = async (tabla: string, condicion: string, parametros: unknown[]) =>
    Number(
      (await admin.query(`SELECT count(*)::int AS n FROM ${tabla} WHERE ${condicion}`, parametros))
        .rows[0].n,
    );

  /** Comprueba que un alta rechazada no dejó ni empresa, ni emisores, ni usuario, ni auditoría. */
  async function exigirNadaCreado(cuerpo: ReturnType<typeof cuerpoDeAlta>) {
    expect(await contar('empresa', 'nombre = $1', [cuerpo.nombre]), 'empresa').toBe(0);
    const rucs = cuerpo.emisores.map((e) => e.ruc);
    expect(
      (
        await admin.query(
          'SELECT 1 FROM emisor WHERE ruc = ANY($1::text[]) AND razon_social = ANY($2::text[])',
          [rucs, cuerpo.emisores.map((e) => (e as unknown as { razonSocial: string }).razonSocial)],
        )
      ).rows,
      'emisores',
    ).toHaveLength(0);
    expect(
      (
        await api.query('SELECT empresa_de_usuario($1) AS empresa_id', [
          cuerpo.administrador.nombreUsuario,
        ])
      ).rows[0].empresa_id,
      'usuario administrador',
    ).toBeNull();
    expect(await filasDeAuditoria(admin, 'motivo = $1', [cuerpo.motivo]), 'auditoría').toHaveLength(
      0,
    );
  }

  const enviar = async (cuerpo: unknown, token: string) =>
    ctx
      .http()
      .post('/plataforma/empresas')
      .set(bearer(token))
      .send(cuerpo as object);

  it('[C1] responde 201 con la empresa, los emisores, las sucursales con su suscripción y el primer Administrador con PIN de 6 dígitos', async () => {
    const { sa } = await sembrado();
    const cuerpo = cuerpoDeAlta({ emisores: 2, sucursalesPorEmisor: 2 });
    cuerpo.motivo = textoUnico('motivo-alta');
    const res = await enviar(cuerpo, sa.token);
    exigirEstado(res, 201, 'alta');
    const r = altaEmpresaRespuestaSchema.parse(res.body);
    expect(r.emisores.map((e) => e.ruc).sort()).toEqual(cuerpo.emisores.map((e) => e.ruc).sort());
    expect(r.sucursales.map((s) => s.nombre).sort()).toEqual(
      cuerpo.sucursales.map((s) => s.nombre as string).sort(),
    );
    expect(r.sucursales).toHaveLength(4);
    for (const s of r.sucursales) expect(s.suscripcion.sucursalId).toBe(s.id);
    expect(r.administrador.pin).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|huella/i);
    expect(JSON.stringify(res.body)).not.toContain(cuerpo.administrador.contrasenaTemporal);

    // Lo creado en la base.
    const empresa = await admin.query('SELECT id FROM empresa WHERE nombre = $1', [cuerpo.nombre]);
    expect(empresa.rows).toEqual([{ id: r.empresaId }]);
    const usuario = await admin.query(
      'SELECT es_administrador, contrasena_temporal, activo, largo_pin, empresa_id, nombre_usuario FROM usuario WHERE id = $1',
      [r.administrador.id],
    );
    expect(usuario.rows).toEqual([
      {
        es_administrador: true,
        contrasena_temporal: true,
        activo: true,
        largo_pin: 6,
        empresa_id: r.empresaId,
        nombre_usuario: cuerpo.administrador.nombreUsuario,
      },
    ]);
    const huellas = await admin.query<{ valor: string }>(
      `SELECT hash_contrasena AS valor FROM usuario WHERE id = $1
       UNION ALL SELECT encode(huella_pin, 'hex') FROM usuario WHERE id = $1`,
      [r.administrador.id],
    );
    for (const { valor } of huellas.rows) {
      expect(valor).not.toContain(r.administrador.pin);
      expect(valor).not.toContain(cuerpo.administrador.contrasenaTemporal);
    }

    // Auditoría registrar_empresa con el id del superadministrador.
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'registrar_empresa'",
      [r.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_superadministrador_id: sa.id,
      motivo: cuerpo.motivo,
      origen: 'plataforma',
    });
  });

  it('el primer Administrador entra con su contraseña temporal y debe cambiarla', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    const { sesion } = await ingresarOk(
      ctx,
      empresa.admin.usuario,
      empresa.admin.contrasenaTemporal,
    );
    expect(sesion).toMatchObject({
      tipo: 'CONTRASENA',
      empresaId: empresa.empresaId,
      esAdministrador: true,
      rol: 'ADMINISTRADOR',
      debeCambiarContrasena: true,
    });
  });

  it('[C1] con una suscripción por sucursal (plan por defecto y vencimiento de hoy) responde 201', async () => {
    const { sa } = await sembrado();
    const cuerpo = cuerpoDeAlta();
    cuerpo.sucursales[0]!.suscripcion = { vencimiento: '2030-02-04' };
    cuerpo.sucursales[1]!.suscripcion = { vencimiento: '2030-06-30' };
    const res = await enviar(cuerpo, sa.token);
    exigirEstado(res, 201, 'alta con suscripciones');
    const r = altaEmpresaRespuestaSchema.parse(res.body);
    const porNombre = Object.fromEntries(r.sucursales.map((s) => [s.nombre, s.suscripcion]));
    expect(porNombre[cuerpo.sucursales[0]!.nombre as string]!.vencimiento).toBe('2030-02-04');
    expect(porNombre[cuerpo.sucursales[1]!.nombre as string]!.vencimiento).toBe('2030-06-30');
  });

  const ERRORES_DE_VALIDACION: [string, (c: ReturnType<typeof cuerpoDeAlta>) => void, RegExp][] = [
    [
      'RUC con dígito verificador incorrecto',
      (c) => {
        const bueno = c.emisores[0]!.ruc;
        const malo = bueno.slice(0, 10) + String((Number(bueno[10]) + 1) % 10);
        c.emisores[0]!.ruc = malo;
        for (const s of c.sucursales) if (s.rucEmisor === bueno) s.rucEmisor = malo;
      },
      /ruc/i,
    ],
    [
      'sucursal con un RUC que no está en la entrada',
      (c) => {
        c.sucursales[0]!.rucEmisor = rucAleatorio();
      },
      /rucEmisor/i,
    ],
    [
      'código de establecimiento sin 4 dígitos',
      (c) => {
        c.sucursales[0]!.codigoEstablecimiento = '123';
      },
      /codigoEstablecimiento/i,
    ],
    [
      'hora de corte mal formada',
      (c) => {
        c.sucursales[0]!.horaCorte = '25:00';
      },
      /horaCorte/i,
    ],
    [
      'contraseña temporal de menos de 8 caracteres',
      (c) => {
        c.administrador.contrasenaTemporal = 'corta';
      },
      /contrasenaTemporal/i,
    ],
    [
      'nombre de usuario del Administrador inválido',
      (c) => {
        c.administrador.nombreUsuario = 'Con Espacios!';
      },
      /nombreUsuario/i,
    ],
  ];

  it.each(ERRORES_DE_VALIDACION)(
    '%s responde 400 DATOS_INVALIDOS indicando el campo y no deja nada creado ni auditado',
    async (_nombre, estropear, campo) => {
      const { sa } = await sembrado();
      const cuerpo = cuerpoDeAlta({ emisores: 1, sucursalesPorEmisor: 2 });
      cuerpo.motivo = textoUnico('motivo-invalido');
      estropear(cuerpo);
      const res = await enviar(cuerpo, sa.token);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
      expect(JSON.stringify(res.body.campos)).toMatch(campo);
      await exigirNadaCreado(cuerpo);
    },
  );

  it.each([
    ['sin motivo', (c: Record<string, unknown>) => delete c.motivo],
    ['con motivo vacío', (c: Record<string, unknown>) => (c.motivo = '   ')],
    ['sin administrador', (c: Record<string, unknown>) => delete c.administrador],
    [
      'con un campo desconocido (empresaId)',
      (c: Record<string, unknown>) => (c.empresaId = randomUUID()),
    ],
  ])('%s responde 400 y no crea nada', async (_nombre, estropear) => {
    const { sa } = await sembrado();
    const cuerpo = cuerpoDeAlta();
    const nombre = cuerpo.nombre;
    estropear(cuerpo);
    const res = await enviar(cuerpo, sa.token);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await contar('empresa', 'nombre = $1', [nombre])).toBe(0);
  });

  it('un RUC ya registrado por otra empresa se rechaza y no queda creado nada (ni siquiera el primer emisor)', async () => {
    const { sa, A } = await sembrado();
    const cuerpo = cuerpoDeAlta({ emisores: 2, sucursalesPorEmisor: 1 });
    cuerpo.motivo = textoUnico('motivo-ruc-repetido');
    const anterior = cuerpo.emisores[1]!.ruc;
    cuerpo.emisores[1]!.ruc = A.emisores[0]!.ruc;
    for (const s of cuerpo.sucursales)
      if (s.rucEmisor === anterior) s.rucEmisor = A.emisores[0]!.ruc;
    const res = await enviar(cuerpo, sa.token);
    expect([400, 409]).toContain(res.status);
    expect(await contar('empresa', 'nombre = $1', [cuerpo.nombre])).toBe(0);
    expect(await contar('emisor', 'ruc = $1', [cuerpo.emisores[0]!.ruc])).toBe(0);
    expect(await filasDeAuditoria(admin, 'motivo = $1', [cuerpo.motivo])).toHaveLength(0);
  });

  it('un nombre de usuario no disponible responde 409 CONFLICTO y no deja nada creado ni auditado', async () => {
    const { sa, A } = await sembrado();
    for (const nombreUsuario of [A.admin.usuario, A.admin.usuario.toUpperCase()]) {
      const cuerpo = cuerpoDeAlta();
      cuerpo.motivo = textoUnico('motivo-usuario-repetido');
      cuerpo.administrador.nombreUsuario = nombreUsuario;
      const res = await enviar(cuerpo, sa.token);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body).toMatchObject({ codigo: 'CONFLICTO' });
      expect(await contar('empresa', 'nombre = $1', [cuerpo.nombre])).toBe(0);
      expect(await contar('emisor', 'ruc = $1', [cuerpo.emisores[0]!.ruc])).toBe(0);
      expect(await filasDeAuditoria(admin, 'motivo = $1', [cuerpo.motivo])).toHaveLength(0);
    }
  });

  it('[C1] un plan inexistente responde 422 PLAN_INVALIDO y no deja nada creado ni auditado', async () => {
    const { sa } = await sembrado();
    const cuerpo = cuerpoDeAlta();
    cuerpo.motivo = textoUnico('motivo-plan-invalido');
    cuerpo.sucursales[1]!.suscripcion = { planId: randomUUID() };
    const res = await enviar(cuerpo, sa.token);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ codigo: 'PLAN_INVALIDO' });
    await exigirNadaCreado(cuerpo);
  });

  it('[C1] un vencimiento anterior a hoy responde 400 y no deja nada creado ni auditado', async () => {
    const { sa } = await sembrado();
    const cuerpo = cuerpoDeAlta();
    cuerpo.motivo = textoUnico('motivo-vencimiento');
    cuerpo.sucursales[0]!.suscripcion = { vencimiento: '2030-02-03' }; // hoy es 2030-02-04 en Lima
    const res = await enviar(cuerpo, sa.token);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    await exigirNadaCreado(cuerpo);
  });

  it('sin sesión de superadministrador responde 401 y no crea nada', async () => {
    const cuerpo = cuerpoDeAlta();
    // Marcador único: el motivo por defecto lo comparten las altas legítimas de otras pruebas.
    cuerpo.motivo = textoUnico('motivo-sin-sesion');
    const res = await ctx.http().post('/plataforma/empresas').send(cuerpo);
    expect(res.status).toBe(401);
    await exigirNadaCreado(cuerpo);
  });
});

// ------------------------------------------------------------------------------------------------
// 64 · Emisores y sucursales por plataforma
// ------------------------------------------------------------------------------------------------
describe('criterio 64 · emisores y sucursales por plataforma', () => {
  it('POST /plataforma/empresas/:id/emisores crea el emisor y lo audita con el superadministrador', async () => {
    const { sa, A } = await sembrado();
    const ruc = rucAleatorio();
    const motivo = textoUnico('motivo-emisor');
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/emisores`)
      .set(bearer(sa.token))
      .send({ ruc, razonSocial: 'Emisor por plataforma SAC', regimen: 'RER', motivo });
    exigirEstado(res, 201, 'agregar emisor');
    expect(res.body).toMatchObject({
      ruc,
      empresaId: A.empresaId,
      razonSocial: 'Emisor por plataforma SAC',
    });
    const fila = await admin.query('SELECT empresa_id, regimen FROM emisor WHERE ruc = $1', [ruc]);
    expect(fila.rows).toEqual([{ empresa_id: A.empresaId, regimen: 'RER' }]);
    const auditoria = await filasDeAuditoria(admin, "accion = 'agregar_emisor' AND motivo = $1", [
      motivo,
    ]);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      empresa_id: A.empresaId,
      actor_superadministrador_id: sa.id,
    });
  });

  it('[C1] POST /plataforma/empresas/:id/sucursales crea la sucursal con su suscripción y la audita', async () => {
    const { sa, A } = await sembrado();
    const nombre = textoUnico('Sucursal-plataforma');
    const motivo = textoUnico('motivo-sucursal');
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/sucursales`)
      .set(bearer(sa.token))
      .send({
        rucEmisor: A.emisores[0]!.ruc,
        nombre,
        codigoEstablecimiento: String(3000 + randomInt(0, 6000)),
        direccion: 'Av. Plataforma 100',
        suscripcion: { vencimiento: '2030-12-31' },
        motivo,
      });
    exigirEstado(res, 201, 'agregar sucursal');
    expect(res.body).toMatchObject({ nombre, suscripcion: { vencimiento: '2030-12-31' } });
    const fila = await admin.query('SELECT empresa_id FROM sucursal WHERE id = $1', [res.body.id]);
    expect(fila.rows).toEqual([{ empresa_id: A.empresaId }]);
    const auditoria = await filasDeAuditoria(admin, "accion = 'agregar_sucursal' AND motivo = $1", [
      motivo,
    ]);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      empresa_id: A.empresaId,
      actor_superadministrador_id: sa.id,
    });
  });

  it('una empresa inexistente responde 404 NO_ENCONTRADO en ambas rutas y no crea nada', async () => {
    const { sa } = await sembrado();
    const ruc = rucAleatorio();
    const nombre = textoUnico('Sucursal-fantasma');
    const emisor = await ctx
      .http()
      .post(`/plataforma/empresas/${randomUUID()}/emisores`)
      .set(bearer(sa.token))
      .send({ ruc, razonSocial: 'Fantasma SAC', regimen: 'GENERAL', motivo: 'prueba' });
    expect(emisor.status).toBe(404);
    expect(emisor.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
    const sucursal = await ctx
      .http()
      .post(`/plataforma/empresas/${randomUUID()}/sucursales`)
      .set(bearer(sa.token))
      .send({
        rucEmisor: ruc,
        nombre,
        codigoEstablecimiento: '0001',
        direccion: 'Calle 1',
        motivo: 'prueba',
      });
    expect(sucursal.status).toBe(404);
    expect((await admin.query('SELECT 1 FROM emisor WHERE ruc = $1', [ruc])).rows).toHaveLength(0);
    expect(
      (await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [nombre])).rows,
    ).toHaveLength(0);
  });

  it('sin motivo (o vacío) responde 400 y no crea nada', async () => {
    const { sa, A } = await sembrado();
    const ruc = rucAleatorio();
    for (const motivo of [undefined, '', '   ']) {
      const res = await ctx
        .http()
        .post(`/plataforma/empresas/${A.empresaId}/emisores`)
        .set(bearer(sa.token))
        .send({
          ruc,
          razonSocial: 'Sin motivo SAC',
          regimen: 'GENERAL',
          ...(motivo === undefined ? {} : { motivo }),
        });
      expect(res.status, `motivo ${JSON.stringify(motivo)}`).toBe(400);
    }
    expect((await admin.query('SELECT 1 FROM emisor WHERE ruc = $1', [ruc])).rows).toHaveLength(0);
  });

  it('una sucursal con un emisor que no es de esa empresa responde 422 y no crea nada', async () => {
    const { sa, A, B } = await sembrado();
    const nombre = textoUnico('Sucursal-emisor-ajeno');
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/sucursales`)
      .set(bearer(sa.token))
      .send({
        rucEmisor: B.emisores[0]!.ruc,
        nombre,
        codigoEstablecimiento: String(3000 + randomInt(0, 6000)),
        direccion: 'Calle 2',
        motivo: 'prueba',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(
      (await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [nombre])).rows,
    ).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------
// 65 · Consulta
// ------------------------------------------------------------------------------------------------
describe('criterio 65 · GET /plataforma/empresas y GET /plataforma/empresas/:id', () => {
  it('[C1] la lista incluye las empresas con sus sucursales y el estado de cada suscripción', async () => {
    const { sa, A } = await sembrado();
    const res = await ctx.http().get('/plataforma/empresas').set(bearer(sa.token));
    exigirEstado(res, 200, 'lista');
    const lista = empresaPlataformaResumenSchema.array().parse(res.body);
    const empresa = lista.find((e) => e.id === A.empresaId);
    expect(empresa, 'la empresa A está en la lista').toBeDefined();
    expect(empresa!.nombre).toBe(A.nombre);
    expect(empresa!.sucursales.map((s) => s.id).sort()).toEqual(
      A.sucursales.map((s) => s.id).sort(),
    );
    for (const s of empresa!.sucursales) expect(s.estadoSuscripcion).toBe('ACTIVA');
  });

  it('[C1] el estado de la suscripción se calcula con el reloj de la API (activa, en gracia, suspendida)', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, {
      conSesion: false,
      ajustar: (cuerpo) => {
        for (const s of cuerpo.sucursales) s.suscripcion = { vencimiento: '2030-02-10' };
      },
    });
    const estadoEn = async (instante: string) => {
      ctx.reloj.fijar(instante);
      // Una sesión de superadministrador dura 8 horas: se abre una nueva con el reloj ya movido.
      const vigente = await nuevoSuperadmin(ctx);
      const res = await ctx.http().get('/plataforma/empresas').set(bearer(vigente.token));
      exigirEstado(res, 200, `lista en ${instante}`);
      const fila = empresaPlataformaResumenSchema
        .array()
        .parse(res.body)
        .find((e) => e.id === empresa.empresaId)!;
      return [...new Set(fila.sucursales.map((s) => s.estadoSuscripcion))];
    };
    expect(await estadoEn('2030-02-10T23:59:00-05:00')).toEqual(['ACTIVA']);
    expect(await estadoEn('2030-02-11T00:00:00-05:00')).toEqual(['EN_GRACIA']);
    expect(await estadoEn('2030-02-17T12:00:00-05:00')).toEqual(['EN_GRACIA']);
    expect(await estadoEn('2030-02-18T00:00:00-05:00')).toEqual(['SUSPENDIDA']);
  });

  it('[C1] el detalle devuelve emisores, sucursales, suscripciones y administradores (sin hashes ni PIN)', async () => {
    const { sa, A } = await sembrado();
    const res = await ctx.http().get(`/plataforma/empresas/${A.empresaId}`).set(bearer(sa.token));
    exigirEstado(res, 200, 'detalle');
    const detalle = empresaPlataformaDetalleSchema.parse(res.body);
    expect(detalle.id).toBe(A.empresaId);
    expect(detalle.emisores.map((e) => e.ruc).sort()).toEqual(A.emisores.map((e) => e.ruc).sort());
    expect(detalle.sucursales.map((s) => s.id).sort()).toEqual(
      A.sucursales.map((s) => s.id).sort(),
    );
    expect(detalle.suscripciones).toHaveLength(A.sucursales.length);
    expect(detalle.administradores).toContainEqual({
      id: A.admin.id,
      nombre: expect.any(String),
      nombreUsuario: A.admin.usuario,
      activo: true,
    });
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/hash|huella/i);
    expect(texto).not.toContain(A.admin.pin);
  });

  it('una empresa inexistente responde 404 NO_ENCONTRADO', async () => {
    const { sa } = await sembrado();
    const res = await ctx.http().get(`/plataforma/empresas/${randomUUID()}`).set(bearer(sa.token));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});
