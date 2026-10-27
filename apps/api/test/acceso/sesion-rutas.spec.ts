// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P1 · Sesión, resolutor de empresa por sesión y rutas protegidas por defecto (criterios 1 a 9).
// Las pruebas con etiqueta [C1], [C2] o [C3] dependen de funciones de grupos posteriores de la fase C.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { Controller, Get, Post } from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { PUBLICA } from '../../src/modulos/seguridad';
import { fijarEntornoDePrueba, rutasDeNest, rutasRegistradas } from '../utilidades';
import {
  HORA_INICIAL,
  MINUTO,
  RUTAS_PUBLICAS,
  UUID_CERO,
  accesosPorHttp,
  armarToken,
  auditoriaDe,
  conAplicacionAparte,
  crearUsuario,
  crearUsuarioConRol,
  enIso,
  escenarioPerezoso,
  esperarError,
  filas,
  huellasPosibles,
  iniciarSoporte,
  nombreUnico,
  partesDeToken,
  recordarEquipoDe,
  rucAleatorio,
  rutaConId,
  rutasDeEmpresa,
  secretoAleatorio,
  sesionAdmin,
  sesionSuperadmin,
  sesionesDe,
  textoUnico,
  type EmpresaDePrueba,
  type Escenario,
  type RolDeAcceso,
} from './fabrica-sesiones';

/** Sonda: una ruta de empresa sin ningún decorador. Cuenta cuántas veces se ejecutó su cuerpo. */
@Controller('sonda-acceso')
class SondaController {
  static llamadas = 0;

  @Get()
  ver() {
    SondaController.llamadas += 1;
    return { ok: true };
  }

  @Post()
  crear() {
    SondaController.llamadas += 1;
    return { ok: true };
  }
}

const sc = escenarioPerezoso({ controladoresExtra: [SondaController], poolMax: 2 });
afterAll(async () => {
  await sc.cerrar();
});
beforeEach(() => {
  SondaController.llamadas = 0;
});

/** El escenario con el reloj en la hora inicial (las pruebas de arranque no lo necesitan). */
async function escenario(): Promise<Escenario> {
  const esc = await sc.obtener();
  esc.reloj.fijar(HORA_INICIAL);
  return esc;
}

const idsDe = (lista: { id: string }[]) => lista.map((x) => x.id).sort();

/** Cuerpo válido de `POST /sucursales` para la empresa. */
function cuerpoSucursal(empresa: EmpresaDePrueba) {
  return {
    rucEmisor: empresa.emisores[0]!.ruc,
    nombre: textoUnico('Sucursal nueva'),
    codigoEstablecimiento: '0099',
    direccion: 'Jr. Prueba 123, Lima',
  };
}

