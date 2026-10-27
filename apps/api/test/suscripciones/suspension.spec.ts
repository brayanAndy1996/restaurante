// Pruebas del desarrollador (no protegidas) de la tarea T41 · criterios 80 a 84: suspensión por falta de pago.
// `avisoSuscripcion` en `GET /sesion` (Administrador y soporte), `SuscripcionService.exigirAperturaDeCaja`
// con un controlador sonda y el reloj de la API, reactivación con un pago, rutas que siguen funcionando con
// la sucursal suspendida y una comprobación de que nada más en `src` consulta el estado.
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { sesionRespuestaSchema, type AvisoSuscripcion } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SuscripcionService } from '../../src/modulos/plataforma';
import { RequiereModulo } from '../../src/modulos/seguridad';
import { textoUnico } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  bearer,
  crearUsuarioConSesion,
  elegirSucursal,
  exigirEstado,
  ingresarOk,
  nuevoSuperadmin,
  recordarEquipo,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';

/** Miércoles 15 de mayo de 2030, 10:00 en Lima. Con 7 días de gracia (plan BASE). */
const INICIO = '2030-05-15T10:00:00-05:00';

/** Sonda: la apertura de caja llama a `exigirAperturaDeCaja`; las demás rutas no consultan nada. */
@Controller('sonda-suspension')
class SondaSuspensionController {
  constructor(@Inject(SuscripcionService) private readonly suscripciones: SuscripcionService) {}

  @Get('abrir-caja')
  async abrirCaja(@Query('sucursalId') sucursalId: string) {
    await this.suscripciones.exigirAperturaDeCaja(sucursalId);
    return { ok: true };
  }

  @Get('otra-operacion')
  @RequiereModulo('CAJA')
  otraOperacion() {
    return { ok: true };
  }
}

let ctx: AppDePrueba;
let sa: SuperadminDePrueba;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO, controladoresExtra: [SondaSuspensionController] });
  sa = await nuevoSuperadmin(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
});

const get = (ruta: string, token: string) => ctx.http().get(ruta).set(bearer(token));

const abrirCaja = (token: string, sucursalId: string) =>
  get(`/sonda-suspension/abrir-caja?sucursalId=${sucursalId}`, token);

/** Una empresa con dos sucursales y su Administrador con sesión. */
const nuevaEmpresa = () => altaEmpresa(ctx, sa, { sucursalesPorEmisor: 2 });

/** Fija el vencimiento de la suscripción de una sucursal (el superadministrador puede ponerlo a cualquier fecha). */
async function vencimiento(e: EmpresaDePrueba, sucursalId: string, fecha: string): Promise<void> {
  exigirEstado(
    await ctx
      .http()
      .patch(`/plataforma/suscripciones/${e.suscripciones[sucursalId]!.id}`)
      .set(bearer(sa.token))
      .send({ vencimiento: fecha, motivo: textoUnico('motivo') }),
    200,
    'fijar el vencimiento',
  );
}

async function pagar(e: EmpresaDePrueba, sucursalId: string, vencimientoNuevo: string) {
  return ctx
    .http()
    .post(`/plataforma/suscripciones/${e.suscripciones[sucursalId]!.id}/pagos`)
    .set(bearer(sa.token))
    .set('Idempotency-Key', randomUUID())
    .send({
      monto: '99.90',
      fechaPago: '2030-05-15',
      medio: 'YAPE',
      referencia: 'Operación de prueba',
      vencimientoNuevo,
      motivo: textoUnico('motivo-pago'),
    });
}

/**
 * Mueve el reloj hacia adelante. Las sesiones expiran por inactividad, así que se vuelve a ingresar con el
 * superadministrador y con el Administrador de cada empresa indicada (se actualizan sus tokens).
 */
async function fijarReloj(instante: string, ...empresas: EmpresaDePrueba[]): Promise<void> {
  ctx.reloj.fijar(instante);
  const res = await ctx
    .http()
    .post('/plataforma/sesiones')
    .send({ usuario: sa.usuario, contrasena: sa.contrasena });
  exigirEstado(res, 201, 'reingreso del superadministrador');
  sa.token = res.body.token as string;
  for (const e of empresas) {
    e.admin.token = (await ingresarOk(ctx, e.admin.usuario, e.admin.contrasena)).token;
  }
}

