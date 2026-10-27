// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P12 (parte 2) · Criterios 114, 115, 117, 119 y 120 por la API real (trazabilidad, ruta crítica):
// - 117 quién queda como creador y como último en cambiar cada fila, según la vía: sesión de contraseña (con
//   y sin equipo), sesión PIN, soporte, plataforma por HTTP, semilla, script, principal de prueba e ingresos
//   (correcto y fallido);
// - 114 el cuerpo de la petición no puede tocar esas columnas;
// - 115 sin actor no hay escritura, y por la API la respuesta es 500 sin detalles;
// - 119 una fila de auditoría y el cambio que registra tienen el mismo actor;
// - 120 con un pool de 2 conexiones y 100 escrituras concurrentes cada fila lleva el actor de su petición.
// Los títulos llevan [C0]..[C3] según el grupo de la fase C que lo hace posible.
import { Body, Controller, Post } from '@nestjs/common';
import * as contratos from '@restaurante/contratos';
import { randomInt, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { PlataformaEmpresasService, SucursalService } from '../../src/modulos/plataforma';
import { Publica } from '../../src/modulos/seguridad';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { RelojManual } from '../../src/nucleo/reloj';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { datosDeEmpresa, rucAleatorio, textoUnico } from '../aislamiento/fabrica';
import {
  MINUTO,
  altaEmpresa,
  arrancar,
  bearer,
  contrasenaUnica,
  crearUsuario,
  crearUsuarioConSesion,
  exigirEstado,
  filaPorId,
  filasDeAuditoria,
  ingresar,
  nuevoSuperadmin,
  recordarEquipo,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from './fabrica-plataforma';

/** Lunes 18 de marzo de 2030, 10:00 en Lima. */
const INICIO = '2030-03-18T10:00:00-05:00';

/** Sonda: escribe con `ContextoEmpresa.ejecutar` SIN actor (lo que el interceptor nunca haría). */
@Controller('sonda-sin-actor')
class SondaSinActorController {
  constructor(
    private readonly contexto: ContextoEmpresa,
    private readonly sucursales: SucursalService,
  ) {}

  @Post()
  @Publica()
  async escribir(@Body() cuerpo: { empresaId: string; sucursalId: string }) {
    await this.contexto.ejecutar(cuerpo.empresaId, () =>
      this.sucursales.configurar(cuerpo.sucursalId, { direccion: 'escrita sin actor' }),
    );
    return { ok: true };
  }
}

let ctx: AppDePrueba;
let admin: Client;
let sembradoPendiente: Promise<{ sa: SuperadminDePrueba }> | undefined;

beforeAll(async () => {
  ctx = await arrancar({
    inicio: INICIO,
    poolMax: 2,
    controladoresExtra: [SondaSinActorController],
  });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

function sembrado() {
  sembradoPendiente ??= (async () => ({ sa: await nuevoSuperadmin(ctx) }))();
  return sembradoPendiente;
}

interface Actor {
  usuario: string | null;
  equipo: string | null;
  superadministrador: string | null;
  sistema: string | null;
}
const actorDe = (
  fila: Record<string, unknown>,
  grupo: 'creado_por' | 'actualizado_por',
): Actor => ({
  usuario: fila[`${grupo}_usuario_id`] as string | null,
  equipo: fila[`${grupo}_equipo_id`] as string | null,
  superadministrador: fila[`${grupo}_superadministrador_id`] as string | null,
  sistema: fila[`${grupo}_sistema`] as string | null,
});
const deUsuario = (usuario: string, equipo: string | null = null): Actor => ({
  usuario,
  equipo,
  superadministrador: null,
  sistema: null,
});
const deSuperadmin = (id: string): Actor => ({
  usuario: null,
  equipo: null,
  superadministrador: id,
  sistema: null,
});
const deSistema = (sistema: string): Actor => ({
  usuario: null,
  equipo: null,
  superadministrador: null,
  sistema,
});

const codigoNuevo = () => String(3000 + randomInt(0, 6000));

/** `POST /sucursales` del Administrador; devuelve la fila creada. */
async function crearSucursal(token: string, empresa: EmpresaDePrueba) {
  const res = await ctx
    .http()
    .post('/sucursales')
    .set(bearer(token))
    .send({
      rucEmisor: empresa.emisores[0]!.ruc,
      nombre: textoUnico('Sucursal-traza'),
      codigoEstablecimiento: codigoNuevo(),
      direccion: 'Av. Trazabilidad 1',
    });
  exigirEstado(res, 201, 'crear sucursal');
  return res.body.id as string;
}

// ------------------------------------------------------------------------------------------------
// 117 · Actor según la vía
// ------------------------------------------------------------------------------------------------
describe('criterio 117 · quién crea y quién cambia cada fila, según la vía', () => {
  it('[C0] sesión de contraseña sin equipo: la sucursal queda creada y cambiada por el usuario, sin equipo, y la auditoría lleva el mismo actor', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const id = await crearSucursal(empresa.admin.token, empresa);
    const fila = (await filaPorId(admin, 'sucursal', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id));
    const auditoria = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'crear_sucursal'",
      [empresa.empresaId],
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_usuario_id: fila.creado_por_usuario_id,
      equipo_id: fila.creado_por_equipo_id,
      actor_superadministrador_id: null,
      actor_sistema: null,
    });
  });

  it('[C0] editada por otro Administrador cambia solo actualizado_por_*; editada en soporte, actualizado_por_superadministrador_id', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const id = await crearSucursal(empresa.admin.token, empresa);
    const otro = await crearUsuarioConSesion(ctx, empresa.admin.token, { esAdministrador: true });

    const editada = await ctx
      .http()
      .patch(`/sucursales/${id}`)
      .set(bearer(otro.token))
      .send({ direccion: 'Editada por otro Administrador' });
    exigirEstado(editada, 200, 'editada por otro Administrador');
    let fila = (await filaPorId(admin, 'sucursal', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(otro.id));

    const soporte = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Edición de prueba de la trazabilidad' });
    exigirEstado(soporte, 201, 'soporte');
    const enSoporte = await ctx
      .http()
      .patch(`/sucursales/${id}`)
      .set(bearer(soporte.body.token as string))
      .send({ direccion: 'Editada en soporte' });
    exigirEstado(enSoporte, 200, 'editada en soporte');
    fila = (await filaPorId(admin, 'sucursal', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deSuperadmin(sa.id));
  });

  it('[C2] sesión de contraseña con equipo recordado: la sucursal queda creada desde ese equipo y la auditoría lleva el mismo equipo', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const { equipo } = await recordarEquipo(ctx, empresa.admin.token, {
      nombre: 'Celular del Administrador',
    });
    const id = await crearSucursal(empresa.admin.token, empresa);
    const fila = (await filaPorId(admin, 'sucursal', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id, equipo.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id, equipo.id));
    const auditoria = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'crear_sucursal'",
      [empresa.empresaId],
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_usuario_id: empresa.admin.id,
      equipo_id: equipo.id,
    });
  });

  it('[C2] sesión PIN: la edición queda a nombre de la persona y del equipo, y el ingreso con PIN actualiza el equipo recordado a su nombre', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const { equipo, tokenEquipo } = await recordarEquipo(ctx, empresa.admin.token);
    const ingreso = await ctx
      .http()
      .post('/sesiones/pin')
      .set('X-Equipo', tokenEquipo!)
      .send({ usuarioId: empresa.admin.id, pin: empresa.admin.pin });
    exigirEstado(ingreso, 201, 'ingreso con PIN');
    const tokenPin = ingreso.body.token as string;

    const recordado = await admin.query(
      'SELECT * FROM equipo_recordado WHERE equipo_id = $1 AND usuario_id = $2',
      [equipo.id, empresa.admin.id],
    );
    expect(recordado.rows).toHaveLength(1);
    expect(actorDe(recordado.rows[0], 'actualizado_por')).toEqual(
      deUsuario(empresa.admin.id, equipo.id),
    );

    const id = empresa.sucursales[0]!.id;
    const cambio = await ctx
      .http()
      .patch(`/sucursales/${id}`)
      .set(bearer(tokenPin))
      .set('X-Equipo', tokenEquipo!)
      .send({ direccion: 'Editada con PIN' });
    exigirEstado(cambio, 200, 'edición con PIN');
    const fila = (await filaPorId(admin, 'sucursal', id))!;
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id, equipo.id));
  });

  it('[C2] el olvido del equipo al 15.º fallo de PIN queda a nombre del sistema autenticacion', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const { equipo, tokenEquipo } = await recordarEquipo(ctx, empresa.admin.token);
    let fallos = 0;
    while (fallos < 15) {
      const res = await ctx
        .http()
        .post('/sesiones/pin')
        .set('X-Equipo', tokenEquipo!)
        .send({ usuarioId: empresa.admin.id, pin: '000000' });
      if (res.status === 429) {
        ctx.reloj.avanzar(5 * MINUTO + 1000);
        continue;
      }
      expect(res.status, `fallo ${fallos + 1}: ${JSON.stringify(res.body)}`).toBe(401);
      fallos++;
    }
    const { rows } = await admin.query(
      'SELECT * FROM equipo_recordado WHERE equipo_id = $1 AND usuario_id = $2',
      [equipo.id, empresa.admin.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revocado_en).not.toBeNull();
    expect(rows[0]!.motivo_revocacion).toBe('BLOQUEO');
    expect(actorDe(rows[0], 'actualizado_por')).toEqual(deSistema('autenticacion'));
    ctx.reloj.fijar(INICIO);
  });

  it('[C0] plataforma por HTTP: la empresa, el emisor, la sucursal y el primer Administrador quedan creados por el superadministrador', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    for (const [tabla, id] of [
      ['empresa', empresa.empresaId],
      ['emisor', empresa.emisores[0]!.id],
      ['sucursal', empresa.sucursales[0]!.id],
      ['usuario', empresa.admin.id],
    ] as const) {
      const fila = (await filaPorId(admin, tabla, id))!;
      expect(actorDe(fila, 'creado_por'), `${tabla} creado`).toEqual(deSuperadmin(sa.id));
      expect(actorDe(fila, 'actualizado_por'), `${tabla} actualizado`).toEqual(deSuperadmin(sa.id));
    }
  });

  it('[C0] POST /plataforma/empresas/:id/sucursales deja creado_por_superadministrador_id', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/sucursales`)
      .set(bearer(sa.token))
      .send({
        rucEmisor: empresa.emisores[0]!.ruc,
        nombre: textoUnico('Sucursal-plataforma'),
        codigoEstablecimiento: codigoNuevo(),
        direccion: 'Av. Plataforma 2',
        motivo: 'Alta de prueba de la trazabilidad',
      });
    exigirEstado(res, 201, 'agregar sucursal');
    const fila = (await filaPorId(admin, 'sucursal', res.body.id as string))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deSuperadmin(sa.id));
  });

  it('[C0] semilla y script: registrarEmpresa con actor de texto deja ese actor de sistema en la empresa, el emisor y la sucursal', async () => {
    const servicio = ctx.app.get(PlataformaEmpresasService);
    for (const actor of ['semilla', 'cli:mi-script']) {
      const resultado = await servicio.registrarEmpresa(datosDeEmpresa(), {
        actor,
        motivo: textoUnico('motivo-traza'),
      });
      for (const [tabla, id] of [
        ['empresa', resultado.empresaId],
        ['emisor', resultado.emisores[0]!.id],
        ['sucursal', resultado.sucursales[0]!.id],
      ] as const) {
        const fila = (await filaPorId(admin, tabla, id))!;
        expect(actorDe(fila, 'creado_por'), `${actor}: ${tabla}`).toEqual(deSistema(actor));
        expect(actorDe(fila, 'actualizado_por'), `${actor}: ${tabla}`).toEqual(deSistema(actor));
      }
    }
  });

  it('[C0] principal de prueba (NODE_ENV=test con la cabecera): la edición queda con el actor de sistema prueba', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    fijarEntornoDePrueba({ empresaPorHeader: true });
    const appPrueba = await crearAplicacion({ reloj: new RelojManual(INICIO), logger: false });
    try {
      const id = empresa.sucursales[0]!.id;
      const res = await request(appPrueba.getHttpServer())
        .patch(`/sucursales/${id}`)
        .set('x-empresa-id', empresa.empresaId)
        .send({ direccion: 'Editada por el principal de prueba' });
      exigirEstado(res, 200, 'edición con el principal de prueba');
      const fila = (await filaPorId(admin, 'sucursal', id))!;
      expect(actorDe(fila, 'actualizado_por')).toEqual(deSistema('prueba'));
      expect(actorDe(fila, 'creado_por')).toEqual(deSuperadmin(sa.id));
    } finally {
      await appPrueba.close();
      fijarEntornoDePrueba({ empresaPorHeader: false });
    }
  });

  it('[C0] ingresos: un cambio de contraseña correcto queda a nombre de la persona; uno con la contraseña actual equivocada no escribe', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const usuario = await crearUsuario(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'CAJERO' }],
    });
    const creado = (await filaPorId(admin, 'usuario', usuario.id))!;
    expect(actorDe(creado, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    const ingreso = await ingresar(ctx, usuario.usuario, usuario.contrasenaTemporal);
    exigirEstado(ingreso, 201, 'ingreso con la contraseña temporal');
    const token = ingreso.body.token as string;

    const mala = await ctx
      .http()
      .put('/sesion/contrasena')
      .set(bearer(token))
      .send({ actual: contrasenaUnica(), nueva: contrasenaUnica() });
    expect(mala.status).toBe(401);
    const sinCambio = (await filaPorId(admin, 'usuario', usuario.id))!;
    expect(actorDe(sinCambio, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(sinCambio.hash_contrasena).toBe(creado.hash_contrasena);

    const buena = await ctx
      .http()
      .put('/sesion/contrasena')
      .set(bearer(token))
      .send({ actual: usuario.contrasenaTemporal, nueva: contrasenaUnica() });
    exigirEstado(buena, 204, 'cambio de contraseña correcto');
    const cambiado = (await filaPorId(admin, 'usuario', usuario.id))!;
    expect(actorDe(cambiado, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(cambiado, 'actualizado_por')).toEqual(deUsuario(usuario.id));
  });

  it('[C0] ingreso fallido: los 5 fallos dejan el bloqueo a nombre del sistema autenticacion y no tocan al usuario', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const usuario = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'MOZO' }],
    });
    const antes = (await filaPorId(admin, 'usuario', usuario.id))!;
    for (let i = 0; i < 5; i++) {
      const res = await ingresar(ctx, usuario.usuario, contrasenaUnica());
      expect(res.status).toBe(401);
    }
    const despues = (await filaPorId(admin, 'usuario', usuario.id))!;
    expect(actorDe(despues, 'actualizado_por')).toEqual(actorDe(antes, 'actualizado_por'));
    expect(despues.actualizado_en).toEqual(antes.actualizado_en);
    const filas = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'bloqueo_contrasena'",
      [empresa.empresaId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_sistema: 'autenticacion',
      actor_usuario_id: null,
      actor_superadministrador_id: null,
    });
  });

  it('[C0] usuarios y accesos: el alta y la edición del Administrador dejan su actor en usuario y acceso_sucursal; en soporte, el superadministrador', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const sucursalId = empresa.sucursales[0]!.id;
    const usuario = await crearUsuario(ctx, empresa.admin.token, {
      accesos: [{ sucursalId, rol: 'MOZO' }],
    });
    const acceso = await admin.query(
      'SELECT * FROM acceso_sucursal WHERE usuario_id = $1 AND sucursal_id = $2',
      [usuario.id, sucursalId],
    );
    expect(acceso.rows).toHaveLength(1);
    expect(actorDe(acceso.rows[0], 'creado_por')).toEqual(deUsuario(empresa.admin.id));

    const cambio = await ctx
      .http()
      .patch(`/usuarios/${usuario.id}`)
      .set(bearer(empresa.admin.token))
      .send({ nombre: 'Nombre cambiado' });
    exigirEstado(cambio, 200, 'editar usuario');
    let fila = (await filaPorId(admin, 'usuario', usuario.id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id));

    const soporte = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Edición de usuario en soporte' });
    exigirEstado(soporte, 201, 'soporte');
    const enSoporte = await ctx
      .http()
      .patch(`/usuarios/${usuario.id}`)
      .set(bearer(soporte.body.token as string))
      .send({ nombre: 'Nombre cambiado en soporte' });
    exigirEstado(enSoporte, 200, 'editar usuario en soporte');
    fila = (await filaPorId(admin, 'usuario', usuario.id))!;
    expect(actorDe(fila, 'actualizado_por')).toEqual(deSuperadmin(sa.id));
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
  });
});

// ------------------------------------------------------------------------------------------------
// 114 · El cuerpo de la petición no puede tocar las columnas
// ------------------------------------------------------------------------------------------------
describe('criterio 114 · el cuerpo de la petición no puede tocar la trazabilidad', () => {
  const PROHIBIDOS = /^(creado|actualizado)(Por|_por)|^empresaId$|^empresa_id$/;

  interface DefDeZod {
    shape?: unknown;
    element?: unknown;
    innerType?: unknown;
    in?: unknown;
    out?: unknown;
    options?: unknown[];
  }

  function clavesDe(schema: unknown, visto = new Set<unknown>()): string[] {
    if (!schema || typeof schema !== 'object' || visto.has(schema)) return [];
    visto.add(schema);
    const interno = schema as { _zod?: { def?: DefDeZod }; def?: DefDeZod };
    const def = interno._zod?.def ?? interno.def;
    if (!def) return [];
    const claves: string[] = [];
    const forma =
      typeof def.shape === 'function'
        ? (def.shape as () => Record<string, unknown>)()
        : (def.shape as Record<string, unknown> | undefined);
    if (forma)
      for (const [clave, hijo] of Object.entries(forma))
        claves.push(clave, ...clavesDe(hijo, visto));
    for (const hijo of [def.element, def.innerType, def.in, def.out, ...(def.options ?? [])]) {
      claves.push(...clavesDe(hijo, visto));
    }
    return claves;
  }

  it('[C0] ningún esquema de entrada de packages/contratos declara empresaId, creadoPor* ni actualizadoPor*', () => {
    const entradas = Object.entries(contratos).filter(([nombre]) =>
      /Entrada.*Schema$/.test(nombre),
    );
    expect(entradas.length).toBeGreaterThan(10);
    const problemas: string[] = [];
    for (const [nombre, esquema] of entradas) {
      for (const clave of clavesDe(esquema))
        if (PROHIBIDOS.test(clave)) problemas.push(`${nombre}.${clave}`);
    }
    expect(problemas).toEqual([]);
  });

  it('[C0] los esquemas de entrada rechazan esos campos o los descartan', () => {
    const intruso = {
      creadoPorUsuarioId: randomUUID(),
      actualizadoPorSistema: 'impostor',
      empresaId: randomUUID(),
    };
    const casos: [
      string,
      { safeParse: (x: unknown) => { success: boolean; data?: unknown } },
      Record<string, unknown>,
    ][] = [
      [
        'usuarioCrearEntradaSchema',
        contratos.usuarioCrearEntradaSchema,
        {
          nombre: 'Persona',
          nombreUsuario: 'persona.traza',
          esAdministrador: false,
          accesos: [{ sucursalId: randomUUID(), rol: 'MOZO' }],
          contrasenaTemporal: 'Clave-segura-1',
        },
      ],
      [
        'emisorCrearEntradaSchema',
        contratos.emisorCrearEntradaSchema,
        { ruc: rucAleatorio(), razonSocial: 'Emisor SAC', regimen: 'GENERAL' },
      ],
      [
        'emisorEntradaSchema',
        contratos.emisorEntradaSchema,
        { ruc: rucAleatorio(), razonSocial: 'Emisor SAC', regimen: 'GENERAL' },
      ],
      [
        'sucursalCrearEntradaSchema',
        contratos.sucursalCrearEntradaSchema,
        {
          rucEmisor: rucAleatorio(),
          nombre: 'Sucursal',
          codigoEstablecimiento: '0001',
          direccion: 'Calle 1',
        },
      ],
      [
        'sucursalConfigurarEntradaSchema',
        contratos.sucursalConfigurarEntradaSchema,
        { direccion: 'Calle 2' },
      ],
    ];
    for (const [nombre, esquema, valido] of casos) {
      const resultado = esquema.safeParse({ ...valido, ...intruso });
      if (resultado.success) {
        for (const clave of Object.keys(intruso)) {
          expect(
            Object.keys(resultado.data as object),
            `${nombre} devuelve ${clave}`,
          ).not.toContain(clave);
        }
      } else {
        expect(
          esquema.safeParse(valido).success,
          `${nombre}: el cuerpo sin intruso es válido`,
        ).toBe(true);
      }
    }
  });

  it('[C0] POST /usuarios con creadoPorUsuarioId responde 400 y no crea el usuario', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const usuario = `intruso-${randomUUID().slice(0, 8)}`;
    const res = await ctx
      .http()
      .post('/usuarios')
      .set(bearer(empresa.admin.token))
      .send({
        nombre: 'Intruso',
        nombreUsuario: usuario,
        esAdministrador: false,
        accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'MOZO' }],
        contrasenaTemporal: contrasenaUnica(),
        creadoPorUsuarioId: randomUUID(),
      });
    expect(res.status).toBe(400);
    expect(
      (await admin.query('SELECT 1 FROM usuario WHERE nombre_usuario = $1', [usuario])).rows,
    ).toEqual([]);
  });

  it('[C0] PATCH /sucursales/:id con columnas de trazabilidad en el cuerpo no cambia quién la creó y la deja cambiada por quien la editó', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa);
    const id = empresa.sucursales[0]!.id;
    const antes = (await filaPorId(admin, 'sucursal', id))!;
    const res = await ctx.http().patch(`/sucursales/${id}`).set(bearer(empresa.admin.token)).send({
      direccion: 'Con intruso',
      creadoPorUsuarioId: randomUUID(),
      creado_por_sistema: 'impostor',
      actualizado_por_sistema: 'impostor',
    });
    expect([200, 400]).toContain(res.status);
    const despues = (await filaPorId(admin, 'sucursal', id))!;
    expect(actorDe(despues, 'creado_por')).toEqual(actorDe(antes, 'creado_por'));
    if (res.status === 200) {
      expect(actorDe(despues, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id));
    } else {
      expect(actorDe(despues, 'actualizado_por')).toEqual(actorDe(antes, 'actualizado_por'));
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 115 · Sin actor no hay escritura (por la API)
// ------------------------------------------------------------------------------------------------
describe('criterio 115 · una escritura sin actor por la API responde 500 sin detalles y no escribe', () => {
  it('[C0] la sonda que escribe con ContextoEmpresa.ejecutar sin actor recibe ERROR_INTERNO y la fila no cambia', async () => {
    const { sa } = await sembrado();
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    const sucursalId = empresa.sucursales[0]!.id;
    const antes = (await filaPorId(admin, 'sucursal', sucursalId))!;
    const res = await ctx
      .http()
      .post('/sonda-sin-actor')
      .send({ empresaId: empresa.empresaId, sucursalId });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ codigo: 'ERROR_INTERNO', mensaje: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/actor|42501|trazabilidad|sucursal|postgres/i);
    const despues = (await filaPorId(admin, 'sucursal', sucursalId))!;
    expect(despues.direccion).toBe(antes.direccion);
    expect(despues.actualizado_en).toEqual(antes.actualizado_en);
  });
});

// ------------------------------------------------------------------------------------------------
// 120 · Sin cruces entre peticiones
// ------------------------------------------------------------------------------------------------
describe('criterio 120 · 100 escrituras concurrentes con un pool de 2 conexiones', () => {
  it('[C0] cada fila escrita y cada fila de auditoría tienen el actor de su propia petición', async () => {
    const { sa } = await sembrado();
    const A = await altaEmpresa(ctx, sa);
    const B = await altaEmpresa(ctx, sa);
    const otroA = await crearUsuarioConSesion(ctx, A.admin.token, { esAdministrador: true });
    const otroB = await crearUsuarioConSesion(ctx, B.admin.token, { esAdministrador: true });
    const personas = [
      { id: A.admin.id, token: A.admin.token, empresaId: A.empresaId },
      { id: otroA.id, token: otroA.token, empresaId: A.empresaId },
      { id: B.admin.id, token: B.admin.token, empresaId: B.empresaId },
      { id: otroB.id, token: otroB.token, empresaId: B.empresaId },
    ];
    const total = 100;
    const respuestas = await Promise.all(
      Array.from({ length: total }, (_, i) => {
        const persona = personas[i % personas.length]!;
        return ctx
          .http()
          .post('/emisores')
          .set(bearer(persona.token))
          .send({
            ruc: rucAleatorio(),
            razonSocial: `Emisor concurrente ${i} SAC`,
            regimen: 'GENERAL',
          })
          .then((res) => ({ res, persona }));
      }),
    );
    const creados = new Map<string, (typeof personas)[number]>();
    for (const { res, persona } of respuestas) {
      exigirEstado(res, 201, 'escritura concurrente');
      creados.set(res.body.id as string, persona);
    }
    expect(creados.size).toBe(total);

    const filas = await admin.query('SELECT * FROM emisor WHERE id = ANY($1::uuid[])', [
      [...creados.keys()],
    ]);
    expect(filas.rows).toHaveLength(total);
    for (const fila of filas.rows) {
      const persona = creados.get(fila.id)!;
      expect(fila.empresa_id).toBe(persona.empresaId);
      expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(persona.id));
      expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(persona.id));
    }
    // Una fila de auditoría por escritura, con el actor y la empresa de su petición.
    for (const persona of personas) {
      const esperadas = [...creados.values()].filter((p) => p.id === persona.id).length;
      const auditoria = await filasDeAuditoria(
        admin,
        "accion = 'crear_emisor' AND actor_usuario_id = $1 AND empresa_id = $2",
        [persona.id, persona.empresaId],
      );
      expect(auditoria, `auditoría de ${persona.id}`).toHaveLength(esperadas);
    }
    const cruzadas = await admin.query(
      `SELECT count(*)::int AS n FROM auditoria a JOIN usuario u ON u.id = a.actor_usuario_id
        WHERE a.accion = 'crear_emisor' AND a.empresa_id = ANY($1::uuid[]) AND u.empresa_id <> a.empresa_id`,
      [[A.empresaId, B.empresaId]],
    );
    expect(cruzadas.rows[0].n).toBe(0);
  });
});
