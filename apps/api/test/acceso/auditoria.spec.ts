// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P7 · Criterios 54 a 60 (auditoría general, RF-13, RNF-09, ruta crítica):
// - 54 inmutable para `restaurante_api`, `restaurante_plataforma` y `restaurante_migrador`;
// - 55 aislada por empresa (las filas sin empresa no las ve nunca la API);
// - 56 la unión con `auditoria_plataforma` (base con filas de 001 antes de migrar, revertir y volver);
// - 57 contenido de cada fila (actor exacto, empresa, sucursal, equipo, sesión) por cada vía;
// - 58 una fila por acción de la lista cerrada, en la misma transacción que el cambio, y los rechazos y
//   bloqueos guardados aunque la petición responda un error;
// - 59 sin secretos (contraseñas, PIN, tokens ni sus huellas);
// - 60 `ocurrido_en` es la hora del reloj de la API.
// Usa la API real con `RelojManual`, sin `EMPRESA_POR_HEADER`.
import { Controller, Post } from '@nestjs/common';
import type { Client } from 'pg';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlataformaEmpresasService } from '../../src/modulos/plataforma';
import { AuditoriaService } from '../../src/modulos/auditoria';
import { SoloAdministrador } from '../../src/modulos/seguridad';
import { crearSuperadministrador } from '../../scripts/lib/superadministrador';
import { abrirCliente } from '../utilidades';
import {
  type EmpresaSql,
  conActor,
  crearEmpresaSql,
  datosDeEmpresa,
  enTransaccion,
  errorDe,
  fijarActorDePrueba,
  rucAleatorio,
  textoUnico,
} from '../aislamiento/fabrica';
import {
  MINUTO,
  PREFIJO_AUDITORIA_GENERAL,
  PREFIJO_CONTEXTO_UNICO,
  altaEmpresa,
  arrancar,
  bearer,
  cambiarContrasena,
  checkAcepta,
  contrasenaUnica,
  crearBaseNueva,
  crearUsuario,
  crearUsuarioConSesion,
  elegirSucursal,
  exigirEstado,
  filasDeAuditoria,
  ingresar,
  ingresarOk,
  migrarHasta,
  nuevoSuperadmin,
  partesDeToken,
  recordarEquipo,
  revertirHasta,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from './fabrica-plataforma';

/** Lunes 7 de enero de 2030, 10:00 en Lima: lejos de la hora real, para que `now()` de la base no pase por reloj. */
const INICIO = '2030-01-07T10:00:00-05:00';

/** Controlador sonda: audita con `AuditoriaService` dentro de la transacción de la petición. */
@Controller('sonda-auditoria')
class SondaAuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Post('bien')
  @SoloAdministrador()
  async bien() {
    await this.auditoria.registrar({ accion: 'sonda_bien', motivo: 'sonda', entidad: 'sonda' });
    return { ok: true };
  }

  @Post('falla')
  @SoloAdministrador()
  async falla(): Promise<never> {
    await this.auditoria.registrar({ accion: 'sonda_falla', motivo: 'sonda', entidad: 'sonda' });
    throw new Error('falla a propósito después de auditar');
  }
}

let ctx: AppDePrueba;
let admin: Client;
let api: Client;
let plataforma: Client;
let migrador: Client;
/** Empresas A y B creadas por SQL (para las pruebas de la base: criterios 54 y 55). */
let sqlA: EmpresaSql;
let sqlB: EmpresaSql;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO, controladoresExtra: [SondaAuditoriaController] });
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  plataforma = await abrirCliente('plataforma');
  migrador = await abrirCliente('migrador');
});

afterAll(async () => {
  await ctx?.cerrar();
  for (const c of [admin, api, plataforma, migrador]) await c?.end();
});

/** Siembra perezosa por HTTP: cada prueba que la necesita falla por sí sola mientras falte la funcionalidad. */
interface Sembrado {
  sa: SuperadminDePrueba;
  A: EmpresaDePrueba;
  B: EmpresaDePrueba;
}
let sembradoPendiente: Promise<Sembrado> | undefined;
function sembrado(): Promise<Sembrado> {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    return { sa, A: await altaEmpresa(ctx, sa), B: await altaEmpresa(ctx, sa) };
  })();
  return sembradoPendiente;
}

async function empresasSql(): Promise<void> {
  sqlA ??= await crearEmpresaSql(plataforma);
  sqlB ??= await crearEmpresaSql(plataforma);
}

/** Inserta una fila de auditoría por SQL como `restaurante_plataforma`; el actor lo pone la base. */
async function insertarFila(datos: {
  empresaId: string | null;
  origen: 'empresa' | 'plataforma';
  motivo: string;
  actor?: string;
}): Promise<string> {
  return conActor(
    plataforma,
    async () => {
      const { rows } = await plataforma.query<{ id: string }>(
        `INSERT INTO auditoria (empresa_id, origen, accion, motivo, detalle, ocurrido_en)
         VALUES ($1, $2, 'prueba_auditoria', $3, '{}'::jsonb, now()) RETURNING id`,
        [datos.empresaId, datos.origen, datos.motivo],
      );
      return rows[0]!.id;
    },
    { sistema: datos.actor ?? 'prueba-auditoria' },
  );
}

const fotoDeFilas = async (ids: string[]) =>
  (
    await admin.query(
      'SELECT to_jsonb(a) AS fila FROM auditoria a WHERE id = ANY($1::uuid[]) ORDER BY id',
      [ids],
    )
  ).rows.map((f) => f.fila);