describe('criterio 1 · rutas protegidas por defecto', () => {
  it('las rutas públicas de la aplicación son exactamente la lista cerrada', async () => {
    const esc = await escenario();
    const publicas = rutasDeNest(esc.app)
      .filter((r) => Reflect.getMetadata(PUBLICA, r.controlador.prototype[r.manejador]) === true)
      .map((r) => `${r.metodo} ${r.ruta}`);
    expect([...publicas].sort()).toEqual([...RUTAS_PUBLICAS].sort());
    // La sonda, sin decorador, no es pública.
    expect(publicas).not.toContain('GET /sonda-acceso');
  });

  it('el recorrido incluye todas las rutas registradas, también las de los controladores extra', async () => {
    const esc = await escenario();
    const rutas = rutasDeEmpresa(rutasRegistradas(esc.app)).map((r) => `${r.metodo} ${r.ruta}`);
    expect(rutas).toContain('GET /sonda-acceso');
    expect(rutas).toContain('POST /sonda-acceso');
    expect(rutas).toContain('GET /sucursales');
    expect(rutas).toContain('GET /usuarios/:id');
    expect(rutas.length).toBeGreaterThan(25);
  });

  it('sin credenciales válidas ninguna ruta de empresa responde 401 NO_AUTENTICADO, sin ejecutar el controlador ni abrir contexto de empresa', async () => {
    const esc = await escenario();
    const sa = await sesionSuperadmin(esc);
    const secreto = secretoAleatorio();
    const sinContexto: { nombre: string; cabeceras: Record<string, string> }[] = [
      { nombre: 'sin Authorization', cabeceras: {} },
      { nombre: 'esquema Basic', cabeceras: { Authorization: 'Basic dXN1YXJpbzpjbGF2ZQ==' } },
      { nombre: 'token vacío', cabeceras: { Authorization: 'Bearer ' } },
      { nombre: 'token mal formado', cabeceras: { Authorization: 'Bearer esto-no-es-un-token' } },
      {
        nombre: 'se. con una parte menos',
        cabeceras: { Authorization: `Bearer se.${esc.A.id}.${randomUUID()}` },
      },
      {
        nombre: 'se. con empresa que no es UUID',
        cabeceras: { Authorization: `Bearer se.no-es-uuid.${randomUUID()}.${secreto}` },
      },
      {
        nombre: 'se. con el secreto de largo incorrecto',
        cabeceras: { Authorization: `Bearer se.${esc.A.id}.${randomUUID()}.corto` },
      },
      {
        nombre: 'token sa. de un superadministrador válido',
        cabeceras: { Authorization: `Bearer ${sa}` },
      },
      {
        nombre: 'token eq. de equipo como Authorization',
        cabeceras: { Authorization: `Bearer ${armarToken('eq', esc.A.id, randomUUID(), secreto)}` },
      },
      {
        nombre: 'solo X-Equipo, sin Authorization',
        cabeceras: { 'X-Equipo': armarToken('eq', esc.A.id, randomUUID(), secreto) },
      },
    ];
    const rutas = rutasDeEmpresa(rutasRegistradas(esc.app));
    const espia = vi.spyOn(esc.app.get(ContextoEmpresa), 'ejecutar');
    try {
      for (const credencial of sinContexto) {
        for (const r of rutas) {
          const res = await esc.api.llamar(r.metodo.toLowerCase() as any, rutaConId(r.ruta), {
            cabeceras: credencial.cabeceras,
            cuerpo: r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : {},
          });
          expect(res.status, `${credencial.nombre} · ${r.metodo} ${r.ruta}: ${res.text}`).toBe(401);
          expect(res.body, `${credencial.nombre} · ${r.metodo} ${r.ruta}`).toMatchObject({
            codigo: 'NO_AUTENTICADO',
          });
        }
      }
      expect(espia).not.toHaveBeenCalled();
    } finally {
      espia.mockRestore();
    }
    expect(SondaController.llamadas).toBe(0);
  });

  it('con un token de sesión inexistente o de una sesión cerrada ninguna ruta de empresa responde distinto de 401 NO_AUTENTICADO', async () => {
    const esc = await escenario();
    const cerrada = await sesionAdmin(esc, esc.A);
    expect((await esc.api.delete('/sesion', { token: cerrada.token })).status).toBe(204);
    const inexistente = armarToken('se', esc.A.id, randomUUID(), secretoAleatorio());
    const rutas = rutasDeEmpresa(rutasRegistradas(esc.app));
    for (const [nombre, token] of [
      ['sesión cerrada', cerrada.token],
      ['sesión inexistente', inexistente],
    ] as const) {
      for (const r of rutas) {
        const res = await esc.api.llamar(r.metodo.toLowerCase() as any, rutaConId(r.ruta), {
          token,
          cuerpo: r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : {},
        });
        expect(res.status, `${nombre} · ${r.metodo} ${r.ruta}: ${res.text}`).toBe(401);
        expect(res.body, `${nombre} · ${r.metodo} ${r.ruta}`).toMatchObject({
          codigo: 'NO_AUTENTICADO',
        });
      }
    }
    expect(SondaController.llamadas).toBe(0);
  });

  it('con una sesión válida la ruta de la sonda sí se ejecuta (control positivo)', async () => {
    const esc = await escenario();
    const { token } = await sesionAdmin(esc, esc.A);
    const res = await esc.api.get('/sonda-acceso', { token });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(SondaController.llamadas).toBe(1);
  });

  it('las rutas públicas responden sin Authorization: /health y el ingreso con contraseña', async () => {
    const esc = await escenario();
    expect((await esc.api.get('/health')).status).toBe(200);
    const res = await esc.api.post('/sesiones/contrasena', {
      cuerpo: { usuario: nombreUnico('no-existe'), contrasena: 'Cualquiera-1' },
    });
    esperarError(res, 401, 'CREDENCIALES_INVALIDAS');
  });

  it('[C2] las rutas públicas de equipo responden sin Authorization con EQUIPO_NO_RECONOCIDO', async () => {
    const esc = await escenario();
    esperarError(await esc.api.get('/equipo'), 401, 'EQUIPO_NO_RECONOCIDO');
    esperarError(
      await esc.api.post('/sesiones/pin', { cuerpo: { usuarioId: UUID_CERO, pin: '1234' } }),
      401,
      'EQUIPO_NO_RECONOCIDO',
    );
  });

  it('[C2] un token eq. real como Authorization tampoco abre ninguna ruta de empresa', async () => {
    const esc = await escenario();
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO');
    const { tokenEquipo } = await recordarEquipoDe(esc, u);
    for (const r of rutasDeEmpresa(rutasRegistradas(esc.app))) {
      const res = await esc.api.llamar(r.metodo.toLowerCase() as any, rutaConId(r.ruta), {
        token: tokenEquipo,
        cuerpo: r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : {},
      });
      expect(res.status, `${r.metodo} ${r.ruta}: ${res.text}`).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    }
    expect(SondaController.llamadas).toBe(0);
  });
});

