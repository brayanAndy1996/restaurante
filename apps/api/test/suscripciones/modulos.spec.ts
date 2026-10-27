// Pruebas del desarrollador (no protegidas) de la tarea T29 · criterio 77: `@RequiereModulo(modulo)` con un
// controlador sonda y `modulos` en `GET /sesion`. El plan de la sucursal activa decide, se lee en cada
// petición (un cambio de plan rige desde la siguiente) y el controlador no corre si el módulo falta.
import { Controller, Get, Inject, Post } from '@nestjs/common';
import { sesionRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequiereModulo, SoloAdministrador } from '../../src/modulos/seguridad';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente } from '../utilidades';
import { textoUnico } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  bearer,
  crearUsuarioConSesion,
  elegirSucursal,
  exigirEstado,
  nuevoSuperadmin,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
  type UsuarioDePrueba,
} from '../acceso/fabrica-plataforma';

const ejecuciones = { caja: 0, pedidos: 0, escritura: 0 };

/** Sonda: rutas de dos módulos distintos (una de lectura y una de escritura). */
@Controller('sonda-modulos')
class SondaModulosController {
  constructor(@Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa) {}

  @Get('caja')
  @RequiereModulo('CAJA')
  caja() {
    ejecuciones.caja++;
    return { ok: true, empresa: this.contexto.empresaActual() };
  }

  @Get('pedidos-web')
  @RequiereModulo('PEDIDOS_WEB')
  pedidos() {
    ejecuciones.pedidos++;
    return { ok: true };
  }

  @Post('escribe')
  @RequiereModulo('FACTURACION')
  @SoloAdministrador()
  escribe() {
    ejecuciones.escritura++;
    return { ok: true };
  }
}

let ctx: AppDePrueba;
let admin: Client;
let sa: SuperadminDePrueba;
let empresa: EmpresaDePrueba;
let mozo: UsuarioDePrueba;

beforeAll(async () => {
  ctx = await arrancar({ controladoresExtra: [SondaModulosController] });
  admin = await abrirCliente('admin');
  sa = await nuevoSuperadmin(ctx);
  empresa = await altaEmpresa(ctx, sa);
  mozo = await crearUsuarioConSesion(ctx, empresa.admin.token, {
    accesos: empresa.sucursales.map((s) => ({ sucursalId: s.id, rol: 'MOZO' as const })),
  });
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const crearPlan = async (modulos: string[]) => {
  const res = await ctx
    .http()
    .post('/plataforma/planes')
    .set(bearer(sa.token))
    .send({
      codigo: `M-${randomUUID().slice(0, 8)}`,
      nombre: 'Plan con módulos',
      diasGracia: 7,
      modulos,
      porDefecto: false,
      activo: true,
      motivo: textoUnico('motivo-plan'),
    });
  exigirEstado(res, 201, 'crear plan');
  return res.body.id as string;
};

const ponerPlan = async (sucursalId: string, planId: string) =>
  exigirEstado(
    await ctx
      .http()
      .patch(`/plataforma/suscripciones/${empresa.suscripciones[sucursalId]!.id}`)
      .set(bearer(sa.token))
      .send({ planId, motivo: 'Cambio de plan' }),
    200,
    'cambiar de plan',
  );

const get = (ruta: string, token: string) => ctx.http().get(ruta).set(bearer(token));

describe('@RequiereModulo (criterio 77)', () => {
  it('con el módulo en el plan de la sucursal activa la ruta responde y el controlador corre', async () => {
    await elegirSucursal(ctx, empresa.admin.token, empresa.sucursales[0]!.id);
    const antes = ejecuciones.caja;
    const res = await get('/sonda-modulos/caja', empresa.admin.token);
    exigirEstado(res, 200, 'ruta con módulo');
    expect(res.body).toEqual({ ok: true, empresa: empresa.empresaId });
    expect(ejecuciones.caja).toBe(antes + 1);
  });

  it('sin el módulo responde 403 MODULO_NO_INCLUIDO y el controlador no corre', async () => {
    const [s1] = empresa.sucursales;
    await ponerPlan(s1!.id, await crearPlan(['SALON', 'CAJA']));
    await elegirSucursal(ctx, empresa.admin.token, s1!.id);
    const antes = ejecuciones.pedidos;
    const res = await get('/sonda-modulos/pedidos-web', empresa.admin.token);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ codigo: 'MODULO_NO_INCLUIDO' });
    expect(Object.keys(res.body).sort()).toEqual(['codigo', 'mensaje']);
    expect(ejecuciones.pedidos).toBe(antes);
    expect((await get('/sonda-modulos/caja', empresa.admin.token)).status).toBe(200);
  });

  it('también corta las escrituras y nada se escribe', async () => {
    await elegirSucursal(ctx, empresa.admin.token, empresa.sucursales[0]!.id);
    const antes = ejecuciones.escritura;
    const res = await ctx.http().post('/sonda-modulos/escribe').set(bearer(empresa.admin.token));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ codigo: 'MODULO_NO_INCLUIDO' });
    expect(ejecuciones.escritura).toBe(antes);
  });

  it('decide el plan de la sucursal activa, no el de otra de la misma empresa', async () => {
    const [s1, s2] = empresa.sucursales;
    await ponerPlan(s2!.id, await crearPlan(['PEDIDOS_WEB']));
    await elegirSucursal(ctx, empresa.admin.token, s2!.id);
    expect((await get('/sonda-modulos/pedidos-web', empresa.admin.token)).status).toBe(200);
    expect((await get('/sonda-modulos/caja', empresa.admin.token)).status).toBe(403);
    await elegirSucursal(ctx, empresa.admin.token, s1!.id);
    expect((await get('/sonda-modulos/pedidos-web', empresa.admin.token)).status).toBe(403);
    expect((await get('/sonda-modulos/caja', empresa.admin.token)).status).toBe(200);
  });

  it('el cambio de plan se aplica desde la siguiente petición, también el de los módulos del plan', async () => {
    const [s1] = empresa.sucursales;
    await elegirSucursal(ctx, empresa.admin.token, s1!.id);
    expect((await get('/sonda-modulos/pedidos-web', empresa.admin.token)).status).toBe(403);
    const plan = await crearPlan(['SALON', 'PEDIDOS_WEB']);
    await ponerPlan(s1!.id, plan);
    expect((await get('/sonda-modulos/pedidos-web', empresa.admin.token)).status).toBe(200);
    expect((await get('/sonda-modulos/caja', empresa.admin.token)).status).toBe(403);
    // Quitarle el módulo al plan también rige de inmediato.
    exigirEstado(
      await ctx
        .http()
        .patch(`/plataforma/planes/${plan}`)
        .set(bearer(sa.token))
        .send({ modulos: ['SALON'], motivo: 'Quita módulos' }),
      200,
      'cambiar los módulos del plan',
    );
    expect((await get('/sonda-modulos/pedidos-web', empresa.admin.token)).status).toBe(403);
  });

  it('sin sucursal activa responde 409 SUCURSAL_NO_ELEGIDA y el controlador no corre', async () => {
    const otro = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: empresa.sucursales.map((s) => ({ sucursalId: s.id, rol: 'CAJERO' as const })),
    });
    const antes = ejecuciones.caja;
    const res = await get('/sonda-modulos/caja', otro.token);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'SUCURSAL_NO_ELEGIDA' });
    expect(ejecuciones.caja).toBe(antes);
  });

  it('sin sesión responde 401 y una sucursal sin suscripción, 403 (no tiene ningún módulo)', async () => {
    expect((await ctx.http().get('/sonda-modulos/caja')).status).toBe(401);
    // Una sucursal sin suscripción (como las que crean otras pruebas por SQL): sin plan no hay módulos.
    // El administrador de la base salta la RLS: se puede borrar sin quitar FORCE.
    await admin.query('BEGIN');
    try {
      await admin.query('DELETE FROM suscripcion WHERE sucursal_id = $1', [
        empresa.sucursales[1]!.id,
      ]);
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
    await elegirSucursal(ctx, empresa.admin.token, empresa.sucursales[1]!.id);
    const res = await get('/sonda-modulos/caja', empresa.admin.token);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ codigo: 'MODULO_NO_INCLUIDO' });
  });
});