// ------------------------------------------------------------------------------------------------
// 54 · Inmutable
// ------------------------------------------------------------------------------------------------
describe('criterio 54 · la tabla auditoria es inmutable para los tres roles', () => {
  it.each(['api', 'plataforma', 'migrador'] as const)(
    '%s no puede UPDATE, DELETE ni TRUNCATE y las filas no cambian',
    async (rol) => {
      await empresasSql();
      const cliente = { api, plataforma, migrador }[rol];
      const filaA = await insertarFila({
        empresaId: sqlA.id,
        origen: 'empresa',
        motivo: textoUnico('inmutable'),
      });
      const filaSin = await insertarFila({
        empresaId: null,
        origen: 'plataforma',
        motivo: textoUnico('inmutable'),
      });
      const antes = await fotoDeFilas([filaA, filaSin]);
      expect(antes).toHaveLength(2);

      const intentos: [string, string, unknown[]][] = [
        ['UPDATE por id', "UPDATE auditoria SET motivo = 'alterado' WHERE id = $1", [filaA]],
        ['UPDATE sin WHERE', "UPDATE auditoria SET motivo = 'alterado'", []],
        ['DELETE por id', 'DELETE FROM auditoria WHERE id = $1', [filaA]],
        ['DELETE sin WHERE', 'DELETE FROM auditoria', []],
        ['TRUNCATE', 'TRUNCATE auditoria', []],
      ];
      for (const [nombre, sql, parametros] of intentos) {
        // Dentro de una transacción que siempre se revierte: si algo tuviera éxito, no borraría la auditoría
        // que otras pruebas están leyendo en la misma base.
        await cliente.query('BEGIN');
        try {
          if (rol === 'api') {
            await fijarActorDePrueba(cliente);
            await cliente.query('SELECT fijar_contexto_empresa($1)', [sqlA.id]);
          }
          const error = await errorDe(cliente.query(sql, parametros));
          expect(error.code, `${rol}: ${nombre}: ${error.message}`).not.toBe('42P01'); // la tabla existe
          expect(error.message, `${rol}: ${nombre}`).toBeTruthy();
        } finally {
          await cliente.query('ROLLBACK');
        }
      }
      expect(await fotoDeFilas([filaA, filaSin])).toEqual(antes);
    },
  );
});

// ------------------------------------------------------------------------------------------------
// 55 · Aislada
// ------------------------------------------------------------------------------------------------
describe('criterio 55 · la API solo ve las filas de su empresa', () => {
  it('con el contexto de A solo se ven filas de A; las de B y las sin empresa no se ven nunca', async () => {
    await empresasSql();
    const marca = textoUnico('aislada');
    const filaA = await insertarFila({ empresaId: sqlA.id, origen: 'empresa', motivo: marca });
    const filaB = await insertarFila({ empresaId: sqlB.id, origen: 'empresa', motivo: marca });
    const filaSin = await insertarFila({ empresaId: null, origen: 'plataforma', motivo: marca });

    await enTransaccion(api, sqlA.id, async () => {
      const porMarca = await api.query<{ id: string }>(
        'SELECT id FROM auditoria WHERE motivo = $1',
        [marca],
      );
      expect(porMarca.rows.map((f) => f.id)).toEqual([filaA]);
      const sinEmpresa = await api.query('SELECT id FROM auditoria WHERE empresa_id IS NULL');
      expect(sinEmpresa.rows).toEqual([]);
      const todas = await api.query<{ empresa_id: string }>('SELECT empresa_id FROM auditoria');
      expect(todas.rows.length).toBeGreaterThan(0);
      expect(todas.rows.every((f) => f.empresa_id === sqlA.id)).toBe(true);
      const porId = await api.query('SELECT id FROM auditoria WHERE id = ANY($1::uuid[])', [
        [filaB, filaSin],
      ]);
      expect(porId.rows).toEqual([]);
    });
  });

  it('sin contexto de empresa la API no lee la auditoría (42501)', async () => {
    await empresasSql();
    const error = await errorDe(api.query('SELECT id FROM auditoria'));
    expect(error.code, error.message).toBe('42501');
  });

  it('con el contexto de A la API no puede insertar filas de B ni sin empresa, pero sí de A', async () => {
    await empresasSql();
    await enTransaccion(api, sqlA.id, async () => {
      const insertar = (empresaId: string | null) =>
        api.query(
          `INSERT INTO auditoria (empresa_id, origen, accion, detalle, ocurrido_en)
           VALUES ($1, 'empresa', 'prueba_api', '{}'::jsonb, now())`,
          [empresaId],
        );
      for (const [nombre, empresaId] of [
        ['de B', sqlB.id],
        ['sin empresa', null],
      ] as const) {
        await api.query('SAVEPOINT intento');
        const error = await errorDe(insertar(empresaId));
        expect(error.code, `${nombre}: ${error.message}`).toBe('42501');
        // El rechazo es el de la política RLS, no el de la falta de actor (el actor está fijado).
        expect(error.message, nombre).toMatch(/row-level security/);
        await api.query('ROLLBACK TO SAVEPOINT intento');
      }
      const propia = await insertar(sqlA.id);
      expect(propia.rowCount).toBe(1);
    });
  });

  it('restaurante_plataforma ve las filas de todas las empresas y las de plataforma sin empresa', async () => {
    await empresasSql();
    const marca = textoUnico('plataforma-ve');
    const ids = [
      await insertarFila({ empresaId: sqlA.id, origen: 'empresa', motivo: marca }),
      await insertarFila({ empresaId: sqlB.id, origen: 'empresa', motivo: marca }),
      await insertarFila({ empresaId: null, origen: 'plataforma', motivo: marca }),
    ];
    const { rows } = await plataforma.query<{ id: string }>(
      'SELECT id FROM auditoria WHERE motivo = $1',
      [marca],
    );
    expect(rows.map((f) => f.id).sort()).toEqual([...ids].sort());
  });
});

