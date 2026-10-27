// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P3 · Quién puede administrar usuarios y accesos, alta, nombre de usuario, accesos, PIN (largo,
// unicidad, regeneración y cambio de largo), restablecer contraseña y consulta (criterios 18 a 21b y
// 23 a 25). Las pruebas con etiqueta [C2] dependen de los equipos recordados y del ingreso con PIN.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import {
  usuarioCreadoRespuestaSchema,
  usuarioModificadoRespuestaSchema,
  usuarioRespuestaSchema,
} from '@restaurante/contratos';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { rutasRegistradas } from '../utilidades';
import {
  CONTRASENA_TEMPORAL,
  HORA_INICIAL,
  UUID_CERO,
  accesosPorHttp,
  altaEmpresa,
  auditoriaDe,
  crearUsuario,
  crearUsuarioConRol,
  escenarioPerezoso,
  esperarError,
  filas,
  iniciarSoporte,
  ingresar,
  ingresarConPin,
  ingresarOk,
  nombreUnico,
  recordarEquipoDe,
  rutaConId,
  sesionAdmin,
  sesionSuperadmin,
  type AccesoPrueba,
  type EmpresaDePrueba,
  type Escenario,
  type RolDeAcceso,
} from './fabrica-sesiones';

const sc = escenarioPerezoso({ poolMax: 2 });
afterAll(async () => {
  await sc.cerrar();
});
beforeEach(async () => {
  const esc = await sc.obtener();
  esc.reloj.fijar(HORA_INICIAL);
});

/** Cuerpo válido de `POST /usuarios`; `o` pisa campos. */
function cuerpoUsuario(empresa: EmpresaDePrueba, o: Record<string, unknown> = {}) {
  return {
    nombre: 'Persona de prueba',
    nombreUsuario: nombreUnico('u'),
    esAdministrador: false,
    accesos: accesosPorHttp(empresa, [{ sucursal: 0, rol: 'MOZO' }]),
    contrasenaTemporal: CONTRASENA_TEMPORAL,
    ...o,
  };
}

async function huellaPin(usuarioId: string): Promise<string> {
  const [fila] = await filas<{ huella: string }>(
    `SELECT encode(huella_pin, 'hex') AS huella FROM usuario WHERE id = $1`,
    [usuarioId],
  );
  return fila!.huella;
}

async function totalUsuarios(empresaId: string): Promise<number> {
  const [fila] = await filas<{ n: string }>(
    'SELECT count(*) AS n FROM usuario WHERE empresa_id = $1',
    [empresaId],
  );
  return Number(fila!.n);
}

const accesosDe = (esc: Escenario, lista: AccesoPrueba[]) => accesosPorHttp(esc.A, lista);

describe('criterio 18 · alta de usuario', () => {
  it('el Administrador crea un usuario: 201 con el usuario y el PIN del largo que le corresponde', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const cuerpo = cuerpoUsuario(esc.A, {
      nombre: 'Rosa Quispe',
      accesos: accesosDe(esc, [{ sucursal: 0, rol: 'MOZO' }]),
    });
    const res = await esc.api.post('/usuarios', { token: admin.token, cuerpo });
    expect(res.status, res.text).toBe(201);
    const usuario = usuarioCreadoRespuestaSchema.parse(res.body);
    expect(usuario).toMatchObject({
      nombre: 'Rosa Quispe',
      nombreUsuario: cuerpo.nombreUsuario,
      esAdministrador: false,
      accesos: [{ sucursalId: esc.A.sucursales[0]!.id, rol: 'MOZO' }],
      activo: true,
      horario: null,
      largoPin: 4,
      contrasenaTemporal: true,
      equiposRecordados: 0,
    });
    expect(usuario.pin).toMatch(/^\d{4}$/);
    expect(res.text).not.toContain(CONTRASENA_TEMPORAL);
  });

  it('un Administrador nuevo no lleva accesos y recibe un PIN de 6 dígitos', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const res = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, { esAdministrador: true, accesos: [] }),
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ esAdministrador: true, accesos: [], largoPin: 6 });
    expect(res.body.pin).toMatch(/^\d{6}$/);
  });

  it('la contraseña temporal es obligatoria para todos: ausente, null o inválida responde 400 sin crear nada', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const antes = await totalUsuarios(esc.A.id);
    const base = cuerpoUsuario(esc.A);
    const { contrasenaTemporal: _quitada, ...sinContrasena } = base;
    void _quitada;
    for (const cuerpo of [
      sinContrasena,
      { ...base, contrasenaTemporal: null },
      { ...base, contrasenaTemporal: '1234567' },
      { ...base, contrasenaTemporal: 'x'.repeat(129) },
      { ...base, contrasenaTemporal: 'abcdefg\u0000h' },
      { ...base, esAdministrador: true, accesos: [], contrasenaTemporal: null },
    ]) {
      const res = await esc.api.post('/usuarios', { token: admin.token, cuerpo });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect(await totalUsuarios(esc.A.id)).toBe(antes);
  });

  it('un Administrador con accesos, o un usuario sin accesos, responde 400 DATOS_INVALIDOS', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const conAccesos = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, {
        esAdministrador: true,
        accesos: accesosDe(esc, [{ sucursal: 0, rol: 'MOZO' }]),
      }),
    });
    esperarError(conAccesos, 400, 'DATOS_INVALIDOS');
    const sinAccesos = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, { accesos: [] }),
    });
    esperarError(sinAccesos, 400, 'DATOS_INVALIDOS');
  });

  it('el cuerpo es estricto: no acepta empresa, actor, PIN ni campos desconocidos', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const antes = await totalUsuarios(esc.A.id);
    for (const extra of [
      { empresaId: esc.B.id },
      { creadoPorUsuarioId: esc.A.admin.id },
      { actualizadoPorSistema: 'migracion:x' },
      { pin: '1234' },
      { activo: false },
      { id: randomUUID() },
    ]) {
      const res = await esc.api.post('/usuarios', {
        token: admin.token,
        cuerpo: cuerpoUsuario(esc.A, extra),
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect(await totalUsuarios(esc.A.id)).toBe(antes);
  });

  it('el PIN solo se muestra en la respuesta de la creación', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO');
    const admin = await sesionAdmin(esc, esc.A);
    const uno = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(uno.status, uno.text).toBe(200);
    expect(uno.body).not.toHaveProperty('pin');
    expect(uno.text).not.toContain(`"${u.pin}"`);
    const lista = await esc.api.get('/usuarios', { token: admin.token });
    expect(lista.text).not.toContain(`"pin"`);
  });

  it('la contraseña temporal del alta obliga a cambiarla en el primer ingreso', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuario(esc, esc.A, { activar: false });
    const res = await ingresar(esc.api, u.nombreUsuario, CONTRASENA_TEMPORAL);
    expect(res.status, res.text).toBe(201);
    expect(res.body.sesion.debeCambiarContrasena).toBe(true);
  });
});