const sesion = async (token: string) => {
  const res = await get('/sesion', token);
  exigirEstado(res, 200, 'GET /sesion');
  return sesionRespuestaSchema.parse(res.body);
};

const porId = (aviso: AvisoSuscripcion | null) =>
  [...(aviso?.sucursales ?? [])].sort((a, b) => a.sucursalId.localeCompare(b.sucursalId));

describe('avisoSuscripcion en GET /sesion (criterio 80)', () => {
  let A: EmpresaDePrueba;
  let B: EmpresaDePrueba;
  let [gracia, suspendida]: [string, string] = ['', ''];

  beforeAll(async () => {
    A = await nuevaEmpresa();
    B = await nuevaEmpresa();
    gracia = A.sucursales[0]!.id;
    suspendida = A.sucursales[1]!.id;
  });

  it('con todas las sucursales ACTIVA es null, tenga o no sucursal activa', async () => {
    expect((await sesion(A.admin.token)).avisoSuscripcion).toBeNull();
    await elegirSucursal(ctx, A.admin.token, gracia);
    expect((await sesion(A.admin.token)).avisoSuscripcion).toBeNull();
  });

  it('el Administrador recibe cada sucursal en gracia o suspendida con sus fechas y días restantes', async () => {
    // El 15 de mayo: vencimiento el 10 → en gracia, suspende el 18 (quedan 3 días); el 1 → suspendida.
    await vencimiento(A, gracia, '2030-05-10');
    await vencimiento(A, suspendida, '2030-05-01');

    // Sin sucursal activa: nueva sesión de contraseña del mismo Administrador.
    const nueva = await ingresarOk(ctx, A.admin.usuario, A.admin.contrasena);
    const sinActiva = await sesion(nueva.token);
    expect(sinActiva.sucursal).toBeNull();
    expect(porId(sinActiva.avisoSuscripcion)).toEqual(
      [
        {
          sucursalId: gracia,
          nombre: A.sucursales[0]!.nombre,
          estado: 'EN_GRACIA',
          vencimiento: '2030-05-10',
          suspensionDesde: '2030-05-18',
          diasRestantesGracia: 3,
        },
        {
          sucursalId: suspendida,
          nombre: A.sucursales[1]!.nombre,
          estado: 'SUSPENDIDA',
          vencimiento: '2030-05-01',
          suspensionDesde: '2030-05-09',
          diasRestantesGracia: null,
        },
      ].sort((a, b) => a.sucursalId.localeCompare(b.sucursalId)),
    );

    await elegirSucursal(ctx, nueva.token, gracia);
    expect(porId((await sesion(nueva.token)).avisoSuscripcion)).toHaveLength(2);
  });

  it('también lo trae el ingreso del Administrador (contraseña y PIN) y no una sucursal ACTIVA', async () => {
    const ingreso = await ingresarOk(ctx, A.admin.usuario, A.admin.contrasena);
    const cuerpo = sesionRespuestaSchema.parse(ingreso.sesion);
    expect(cuerpo.avisoSuscripcion?.sucursales.map((s) => s.estado).sort()).toEqual([
      'EN_GRACIA',
      'SUSPENDIDA',
    ]);

    const equipo = await recordarEquipo(ctx, ingreso.token);
    const pin = await ctx
      .http()
      .post('/sesiones/pin')
      .set('X-Equipo', equipo.tokenEquipo!)
      .send({ usuarioId: A.admin.id, pin: A.admin.pin });
    exigirEstado(pin, 201, 'ingreso con PIN del Administrador');
    expect(sesionRespuestaSchema.parse(pin.body.sesion).avisoSuscripcion?.sucursales).toHaveLength(
      2,
    );
  });

  it('el soporte lo recibe al entrar (con y sin sucursal) y en GET /sesion', async () => {
    const entrar = (cuerpo: object) =>
      ctx
        .http()
        .post(`/plataforma/empresas/${A.empresaId}/soporte`)
        .set(bearer(sa.token))
        .send({ motivo: 'Soporte de prueba', ...cuerpo });
    const sin = await entrar({});
    exigirEstado(sin, 201, 'soporte sin sucursal');
    expect(porId(sesionRespuestaSchema.parse(sin.body.sesion).avisoSuscripcion)).toHaveLength(2);
    const con = await entrar({ sucursalId: suspendida });
    exigirEstado(con, 201, 'soporte con sucursal');
    const entrada = sesionRespuestaSchema.parse(con.body.sesion);
    expect(entrada.avisoSuscripcion?.sucursales.map((s) => s.sucursalId).sort()).toEqual(
      [gracia, suspendida].sort(),
    );
    const actual = await sesion(con.body.token as string);
    expect(actual.tipo).toBe('SOPORTE');
    expect(actual.avisoSuscripcion).toEqual(entrada.avisoSuscripcion);
    // Soporte en una empresa sin avisos: null.
    const sinAvisos = await ctx
      .http()
      .post(`/plataforma/empresas/${B.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Soporte de prueba' });
    exigirEstado(sinAvisos, 201, 'soporte en B');
    expect(sesionRespuestaSchema.parse(sinAvisos.body.sesion).avisoSuscripcion).toBeNull();
  });

  it('para los demás roles siempre es null y otra empresa no ve los avisos de A', async () => {
    for (const rol of ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR'] as const) {
      const u = await crearUsuarioConSesion(ctx, A.admin.token, {
        accesos: A.sucursales.map((s) => ({ sucursalId: s.id, rol })),
      });
      expect((await sesion(u.token)).avisoSuscripcion).toBeNull();
      await elegirSucursal(ctx, u.token, suspendida);
      expect((await sesion(u.token)).avisoSuscripcion).toBeNull();
    }
    expect((await sesion(B.admin.token)).avisoSuscripcion).toBeNull();
  });
});

describe('exigirAperturaDeCaja y las rutas con la sucursal suspendida (criterios 81, 82 y 84)', () => {
  let E: EmpresaDePrueba;
  let activa: string;
  let suspendida: string;
  let otra: EmpresaDePrueba;

  beforeAll(async () => {
    E = await nuevaEmpresa();
    otra = await nuevaEmpresa();
    activa = E.sucursales[0]!.id;
    suspendida = E.sucursales[1]!.id;
    await vencimiento(E, suspendida, '2030-05-01');
  });

  it('no lanza con la sucursal ACTIVA y lanza 403 SUCURSAL_SUSPENDIDA con la suspendida', async () => {
    const ok = await abrirCaja(E.admin.token, activa);
    exigirEstado(ok, 200, 'abrir caja activa');
    expect(ok.body).toEqual({ ok: true });
    const res = await abrirCaja(E.admin.token, suspendida);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ codigo: 'SUCURSAL_SUSPENDIDA' });
    expect(Object.keys(res.body).sort()).toEqual(['codigo', 'mensaje']);
  });

  it('también lo exige a un cajero (la regla es de la sucursal, no del rol) y una sucursal de otra empresa es 404', async () => {
    const cajero = await crearUsuarioConSesion(ctx, E.admin.token, {
      accesos: E.sucursales.map((s) => ({ sucursalId: s.id, rol: 'CAJERO' as const })),
    });
    expect((await abrirCaja(cajero.token, activa)).status).toBe(200);
    expect((await abrirCaja(cajero.token, suspendida)).status).toBe(403);
    const ajena = await abrirCaja(otra.admin.token, suspendida);
    expect(ajena.status).toBe(404);
    expect(ajena.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('con la sucursal EN_GRACIA no lanza', async () => {
    await vencimiento(E, activa, '2030-05-10');
    exigirEstado(await abrirCaja(E.admin.token, activa), 200, 'abrir caja en gracia');
    await vencimiento(E, activa, '2030-06-30');
  });

  it('ingreso con contraseña y con PIN, sesión, consultas, configuración, usuarios y equipos siguen funcionando', async () => {
    const cajero = await crearUsuarioConSesion(ctx, E.admin.token, {
      accesos: [{ sucursalId: suspendida, rol: 'CAJERO' }],
    });
    // Ingreso con contraseña: la única sucursal del cajero está suspendida y entra a ella.
    const ingreso = await ingresarOk(ctx, cajero.usuario, cajero.contrasena);
    expect(sesionRespuestaSchema.parse(ingreso.sesion).sucursal?.id).toBe(suspendida);
    exigirEstado(await get('/sesion', ingreso.token), 200, 'GET /sesion');

    // Equipo recordado e ingreso con PIN.
    const equipo = await recordarEquipo(ctx, ingreso.token, { nombre: 'Caja 1' });
    const pin = await ctx
      .http()
      .post('/sesiones/pin')
      .set('X-Equipo', equipo.tokenEquipo!)
      .send({ usuarioId: cajero.id, pin: cajero.pin });
    exigirEstado(pin, 201, 'ingreso con PIN');
    exigirEstado(await get('/sesion/equipos', ingreso.token), 200, 'equipos de la persona');

    // El Administrador elige la sucursal suspendida, consulta y configura.
    const admin = E.admin.token;
    await elegirSucursal(ctx, admin, suspendida);
    exigirEstado(await get('/sucursales', admin), 200, 'listar sucursales');
    exigirEstado(await get(`/sucursales/${suspendida}`, admin), 200, 'consultar la sucursal');
    exigirEstado(await get('/usuarios', admin), 200, 'listar usuarios');
    exigirEstado(
      await ctx
        .http()
        .patch(`/sucursales/${suspendida}`)
        .set(bearer(admin))
        .send({ direccion: 'Av. Siempre Viva 742' }),
      200,
      'configurar la sucursal',
    );
    exigirEstado(
      await ctx
        .http()
        .patch(`/sucursales/${suspendida}/acceso`)
        .set(bearer(admin))
        .send({ minutosInactividad: 10 }),
      200,
      'configurar el acceso',
    );
    const nuevo = await ctx
      .http()
      .post('/usuarios')
      .set(bearer(admin))
      .send({
        nombre: 'Persona nueva',
        nombreUsuario: textoUnico('nuevo'),
        esAdministrador: false,
        accesos: [{ sucursalId: suspendida, rol: 'MOZO' }],
        contrasenaTemporal: `Clave-${randomUUID()}`,
      });
    exigirEstado(nuevo, 201, 'crear usuario');
    exigirEstado(
      await ctx.http().delete(`/usuarios/${cajero.id}/equipos`).set(bearer(admin)),
      204,
      'revocar los equipos de una persona',
    );

    // Un módulo del plan sigue disponible: el estado no lo decide.
    exigirEstado(await get('/sonda-suspension/otra-operacion', admin), 200, 'ruta con módulo');
    // Y la única que lo comprueba es la apertura de caja.
    expect((await abrirCaja(admin, suspendida)).status).toBe(403);
  });
});

describe('el reloj: gracia y suspensión (criterios 71 y 81)', () => {
  let E: EmpresaDePrueba;
  let sucursal: string;

  beforeAll(async () => {
    E = await nuevaEmpresa();
    sucursal = E.sucursales[0]!.id;
    await vencimiento(E, sucursal, '2030-05-15');
  });

  it('vence hoy: sigue ACTIVA; al día siguiente (hora de Lima) está en gracia y puede abrir caja', async () => {
    exigirEstado(await abrirCaja(E.admin.token, sucursal), 200, 'el último día');
    await fijarReloj('2030-05-15T23:59:00-05:00', E);
    exigirEstado(await abrirCaja(E.admin.token, sucursal), 200, 'a las 23:59');
    expect((await sesion(E.admin.token)).avisoSuscripcion).toBeNull();

    await fijarReloj('2030-05-16T00:00:00-05:00', E);
    exigirEstado(await abrirCaja(E.admin.token, sucursal), 200, 'primer día de gracia');
    expect(porId((await sesion(E.admin.token)).avisoSuscripcion)).toEqual([
      {
        sucursalId: sucursal,
        nombre: E.sucursales[0]!.nombre,
        estado: 'EN_GRACIA',
        vencimiento: '2030-05-15',
        suspensionDesde: '2030-05-23',
        diasRestantesGracia: 7,
      },
    ]);
  });

  it('el último día de gracia cuenta los días restantes y puede abrir caja; al siguiente se suspende', async () => {
    await fijarReloj('2030-05-22T23:59:00-05:00', E);
    exigirEstado(await abrirCaja(E.admin.token, sucursal), 200, 'último día de gracia');
    expect((await sesion(E.admin.token)).avisoSuscripcion?.sucursales[0]).toMatchObject({
      estado: 'EN_GRACIA',
      diasRestantesGracia: 1,
    });

    await fijarReloj('2030-05-23T00:00:00-05:00', E);
    const res = await abrirCaja(E.admin.token, sucursal);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ codigo: 'SUCURSAL_SUSPENDIDA' });
    expect((await sesion(E.admin.token)).avisoSuscripcion?.sucursales[0]).toMatchObject({
      estado: 'SUSPENDIDA',
      diasRestantesGracia: null,
      suspensionDesde: '2030-05-23',
    });
  });
});

describe('reactivación con un pago (criterio 83)', () => {
  let E: EmpresaDePrueba;
  let sucursal: string;
  let otraSucursal: string;

  beforeAll(async () => {
    E = await nuevaEmpresa();
    sucursal = E.sucursales[0]!.id;
    otraSucursal = E.sucursales[1]!.id;
    await vencimiento(E, sucursal, '2030-05-01');
    await vencimiento(E, otraSucursal, '2030-05-01');
    // Estas pruebas corren con el reloj ya movido por las anteriores; se asegura el día.
    await fijarReloj('2030-05-23T10:00:00-05:00', E);
  });

  it('un pago que no llega a hoy más los días de gracia no la reactiva', async () => {
    expect((await abrirCaja(E.admin.token, sucursal)).status).toBe(403);
    exigirEstado(await pagar(E, sucursal, '2030-05-10'), 201, 'pago insuficiente');
    expect((await abrirCaja(E.admin.token, sucursal)).status).toBe(403);
  });

  it('un pago con vencimientoNuevo igual a hoy la deja ACTIVA desde la siguiente petición', async () => {
    expect(
      porId((await sesion(E.admin.token)).avisoSuscripcion)
        .map((s) => s.sucursalId)
        .sort(),
    ).toEqual([sucursal, otraSucursal].sort());
    exigirEstado(await pagar(E, sucursal, '2030-05-23'), 201, 'pago hasta hoy');
    exigirEstado(await abrirCaja(E.admin.token, sucursal), 200, 'abrir caja reactivada');
    // El aviso ya no la incluye, pero sí la otra, que sigue suspendida.
    expect((await sesion(E.admin.token)).avisoSuscripcion?.sucursales).toMatchObject([
      { sucursalId: otraSucursal, estado: 'SUSPENDIDA' },
    ]);
    expect((await abrirCaja(E.admin.token, otraSucursal)).status).toBe(403);
  });

  it('con un pago hasta una fecha futura queda ACTIVA y el aviso desaparece', async () => {
    exigirEstado(await pagar(E, otraSucursal, '2030-06-23'), 201, 'pago futuro');
    exigirEstado(await abrirCaja(E.admin.token, otraSucursal), 200, 'abrir caja reactivada');
    expect((await sesion(E.admin.token)).avisoSuscripcion).toBeNull();
  });
});

describe('nada más consulta el estado de la suscripción (criterio 84)', () => {
  /** Archivos de `src` que pueden hablar del estado de la suscripción: solo el servicio dueño. */
  const PERMITIDOS = ['modulos/plataforma/suscripcion.service.ts'];
  const PATRONES = [
    'estadoDeSucursal',
    'exigirAperturaDeCaja',
    'SUCURSAL_SUSPENDIDA',
    'estadoSuscripcion(',
    "'SUSPENDIDA'",
    "'EN_GRACIA'",
  ];

  const archivos = (carpeta: string): string[] =>
    readdirSync(carpeta, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? archivos(join(carpeta, e.name))
        : e.name.endsWith('.ts')
          ? [join(carpeta, e.name)]
          : [],
    );

  it('solo SuscripcionService calcula el estado y nadie más lo consulta para bloquear algo', () => {
    const src = join(__dirname, '..', '..', 'src');
    const infractores: string[] = [];
    for (const archivo of archivos(src)) {
      const ruta = relative(src, archivo).split('\\').join('/');
      if (PERMITIDOS.includes(ruta)) continue;
      const texto = readFileSync(archivo, 'utf8');
      for (const patron of PATRONES) {
        if (texto.includes(patron)) infractores.push(`${ruta}: ${patron}`);
      }
    }
    expect(infractores).toEqual([]);
  });
});