// ------------------------------------------------------------------------------------------------
// 56 · Unión con auditoria_plataforma
// ------------------------------------------------------------------------------------------------
describe('criterio 56 · la migración copia auditoria_plataforma a auditoria y se puede revertir', () => {
  let base: Awaited<ReturnType<typeof crearBaseNueva>>;
  let clientePlataforma: Client;
  let clienteAdmin: Client;

  interface Fila001 {
    ocurrido_en: Date;
    actor: string;
    operacion: string;
    motivo: string;
    empresa_id: string | null;
    detalle: unknown;
  }
  const MARCA = `union-${randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await clientePlataforma?.end().catch(() => undefined);
    await clienteAdmin?.end().catch(() => undefined);
    await base?.eliminar();
  });

  async function filasEn001(): Promise<Fila001[]> {
    const { rows } = await clientePlataforma.query<Fila001>(
      `SELECT ocurrido_en, actor, operacion, motivo, empresa_id, detalle
         FROM auditoria_plataforma WHERE motivo LIKE $1 ORDER BY ocurrido_en, motivo`,
      [`${MARCA}%`],
    );
    return rows;
  }

  async function filasEnAuditoria(): Promise<Record<string, unknown>[]> {
    const { rows } = await clienteAdmin.query(
      `SELECT ocurrido_en, origen, accion, actor_usuario_id, actor_superadministrador_id, actor_sistema,
              motivo, empresa_id, detalle
         FROM auditoria WHERE motivo LIKE $1 ORDER BY ocurrido_en, motivo`,
      [`${MARCA}%`],
    );
    return rows;
  }

  it('prepara una base con las migraciones de 001 y filas en auditoria_plataforma', async () => {
    base = await crearBaseNueva('auditoria');
    await migrarHasta(base.base, PREFIJO_CONTEXTO_UNICO);
    clientePlataforma = await abrirCliente('plataforma', base.base);
    clienteAdmin = await abrirCliente('admin', base.base);
    const empresa = await clientePlataforma.query<{ id: string }>(
      'INSERT INTO empresa (nombre, creado_en, actualizado_en) VALUES ($1, now(), now()) RETURNING id',
      [textoUnico('Empresa-union')],
    );
    const empresaId = empresa.rows[0]!.id;
    const filas: [string, string, string, string | null, unknown, string][] = [
      [
        'semilla',
        'registrar_empresa',
        `${MARCA}-1`,
        empresaId,
        { a: 1, lista: ['x', 'y'] },
        '2026-05-01T12:34:56.789Z',
      ],
      ['cli:prueba', 'agregar_sucursal', `${MARCA}-2`, null, {}, '2026-06-02T01:02:03.000Z'],
      [
        'Persona con ñ y espacios',
        'agregar_emisor',
        `${MARCA}-3`,
        empresaId,
        { ruc: '20123456789' },
        '2026-07-03T23:59:59.123Z',
      ],
    ];
    for (const [actor, operacion, motivo, empresa_id, detalle, ocurrido] of filas) {
      await clientePlataforma.query(
        `INSERT INTO auditoria_plataforma (ocurrido_en, actor, operacion, motivo, empresa_id, detalle)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [ocurrido, actor, operacion, motivo, empresa_id, JSON.stringify(detalle)],
      );
    }
    expect(await filasEn001()).toHaveLength(3);
  });

  it('al migrar, cada fila queda en auditoria con origen plataforma y sus campos; auditoria_plataforma deja de existir', async () => {
    const antes = await filasEn001();
    await migrarHasta(base.base);
    const despues = await filasEnAuditoria();
    expect(despues).toHaveLength(antes.length);
    antes.forEach((fila, i) => {
      const copia = despues[i]!;
      expect(copia.origen).toBe('plataforma');
      expect(copia.accion).toBe(fila.operacion);
      expect(copia.actor_sistema).toBe(fila.actor);
      expect(copia.actor_usuario_id).toBeNull();
      expect(copia.actor_superadministrador_id).toBeNull();
      expect(copia.motivo).toBe(fila.motivo);
      expect(copia.empresa_id).toBe(fila.empresa_id);
      expect(copia.detalle).toEqual(fila.detalle);
      expect((copia.ocurrido_en as Date).getTime()).toBe(fila.ocurrido_en.getTime());
    });
    const existe = await clienteAdmin.query(
      "SELECT to_regclass('public.auditoria_plataforma') AS tabla",
    );
    expect(existe.rows[0].tabla).toBeNull();
  });

  it('las filas copiadas siguen siendo inmutables', async () => {
    const error = await errorDe(
      clienteAdmin.query("UPDATE auditoria SET motivo = 'alterado' WHERE motivo LIKE $1", [
        `${MARCA}%`,
      ]),
    );
    expect(error.code, error.message).not.toBe('42P01');
    expect(error.message).toBeTruthy();
    expect(await filasEnAuditoria()).toHaveLength(3);
  });

  it('revertir la migración devuelve las filas de origen plataforma a auditoria_plataforma', async () => {
    const copiadas = await filasEnAuditoria();
    await revertirHasta(base.base, PREFIJO_AUDITORIA_GENERAL);
    const existe = await clienteAdmin.query(
      `SELECT to_regclass('public.auditoria_plataforma') AS vieja, to_regclass('public.auditoria') AS nueva`,
    );
    expect(existe.rows[0]).toEqual({ vieja: 'auditoria_plataforma', nueva: null });
    const vueltas = await filasEn001();
    expect(vueltas).toHaveLength(copiadas.length);
    copiadas.forEach((copia, i) => {
      const fila = vueltas[i]!;
      expect(fila.operacion).toBe(copia.accion);
      expect(fila.actor).toBe(copia.actor_sistema);
      expect(fila.motivo).toBe(copia.motivo);
      expect(fila.empresa_id).toBe(copia.empresa_id);
      expect(fila.detalle).toEqual(copia.detalle);
      expect(fila.ocurrido_en.getTime()).toBe((copia.ocurrido_en as Date).getTime());
    });
  });

  it('volver a migrar deja otra vez las tres filas, sin duplicados', async () => {
    await migrarHasta(base.base);
    expect(await filasEnAuditoria()).toHaveLength(3);
  });
});