describe('criterio 19 · nombre de usuario', () => {
  it('acepta de 3 a 50 caracteres a-z, 0-9, punto, guion bajo y guion, y lo guarda en minúsculas', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const sufijo = nombreUnico('').slice(1, 9);
    const validos = [
      `abc${sufijo}`.slice(0, 3) + `.${sufijo}`,
      `a_b-c.${sufijo}`,
      ('Mayus-' + sufijo).toUpperCase(),
      'z'.repeat(50 - sufijo.length) + sufijo,
    ];
    for (const nombreUsuario of validos) {
      const res = await esc.api.post('/usuarios', {
        token: admin.token,
        cuerpo: cuerpoUsuario(esc.A, { nombreUsuario }),
      });
      expect(res.status, `${nombreUsuario}: ${res.text}`).toBe(201);
      expect(res.body.nombreUsuario).toBe(nombreUsuario.toLowerCase());
    }
    // El nombre guardado en minúsculas sirve para ingresar con cualquier combinación.
    const primero = validos[2]!;
    const ingreso = await ingresar(esc.api, primero, CONTRASENA_TEMPORAL);
    expect(ingreso.status, ingreso.text).toBe(201);
    expect(ingreso.body.sesion.usuario.nombreUsuario).toBe(primero.toLowerCase());
  });

  it('rechaza menos de 3, más de 50 y otros caracteres con 400 DATOS_INVALIDOS', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const antes = await totalUsuarios(esc.A.id);
    for (const nombreUsuario of [
      'ab',
      '',
      'x'.repeat(51),
      'con espacio',
      ' empieza',
      'termina ',
      'ñandú-123',
      'user@empresa',
      'a/b/c',
      'tab\tdentro',
      'nombre%',
      'nul\u0000x',
    ]) {
      const res = await esc.api.post('/usuarios', {
        token: admin.token,
        cuerpo: cuerpoUsuario(esc.A, { nombreUsuario }),
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect(await totalUsuarios(esc.A.id)).toBe(antes);
  });

  it('un nombre ya usado en A o en B responde 409 CONFLICTO con el mismo mensaje, sin decir de qué empresa', async () => {
    const esc = await sc.obtener();
    const adminA = await sesionAdmin(esc, esc.A);
    const deA = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: adminA.token });
    const deB = await crearUsuarioConRol(esc, esc.B, 'MOZO');
    const enA = await esc.api.post('/usuarios', {
      token: adminA.token,
      cuerpo: cuerpoUsuario(esc.A, { nombreUsuario: deA.nombreUsuario }),
    });
    const enB = await esc.api.post('/usuarios', {
      token: adminA.token,
      cuerpo: cuerpoUsuario(esc.A, { nombreUsuario: deB.nombreUsuario }),
    });
    const enMayusculas = await esc.api.post('/usuarios', {
      token: adminA.token,
      cuerpo: cuerpoUsuario(esc.A, { nombreUsuario: deB.nombreUsuario.toUpperCase() }),
    });
    esperarError(enA, 409, 'CONFLICTO');
    esperarError(enB, 409, 'CONFLICTO');
    esperarError(enMayusculas, 409, 'CONFLICTO');
    expect(enB.body).toEqual(enA.body);
    expect(enMayusculas.body).toEqual(enA.body);
    for (const res of [enA, enB, enMayusculas]) {
      expect(res.text).not.toContain(esc.B.id);
      expect(res.text).not.toContain(esc.B.nombre);
    }
    // El administrador de A tampoco puede quedarse con el nombre del administrador de B.
    const delAdminB = await esc.api.post('/usuarios', {
      token: adminA.token,
      cuerpo: cuerpoUsuario(esc.A, { nombreUsuario: esc.B.admin.nombreUsuario }),
    });
    esperarError(delAdminB, 409, 'CONFLICTO');
    expect(delAdminB.body).toEqual(enA.body);
  });

  it('un usuario desactivado conserva su nombre: no se libera', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const baja = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { activo: false },
    });
    expect(baja.status, baja.text).toBe(200);
    const res = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, { nombreUsuario: u.nombreUsuario }),
    });
    esperarError(res, 409, 'CONFLICTO');
  });

  it('el rechazo por nombre repetido no deja nada creado y el nombre sigue siendo del primero', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const antes = await totalUsuarios(esc.A.id);
    const res = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, { nombreUsuario: u.nombreUsuario, nombre: 'Intruso' }),
    });
    esperarError(res, 409, 'CONFLICTO');
    expect(await totalUsuarios(esc.A.id)).toBe(antes);
    const ingreso = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(ingreso.status, ingreso.text).toBe(201);
    expect(ingreso.body.sesion.usuario.id).toBe(u.id);
  });
});