describe('criterio 2 · la empresa sale de la sesión', () => {
  it('con x-empresa-id = B, GET /sucursales devuelve solo sucursales de A (NODE_ENV=test)', async () => {
    const esc = await escenario();
    const { token } = await sesionAdmin(esc, esc.A);
    const res = await esc.api.get('/sucursales', {
      token,
      cabeceras: { 'x-empresa-id': esc.B.id },
    });
    expect(res.status, res.text).toBe(200);
    expect(idsDe(res.body)).toEqual(idsDe(esc.A.sucursales));
    expect(res.text).not.toContain(esc.B.id);
    for (const s of esc.B.sucursales) expect(res.text).not.toContain(s.id);
  });

  it('ningún parámetro de consulta, de ruta ni del cuerpo cambia la empresa', async () => {
    const esc = await escenario();
    const { token } = await sesionAdmin(esc, esc.A);
    const cabeceras = { 'x-empresa-id': esc.B.id };
    // Una sucursal de B por id: no existe para A.
    esperarError(
      await esc.api.get(`/sucursales/${esc.B.sucursales[0]!.id}`, { token, cabeceras }),
      404,
      'NO_ENCONTRADO',
    );
    // Parámetro de consulta con la empresa de B.
    const consulta = await esc.api.get(`/sucursales?empresaId=${esc.B.id}`, { token, cabeceras });
    expect(consulta.status).toBe(200);
    expect(idsDe(consulta.body)).toEqual(idsDe(esc.A.sucursales));
    // Modificar una sucursal de B desde A: 404, y la de B queda igual.
    const antes = await sesionAdmin(esc, esc.B);
    const sucursalB = await esc.api.get(`/sucursales/${esc.B.sucursales[0]!.id}`, {
      token: antes.token,
    });
    esperarError(
      await esc.api.patch(`/sucursales/${esc.B.sucursales[0]!.id}`, {
        token,
        cabeceras,
        cuerpo: { direccion: 'Hackeada' },
      }),
      404,
      'NO_ENCONTRADO',
    );
    const despues = await esc.api.get(`/sucursales/${esc.B.sucursales[0]!.id}`, {
      token: antes.token,
    });
    expect(despues.body).toEqual(sucursalB.body);
    // Una empresa en el cuerpo de una modificación de la propia sucursal: entrada inválida.
    const conEmpresa = await esc.api.patch(`/sucursales/${esc.A.sucursales[0]!.id}`, {
      token,
      cuerpo: { direccion: 'Otra dirección 45', empresaId: esc.B.id },
    });
    expect([200, 400]).toContain(conEmpresa.status);
    const propia = await esc.api.get(`/sucursales/${esc.A.sucursales[0]!.id}`, { token });
    expect(propia.body.empresaId).toBe(esc.A.id);
  });

  it('también con NODE_ENV=development y NODE_ENV=production la cabecera x-empresa-id no cambia la empresa', async () => {
    const esc = await escenario();
    const { token } = await sesionAdmin(esc, esc.A);
    for (const nodeEnv of ['development', 'production'] as const) {
      await conAplicacionAparte(esc, { nodeEnv, empresaPorHeader: false }, async (api) => {
        const res = await api.get('/sucursales', {
          token,
          cabeceras: { 'x-empresa-id': esc.B.id },
        });
        expect(res.status, `${nodeEnv}: ${res.text}`).toBe(200);
        expect(idsDe(res.body), nodeEnv).toEqual(idsDe(esc.A.sucursales));
      });
    }
  });
});

describe('criterio 3 · token adulterado', () => {
  it('cambiar la empresa, la sesión o el secreto responde 401 NO_AUTENTICADO idéntico y no toca la sesión de B', async () => {
    const esc = await escenario();
    const a = await sesionAdmin(esc, esc.A);
    const b = await sesionAdmin(esc, esc.B);
    const pa = partesDeToken(a.token);
    const pb = partesDeToken(b.token);
    const antes = await esc.api.get('/sesion', { token: b.token, segundoPlano: true });
    expect(antes.status, antes.text).toBe(200);
    expect(antes.body.expiraPorInactividadEn).toBe(enIso(esc.reloj, 30 * MINUTO));

    esc.reloj.avanzar(MINUTO);
    const otroSecreto = secretoAleatorio();
    const variantes = [
      armarToken('se', esc.B.id, pa.id, pa.secreto), // empresa de B
      armarToken('se', esc.A.id, pb.id, pa.secreto), // sesión de B con el secreto de A, en la empresa de A
      armarToken('se', esc.B.id, pb.id, pa.secreto), // sesión de B con el secreto de A, en la empresa de B
      armarToken('se', esc.A.id, pa.id, otroSecreto), // otro secreto
      armarToken('se', esc.A.id, pa.id, pb.secreto), // el secreto de B
      armarToken('se', esc.B.id, pb.id, otroSecreto), // sesión de B, secreto ajeno
      armarToken('se', esc.A.id, randomUUID(), pa.secreto), // sesión inexistente
    ];
    let primero: any;
    for (const token of variantes) {
      const res = await esc.api.get('/sesion', { token });
      esperarError(res, 401, 'NO_AUTENTICADO');
      primero ??= res.body;
      expect(res.body).toEqual(primero);
      expect(res.text).not.toContain(esc.B.id);
      expect(res.text).not.toContain(esc.B.nombre);
      // Tampoco en rutas de datos.
      const datos = await esc.api.get('/sucursales', { token });
      esperarError(datos, 401, 'NO_AUTENTICADO');
      expect(datos.text).not.toContain(esc.B.sucursales[0]!.id);
    }

    // La sesión de B sigue válida y su actividad no cambió.
    const despues = await esc.api.get('/sesion', { token: b.token, segundoPlano: true });
    expect(despues.status, despues.text).toBe(200);
    expect(despues.body.expiraPorInactividadEn).toBe(antes.body.expiraPorInactividadEn);
    // La sesión de A tampoco se cerró por los intentos con su identificador.
    expect((await esc.api.get('/sesion', { token: a.token })).status).toBe(200);
  });
});