// ------------------------------------------------------------------------------------------------
// 57 · Contenido de cada fila
// ------------------------------------------------------------------------------------------------
describe('criterio 57 · actor exacto, empresa, sucursal, equipo, sesión y fecha de cada fila', () => {
  it('una restricción de la base exige exactamente uno de actor_usuario_id, actor_superadministrador_id o actor_sistema', async () => {
    const combinaciones: [boolean, boolean, boolean][] = [
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, true, false],
      [true, false, true],
      [false, true, true],
      [true, true, true],
    ];
    for (const [usuario, superadmin, sistema] of combinaciones) {
      const valores: Record<string, unknown> = {
        ocurrido_en: new Date(),
        origen: 'empresa',
        accion: 'prueba_check',
        detalle: '{}',
      };
      if (usuario) valores.actor_usuario_id = randomUUID();
      if (superadmin) valores.actor_superadministrador_id = randomUUID();
      if (sistema) valores.actor_sistema = 'prueba';
      const esperado = [usuario, superadmin, sistema].filter(Boolean).length === 1;
      expect(
        await checkAcepta(admin, 'auditoria', valores),
        `usuario=${usuario} superadministrador=${superadmin} sistema=${sistema}`,
      ).toBe(esperado);
    }
  });

  it('plataforma por HTTP: registrar_empresa lleva el id del superadministrador, la empresa y el motivo', async () => {
    const { sa } = await sembrado();
    const motivo = textoUnico('motivo-http');
    const empresa = await altaEmpresa(ctx, sa, {
      conSesion: false,
      ajustar: (cuerpo) => {
        cuerpo.motivo = motivo;
      },
    });
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'registrar_empresa'",
      [empresa.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      origen: 'plataforma',
      actor_superadministrador_id: sa.id,
      actor_usuario_id: null,
      actor_sistema: null,
      equipo_id: null,
      motivo,
    });
  });

  it('plataforma por HTTP: agregar_emisor y agregar_sucursal llevan el id del superadministrador', async () => {
    const { sa, A } = await sembrado();
    const motivo = textoUnico('motivo-agregar');
    const emisor = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/emisores`)
      .set(bearer(sa.token))
      .send({
        ruc: rucAleatorio(),
        razonSocial: 'Emisor agregado SAC',
        regimen: 'GENERAL',
        motivo,
      });
    exigirEstado(emisor, 201, 'agregar emisor');
    const sucursal = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/sucursales`)
      .set(bearer(sa.token))
      .send({
        rucEmisor: A.emisores[0]!.ruc,
        nombre: textoUnico('Sucursal-agregada'),
        codigoEstablecimiento: String(3000 + randomInt(0, 6000)),
        direccion: 'Jr. Agregada 1',
        motivo,
      });
    exigirEstado(sucursal, 201, 'agregar sucursal');
    for (const accion of ['agregar_emisor', 'agregar_sucursal']) {
      const filas = await filasDeAuditoria(admin, 'motivo = $1 AND accion = $2', [motivo, accion]);
      expect(filas, accion).toHaveLength(1);
      expect(filas[0], accion).toMatchObject({
        origen: 'plataforma',
        empresa_id: A.empresaId,
        actor_superadministrador_id: sa.id,
        actor_usuario_id: null,
        actor_sistema: null,
      });
    }
  });

  it('script y semilla: crearSuperadministrador deja actor_sistema cli:superadmin sin empresa', async () => {
    const usuario = usuarioUnico('sa-script');
    const { id } = await crearSuperadministrador({
      usuario,
      nombre: 'Creado por script',
      contrasena: contrasenaUnica(),
    });
    const filas = await filasDeAuditoria(
      admin,
      "accion = 'crear_superadministrador' AND (entidad_id::text = $1 OR detalle::text LIKE '%' || $2 || '%')",
      [id, usuario],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      origen: 'plataforma',
      empresa_id: null,
      actor_sistema: 'cli:superadmin',
      actor_usuario_id: null,
      actor_superadministrador_id: null,
    });
  });

  it('semilla y script: registrarEmpresa con actor de texto deja actor_sistema; con { superadministradorId } deja el superadministrador', async () => {
    const { sa } = await sembrado();
    const servicio = ctx.app.get(PlataformaEmpresasService);
    const delSistema = await servicio.registrarEmpresa(datosDeEmpresa(), {
      actor: 'semilla',
      motivo: textoUnico('motivo-semilla'),
    });
    const filaSistema = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'registrar_empresa'",
      [delSistema.empresaId],
    );
    expect(filaSistema).toHaveLength(1);
    expect(filaSistema[0]).toMatchObject({
      origen: 'plataforma',
      actor_sistema: 'semilla',
      actor_usuario_id: null,
      actor_superadministrador_id: null,
    });

    const delSuper = await servicio.registrarEmpresa(datosDeEmpresa(), {
      actor: { superadministradorId: sa.id },
      motivo: textoUnico('motivo-super'),
    } as never);
    const filaSuper = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'registrar_empresa'",
      [delSuper.empresaId],
    );
    expect(filaSuper).toHaveLength(1);
    expect(filaSuper[0]).toMatchObject({
      actor_superadministrador_id: sa.id,
      actor_sistema: null,
      actor_usuario_id: null,
    });
  });

  it('sesión de contraseña sin equipo: crear_emisor lleva el usuario, la empresa y la sesión, sin equipo', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const respuesta = await ctx
      .http()
      .post('/emisores')
      .set(bearer(empresa.admin.token))
      .send({ ruc: rucAleatorio(), razonSocial: 'Nuevo emisor SAC', regimen: 'GENERAL' });
    exigirEstado(respuesta, 201, 'crear emisor');
    const filas = await filasDeAuditoria(admin, "empresa_id = $1 AND accion = 'crear_emisor'", [
      empresa.empresaId,
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      origen: 'empresa',
      actor_usuario_id: empresa.admin.id,
      actor_superadministrador_id: null,
      actor_sistema: null,
      equipo_id: null,
      sesion_id: partesDeToken(empresa.admin.token).sesionId,
    });
  });

  it('sesión con equipo recordado: configurar_sucursal lleva el equipo, la sucursal y la sesión', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const sucursal = empresa.sucursales[0]!;
    await elegirSucursal(ctx, empresa.admin.token, sucursal.id);
    const { equipo } = await recordarEquipo(ctx, empresa.admin.token, {
      nombre: 'Celular de prueba',
    });
    const cambio = await ctx
      .http()
      .patch(`/sucursales/${sucursal.id}`)
      .set(bearer(empresa.admin.token))
      .send({ direccion: 'Nueva dirección 123' });
    exigirEstado(cambio, 200, 'configurar sucursal');
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'configurar_sucursal'",
      [empresa.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_usuario_id: empresa.admin.id,
      equipo_id: equipo.id,
      sucursal_id: sucursal.id,
      sesion_id: partesDeToken(empresa.admin.token).sesionId,
    });
  });

  it('sesión de soporte: inicio_soporte, la acción y fin_soporte llevan el superadministrador y la sesión de soporte', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    const motivo = textoUnico('motivo-soporte');
    const inicio = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo, sucursalId: empresa.sucursales[0]!.id });
    exigirEstado(inicio, 201, 'inicio de soporte');
    const token = inicio.body.token as string;
    const sesionId = partesDeToken(token).sesionId;

    const accion = await ctx
      .http()
      .patch(`/sucursales/${empresa.sucursales[0]!.id}`)
      .set(bearer(token))
      .send({ direccion: 'Cambiada en soporte' });
    exigirEstado(accion, 200, 'acción en soporte');
    const fin = await ctx.http().delete('/sesion').set(bearer(token));
    exigirEstado(fin, 204, 'fin de soporte');

    const filas = await filasDeAuditoria(admin, 'empresa_id = $1', [empresa.empresaId]);
    const deAccion = (nombre: string) => filas.filter((f) => f.accion === nombre);
    expect(deAccion('inicio_soporte')).toHaveLength(1);
    expect(deAccion('inicio_soporte')[0]).toMatchObject({
      origen: 'plataforma',
      actor_superadministrador_id: sa.id,
      actor_usuario_id: null,
      motivo,
    });
    expect(deAccion('configurar_sucursal')).toHaveLength(1);
    expect(deAccion('configurar_sucursal')[0]).toMatchObject({
      origen: 'empresa',
      actor_superadministrador_id: sa.id,
      actor_usuario_id: null,
      actor_sistema: null,
      equipo_id: null,
      sesion_id: sesionId,
    });
    expect(deAccion('fin_soporte')).toHaveLength(1);
    expect(deAccion('fin_soporte')[0]).toMatchObject({
      actor_superadministrador_id: sa.id,
      sesion_id: sesionId,
    });
  });

  it('los valores que se envían en las columnas del actor se ignoran: manda el contexto de actor de la transacción', async () => {
    const { A } = await sembrado();
    const marca = textoUnico('ignora-actor');
    const impostor = randomUUID();
    await enTransaccion(
      api,
      A.empresaId,
      async () => {
        await api.query(
          `INSERT INTO auditoria (empresa_id, origen, accion, motivo, detalle, ocurrido_en,
                                  actor_usuario_id, actor_superadministrador_id, actor_sistema, equipo_id)
           VALUES ($1, 'empresa', 'prueba_actor', $2, '{}'::jsonb, now(), $3, $3, 'impostor', $3)`,
          [A.empresaId, marca, impostor],
        );
      },
      { confirmar: true, actor: 'actor-real-57' },
    );
    const filas = await filasDeAuditoria(admin, 'motivo = $1', [marca]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_sistema: 'actor-real-57',
      actor_usuario_id: null,
      actor_superadministrador_id: null,
      equipo_id: null,
    });
  });
});