describe('criterio 20 · accesos', () => {
  it('una sucursal de B o inexistente responde 422 SUCURSAL_INVALIDA idéntico y no crea el usuario', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const antes = await totalUsuarios(esc.A.id);
    const nombreUsuario = nombreUnico('u');
    const deB = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, {
        nombreUsuario,
        accesos: [{ sucursalId: esc.B.sucursales[0]!.id, rol: 'MOZO' }],
      }),
    });
    const inexistente = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, {
        nombreUsuario,
        accesos: [{ sucursalId: randomUUID(), rol: 'MOZO' }],
      }),
    });
    const mezclada = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, {
        nombreUsuario,
        accesos: [
          { sucursalId: esc.A.sucursales[0]!.id, rol: 'MOZO' },
          { sucursalId: esc.B.sucursales[1]!.id, rol: 'CAJERO' },
        ],
      }),
    });
    for (const res of [deB, inexistente, mezclada]) esperarError(res, 422, 'SUCURSAL_INVALIDA');
    expect(deB.body).toEqual(inexistente.body);
    expect(mezclada.body).toEqual(inexistente.body);
    expect(deB.text).not.toContain(esc.B.id);
    expect(await totalUsuarios(esc.A.id)).toBe(antes);
    // El nombre quedó libre: el intento rechazado no lo reservó.
    const bien = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc.A, { nombreUsuario }),
    });
    expect(bien.status, bien.text).toBe(201);
  });

  it('un rol fuera de MOZO, CAJERO, COCINA_BARRA y SUPERVISOR, o la misma sucursal dos veces, responde 400', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const sucursalId = esc.A.sucursales[0]!.id;
    for (const accesos of [
      [{ sucursalId, rol: 'ADMINISTRADOR' }],
      [{ sucursalId, rol: 'DUENO' }],
      [{ sucursalId, rol: 'mozo' }],
      [{ sucursalId }],
      [
        { sucursalId, rol: 'MOZO' },
        { sucursalId, rol: 'CAJERO' },
      ],
      [
        { sucursalId, rol: 'MOZO' },
        { sucursalId, rol: 'MOZO' },
      ],
    ]) {
      const res = await esc.api.post('/usuarios', {
        token: admin.token,
        cuerpo: cuerpoUsuario(esc.A, { accesos }),
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
  });

  it('PATCH con una sucursal de B responde 422 SUCURSAL_INVALIDA y deja los accesos como estaban', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const antes = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    const res = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: [{ sucursalId: esc.B.sucursales[0]!.id, rol: 'MOZO' }] },
    });
    esperarError(res, 422, 'SUCURSAL_INVALIDA');
    const despues = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(despues.body).toEqual(antes.body);
    const repetida = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: {
        accesos: [
          { sucursalId: esc.A.sucursales[0]!.id, rol: 'MOZO' },
          { sucursalId: esc.A.sucursales[0]!.id, rol: 'CAJERO' },
        ],
      },
    });
    esperarError(repetida, 400, 'DATOS_INVALIDOS');
  });
});