describe('criterio 4 · secretos no guardados', () => {
  it('la sesión de empresa guarda solo la huella SHA-256 del secreto', async () => {
    const esc = await escenario();
    const { token } = await sesionAdmin(esc, esc.A);
    const { id, secreto } = partesDeToken(token);
    const [fila] = await filas<{ texto: string; huella: string }>(
      `SELECT s::text AS texto, encode(s.huella_secreto, 'hex') AS huella FROM sesion s WHERE s.id = $1`,
      [id],
    );
    expect(fila).toBeDefined();
    expect(fila!.texto).not.toContain(token);
    expect(fila!.texto).not.toContain(secreto);
    expect(huellasPosibles(secreto)).toContain(fila!.huella);
  });

  it('la sesión del superadministrador guarda solo la huella SHA-256 del secreto', async () => {
    const esc = await escenario();
    const token = await sesionSuperadmin(esc);
    const { id, secreto } = partesDeToken(token);
    const [fila] = await filas<{ texto: string; huella: string }>(
      `SELECT s::text AS texto, encode(s.huella_secreto, 'hex') AS huella
         FROM sesion_superadministrador s WHERE s.id = $1`,
      [id],
    );
    expect(fila).toBeDefined();
    expect(fila!.texto).not.toContain(token);
    expect(fila!.texto).not.toContain(secreto);
    expect(huellasPosibles(secreto)).toContain(fila!.huella);
  });

  it('la sesión de soporte guarda solo la huella SHA-256 del secreto', async () => {
    const esc = await escenario();
    const { token } = await iniciarSoporte(esc, esc.A);
    const { id, secreto } = partesDeToken(token);
    const [fila] = await filas<{ texto: string; huella: string }>(
      `SELECT s::text AS texto, encode(s.huella_secreto, 'hex') AS huella FROM sesion s WHERE s.id = $1`,
      [id],
    );
    expect(fila).toBeDefined();
    expect(fila!.texto).not.toContain(token);
    expect(fila!.texto).not.toContain(secreto);
    expect(huellasPosibles(secreto)).toContain(fila!.huella);
  });

  it('[C2] el equipo guarda solo la huella SHA-256 del secreto', async () => {
    const esc = await escenario();
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO');
    const { tokenEquipo } = await recordarEquipoDe(esc, u);
    const { id, secreto } = partesDeToken(tokenEquipo);
    const [fila] = await filas<{ texto: string; huella: string }>(
      `SELECT e::text AS texto, encode(e.huella_secreto, 'hex') AS huella FROM equipo e WHERE e.id = $1`,
      [id],
    );
    expect(fila).toBeDefined();
    expect(fila!.texto).not.toContain(tokenEquipo);
    expect(fila!.texto).not.toContain(secreto);
    expect(huellasPosibles(secreto)).toContain(fila!.huella);
  });
});