// ------------------------------------------------------------------------------------------------
// 58 · Eventos auditados
// ------------------------------------------------------------------------------------------------
describe('criterio 58 · cada acción de la lista deja exactamente una fila', () => {
  /** Cuenta las filas de una acción en una empresa. */
  const contarEn = async (empresaId: string, accion: string) =>
    Number(
      (
        await admin.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM auditoria WHERE empresa_id = $1 AND accion = $2',
          [empresaId, accion],
        )
      ).rows[0]!.n,
    );

  it('las acciones de empresa de la sección dejan una sola fila cada una, con su actor', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const token = empresa.admin.token;
    const http = ctx.http;
    const sucursalId = empresa.sucursales[0]!.id;
    const trabajador = await crearUsuario(ctx, token, {
      accesos: [{ sucursalId, rol: 'MOZO' }],
    });
    const aEjecutar: [string, string, () => Promise<{ status: number; body: unknown }>, number][] =
      [
        [
          'crear_emisor',
          empresa.admin.id,
          () =>
            http()
              .post('/emisores')
              .set(bearer(token))
              .send({ ruc: rucAleatorio(), razonSocial: 'Segundo emisor SAC', regimen: 'RER' }),
          201,
        ],
        [
          'crear_sucursal',
          empresa.admin.id,
          () =>
            http()
              .post('/sucursales')
              .set(bearer(token))
              .send({
                rucEmisor: empresa.emisores[0]!.ruc,
                nombre: textoUnico('Sucursal-auditada'),
                codigoEstablecimiento: String(3000 + randomInt(0, 6000)),
                direccion: 'Av. Auditada 1',
              }),
          201,
        ],
        [
          'configurar_sucursal',
          empresa.admin.id,
          () =>
            http()
              .patch(`/sucursales/${sucursalId}`)
              .set(bearer(token))
              .send({ direccion: 'Dirección auditada 2' }),
          200,
        ],
        [
          'modificar_usuario',
          empresa.admin.id,
          () =>
            http()
              .patch(`/usuarios/${trabajador.id}`)
              .set(bearer(token))
              .send({ nombre: 'Nombre nuevo' }),
          200,
        ],
        [
          'regenerar_pin',
          empresa.admin.id,
          () => http().post(`/usuarios/${trabajador.id}/pin`).set(bearer(token)),
          200,
        ],
        [
          'restablecer_contrasena',
          empresa.admin.id,
          () =>
            http()
              .post(`/usuarios/${trabajador.id}/contrasena`)
              .set(bearer(token))
              .send({ contrasenaTemporal: contrasenaUnica() }),
          204,
        ],
      ];
    for (const [accion, actorId, ejecutar, estado] of aEjecutar) {
      const antes = await contarEn(empresa.empresaId, accion);
      const res = await ejecutar();
      exigirEstado(res, estado, accion);
      expect(await contarEn(empresa.empresaId, accion), accion).toBe(antes + 1);
      const ultima = (
        await filasDeAuditoria(admin, 'empresa_id = $1 AND accion = $2', [
          empresa.empresaId,
          accion,
        ])
      ).at(-1)!;
      expect(ultima.actor_usuario_id, accion).toBe(actorId);
    }
    // crear_usuario quedó de la alta del trabajador, también una vez.
    expect(await contarEn(empresa.empresaId, 'crear_usuario')).toBe(1);
  });

  it('cambiar_contrasena queda a nombre de la propia persona', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const usuario = await crearUsuario(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'CAJERO' }],
    });
    const { token } = await ingresarOk(ctx, usuario.usuario, usuario.contrasenaTemporal);
    await cambiarContrasena(ctx, token, usuario.contrasenaTemporal, contrasenaUnica());
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'cambiar_contrasena'",
      [empresa.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_usuario_id: usuario.id,
      sesion_id: partesDeToken(token).sesionId,
    });
  });

  it('recordar_equipo y olvidar_equipo dejan una fila cada una con el equipo y la persona', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const { equipo } = await recordarEquipo(ctx, empresa.admin.token);
    const recordadas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'recordar_equipo'",
      [empresa.empresaId],
    );
    expect(recordadas).toHaveLength(1);
    expect(recordadas[0]).toMatchObject({
      actor_usuario_id: empresa.admin.id,
      equipo_id: equipo.id,
    });

    const lista = await ctx.http().get('/sesion/equipos').set(bearer(empresa.admin.token));
    exigirEstado(lista, 200, 'mis equipos');
    const recordadoId = (lista.body as { id: string }[])[0]!.id;
    const olvido = await ctx
      .http()
      .delete(`/sesion/equipos/${recordadoId}`)
      .set(bearer(empresa.admin.token));
    exigirEstado(olvido, 204, 'olvidar equipo');
    const olvidadas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'olvidar_equipo'",
      [empresa.empresaId],
    );
    expect(olvidadas).toHaveLength(1);
    expect(olvidadas[0]).toMatchObject({ actor_usuario_id: empresa.admin.id });
  });

  it('las acciones de plataforma sin empresa (planes, ingresos, salida) dejan una fila cada una', async () => {
    const { sa } = await sembrado();
    const otro = await nuevoSuperadmin(ctx); // crear_superadministrador + ingreso_superadministrador
    const buscarDe = (accion: string) =>
      filasDeAuditoria(
        admin,
        `accion = $1 AND empresa_id IS NULL AND origen = 'plataforma'
         AND (actor_superadministrador_id = $2 OR detalle::text LIKE '%' || $3 || '%')`,
        [accion, otro.id, otro.usuario],
      );
    expect(await buscarDe('ingreso_superadministrador')).toHaveLength(1);

    const fallido = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: otro.usuario, contrasena: contrasenaUnica() });
    expect(fallido.status).toBe(401);
    expect(await buscarDe('ingreso_superadministrador_fallido')).toHaveLength(1);

    const salida = await ctx.http().delete('/plataforma/sesion').set(bearer(otro.token));
    exigirEstado(salida, 204, 'salida del superadministrador');
    expect(await buscarDe('salida_superadministrador')).toHaveLength(1);

    const motivo = textoUnico('motivo-plan');
    const codigo = `plan-${randomUUID().slice(0, 8)}`;
    const plan = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(sa.token))
      .send({
        codigo,
        nombre: 'Plan de prueba',
        diasGracia: 7,
        modulos: ['SALON'],
        porDefecto: false,
        activo: true,
        motivo,
      });
    exigirEstado(plan, 201, 'crear plan');
    const creadas = await filasDeAuditoria(admin, "accion = 'crear_plan' AND motivo = $1", [
      motivo,
    ]);
    expect(creadas).toHaveLength(1);
    expect(creadas[0]).toMatchObject({
      origen: 'plataforma',
      empresa_id: null,
      actor_superadministrador_id: sa.id,
    });
    const motivo2 = textoUnico('motivo-plan-2');
    const modificado = await ctx
      .http()
      .patch(`/plataforma/planes/${plan.body.id}`)
      .set(bearer(sa.token))
      .send({ nombre: 'Plan de prueba 2', motivo: motivo2 });
    exigirEstado(modificado, 200, 'modificar plan');
    expect(
      await filasDeAuditoria(admin, "accion = 'modificar_plan' AND motivo = $1", [motivo2]),
    ).toHaveLength(1);
  });

  it('registrar_pago y modificar_suscripcion dejan una fila cada una a nombre del superadministrador', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    const suscripcionId = empresa.suscripciones[empresa.sucursales[0]!.id]!.id;
    const motivo = textoUnico('motivo-pago');
    const pago = await ctx
      .http()
      .post(`/plataforma/suscripciones/${suscripcionId}/pagos`)
      .set(bearer(sa.token))
      .set('Idempotency-Key', randomUUID())
      .send({
        monto: '99.90',
        fechaPago: '2030-01-07',
        medio: 'YAPE',
        vencimientoNuevo: '2031-12-31',
        motivo,
      });
    exigirEstado(pago, 201, 'registrar pago');
    expect(
      await filasDeAuditoria(admin, "accion = 'registrar_pago' AND motivo = $1", [motivo]),
    ).toHaveLength(1);
    const motivo2 = textoUnico('motivo-ajuste');
    const ajuste = await ctx
      .http()
      .patch(`/plataforma/suscripciones/${suscripcionId}`)
      .set(bearer(sa.token))
      .send({ vencimiento: '2031-06-30', motivo: motivo2 });
    exigirEstado(ajuste, 200, 'ajustar vencimiento');
    const filas = await filasDeAuditoria(
      admin,
      "accion = 'modificar_suscripcion' AND motivo = $1",
      [motivo2],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      empresa_id: empresa.empresaId,
      actor_superadministrador_id: sa.id,
    });
  });

  it('no hay cambio sin fila ni fila sin cambio: una acción que falla después de auditar no deja la fila', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const sucursalId = empresa.sucursales[0]!.id;
    await elegirSucursal(ctx, empresa.admin.token, sucursalId);

    const bien = await ctx.http().post('/sonda-auditoria/bien').set(bearer(empresa.admin.token));
    exigirEstado(bien, 201, 'sonda que sale bien');
    const falla = await ctx.http().post('/sonda-auditoria/falla').set(bearer(empresa.admin.token));
    expect(falla.status).toBe(500);

    const filas = await filasDeAuditoria(admin, 'empresa_id = $1 AND accion LIKE $2', [
      empresa.empresaId,
      'sonda_%',
    ]);
    expect(filas.map((f) => f.accion)).toEqual(['sonda_bien']);
    expect(filas[0]).toMatchObject({
      actor_usuario_id: empresa.admin.id,
      sucursal_id: sucursalId,
      sesion_id: partesDeToken(empresa.admin.token).sesionId,
    });
  });

  it('un alta rechazada (nombre de usuario repetido) no deja ni usuario ni fila crear_usuario', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const existente = await crearUsuario(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'MOZO' }],
    });
    const antes = await filasDeAuditoria(admin, "empresa_id = $1 AND accion = 'crear_usuario'", [
      empresa.empresaId,
    ]);
    const repetido = await ctx
      .http()
      .post('/usuarios')
      .set(bearer(empresa.admin.token))
      .send({
        nombre: 'Repetido',
        nombreUsuario: existente.usuario,
        esAdministrador: false,
        accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'MOZO' }],
        contrasenaTemporal: contrasenaUnica(),
      });
    expect(repetido.status).toBe(409);
    const despues = await filasDeAuditoria(admin, "empresa_id = $1 AND accion = 'crear_usuario'", [
      empresa.empresaId,
    ]);
    expect(despues).toHaveLength(antes.length);
  });

  it('un alta de empresa rechazada no deja nada creado ni auditado', async () => {
    const { sa } = await sembrado();
    const motivo = textoUnico('motivo-rechazado');
    const nombre = textoUnico('Empresa-rechazada');
    const cuerpo = datosDeEmpresa();
    const res = await ctx
      .http()
      .post('/plataforma/empresas')
      .set(bearer(sa.token))
      .send({
        ...cuerpo,
        nombre,
        sucursales: cuerpo.sucursales.map((s) => ({
          ...s,
          suscripcion: { planId: randomUUID() },
        })),
        administrador: {
          nombre: 'Administrador',
          nombreUsuario: usuarioUnico('adm'),
          contrasenaTemporal: contrasenaUnica(),
        },
        motivo,
      });
    expect(res.status).toBe(422);
    expect(
      (await admin.query('SELECT 1 FROM empresa WHERE nombre = $1', [nombre])).rows,
    ).toHaveLength(0);
    expect(await filasDeAuditoria(admin, 'motivo = $1', [motivo])).toHaveLength(0);
  });

  it('los rechazos y bloqueos se guardan aunque la petición responda un error (bloqueo_contrasena)', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const usuario = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'CAJERO' }],
    });
    for (let i = 0; i < 5; i++) {
      const res = await ingresar(ctx, usuario.usuario, contrasenaUnica());
      expect(res.status).toBe(401);
    }
    const bloqueado = await ingresar(ctx, usuario.usuario, usuario.contrasena);
    expect(bloqueado.status).toBe(429);
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'bloqueo_contrasena'",
      [empresa.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ actor_sistema: 'autenticacion', actor_usuario_id: null });
    expect(JSON.stringify(filas[0]!.detalle)).toContain(usuario.id);
  });

  it('un ingreso fuera de horario con credenciales correctas deja ingreso_fuera_de_horario a nombre de la persona', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const usuario = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'MOZO' }],
    });
    // El reloj está el lunes a las 10:00 (Lima); el horario es el lunes de 08:00 a 09:00 (rige desde el
    // siguiente ingreso, criterio 106).
    const horario = await ctx
      .http()
      .patch(`/usuarios/${usuario.id}`)
      .set(bearer(empresa.admin.token))
      .send({ horario: [{ dia: 1, desde: '08:00', hasta: '09:00' }] });
    exigirEstado(horario, 200, 'asignar horario');
    const res = await ingresar(ctx, usuario.usuario, usuario.contrasena);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ codigo: 'FUERA_DE_HORARIO' });
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'ingreso_fuera_de_horario'",
      [empresa.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ actor_usuario_id: usuario.id });
  });
});