describe('criterio 21 · PIN', () => {
  it('el largo lo dan los roles: ejemplos del criterio', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const casos: {
      nombre: string;
      datos: { esAdministrador?: boolean; accesos?: AccesoPrueba[] };
      largo: 4 | 6;
    }[] = [
      { nombre: 'Mozo en S1', datos: { accesos: [{ sucursal: 0, rol: 'MOZO' }] }, largo: 4 },
      {
        nombre: 'Cocina/Barra en S1',
        datos: { accesos: [{ sucursal: 0, rol: 'COCINA_BARRA' }] },
        largo: 4,
      },
      {
        nombre: 'Mozo en S1 y Cocina/Barra en S2',
        datos: {
          accesos: [
            { sucursal: 0, rol: 'MOZO' },
            { sucursal: 1, rol: 'COCINA_BARRA' },
          ],
        },
        largo: 4,
      },
      {
        nombre: 'Mozo en S1 y Cajero en S2',
        datos: {
          accesos: [
            { sucursal: 0, rol: 'MOZO' },
            { sucursal: 1, rol: 'CAJERO' },
          ],
        },
        largo: 6,
      },
      { nombre: 'Cajero', datos: { accesos: [{ sucursal: 0, rol: 'CAJERO' }] }, largo: 6 },
      { nombre: 'Supervisor', datos: { accesos: [{ sucursal: 1, rol: 'SUPERVISOR' }] }, largo: 6 },
      { nombre: 'Administrador', datos: { esAdministrador: true }, largo: 6 },
    ];
    for (const caso of casos) {
      const u = await crearUsuario(esc, esc.A, {
        ...caso.datos,
        activar: false,
        tokenAdmin: admin.token,
      });
      expect(u.pin, caso.nombre).toMatch(new RegExp(`^\\d{${caso.largo}}$`));
      expect(u.respuesta.largoPin, caso.nombre).toBe(caso.largo);
      const consulta = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
      expect(consulta.body.largoPin, caso.nombre).toBe(caso.largo);
    }
  });

  it('el PIN es único entre los usuarios de la empresa', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const creados = [];
    for (let i = 0; i < 8; i++) {
      creados.push(
        await crearUsuario(esc, esc.A, {
          accesos: [{ sucursal: 0, rol: i % 2 === 0 ? 'MOZO' : 'CAJERO' }],
          activar: false,
          tokenAdmin: admin.token,
        }),
      );
    }
    const pines = creados.map((u) => u.pin);
    expect(new Set(pines).size).toBe(pines.length);
    // En la base, ninguna huella se repite dentro de la empresa.
    const [conteo] = await filas<{ total: string; distintos: string }>(
      `SELECT count(*) AS total, count(DISTINCT huella_pin) AS distintos FROM usuario WHERE empresa_id = $1`,
      [esc.A.id],
    );
    expect(conteo!.distintos).toBe(conteo!.total);
  });

  it('el PIN no se guarda en claro', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO');
    const [fila] = await filas<{ huella: string; largo_pin: number }>(
      `SELECT encode(huella_pin, 'hex') AS huella, largo_pin FROM usuario WHERE id = $1`,
      [u.id],
    );
    expect(fila!.largo_pin).toBe(6);
    expect(fila!.huella).not.toBe(u.pin);
    expect(fila!.huella).not.toContain(u.pin);
    const auditoria = JSON.stringify(await auditoriaDe(esc.A.id));
    expect(auditoria).not.toContain(`"${u.pin}"`);
  });

  it('POST /usuarios/:id/pin genera uno nuevo del largo vigente, lo muestra una vez e invalida el anterior', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const antes = await huellaPin(u.id);
    const res = await esc.api.post(`/usuarios/${u.id}/pin`, { token: admin.token });
    expect(res.status, res.text).toBe(200);
    expect(Object.keys(res.body)).toEqual(['pin']);
    expect(res.body.pin).toMatch(/^\d{6}$/);
    // El anterior dejó de ser el PIN del usuario.
    expect(await huellaPin(u.id)).not.toBe(antes);
    const consulta = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(consulta.body.largoPin).toBe(6);
    expect(consulta.text).not.toContain(`"${res.body.pin}"`);
  });

  it('regenerar el PIN de un Mozo da uno de 4 dígitos', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const res = await esc.api.post(`/usuarios/${u.id}/pin`, { token: admin.token });
    expect(res.status, res.text).toBe(200);
    expect(res.body.pin).toMatch(/^\d{4}$/);
  });

  it('regenerar el PIN no cierra las sesiones de contraseña del usuario ni cambia su contraseña', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const res = await esc.api.post(`/usuarios/${u.id}/pin`, { token: admin.token });
    expect(res.status, res.text).toBe(200);
    expect((await esc.api.get('/sesion', { token: u.token! })).status).toBe(200);
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
  });

  it('[C2] el PIN anterior deja de funcionar, se cierran las sesiones PIN y los equipos se conservan', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const { tokenEquipo } = await recordarEquipoDe(esc, u);
    const pin = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    expect(pin.status, pin.text).toBe(201);
    const sesionPin = pin.body.token as string;
    expect((await esc.api.get('/sesion', { token: sesionPin, equipo: tokenEquipo })).status).toBe(
      200,
    );

    const nuevo = await esc.api.post(`/usuarios/${u.id}/pin`, { token: admin.token });
    expect(nuevo.status, nuevo.text).toBe(200);

    esperarError(
      await esc.api.get('/sesion', { token: sesionPin, equipo: tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(
      await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin),
      401,
      'CREDENCIALES_INVALIDAS',
    );
    expect((await ingresarConPin(esc.api, tokenEquipo, u.id, nuevo.body.pin)).status).toBe(201);
    const equipos = await esc.api.get(`/usuarios/${u.id}/equipos`, { token: admin.token });
    expect(equipos.body).toHaveLength(1);
  });
});