describe('GET /sesion incluye `modulos` (criterio 77)', () => {
  it('vacío sin sucursal activa y con los del plan de la sucursal activa al elegirla', async () => {
    const nuevo = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: empresa.sucursales.map((s) => ({ sucursalId: s.id, rol: 'MOZO' as const })),
    });
    const sin = sesionRespuestaSchema.parse((await get('/sesion', nuevo.token)).body);
    expect(sin.sucursal).toBeNull();
    expect(sin.modulos).toEqual([]);

    const [s1] = empresa.sucursales;
    await ponerPlan(s1!.id, await crearPlan(['COCINA', 'SALON']));
    const elegida = await ctx
      .http()
      .put('/sesion/sucursal')
      .set(bearer(nuevo.token))
      .send({ sucursalId: s1!.id });
    exigirEstado(elegida, 200, 'elegir sucursal');
    expect(sesionRespuestaSchema.parse(elegida.body).modulos).toEqual(['SALON', 'COCINA']);
    const actual = sesionRespuestaSchema.parse((await get('/sesion', nuevo.token)).body);
    expect(actual.modulos).toEqual(['SALON', 'COCINA']);
  });

  it('el ingreso con contraseña trae los módulos de la única sucursal del usuario', async () => {
    const sucursal = empresa.sucursales[0]!;
    const unico = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: sucursal.id, rol: 'CAJERO' }],
    });
    const ingreso = await ctx
      .http()
      .post('/sesiones/contrasena')
      .send({ usuario: unico.usuario, contrasena: unico.contrasena });
    exigirEstado(ingreso, 201, 'ingreso');
    expect(ingreso.body.sesion.sucursal).toMatchObject({ id: sucursal.id });
    expect(ingreso.body.sesion.modulos).toEqual(['SALON', 'COCINA']);
  });

  it('la sesión de soporte con sucursal trae los módulos del plan de esa sucursal', async () => {
    const sucursal = empresa.sucursales[0]!;
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Soporte de prueba', sucursalId: sucursal.id });
    exigirEstado(res, 201, 'soporte');
    expect(res.body.sesion.modulos).toEqual(['SALON', 'COCINA']);
    const sinSucursal = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Soporte de prueba' });
    exigirEstado(sinSucursal, 201, 'soporte sin sucursal');
    expect(sinSucursal.body.sesion.modulos).toEqual([]);
    // Con la sesión de soporte la sonda también respeta el plan.
    const conSucursal = res.body.token as string;
    expect((await get('/sonda-modulos/pedidos-web', conSucursal)).status).toBe(403);
  });

  it('cada empresa ve solo los módulos de su plan', async () => {
    const otra = await altaEmpresa(ctx, sa);
    await elegirSucursal(ctx, otra.admin.token, otra.sucursales[0]!.id);
    const res = await get('/sesion', otra.admin.token);
    expect(sesionRespuestaSchema.parse(res.body).modulos).toHaveLength(7);
    expect(mozo.id).not.toBe(otra.admin.id);
  });
});