// ------------------------------------------------------------------------------------------------
// 59 · Sin secretos
// ------------------------------------------------------------------------------------------------
describe('criterio 59 · ningún secreto conocido aparece en la auditoría', () => {
  it('contraseñas, PIN, tokens de sesión y de equipo, y sus huellas no aparecen en el texto de las filas', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const sucursalId = empresa.sucursales[0]!.id;
    const secretos: [string, string][] = [];
    const guardar = (nombre: string, valor: string | undefined) => {
      if (valor) secretos.push([nombre, valor]);
    };
    guardar('contraseña temporal del Administrador', empresa.admin.contrasenaTemporal);
    guardar('contraseña del Administrador', empresa.admin.contrasena);
    guardar('PIN del Administrador', empresa.admin.pin);
    guardar('token del Administrador', empresa.admin.token);
    guardar('secreto del token del Administrador', partesDeToken(empresa.admin.token).secreto);

    const trabajador = await crearUsuario(ctx, empresa.admin.token, {
      accesos: [{ sucursalId, rol: 'CAJERO' }],
    });
    guardar('contraseña temporal del trabajador', trabajador.contrasenaTemporal);
    guardar('PIN del trabajador', trabajador.pin);

    const nuevoPin = await ctx
      .http()
      .post(`/usuarios/${trabajador.id}/pin`)
      .set(bearer(empresa.admin.token));
    exigirEstado(nuevoPin, 200, 'regenerar PIN');
    guardar('PIN regenerado', nuevoPin.body.pin as string);

    const restablecida = contrasenaUnica();
    const reset = await ctx
      .http()
      .post(`/usuarios/${trabajador.id}/contrasena`)
      .set(bearer(empresa.admin.token))
      .send({ contrasenaTemporal: restablecida });
    exigirEstado(reset, 204, 'restablecer contraseña');
    guardar('contraseña restablecida', restablecida);

    const mala = contrasenaUnica();
    guardar('contraseña equivocada', mala);
    for (let i = 0; i < 5; i++) await ingresar(ctx, trabajador.usuario, mala);
    await ingresar(ctx, trabajador.usuario, restablecida); // bloqueado: 429

    const otro = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: [{ sucursalId, rol: 'MOZO' }],
    });
    guardar('contraseña definitiva del otro usuario', otro.contrasena);
    guardar('PIN del otro usuario', otro.pin);
    guardar('token del otro usuario', otro.token);
    const equipo = await recordarEquipo(ctx, otro.token);
    guardar('token del equipo', equipo.tokenEquipo);
    guardar('secreto del token del equipo', equipo.tokenEquipo?.split('.')[3]);

    guardar('contraseña del superadministrador', sa.contrasena);
    guardar('token del superadministrador', sa.token);
    guardar('secreto del token del superadministrador', partesDeToken(sa.token).secreto);
    const soporte = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Revisión de secretos' });
    exigirEstado(soporte, 201, 'soporte');
    guardar('token de soporte', soporte.body.token as string);
    guardar('secreto del token de soporte', partesDeToken(soporte.body.token as string).secreto);

    // Huellas y hashes guardados en las tablas de credenciales (los lee el administrador de la base).
    const hashes = await admin.query<{ valor: string }>(
      `SELECT hash_contrasena AS valor FROM usuario WHERE empresa_id = $1
       UNION ALL SELECT encode(huella_pin, 'hex') FROM usuario WHERE empresa_id = $1
       UNION ALL SELECT encode(huella_pin, 'base64') FROM usuario WHERE empresa_id = $1
       UNION ALL SELECT encode(huella_secreto, 'hex') FROM sesion WHERE empresa_id = $1
       UNION ALL SELECT encode(huella_secreto, 'base64') FROM sesion WHERE empresa_id = $1`,
      [empresa.empresaId],
    );
    for (const { valor } of hashes.rows) guardar('huella o hash guardado', valor);
    const hashSa = await admin.query<{ valor: string }>(
      'SELECT hash_contrasena AS valor FROM superadministrador WHERE id = $1',
      [sa.id],
    );
    for (const { valor } of hashSa.rows) guardar('hash del superadministrador', valor);
    const huellaEquipo = await admin.query<{ valor: string }>(
      `SELECT encode(huella_secreto, 'hex') AS valor FROM equipo WHERE empresa_id = $1
       UNION ALL SELECT encode(huella_secreto, 'base64') FROM equipo WHERE empresa_id = $1`,
      [empresa.empresaId],
    );
    for (const { valor } of huellaEquipo.rows) guardar('huella del equipo', valor);
    expect(secretos.length).toBeGreaterThan(15);

    // Texto de las columnas con texto libre de las filas de esta empresa y del superadministrador.
    const { rows } = await admin.query<{ texto: string }>(
      `SELECT concat_ws(' | ', accion, origen, motivo, entidad, entidad_id::text, actor_sistema, detalle::text) AS texto
         FROM auditoria
        WHERE empresa_id = $1 OR actor_superadministrador_id = $2`,
      [empresa.empresaId, sa.id],
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const [nombre, valor] of secretos) {
      for (const fila of rows) {
        // Los PIN (4 o 6 dígitos) se buscan como número entero aparte: no dentro de otro número o identificador.
        const encontrado = /^\d{4,6}$/.test(valor)
          ? new RegExp(`(?<![0-9A-Za-z-])${valor}(?![0-9A-Za-z-])`).test(fila.texto)
          : fila.texto.includes(valor);
        expect(encontrado, `${nombre} aparece en la auditoría: ${fila.texto.slice(0, 200)}`).toBe(
          false,
        );
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 60 · Hora
// ------------------------------------------------------------------------------------------------
describe('criterio 60 · ocurrido_en es la hora del reloj de la API', () => {
  it('la fila lleva exactamente el instante del reloj (no el now() de la base) y sigue al reloj al avanzarlo', async () => {
    const instante = new Date('2030-03-04T09:15:30.250-05:00');
    ctx.reloj.fijar(instante);
    // Las sesiones se abren con el reloj ya movido (una sesión creada antes habría expirado).
    const sa = await nuevoSuperadmin(ctx);
    const empresa = await altaEmpresa(ctx, sa);
    const primera = await ctx
      .http()
      .post('/emisores')
      .set(bearer(empresa.admin.token))
      .send({ ruc: rucAleatorio(), razonSocial: 'Hora uno SAC', regimen: 'GENERAL' });
    exigirEstado(primera, 201, 'primer emisor');
    ctx.reloj.avanzar(7 * MINUTO);
    const segunda = await ctx
      .http()
      .post('/emisores')
      .set(bearer(empresa.admin.token))
      .send({ ruc: rucAleatorio(), razonSocial: 'Hora dos SAC', regimen: 'GENERAL' });
    exigirEstado(segunda, 201, 'segundo emisor');
    const filas = await filasDeAuditoria(admin, "empresa_id = $1 AND accion = 'crear_emisor'", [
      empresa.empresaId,
    ]);
    expect(filas).toHaveLength(2);
    expect(filas[0]!.ocurrido_en.getTime()).toBe(instante.getTime());
    expect(filas[1]!.ocurrido_en.getTime()).toBe(instante.getTime() + 7 * MINUTO);
    ctx.reloj.fijar(INICIO);
  });

  it('las filas de plataforma también usan el reloj de la API', async () => {
    const instante = new Date('2030-05-06T22:00:00.000-05:00');
    ctx.reloj.fijar(instante);
    const sa = await nuevoSuperadmin(ctx);
    const motivo = textoUnico('motivo-hora');
    const empresa = await altaEmpresa(ctx, sa, {
      conSesion: false,
      ajustar: (cuerpo) => {
        cuerpo.motivo = motivo;
      },
    });
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'registrar_empresa'",
      [empresa.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.ocurrido_en.getTime()).toBe(instante.getTime());
    ctx.reloj.fijar(INICIO);
  });
});