describe('criterio 21b · cambio de largo del PIN', () => {
  it('de 4 a 6: al agregar un acceso de Cajero se genera un PIN nuevo de 6 dígitos y solo se muestra ahí', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    expect(u.respuesta.largoPin).toBe(4);
    const antes = await huellaPin(u.id);
    const res = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: {
        accesos: accesosDe(esc, [
          { sucursal: 0, rol: 'MOZO' },
          { sucursal: 1, rol: 'CAJERO' },
        ]),
      },
    });
    expect(res.status, res.text).toBe(200);
    const modificado = usuarioModificadoRespuestaSchema.parse(res.body);
    expect(modificado.largoPin).toBe(6);
    expect(modificado.pin).toMatch(/^\d{6}$/);
    expect(await huellaPin(u.id)).not.toBe(antes);
    const consulta = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(consulta.body.largoPin).toBe(6);
    expect(consulta.body).not.toHaveProperty('pin');
  });

  it('de 6 a 4: al quitar el acceso de Cajero se genera un PIN nuevo de 4 dígitos', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuario(esc, esc.A, {
      accesos: [
        { sucursal: 0, rol: 'MOZO' },
        { sucursal: 1, rol: 'CAJERO' },
      ],
      tokenAdmin: admin.token,
    });
    expect(u.respuesta.largoPin).toBe(6);
    const res = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: accesosDe(esc, [{ sucursal: 0, rol: 'MOZO' }]) },
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.largoPin).toBe(4);
    expect(res.body.pin).toMatch(/^\d{4}$/);
  });

  it('cambiar cualquier rol por otro del mismo largo no cambia ni muestra el PIN', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const antes = await huellaPin(u.id);
    const res = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: accesosDe(esc, [{ sucursal: 0, rol: 'SUPERVISOR' }]) },
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body).not.toHaveProperty('pin');
    expect(res.body.largoPin).toBe(6);
    expect(await huellaPin(u.id)).toBe(antes);
    // Lo mismo con un cambio que no toca los accesos.
    const nombre = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { nombre: 'Nombre nuevo' },
    });
    expect(nombre.status, nombre.text).toBe(200);
    expect(nombre.body).not.toHaveProperty('pin');
    expect(await huellaPin(u.id)).toBe(antes);
    const mozo = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const antesMozo = await huellaPin(mozo.id);
    const aCocina = await esc.api.patch(`/usuarios/${mozo.id}`, {
      token: admin.token,
      cuerpo: { accesos: accesosDe(esc, [{ sucursal: 1, rol: 'COCINA_BARRA' }]) },
    });
    expect(aCocina.status, aCocina.text).toBe(200);
    expect(aCocina.body).not.toHaveProperty('pin');
    expect(await huellaPin(mozo.id)).toBe(antesMozo);
  });

  it('al hacer Administrador a un Mozo el PIN pasa a 6 dígitos, y al revés a 4', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const promovido = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { esAdministrador: true, accesos: [] },
    });
    expect(promovido.status, promovido.text).toBe(200);
    expect(promovido.body).toMatchObject({ esAdministrador: true, accesos: [], largoPin: 6 });
    expect(promovido.body.pin).toMatch(/^\d{6}$/);
    const degradado = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: {
        esAdministrador: false,
        accesos: accesosDe(esc, [{ sucursal: 0, rol: 'MOZO' }]),
      },
    });
    expect(degradado.status, degradado.text).toBe(200);
    expect(degradado.body).toMatchObject({ esAdministrador: false, largoPin: 4 });
    expect(degradado.body.pin).toMatch(/^\d{4}$/);
  });

  it('si el cambio se rechaza no se regenera el PIN: nunca queda un largo distinto del que dan los roles', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const antes = await huellaPin(u.id);
    const rechazado = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: [{ sucursalId: esc.B.sucursales[0]!.id, rol: 'CAJERO' }] },
    });
    esperarError(rechazado, 422, 'SUCURSAL_INVALIDA');
    expect(await huellaPin(u.id)).toBe(antes);
    const consulta = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(consulta.body.largoPin).toBe(4);
    expect(consulta.body.accesos).toEqual(u.respuesta.accesos);
  });

  it('dejar a la empresa sin Administrador responde 409 ULTIMO_ADMINISTRADOR, no cambia nada ni regenera el PIN', async () => {
    const esc = await sc.obtener();
    const sa = await sesionSuperadmin(esc);
    const empresa = await altaEmpresa(esc.api, sa);
    const unico = await sesionAdmin(esc, empresa);
    const antes = await huellaPin(empresa.admin.id);
    const res = await esc.api.patch(`/usuarios/${empresa.admin.id}`, {
      token: unico.token,
      cuerpo: {
        esAdministrador: false,
        accesos: accesosPorHttp(empresa, [{ sucursal: 0, rol: 'MOZO' }]),
      },
    });
    esperarError(res, 409, 'ULTIMO_ADMINISTRADOR');
    expect(await huellaPin(empresa.admin.id)).toBe(antes);
    const consulta = await esc.api.get(`/usuarios/${empresa.admin.id}`, { token: unico.token });
    expect(consulta.body).toMatchObject({ esAdministrador: true, largoPin: 6, activo: true });
  });

  it('[C2] el PIN anterior deja de funcionar y se cierran las sesiones PIN al cambiar el largo', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const { tokenEquipo } = await recordarEquipoDe(esc, u);
    const pin = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    expect(pin.status, pin.text).toBe(201);
    const res = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { accesos: accesosDe(esc, [{ sucursal: 0, rol: 'CAJERO' }]) },
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.pin).toMatch(/^\d{6}$/);
    esperarError(
      await esc.api.get('/sesion', { token: pin.body.token, equipo: tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(
      await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin),
      401,
      'CREDENCIALES_INVALIDAS',
    );
    expect((await ingresarConPin(esc.api, tokenEquipo, u.id, res.body.pin)).status).toBe(201);
    // El equipo se conserva.
    const equipos = await esc.api.get(`/usuarios/${u.id}/equipos`, { token: admin.token });
    expect(equipos.body).toHaveLength(1);
  });
});