describe('criterio 5 · concurrencia con un pool de 2 conexiones', () => {
  it('100 peticiones concurrentes alternando sesiones de A y de B devuelven solo datos de su empresa', async () => {
    const esc = await escenario();
    const sesionesA = await Promise.all(Array.from({ length: 4 }, () => sesionAdmin(esc, esc.A)));
    const sesionesB = await Promise.all(Array.from({ length: 4 }, () => sesionAdmin(esc, esc.B)));
    const rutas = ['/sucursales', '/emisores', '/sesion'];
    const respuestas = await Promise.all(
      Array.from({ length: 100 }, (_, i) => {
        const empresa = i % 2 === 0 ? esc.A : esc.B;
        const sesiones = i % 2 === 0 ? sesionesA : sesionesB;
        const token = sesiones[(i >> 1) % sesiones.length]!.token;
        const ruta = rutas[i % rutas.length]!;
        return esc.api.get(ruta, { token }).then((res) => ({ empresa, ruta, res }));
      }),
    );
    expect(respuestas).toHaveLength(100);
    for (const { empresa, ruta, res } of respuestas) {
      expect(res.status, `${ruta}: ${res.text}`).toBe(200);
      if (ruta === '/sucursales') expect(idsDe(res.body)).toEqual(idsDe(empresa.sucursales));
      if (ruta === '/emisores') expect(idsDe(res.body)).toEqual(idsDe(empresa.emisores));
      if (ruta === '/sesion') {
        expect(res.body.empresaId).toBe(empresa.id);
        for (const s of res.body.sucursales) {
          expect(idsDe(empresa.sucursales)).toContain(s.id);
        }
      }
      const ajena = empresa === esc.A ? esc.B : esc.A;
      expect(res.text).not.toContain(ajena.id);
    }
  });
});

describe('criterio 6 · rol y acceso en cada petición', () => {
  it('cuando el Administrador cambia el rol, la siguiente petición ya usa el rol nuevo', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuario(esc, esc.A, {
      accesos: [{ sucursal: 0, rol: 'CAJERO' }],
      tokenAdmin: admin.token,
    });
    const antes = await esc.api.get('/sesion', { token: u.token! });
    expect(antes.body.rol).toBe('CAJERO');
    const cambio = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: accesosPorHttp(esc.A, [{ sucursal: 0, rol: 'SUPERVISOR' }]) },
    });
    expect(cambio.status, cambio.text).toBe(200);
    const despues = await esc.api.get('/sesion', { token: u.token! });
    expect(despues.status, despues.text).toBe(200);
    expect(despues.body.rol).toBe('SUPERVISOR');
    expect(despues.body.sucursal?.id).toBe(esc.A.sucursales[0]!.id);
  });

  it('cuando le quita el acceso a la sucursal activa, la sesión queda cerrada y responde 401 NO_AUTENTICADO', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuario(esc, esc.A, {
      accesos: [
        { sucursal: 0, rol: 'CAJERO' },
        { sucursal: 1, rol: 'CAJERO' },
      ],
      tokenAdmin: admin.token,
    });
    const elegir = await esc.api.put('/sesion/sucursal', {
      token: u.token!,
      cuerpo: { sucursalId: esc.A.sucursales[0]!.id },
    });
    expect(elegir.status, elegir.text).toBe(200);
    const cambio = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: accesosPorHttp(esc.A, [{ sucursal: 1, rol: 'CAJERO' }]) },
    });
    expect(cambio.status, cambio.text).toBe(200);
    esperarError(await esc.api.get('/sesion', { token: u.token! }), 401, 'NO_AUTENTICADO');
    esperarError(await esc.api.get('/sucursales', { token: u.token! }), 401, 'NO_AUTENTICADO');
    const sesiones = await sesionesDe(u.id);
    expect(sesiones.every((s) => s.cerrada_en !== null)).toBe(true);
  });

  it('quitar el acceso a otra sucursal (no la activa) no cierra la sesión', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuario(esc, esc.A, {
      accesos: [
        { sucursal: 0, rol: 'CAJERO' },
        { sucursal: 1, rol: 'CAJERO' },
      ],
      tokenAdmin: admin.token,
    });
    const elegir = await esc.api.put('/sesion/sucursal', {
      token: u.token!,
      cuerpo: { sucursalId: esc.A.sucursales[1]!.id },
    });
    expect(elegir.status, elegir.text).toBe(200);
    const cambio = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: accesosPorHttp(esc.A, [{ sucursal: 1, rol: 'CAJERO' }]) },
    });
    expect(cambio.status, cambio.text).toBe(200);
    const res = await esc.api.get('/sesion', { token: u.token! });
    expect(res.status, res.text).toBe(200);
    expect(res.body.sucursal?.id).toBe(esc.A.sucursales[1]!.id);
  });

  it('cuando lo desactiva, la siguiente petición de su sesión responde 401 NO_AUTENTICADO', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuario(esc, esc.A, { tokenAdmin: admin.token });
    expect((await esc.api.get('/sesion', { token: u.token! })).status).toBe(200);
    const cambio = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { activo: false },
    });
    expect(cambio.status, cambio.text).toBe(200);
    esperarError(await esc.api.get('/sesion', { token: u.token! }), 401, 'NO_AUTENTICADO');
    const sesiones = await sesionesDe(u.id);
    expect(sesiones.every((s) => s.cerrada_en !== null)).toBe(true);
  });
});