describe('criterio 23 · restablecer contraseña', () => {
  it('deja la contraseña como temporal, cierra las sesiones del usuario y obliga a cambiarla', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const otraSesion = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    const nueva = 'Temporal-Nueva-77';
    const res = await esc.api.post(`/usuarios/${u.id}/contrasena`, {
      token: admin.token,
      cuerpo: { contrasenaTemporal: nueva },
    });
    expect(res.status, res.text).toBe(204);
    esperarError(await esc.api.get('/sesion', { token: u.token! }), 401, 'NO_AUTENTICADO');
    esperarError(await esc.api.get('/sesion', { token: otraSesion.token }), 401, 'NO_AUTENTICADO');
    esperarError(
      await ingresar(esc.api, u.nombreUsuario, u.contrasena),
      401,
      'CREDENCIALES_INVALIDAS',
    );
    const ingreso = await ingresar(esc.api, u.nombreUsuario, nueva);
    expect(ingreso.status, ingreso.text).toBe(201);
    expect(ingreso.body.sesion.debeCambiarContrasena).toBe(true);
    const consulta = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(consulta.body.contrasenaTemporal).toBe(true);
    // La administración de otros usuarios no se ve afectada.
    expect((await esc.api.get('/sesion', { token: admin.token })).status).toBe(200);
  });

  it('es obligatoria: null, ausente, inválida o con campos de más responde 400 y no cambia nada', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    for (const cuerpo of [
      {},
      { contrasenaTemporal: null },
      { contrasenaTemporal: '1234567' },
      { contrasenaTemporal: 'x'.repeat(129) },
      { contrasenaTemporal: 'Valida-Temporal-1', extra: true },
    ]) {
      const res = await esc.api.post(`/usuarios/${u.id}/contrasena`, {
        token: admin.token,
        cuerpo,
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect((await esc.api.get('/sesion', { token: u.token! })).status).toBe(200);
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
  });

  it('un usuario de B responde 404 NO_ENCONTRADO igual que uno inexistente y no cambia', async () => {
    const esc = await sc.obtener();
    const adminA = await sesionAdmin(esc, esc.A);
    const deB = await crearUsuarioConRol(esc, esc.B, 'MOZO');
    const cuerpo = { contrasenaTemporal: 'Temporal-Ajena-77' };
    const ajeno = await esc.api.post(`/usuarios/${deB.id}/contrasena`, {
      token: adminA.token,
      cuerpo,
    });
    const inexistente = await esc.api.post(`/usuarios/${randomUUID()}/contrasena`, {
      token: adminA.token,
      cuerpo,
    });
    esperarError(ajeno, 404, 'NO_ENCONTRADO');
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    expect(ajeno.body).toEqual(inexistente.body);
    expect((await ingresar(esc.api, deB.nombreUsuario, deB.contrasena)).status).toBe(201);
    expect((await esc.api.get('/sesion', { token: deB.token! })).status).toBe(200);
  });

  it('[C2] revoca todos los equipos recordados: el PIN deja de servir y la persona entra con la temporal', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const { tokenEquipo } = await recordarEquipoDe(esc, u);
    expect((await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin)).status).toBe(201);
    const antes = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(antes.body.equiposRecordados).toBe(1);
    const res = await esc.api.post(`/usuarios/${u.id}/contrasena`, {
      token: admin.token,
      cuerpo: { contrasenaTemporal: 'Temporal-Nueva-77' },
    });
    expect(res.status, res.text).toBe(204);
    esperarError(
      await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin),
      401,
      'CREDENCIALES_INVALIDAS',
    );
    const despues = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(despues.body.equiposRecordados).toBe(0);
    expect((await esc.api.get(`/usuarios/${u.id}/equipos`, { token: admin.token })).body).toEqual(
      [],
    );
  });
});

describe('criterio 24 · consulta', () => {
  const CAMPOS = [
    'id',
    'nombre',
    'nombreUsuario',
    'esAdministrador',
    'accesos',
    'activo',
    'horario',
    'largoPin',
    'contrasenaTemporal',
    'equiposRecordados',
    'creadoEn',
    'actualizadoEn',
  ];

  it('GET /usuarios y GET /usuarios/:id devuelven los campos del contrato y nunca hashes, huellas ni PIN', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuario(esc, esc.A, {
      accesos: [
        { sucursal: 0, rol: 'CAJERO' },
        { sucursal: 1, rol: 'MOZO' },
      ],
      tokenAdmin: admin.token,
    });
    const lista = await esc.api.get('/usuarios', { token: admin.token });
    expect(lista.status, lista.text).toBe(200);
    const usuarios = usuarioRespuestaSchema.array().parse(lista.body);
    const propio = usuarios.find((x) => x.id === u.id)!;
    expect(propio).toMatchObject({
      nombreUsuario: u.nombreUsuario,
      esAdministrador: false,
      activo: true,
      horario: null,
      largoPin: 6,
      contrasenaTemporal: false,
      equiposRecordados: 0,
    });
    expect(propio.accesos).toHaveLength(2);
    expect(usuarios.some((x) => x.id === esc.A.admin.id && x.esAdministrador)).toBe(true);
    for (const fila of lista.body) {
      expect(Object.keys(fila).filter((k) => !CAMPOS.includes(k))).toEqual([]);
    }
    const uno = await esc.api.get(`/usuarios/${u.id}`, { token: admin.token });
    expect(uno.status, uno.text).toBe(200);
    expect(usuarioRespuestaSchema.parse(uno.body).id).toBe(u.id);
    expect(Object.keys(uno.body).filter((k) => !CAMPOS.includes(k))).toEqual([]);
    for (const res of [lista, uno]) {
      expect(res.text).not.toMatch(/hash|huella|scrypt|"pin"|secreto/i);
      expect(res.text).not.toContain(u.contrasena);
      expect(res.text).not.toContain(CONTRASENA_TEMPORAL);
    }
  });

  it('la lista trae solo usuarios de la empresa del Administrador', async () => {
    const esc = await sc.obtener();
    const adminA = await sesionAdmin(esc, esc.A);
    const deB = await crearUsuarioConRol(esc, esc.B, 'MOZO');
    const lista = await esc.api.get('/usuarios', { token: adminA.token });
    const ids = lista.body.map((x: any) => x.id);
    expect(ids).not.toContain(deB.id);
    expect(ids).not.toContain(esc.B.admin.id);
    expect(lista.text).not.toContain(deB.nombreUsuario);
  });

  it('un usuario de B responde 404 NO_ENCONTRADO igual que uno inexistente en todas las rutas', async () => {
    const esc = await sc.obtener();
    const adminA = await sesionAdmin(esc, esc.A);
    const adminB = await sesionAdmin(esc, esc.B);
    const deB = await crearUsuarioConRol(esc, esc.B, 'MOZO', { tokenAdmin: adminB.token });
    const antes = await esc.api.get(`/usuarios/${deB.id}`, { token: adminB.token });
    expect(antes.status).toBe(200);
    const intentar = (id: string) => [
      esc.api.get(`/usuarios/${id}`, { token: adminA.token }),
      esc.api.patch(`/usuarios/${id}`, { token: adminA.token, cuerpo: { nombre: 'Hackeado' } }),
      esc.api.patch(`/usuarios/${id}`, { token: adminA.token, cuerpo: { activo: false } }),
      esc.api.post(`/usuarios/${id}/pin`, { token: adminA.token }),
      esc.api.post(`/usuarios/${id}/contrasena`, {
        token: adminA.token,
        cuerpo: { contrasenaTemporal: 'Temporal-Ajena-77' },
      }),
    ];
    const ajenas = await Promise.all(intentar(deB.id));
    const inexistentes = await Promise.all(intentar(randomUUID()));
    ajenas.forEach((res, i) => {
      esperarError(res, 404, 'NO_ENCONTRADO');
      expect(res.body, `ruta ${i}`).toEqual(inexistentes[i]!.body);
    });
    // Nada cambió en B.
    const despues = await esc.api.get(`/usuarios/${deB.id}`, { token: adminB.token });
    expect(despues.body).toEqual(antes.body);
    expect((await ingresar(esc.api, deB.nombreUsuario, deB.contrasena)).status).toBe(201);
  });

  it('[C2] los equipos de un usuario de B responden 404 igual que los de uno inexistente', async () => {
    const esc = await sc.obtener();
    const adminA = await sesionAdmin(esc, esc.A);
    const deB = await crearUsuarioConRol(esc, esc.B, 'MOZO');
    const { tokenEquipo } = await recordarEquipoDe(esc, deB);
    const rutas = (id: string) => [
      esc.api.get(`/usuarios/${id}/equipos`, { token: adminA.token }),
      esc.api.delete(`/usuarios/${id}/equipos`, { token: adminA.token }),
      esc.api.delete(`/usuarios/${id}/equipos/${randomUUID()}`, { token: adminA.token }),
    ];
    const ajenas = await Promise.all(rutas(deB.id));
    const inexistentes = await Promise.all(rutas(randomUUID()));
    ajenas.forEach((res, i) => {
      esperarError(res, 404, 'NO_ENCONTRADO');
      expect(res.body).toEqual(inexistentes[i]!.body);
    });
    // El equipo de B sigue recordando a la persona.
    expect((await ingresarConPin(esc.api, tokenEquipo, deB.id, deB.pin)).status).toBe(201);
  });

  it('[C2] equiposRecordados cuenta los equipos activos de la persona', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    expect(
      (await esc.api.get(`/usuarios/${u.id}`, { token: admin.token })).body.equiposRecordados,
    ).toBe(0);
    await recordarEquipoDe(esc, u);
    expect(
      (await esc.api.get(`/usuarios/${u.id}`, { token: admin.token })).body.equiposRecordados,
    ).toBe(1);
    await recordarEquipoDe(esc, u); // otro navegador: sin X-Equipo, equipo nuevo
    expect(
      (await esc.api.get(`/usuarios/${u.id}`, { token: admin.token })).body.equiposRecordados,
    ).toBe(2);
  });
});