describe('criterio 7 · cabecera de empresa solo en pruebas', () => {
  it('con NODE_ENV=development y EMPRESA_POR_HEADER=habilitado la API no arranca y explica que solo vale con test', async () => {
    fijarEntornoDePrueba({ nodeEnv: 'development', empresaPorHeader: true });
    let app: Awaited<ReturnType<typeof crearAplicacion>> | null = null;
    let mensaje = '';
    try {
      app = await crearAplicacion({ logger: false }).catch((error: unknown) => {
        mensaje = String(error instanceof Error ? error.message : error);
        return null;
      });
      expect(app, 'la API arrancó en development con EMPRESA_POR_HEADER=habilitado').toBeNull();
      expect(mensaje).toMatch(/EMPRESA_POR_HEADER/);
      expect(mensaje).toMatch(/\btest\b/);
    } finally {
      await app?.close();
      fijarEntornoDePrueba({ empresaPorHeader: false });
    }
  });

  it('con NODE_ENV=production y EMPRESA_POR_HEADER=habilitado la API sigue sin arrancar', async () => {
    fijarEntornoDePrueba({ nodeEnv: 'production', empresaPorHeader: true });
    let app: Awaited<ReturnType<typeof crearAplicacion>> | null = null;
    let mensaje = '';
    try {
      app = await crearAplicacion({ logger: false }).catch((error: unknown) => {
        mensaje = String(error instanceof Error ? error.message : error);
        return null;
      });
      expect(app, 'la API arrancó en producción con EMPRESA_POR_HEADER=habilitado').toBeNull();
      expect(mensaje).toMatch(/EMPRESA_POR_HEADER/);
    } finally {
      await app?.close();
      fijarEntornoDePrueba({ empresaPorHeader: false });
    }
  });

  it('con NODE_ENV=test y la opción habilitada, sin Authorization corre con la empresa de x-empresa-id como principal de prueba', async () => {
    const esc = await escenario();
    await conAplicacionAparte(esc, { nodeEnv: 'test', empresaPorHeader: true }, async (api) => {
      const cabeceras = { 'x-empresa-id': esc.A.id };
      const lista = await api.get('/sucursales', { cabeceras });
      expect(lista.status, lista.text).toBe(200);
      expect(idsDe(lista.body)).toEqual(idsDe(esc.A.sucursales));

      const sesion = await api.get('/sesion', { cabeceras });
      expect(sesion.status, sesion.text).toBe(200);
      expect(sesion.body).toMatchObject({
        tipo: 'PRUEBA',
        empresaId: esc.A.id,
        esAdministrador: true,
        usuario: null,
        superadministrador: null,
        expiraPorInactividadEn: null,
      });

      // Permisos de Administrador en todas las sucursales de la empresa.
      expect((await api.get('/usuarios', { cabeceras })).status).toBe(200);
      for (const sucursal of esc.A.sucursales) {
        const res = await api.patch(`/sucursales/${sucursal.id}`, {
          cabeceras,
          cuerpo: { direccion: `Dirección de prueba ${textoUnico('x')}` },
        });
        expect(res.status, res.text).toBe(200);
      }

      // Actor de sistema `prueba` en la auditoría de lo que hizo.
      const filasDeAuditoria = await auditoriaDe(esc.A.id, 'configurar_sucursal');
      const delPrincipalDePrueba = filasDeAuditoria.filter((f) => f.actor_sistema === 'prueba');
      expect(delPrincipalDePrueba.length).toBeGreaterThanOrEqual(esc.A.sucursales.length);
      for (const fila of delPrincipalDePrueba) {
        expect(fila.actor_usuario_id).toBeNull();
        expect(fila.actor_superadministrador_id).toBeNull();
      }

      // Sin la cabecera, o con una inválida: 401 EMPRESA_NO_RESUELTA como en la historia 001.
      esperarError(await api.get('/sucursales'), 401, 'EMPRESA_NO_RESUELTA');
      esperarError(
        await api.get('/sucursales', { cabeceras: { 'x-empresa-id': 'no-es-un-uuid' } }),
        401,
        'EMPRESA_NO_RESUELTA',
      );
    });
  });

  it('con NODE_ENV=test y la opción habilitada, una petición con Authorization ignora la cabecera', async () => {
    const esc = await escenario();
    const { token } = await sesionAdmin(esc, esc.A);
    const sa = await sesionSuperadmin(esc);
    await conAplicacionAparte(esc, { nodeEnv: 'test', empresaPorHeader: true }, async (api) => {
      const cabeceras = { 'x-empresa-id': esc.B.id };
      const propia = await api.get('/sucursales', { token, cabeceras });
      expect(propia.status, propia.text).toBe(200);
      expect(idsDe(propia.body)).toEqual(idsDe(esc.A.sucursales));
      // Un token inválido no vuelve al modo de prueba: la cabecera se ignora.
      esperarError(
        await api.get('/sucursales', {
          token: armarToken('se', esc.B.id, randomUUID(), secretoAleatorio()),
          cabeceras,
        }),
        401,
        'NO_AUTENTICADO',
      );
      // Un token sa. como Authorization tampoco habilita la cabecera.
      esperarError(await api.get('/sucursales', { token: sa, cabeceras }), 401, 'NO_AUTENTICADO');
    });
  });

  it('sin la opción, la cabecera se ignora siempre: con ella y sin Authorization responde 401 NO_AUTENTICADO', async () => {
    const esc = await escenario();
    const cabeceras = { 'x-empresa-id': esc.A.id };
    for (const ruta of [
      '/sucursales',
      `/sucursales/${esc.A.sucursales[0]!.id}`,
      '/sesion',
      '/usuarios',
    ]) {
      esperarError(await esc.api.get(ruta, { cabeceras }), 401, 'NO_AUTENTICADO');
    }
  });
});