describe('criterio 25 · solo el Administrador', () => {
  const ROLES: RolDeAcceso[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR'];

  /** Pide cada ruta de `/usuarios` con cuerpos válidos para que, si no se protegiera, hiciera algo. */
  function intentosContraUsuarios(esc: Escenario, victimaId: string) {
    const cuerpos: Record<string, unknown> = {
      'POST /usuarios': cuerpoUsuario(esc.A),
      'PATCH /usuarios/:id': { nombre: 'Cambiado sin permiso', activo: false },
      'POST /usuarios/:id/contrasena': { contrasenaTemporal: 'Temporal-Colada-77' },
    };
    return rutasRegistradas(esc.app)
      .filter((r) => r.ruta === '/usuarios' || r.ruta.startsWith('/usuarios/'))
      .map((r) => ({
        nombre: `${r.metodo} ${r.ruta}`,
        metodo: r.metodo.toLowerCase() as 'get',
        ruta: rutaConId(r.ruta.replace(':id', victimaId), UUID_CERO),
        cuerpo: cuerpos[`${r.metodo} ${r.ruta}`],
      }));
  }

  it('el recorrido cubre todas las rutas de /usuarios, incluidas las de equipos', async () => {
    const esc = await sc.obtener();
    const nombres = intentosContraUsuarios(esc, UUID_CERO).map((i) => i.nombre);
    for (const esperada of [
      'GET /usuarios',
      'GET /usuarios/:id',
      'POST /usuarios',
      'PATCH /usuarios/:id',
      'POST /usuarios/:id/pin',
      'POST /usuarios/:id/contrasena',
      'GET /usuarios/:id/equipos',
      'DELETE /usuarios/:id/equipos',
      'DELETE /usuarios/:id/equipos/:equipoRecordadoId',
    ]) {
      expect(nombres).toContain(esperada);
    }
  });

  it('cada rol que no es Administrador (con sesión de contraseña) recibe 403 PROHIBIDO en toda ruta de /usuarios y nada cambia', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const victima = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const solicitantes = [];
    for (const rol of ROLES) {
      solicitantes.push({
        rol,
        usuario: await crearUsuarioConRol(esc, esc.A, rol, { tokenAdmin: admin.token }),
      });
    }
    const fotoVictima = await esc.api.get(`/usuarios/${victima.id}`, { token: admin.token });
    const fotoLista = await esc.api.get('/usuarios', { token: admin.token });
    const huella = await huellaPin(victima.id);
    const filasAuditoria = (await auditoriaDe(esc.A.id)).length;
    const total = await totalUsuarios(esc.A.id);

    for (const { rol, usuario } of solicitantes) {
      for (const intento of intentosContraUsuarios(esc, victima.id)) {
        const res = await esc.api.llamar(intento.metodo, intento.ruta, {
          token: usuario.token!,
          cuerpo: intento.cuerpo,
        });
        expect(res.status, `${rol} · ${intento.nombre}: ${res.text}`).toBe(403);
        expect(res.body, `${rol} · ${intento.nombre}`).toMatchObject({ codigo: 'PROHIBIDO' });
      }
    }

    expect(await totalUsuarios(esc.A.id)).toBe(total);
    expect((await auditoriaDe(esc.A.id)).length).toBe(filasAuditoria);
    expect(await huellaPin(victima.id)).toBe(huella);
    expect((await esc.api.get(`/usuarios/${victima.id}`, { token: admin.token })).body).toEqual(
      fotoVictima.body,
    );
    expect((await esc.api.get('/usuarios', { token: admin.token })).body).toEqual(fotoLista.body);
    expect((await ingresar(esc.api, victima.nombreUsuario, victima.contrasena)).status).toBe(201);
  });

  it('el Administrador sí puede, y la sesión de soporte también', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const lista = await esc.api.get('/usuarios', { token: admin.token });
    expect(lista.status, lista.text).toBe(200);
    const soporte = await iniciarSoporte(esc, esc.A);
    const desdeSoporte = await esc.api.get('/usuarios', { token: soporte.token });
    expect(desdeSoporte.status, desdeSoporte.text).toBe(200);
  });

  it('[C2] una sesión de PIN de cualquier rol que no es Administrador recibe 403 PROHIBIDO en toda ruta de /usuarios', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const victima = await crearUsuarioConRol(esc, esc.A, 'MOZO', { tokenAdmin: admin.token });
    const fotoVictima = await esc.api.get(`/usuarios/${victima.id}`, { token: admin.token });
    const total = await totalUsuarios(esc.A.id);
    for (const rol of ROLES) {
      const u = await crearUsuarioConRol(esc, esc.A, rol, { tokenAdmin: admin.token });
      const { tokenEquipo } = await recordarEquipoDe(esc, u);
      const pin = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
      expect(pin.status, `${rol}: ${pin.text}`).toBe(201);
      for (const intento of intentosContraUsuarios(esc, victima.id)) {
        const res = await esc.api.llamar(intento.metodo, intento.ruta, {
          token: pin.body.token,
          equipo: tokenEquipo,
          cuerpo: intento.cuerpo,
        });
        expect(res.status, `${rol} (PIN) · ${intento.nombre}: ${res.text}`).toBe(403);
        expect(res.body).toMatchObject({ codigo: 'PROHIBIDO' });
      }
    }
    // Solo se crearon los cuatro usuarios de la propia prueba.
    expect(await totalUsuarios(esc.A.id)).toBe(total + ROLES.length);
    expect((await esc.api.get(`/usuarios/${victima.id}`, { token: admin.token })).body).toEqual(
      fotoVictima.body,
    );
  });
});