describe('criterio 8 · producción sin sesión', () => {
  it('GET /sucursales con x-empresa-id de una empresa real y sin Authorization responde 401 NO_AUTENTICADO', async () => {
    const esc = await escenario();
    const { token } = await sesionAdmin(esc, esc.A);
    await conAplicacionAparte(
      esc,
      { nodeEnv: 'production', empresaPorHeader: false },
      async (api) => {
        const cabeceras = { 'x-empresa-id': esc.A.id };
        for (const ruta of ['/sucursales', `/sucursales/${esc.A.sucursales[0]!.id}`, '/emisores']) {
          esperarError(await api.get(ruta, { cabeceras }), 401, 'NO_AUTENTICADO');
        }
        esperarError(
          await api.patch(`/sucursales/${esc.A.sucursales[0]!.id}`, {
            cabeceras,
            cuerpo: { direccion: 'Desde producción 123' },
          }),
          401,
          'NO_AUTENTICADO',
        );
        // Con sesión sí funciona.
        const conSesion = await api.get('/sucursales', { token });
        expect(conSesion.status, conSesion.text).toBe(200);
        expect(idsDe(conSesion.body)).toEqual(idsDe(esc.A.sucursales));
      },
    );
  });
});

describe('criterio 9 · regla de rol en emisores y sucursales', () => {
  const ROLES_NO_ADMIN: RolDeAcceso[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR'];

  it('cualquier rol con sesión lee sucursales y emisores de su empresa', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    for (const rol of ROLES_NO_ADMIN) {
      const u = await crearUsuarioConRol(esc, esc.A, rol, { tokenAdmin: admin.token });
      const lista = await esc.api.get('/sucursales', { token: u.token! });
      expect(lista.status, `${rol}: ${lista.text}`).toBe(200);
      expect(idsDe(lista.body)).toContain(esc.A.sucursales[0]!.id);
      for (const s of lista.body) expect(idsDe(esc.A.sucursales)).toContain(s.id);
      const una = await esc.api.get(`/sucursales/${esc.A.sucursales[0]!.id}`, { token: u.token! });
      expect(una.status, `${rol}: ${una.text}`).toBe(200);
      const emisores = await esc.api.get('/emisores', { token: u.token! });
      expect(emisores.status, `${rol}: ${emisores.text}`).toBe(200);
      expect(idsDe(emisores.body)).toEqual(idsDe(esc.A.emisores));
    }
  });

  it('los demás roles reciben 403 PROHIBIDO en las rutas de escritura y nada cambia', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const sucursalId = esc.A.sucursales[0]!.id;
    const fotoSucursales = await esc.api.get('/sucursales', { token: admin.token });
    const fotoEmisores = await esc.api.get('/emisores', { token: admin.token });
    const auditoriaAntes = new Set((await auditoriaDe(esc.A.id)).map((f) => f.id));
    for (const rol of ROLES_NO_ADMIN) {
      const u = await crearUsuarioConRol(esc, esc.A, rol, { tokenAdmin: admin.token });
      const intentos: [string, () => Promise<any>][] = [
        [
          'POST /emisores',
          () =>
            esc.api.post('/emisores', {
              token: u.token!,
              cuerpo: { ruc: rucAleatorio(), razonSocial: 'Emisor nuevo', regimen: 'GENERAL' },
            }),
        ],
        [
          'POST /sucursales',
          () => esc.api.post('/sucursales', { token: u.token!, cuerpo: cuerpoSucursal(esc.A) }),
        ],
        [
          'PATCH /sucursales/:id',
          () =>
            esc.api.patch(`/sucursales/${sucursalId}`, {
              token: u.token!,
              cuerpo: { direccion: 'Cambiada por ' + rol },
            }),
        ],
        [
          'GET /sucursales/:id/acceso',
          () => esc.api.get(`/sucursales/${sucursalId}/acceso`, { token: u.token! }),
        ],
        [
          'PATCH /sucursales/:id/acceso',
          () =>
            esc.api.patch(`/sucursales/${sucursalId}/acceso`, {
              token: u.token!,
              cuerpo: { minutosInactividad: 90 },
            }),
        ],
      ];
      for (const [nombre, intento] of intentos) {
        esperarError(await intento(), 403, 'PROHIBIDO');
        expect(nombre).toBeTruthy();
      }
    }
    expect((await esc.api.get('/sucursales', { token: admin.token })).body).toEqual(
      fotoSucursales.body,
    );
    expect((await esc.api.get('/emisores', { token: admin.token })).body).toEqual(
      fotoEmisores.body,
    );
    // Lo único nuevo en la auditoría son las altas de usuarios de la propia prueba.
    const nuevas = (await auditoriaDe(esc.A.id)).filter((f) => !auditoriaAntes.has(f.id));
    expect(nuevas.length).toBeGreaterThan(0);
    for (const fila of nuevas) {
      expect(['crear_emisor', 'crear_sucursal', 'configurar_sucursal']).not.toContain(fila.accion);
    }
  });

  it('el Administrador y la sesión de soporte pueden modificar una sucursal (criterios 39 y 40 de 001)', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const sucursalId = esc.A.sucursales[0]!.id;
    const propia = await esc.api.patch(`/sucursales/${sucursalId}`, {
      token: admin.token,
      cuerpo: { direccion: 'Dirección del Administrador 1' },
    });
    expect(propia.status, propia.text).toBe(200);
    expect(propia.body.direccion).toBe('Dirección del Administrador 1');
    const soporte = await iniciarSoporte(esc, esc.A);
    const desdeSoporte = await esc.api.patch(`/sucursales/${sucursalId}`, {
      token: soporte.token,
      cuerpo: { direccion: 'Dirección desde soporte 2' },
    });
    expect(desdeSoporte.status, desdeSoporte.text).toBe(200);
    expect(desdeSoporte.body.direccion).toBe('Dirección desde soporte 2');
  });

  it('[C1] el Administrador y la sesión de soporte pueden crear emisores y sucursales', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const emisor = await esc.api.post('/emisores', {
      token: admin.token,
      cuerpo: { ruc: rucAleatorio(), razonSocial: textoUnico('Emisor'), regimen: 'GENERAL' },
    });
    expect(emisor.status, emisor.text).toBe(201);
    const sucursal = await esc.api.post('/sucursales', {
      token: admin.token,
      cuerpo: cuerpoSucursal(esc.A),
    });
    expect(sucursal.status, sucursal.text).toBe(201);
    const soporte = await iniciarSoporte(esc, esc.A);
    const desdeSoporte = await esc.api.post('/sucursales', {
      token: soporte.token,
      cuerpo: { ...cuerpoSucursal(esc.A), codigoEstablecimiento: '0098' },
    });
    expect(desdeSoporte.status, desdeSoporte.text).toBe(201);
  });

  it('[C2] el Administrador lee y cambia el acceso de la sucursal y los demás roles reciben 403', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const sucursalId = esc.A.sucursales[0]!.id;
    const lee = await esc.api.get(`/sucursales/${sucursalId}/acceso`, { token: admin.token });
    expect(lee.status, lee.text).toBe(200);
    const cambia = await esc.api.patch(`/sucursales/${sucursalId}/acceso`, {
      token: admin.token,
      cuerpo: { minutosInactividad: 7 },
    });
    expect(cambia.status, cambia.text).toBe(200);
    expect(cambia.body).toEqual({ sucursalId, minutosInactividad: 7 });
  });

  it('[C2] una sesión de PIN de cualquier rol no administrador recibe 403 PROHIBIDO en las rutas de escritura', async () => {
    const esc = await escenario();
    const admin = await sesionAdmin(esc, esc.A);
    const sucursalId = esc.A.sucursales[0]!.id;
    for (const rol of ROLES_NO_ADMIN) {
      const u = await crearUsuarioConRol(esc, esc.A, rol, { tokenAdmin: admin.token });
      const { tokenEquipo } = await recordarEquipoDe(esc, u);
      const pin = await esc.api.post('/sesiones/pin', {
        equipo: tokenEquipo,
        cuerpo: { usuarioId: u.id, pin: u.pin },
      });
      expect(pin.status, `${rol}: ${pin.text}`).toBe(201);
      const sesion = { token: pin.body.token as string };
      expect(
        (await esc.api.get('/sucursales', { token: sesion.token, equipo: tokenEquipo })).status,
      ).toBe(200);
      esperarError(
        await esc.api.post('/sucursales', {
          token: sesion.token,
          equipo: tokenEquipo,
          cuerpo: cuerpoSucursal(esc.A),
        }),
        403,
        'PROHIBIDO',
      );
      esperarError(
        await esc.api.patch(`/sucursales/${sucursalId}`, {
          token: sesion.token,
          equipo: tokenEquipo,
          cuerpo: { direccion: 'Por PIN 123' },
        }),
        403,
        'PROHIBIDO',
      );
      esperarError(
        await esc.api.get(`/sucursales/${sucursalId}/acceso`, {
          token: sesion.token,
          equipo: tokenEquipo,
        }),
        403,
        'PROHIBIDO',
      );
    }
  });
});
