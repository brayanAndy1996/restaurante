// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P11 · Horario de acceso por trabajador (criterios 12b y 105 a 112): asignar, quitar y validar el
// horario; ingreso fuera de horario con contraseña y con PIN; la sesión abierta sigue; sin volver a
// entrar; supervisor fuera de horario; Administrador, soporte y trabajadores sin horario a cualquier
// hora; hora de Lima. Las pruebas con etiqueta [C2] (equipos y PIN) o [C3] (clave de supervisor)
// dependen de funciones de grupos posteriores de la fase C.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { usuarioCreadoRespuestaSchema } from '@restaurante/contratos';
import type { TramoHorario } from '@restaurante/dominio';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HORA_INICIAL,
  accesosPorHttp,
  auditoriaDe,
  crearUsuario,
  crearUsuarioConRol,
  escenarioPerezoso,
  esperarError,
  iniciarSoporte,
  ingresar,
  ingresarConPin,
  ingresarOk,
  recordarEquipoDe,
  sesionAdmin,
  sesionSuperadmin,
  sesionesDe,
  type Escenario,
  type UsuarioPrueba,
} from './fabrica-sesiones';

const sc = escenarioPerezoso({ poolMax: 2 });
afterAll(async () => {
  await sc.cerrar();
});

const TZ_ORIGINAL = process.env.TZ;
beforeEach(async () => {
  const esc = await sc.obtener();
  esc.reloj.fijar(HORA_INICIAL);
});
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

/** Viernes 18:00 a sábado 02:00 (Lima). */
const VIERNES_NOCHE: TramoHorario[] = [{ dia: 5, desde: '18:00', hasta: '02:00' }];
/** Viernes 30 de octubre, dentro del horario anterior. */
const DENTRO = '2026-10-30T19:00:00-05:00';
/** Lunes 2 de noviembre, 10:00 (la hora inicial): fuera del horario anterior. */
const FUERA = HORA_INICIAL;
const INCORRECTA = 'Incorrecta-Prueba-9';

const idsDe = (lista: { id: string }[]) => lista.map((x) => x.id).sort();

function cuerpoUsuario(esc: Escenario, o: Record<string, unknown> = {}) {
  return {
    nombre: 'Persona de prueba',
    nombreUsuario: `h-${randomUUID().replace(/-/g, '').slice(0, 14)}`,
    esAdministrador: false,
    accesos: accesosPorHttp(esc.A, [{ sucursal: 0, rol: 'MOZO' }]),
    contrasenaTemporal: 'Temporal-Prueba-1',
    ...o,
  };
}

/** Usuario con horario; la cuenta se activa antes de asignarlo. */
function conHorario(
  esc: Escenario,
  rol: 'MOZO' | 'CAJERO' | 'SUPERVISOR' = 'CAJERO',
  tramos = VIERNES_NOCHE,
) {
  return crearUsuario(esc, esc.A, { accesos: [{ sucursal: 0, rol }], horario: tramos });
}

async function sesionesCreadas(usuarioId: string): Promise<number> {
  return (await sesionesDe(usuarioId)).length;
}

async function filasDeFueraDeHorario(esc: Escenario, usuarioId: string) {
  return (await auditoriaDe(esc.A.id, 'ingreso_fuera_de_horario')).filter(
    (f) => f.actor_usuario_id === usuarioId,
  );
}

describe('criterio 106 · asignar, quitar y validar el horario', () => {
  it('POST /usuarios acepta un horario válido y lo devuelve igual', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const horario: TramoHorario[] = [
      { dia: 1, desde: '12:00', hasta: '15:00' },
      { dia: 1, desde: '19:00', hasta: '23:00' },
      { dia: 5, desde: '18:00', hasta: '02:00' },
      { dia: 7, desde: '22:00', hasta: '06:00' },
    ];
    const res = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc, { horario }),
    });
    expect(res.status, res.text).toBe(201);
    const usuario = usuarioCreadoRespuestaSchema.parse(res.body);
    expect(usuario.horario).toEqual(horario);
    const consulta = await esc.api.get(`/usuarios/${usuario.id}`, { token: admin.token });
    expect(consulta.body.horario).toEqual(horario);
  });

  it('sin horario o con horario null el usuario queda sin horario', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    for (const o of [{}, { horario: null }]) {
      const res = await esc.api.post('/usuarios', {
        token: admin.token,
        cuerpo: cuerpoUsuario(esc, o),
      });
      expect(res.status, res.text).toBe(201);
      expect(res.body.horario).toBeNull();
    }
  });

  it('una lista vacía o con tramos inválidos responde 400 DATOS_INVALIDOS con campos', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const invalidos: [string, unknown][] = [
      ['lista vacía', []],
      ['desde igual a hasta', [{ dia: 1, desde: '10:00', hasta: '10:00' }]],
      [
        'tramos solapados',
        [
          { dia: 3, desde: '10:00', hasta: '15:00' },
          { dia: 3, desde: '14:00', hasta: '20:00' },
        ],
      ],
      [
        'solape con el tramo que cruza la medianoche',
        [
          { dia: 5, desde: '22:00', hasta: '03:00' },
          { dia: 6, desde: '02:00', hasta: '05:00' },
        ],
      ],
      ['día 8', [{ dia: 8, desde: '10:00', hasta: '12:00' }]],
      ['día 0', [{ dia: 0, desde: '10:00', hasta: '12:00' }]],
      ['hora inválida', [{ dia: 1, desde: '25:00', hasta: '12:00' }]],
      ['formato de hora', [{ dia: 1, desde: '9:00', hasta: '12:00' }]],
      ['tramo sin hasta', [{ dia: 1, desde: '09:00' }]],
      ['no es una lista', { dia: 1, desde: '09:00', hasta: '12:00' }],
    ];
    for (const [nombre, horario] of invalidos) {
      const creando = await esc.api.post('/usuarios', {
        token: admin.token,
        cuerpo: cuerpoUsuario(esc, { horario }),
      });
      esperarError(creando, 400, 'DATOS_INVALIDOS');
      expect(Array.isArray(creando.body.campos), `${nombre}: sin campos`).toBe(true);
      expect(
        creando.body.campos.some((c: any) => String(c.campo).startsWith('horario')),
        `${nombre}: ${JSON.stringify(creando.body.campos)}`,
      ).toBe(true);
    }
  });

  it('PATCH asigna, reemplaza y quita el horario; los inválidos no cambian nada', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const url = `/usuarios/${u.id}`;
    const asigna = await esc.api.patch(url, {
      token: admin.token,
      cuerpo: { horario: VIERNES_NOCHE },
    });
    expect(asigna.status, asigna.text).toBe(200);
    expect(asigna.body.horario).toEqual(VIERNES_NOCHE);
    const otro: TramoHorario[] = [{ dia: 2, desde: '08:00', hasta: '16:00' }];
    const reemplaza = await esc.api.patch(url, { token: admin.token, cuerpo: { horario: otro } });
    expect(reemplaza.body.horario).toEqual(otro);

    for (const horario of [
      [],
      [
        { dia: 3, desde: '10:00', hasta: '15:00' },
        { dia: 3, desde: '14:00', hasta: '20:00' },
      ],
      [{ dia: 1, desde: '10:00', hasta: '10:00' }],
    ]) {
      const res = await esc.api.patch(url, { token: admin.token, cuerpo: { horario } });
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(res.body.campos.some((c: any) => String(c.campo).startsWith('horario'))).toBe(true);
    }
    expect((await esc.api.get(url, { token: admin.token })).body.horario).toEqual(otro);

    const quita = await esc.api.patch(url, { token: admin.token, cuerpo: { horario: null } });
    expect(quita.status, quita.text).toBe(200);
    expect(quita.body.horario).toBeNull();
    expect((await esc.api.get(url, { token: admin.token })).body.horario).toBeNull();
  });

  it('un horario no nulo en un Administrador, o en quien queda Administrador, responde 400 con el campo horario', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const nuevoAdmin = await esc.api.post('/usuarios', {
      token: admin.token,
      cuerpo: cuerpoUsuario(esc, { esAdministrador: true, accesos: [], horario: VIERNES_NOCHE }),
    });
    esperarError(nuevoAdmin, 400, 'DATOS_INVALIDOS');
    expect(nuevoAdmin.body.campos.some((c: any) => String(c.campo).startsWith('horario'))).toBe(
      true,
    );

    // Un Administrador existente no admite un horario.
    const otroAdmin = await crearUsuarioConRol(esc, esc.A, 'ADMINISTRADOR', {
      tokenAdmin: admin.token,
    });
    const aAdmin = await esc.api.patch(`/usuarios/${otroAdmin.id}`, {
      token: admin.token,
      cuerpo: { horario: VIERNES_NOCHE },
    });
    esperarError(aAdmin, 400, 'DATOS_INVALIDOS');
    expect(aAdmin.body.campos.some((c: any) => String(c.campo).startsWith('horario'))).toBe(true);

    // Hacer Administrador a alguien con horario: sin `horario: null` se rechaza; con él, se acepta.
    const cajero = await conHorario(esc);
    const sinNull = await esc.api.patch(`/usuarios/${cajero.id}`, {
      token: admin.token,
      cuerpo: { esAdministrador: true, accesos: [] },
    });
    esperarError(sinNull, 400, 'DATOS_INVALIDOS');
    expect(sinNull.body.campos.some((c: any) => String(c.campo).startsWith('horario'))).toBe(true);
    const aunCajero = await esc.api.get(`/usuarios/${cajero.id}`, { token: admin.token });
    expect(aunCajero.body).toMatchObject({ esAdministrador: false, horario: VIERNES_NOCHE });

    const conNull = await esc.api.patch(`/usuarios/${cajero.id}`, {
      token: admin.token,
      cuerpo: { esAdministrador: true, accesos: [], horario: null },
    });
    expect(conNull.status, conNull.text).toBe(200);
    expect(conNull.body).toMatchObject({ esAdministrador: true, horario: null });
  });

  it('cada cambio del horario deja una fila de auditoría del usuario modificado', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    const modificaciones = async () =>
      (await auditoriaDe(esc.A.id, 'modificar_usuario')).filter((f) =>
        JSON.stringify(f).includes(u.id),
      ).length;
    const antes = await modificaciones();
    const res = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { horario: VIERNES_NOCHE },
    });
    expect(res.status, res.text).toBe(200);
    expect(await modificaciones()).toBe(antes + 1);
  });

  it('cambiar el horario no cierra las sesiones abiertas: rige desde el siguiente ingreso', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    // La sesión abierta (sin horario) sigue al asignar un horario que excluye la hora actual.
    const res = await esc.api.patch(`/usuarios/${u.id}`, {
      token: admin.token,
      cuerpo: { horario: VIERNES_NOCHE },
    });
    expect(res.status, res.text).toBe(200);
    const abierta = await esc.api.get('/sesion', { token: u.token! });
    expect(abierta.status, abierta.text).toBe(200);
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
    // Quitarlo permite entrar de nuevo.
    await esc.api.patch(`/usuarios/${u.id}`, { token: admin.token, cuerpo: { horario: null } });
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
  });
});

describe('criterios 12b y 107 · ingreso fuera de horario con contraseña', () => {
  it('con la contraseña correcta fuera de horario responde 403 FUERA_DE_HORARIO y no crea sesión', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    const antes = await sesionesCreadas(u.id);
    esc.reloj.fijar(FUERA);
    const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    esperarError(res, 403, 'FUERA_DE_HORARIO');
    expect(res.body.token).toBeUndefined();
    expect(await sesionesCreadas(u.id)).toBe(antes);
  });

  it('con la contraseña incorrecta no revela el horario: responde como a cualquier otro usuario', async () => {
    const esc = await sc.obtener();
    const conHorarioU = await conHorario(esc);
    const sinHorarioU = await crearUsuarioConRol(esc, esc.A, 'CAJERO');
    esc.reloj.fijar(FUERA);
    const a = await ingresar(esc.api, conHorarioU.nombreUsuario, INCORRECTA);
    const b = await ingresar(esc.api, sinHorarioU.nombreUsuario, INCORRECTA);
    esperarError(a, 401, 'CREDENCIALES_INVALIDAS');
    expect(a.body).toEqual(b.body);
  });

  it('el bloqueo manda sobre el horario: durante el bloqueo responde 429 aunque la contraseña sea correcta', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    esc.reloj.fijar(FUERA);
    for (let i = 0; i < 5; i++) {
      esperarError(
        await ingresar(esc.api, u.nombreUsuario, INCORRECTA),
        401,
        'CREDENCIALES_INVALIDAS',
      );
    }
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 429, 'BLOQUEO_TEMPORAL');
    expect(await filasDeFueraDeHorario(esc, u.id)).toHaveLength(0);
  });

  it('no cuenta como fallo: nunca bloquea y reinicia la cuenta de fallos como un ingreso correcto', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    esc.reloj.fijar(FUERA);
    for (let i = 0; i < 4; i++) {
      expect((await ingresar(esc.api, u.nombreUsuario, INCORRECTA)).status).toBe(401);
    }
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
    // La cuenta se reinició: cuatro fallos más no bloquean (sin reinicio, el primero ya sería el quinto).
    for (let i = 0; i < 4; i++) {
      const res = await ingresar(esc.api, u.nombreUsuario, INCORRECTA);
      expect(res.status, `fallo ${i + 1}: ${res.text}`).toBe(401);
    }
    // Muchos intentos correctos fuera de horario nunca llegan a bloquear.
    for (let i = 0; i < 7; i++) {
      esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
    }
    // Dentro del horario entra.
    esc.reloj.fijar(DENTRO);
    const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(res.status, res.text).toBe(201);
  });

  it('cada rechazo deja una fila de auditoría ingreso_fuera_de_horario a nombre del usuario, sin la contraseña', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    esc.reloj.fijar(FUERA);
    for (let i = 0; i < 3; i++) {
      esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
    }
    const filas = await filasDeFueraDeHorario(esc, u.id);
    expect(filas).toHaveLength(3);
    for (const fila of filas) {
      expect(fila.empresa_id).toBe(esc.A.id);
      expect(fila.origen).toBe('empresa');
      expect(fila.actor_usuario_id).toBe(u.id);
      expect(new Date(fila.ocurrido_en).toISOString()).toBe(new Date(FUERA).toISOString());
      expect(JSON.stringify(fila)).not.toContain(u.contrasena);
    }
  });

  it('el borde del horario se evalúa con el reloj: entra desde el inicio y no desde el fin', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    const casos: [string, number][] = [
      ['2026-10-30T17:59:59-05:00', 403],
      ['2026-10-30T18:00:00-05:00', 201],
      ['2026-10-31T01:59:59-05:00', 201],
      ['2026-10-31T02:00:00-05:00', 403],
      ['2026-10-31T19:00:00-05:00', 403], // sábado por la tarde: el horario es del viernes
      ['2026-10-29T19:00:00-05:00', 403], // jueves por la noche
    ];
    for (const [instante, estado] of casos) {
      esc.reloj.fijar(instante);
      const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
      expect(res.status, `${instante}: ${res.text}`).toBe(estado);
      if (estado === 403) expect(res.body.codigo).toBe('FUERA_DE_HORARIO');
    }
  });

  it('trabajador con horario solo de viernes a domingo: el lunes no puede entrar', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc, 'MOZO', [
      { dia: 5, desde: '00:00', hasta: '23:59' },
      { dia: 6, desde: '00:00', hasta: '23:59' },
      { dia: 7, desde: '00:00', hasta: '23:59' },
    ]);
    esc.reloj.fijar('2026-11-02T10:00:00-05:00'); // lunes
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
    esc.reloj.fijar('2026-11-01T10:00:00-05:00'); // domingo
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
  });

  it('un tramo que cruza del domingo al lunes deja entrar el lunes de madrugada', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc, 'MOZO', [{ dia: 7, desde: '22:00', hasta: '06:00' }]);
    esc.reloj.fijar('2026-11-02T05:59:00-05:00');
    expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
    esc.reloj.fijar('2026-11-02T06:00:00-05:00');
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
  });
});

describe('criterio 112 · hora de Lima', () => {
  it('se evalúa con la hora de Lima del reloj aunque el servidor esté en otra zona horaria', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    for (const zona of ['Pacific/Kiritimati', 'Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = zona;
      expect(new Date('2026-10-30T12:00:00Z').getTimezoneOffset()).not.toBe(300);
      esc.reloj.fijar('2026-10-31T06:59:00Z'); // 01:59 del sábado en Lima
      const dentro = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
      expect(dentro.status, `${zona} dentro: ${dentro.text}`).toBe(201);
      esc.reloj.fijar('2026-10-31T07:00:00Z'); // 02:00 del sábado en Lima
      const fuera = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
      esperarError(fuera, 403, 'FUERA_DE_HORARIO');
      esc.reloj.fijar('2026-10-30T22:59:00Z'); // 17:59 del viernes en Lima
      esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
      esc.reloj.fijar('2026-10-30T23:00:00Z'); // 18:00 del viernes en Lima
      expect((await ingresar(esc.api, u.nombreUsuario, u.contrasena)).status).toBe(201);
    }
  });
});

describe('criterio 111 · sin horario, Administrador y soporte entran a cualquier hora', () => {
  const HORAS = [
    '2026-11-02T03:00:00-05:00', // lunes de madrugada
    '2026-11-04T12:00:00-05:00', // miércoles al mediodía
    '2026-11-07T23:59:00-05:00', // sábado a última hora
    '2026-11-08T00:00:00-05:00', // domingo a medianoche
    '2026-10-30T18:00:00-05:00',
  ];

  it('un trabajador sin horario entra a cualquier hora', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuarioConRol(esc, esc.A, 'CAJERO');
    for (const hora of HORAS) {
      esc.reloj.fijar(hora);
      const res = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
      expect(res.status, `${hora}: ${res.text}`).toBe(201);
    }
  });

  it('el Administrador entra a cualquier hora', async () => {
    const esc = await sc.obtener();
    for (const hora of HORAS) {
      esc.reloj.fijar(hora);
      const res = await ingresar(esc.api, esc.A.admin.nombreUsuario, esc.A.admin.contrasena);
      expect(res.status, `${hora}: ${res.text}`).toBe(201);
    }
  });

  it('la sesión de soporte se inicia y funciona a cualquier hora', async () => {
    const esc = await sc.obtener();
    for (const hora of HORAS) {
      esc.reloj.fijar(hora);
      const soporte = await iniciarSoporte(esc, esc.A, {
        tokenSuperadmin: await sesionSuperadmin(esc),
      });
      const res = await esc.api.get('/sucursales', { token: soporte.token });
      expect(res.status, `${hora}: ${res.text}`).toBe(200);
      expect(idsDe(res.body)).toEqual(idsDe(esc.A.sucursales));
    }
  });
});

describe('criterio 108 · la sesión abierta sigue cuando termina el horario', () => {
  it('ninguna petición de la sesión responde FUERA_DE_HORARIO, incluido el cambio de sucursal', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuario(esc, esc.A, {
      accesos: [
        { sucursal: 0, rol: 'CAJERO' },
        { sucursal: 1, rol: 'MOZO' },
      ],
      horario: VIERNES_NOCHE,
    });
    esc.reloj.fijar('2026-10-31T01:45:00-05:00'); // sábado, quince minutos antes de las 02:00
    const ingreso = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(ingreso.status, ingreso.text).toBe(201);
    const token = ingreso.body.token as string;
    esc.reloj.fijar('2026-10-31T01:55:00-05:00');
    expect((await esc.api.get('/sesion', { token })).status).toBe(200);
    // El horario terminó a las 02:00.
    const tardes = ['02:05', '02:20', '02:40', '03:00'];
    for (const hora of tardes) {
      esc.reloj.fijar(`2026-10-31T${hora}:00-05:00`);
      const sesion = await esc.api.get('/sesion', { token });
      expect(sesion.status, `${hora}: ${sesion.text}`).toBe(200);
      const sucursales = await esc.api.get('/sucursales', { token });
      expect(sucursales.status, `${hora}: ${sucursales.text}`).toBe(200);
    }
    const cambio = await esc.api.put('/sesion/sucursal', {
      token,
      cuerpo: { sucursalId: esc.A.sucursales[1]!.id },
    });
    expect(cambio.status, cambio.text).toBe(200);
    expect(cambio.body.sucursal.id).toBe(esc.A.sucursales[1]!.id);
    const otra = await esc.api.put('/sesion/sucursal', {
      token,
      cuerpo: { sucursalId: esc.A.sucursales[0]!.id },
    });
    expect(otra.status, otra.text).toBe(200);
  });

  it('[C3] las autorizaciones que pide la sesión abierta también funcionan después del horario', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const supervisor = await crearUsuarioConRol(esc, esc.A, 'SUPERVISOR', {
      tokenAdmin: admin.token,
    });
    const cajero = await crearUsuario(esc, esc.A, {
      accesos: [{ sucursal: 0, rol: 'CAJERO' }],
      horario: VIERNES_NOCHE,
      tokenAdmin: admin.token,
    });
    esc.reloj.fijar('2026-10-31T01:50:00-05:00');
    const { token } = await ingresarOk(esc.api, cajero.nombreUsuario, cajero.contrasena);
    esc.reloj.fijar('2026-10-31T02:10:00-05:00'); // ya terminó el horario del Cajero
    const res = await esc.api.post('/autorizaciones', {
      token,
      cuerpo: { accion: 'ANULAR_ITEM_ENVIADO', motivo: 'Cliente se retiró', pin: supervisor.pin },
    });
    expect(res.status, res.text).toBe(201);
  });
});

describe('criterio 109 · sin volver a entrar fuera de horario', () => {
  it('tras expirar por inactividad la persona no puede volver a entrar fuera de su horario', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    esc.reloj.fijar('2026-10-31T01:30:00-05:00');
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    esc.reloj.fijar('2026-10-31T02:30:00-05:00'); // 60 minutos sin peticiones
    esperarError(await esc.api.get('/sesion', { token }), 401, 'SESION_EXPIRADA');
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
  });

  it('tras salir (DELETE /sesion) fuera de horario no puede volver a entrar', async () => {
    const esc = await sc.obtener();
    const u = await conHorario(esc);
    esc.reloj.fijar('2026-10-31T01:50:00-05:00');
    const { token } = await ingresarOk(esc.api, u.nombreUsuario, u.contrasena);
    esc.reloj.fijar('2026-10-31T02:05:00-05:00');
    expect((await esc.api.delete('/sesion', { token })).status).toBe(204);
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
    expect((await filasDeFueraDeHorario(esc, u.id)).length).toBe(1);
  });
});

describe('criterios 107 a 109 con PIN [C2]', () => {
  /** Mozo con horario, con la cuenta activa y el equipo recordado (todo dentro del horario). */
  async function mozoConEquipo(esc: Escenario): Promise<{ u: UsuarioPrueba; tokenEquipo: string }> {
    const u = await conHorario(esc, 'MOZO');
    esc.reloj.fijar(DENTRO);
    const { tokenEquipo } = await recordarEquipoDe(esc, u);
    return { u, tokenEquipo };
  }

  it('[C2] con el PIN correcto fuera de horario responde 403 FUERA_DE_HORARIO sin crear sesión; dentro, entra', async () => {
    const esc = await sc.obtener();
    const { u, tokenEquipo } = await mozoConEquipo(esc);
    const antes = (await sesionesDe(u.id)).filter((s) => s.tipo === 'PIN').length;
    esc.reloj.fijar(FUERA);
    const res = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    esperarError(res, 403, 'FUERA_DE_HORARIO');
    expect((await sesionesDe(u.id)).filter((s) => s.tipo === 'PIN').length).toBe(antes);
    esc.reloj.fijar(DENTRO);
    const dentro = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    expect(dentro.status, dentro.text).toBe(201);
  });

  it('[C2] con un PIN incorrecto fuera de horario responde como siempre (401), sin revelar el horario', async () => {
    const esc = await sc.obtener();
    const { u, tokenEquipo } = await mozoConEquipo(esc);
    const otro = await crearUsuarioConRol(esc, esc.A, 'MOZO');
    const { tokenEquipo: equipoDelOtro } = await recordarEquipoDe(esc, otro);
    esc.reloj.fijar(FUERA);
    const incorrecto = u.pin === '0000' ? '1111' : '0000';
    const a = await ingresarConPin(esc.api, tokenEquipo, u.id, incorrecto);
    const incorrectoOtro = otro.pin === '0000' ? '1111' : '0000';
    const b = await ingresarConPin(esc.api, equipoDelOtro, otro.id, incorrectoOtro);
    esperarError(a, 401, 'CREDENCIALES_INVALIDAS');
    expect(a.body).toEqual(b.body);
  });

  it('[C2] no cuenta como fallo y reinicia la cuenta de la persona en el equipo; queda auditado', async () => {
    const esc = await sc.obtener();
    const { u, tokenEquipo } = await mozoConEquipo(esc);
    esc.reloj.fijar(FUERA);
    const incorrecto = u.pin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 4; i++) {
      esperarError(
        await ingresarConPin(esc.api, tokenEquipo, u.id, incorrecto),
        401,
        'CREDENCIALES_INVALIDAS',
      );
    }
    esperarError(await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin), 403, 'FUERA_DE_HORARIO');
    for (let i = 0; i < 4; i++) {
      const res = await ingresarConPin(esc.api, tokenEquipo, u.id, incorrecto);
      expect(res.status, `fallo ${i + 1}: ${res.text}`).toBe(401);
    }
    for (let i = 0; i < 6; i++) {
      esperarError(
        await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin),
        403,
        'FUERA_DE_HORARIO',
      );
    }
    const filas = await filasDeFueraDeHorario(esc, u.id);
    expect(filas).toHaveLength(7);
    for (const fila of filas) expect(JSON.stringify(fila)).not.toContain(`"${u.pin}"`);
  });

  it('[C2] la sesión PIN abierta sigue después del horario, hasta salir o expirar; después no puede volver a entrar', async () => {
    const esc = await sc.obtener();
    const { u, tokenEquipo } = await mozoConEquipo(esc);
    esc.reloj.fijar('2026-10-31T01:50:00-05:00');
    const pin = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    expect(pin.status, pin.text).toBe(201);
    const token = pin.body.token as string;
    for (const hora of ['02:00', '02:02', '02:04']) {
      esc.reloj.fijar(`2026-10-31T${hora}:00-05:00`);
      const res = await esc.api.get('/sesion', { token, equipo: tokenEquipo });
      expect(res.status, `${hora}: ${res.text}`).toBe(200);
    }
    expect((await esc.api.delete('/sesion', { token, equipo: tokenEquipo })).status).toBe(204);
    esperarError(await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin), 403, 'FUERA_DE_HORARIO');
    esperarError(await ingresar(esc.api, u.nombreUsuario, u.contrasena), 403, 'FUERA_DE_HORARIO');
  });

  it('[C2] el cambio rápido de usuario no deja volver a entrar a quien ya está fuera de su horario', async () => {
    const esc = await sc.obtener();
    const { u, tokenEquipo } = await mozoConEquipo(esc);
    const otro = await crearUsuarioConRol(esc, esc.A, 'MOZO');
    const enElMismoEquipo = await recordarEquipoDe(esc, otro, { equipo: tokenEquipo });
    expect(enElMismoEquipo.tokenEquipo).toBe(tokenEquipo);
    esc.reloj.fijar('2026-10-31T01:58:00-05:00');
    const primera = await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin);
    expect(primera.status, primera.text).toBe(201);
    esc.reloj.fijar('2026-10-31T02:01:00-05:00'); // ya terminó el horario de la primera persona
    const segunda = await ingresarConPin(esc.api, tokenEquipo, otro.id, otro.pin);
    expect(segunda.status, segunda.text).toBe(201);
    esperarError(
      await esc.api.get('/sesion', { token: primera.body.token, equipo: tokenEquipo }),
      401,
      'NO_AUTENTICADO',
    );
    esperarError(await ingresarConPin(esc.api, tokenEquipo, u.id, u.pin), 403, 'FUERA_DE_HORARIO');
  });
});

describe('criterio 110 · autorizar fuera de horario [C3]', () => {
  const cuerpoAutorizacion = (pin: string) => ({
    accion: 'ANULAR_ITEM_ENVIADO',
    motivo: 'Cliente se retiró',
    pin,
  });

  it('[C3] un Supervisor con horario es rechazado como CLAVE_INVALIDA, con FUERA_DE_HORARIO solo en la auditoría', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const supervisor = await crearUsuario(esc, esc.A, {
      accesos: [{ sucursal: 0, rol: 'SUPERVISOR' }],
      horario: VIERNES_NOCHE,
      tokenAdmin: admin.token,
    });
    const cajero = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    esc.reloj.fijar(FUERA);
    const { token } = await ingresarOk(esc.api, cajero.nombreUsuario, cajero.contrasena);
    const fuera = await esc.api.post('/autorizaciones', {
      token,
      cuerpo: cuerpoAutorizacion(supervisor.pin),
    });
    const inexistente = await esc.api.post('/autorizaciones', {
      token,
      cuerpo: cuerpoAutorizacion('000000'),
    });
    esperarError(fuera, 403, 'CLAVE_INVALIDA');
    esperarError(inexistente, 403, 'CLAVE_INVALIDA');
    expect(fuera.body).toEqual(inexistente.body);
    expect(fuera.text).not.toContain('FUERA_DE_HORARIO');

    const rechazos = (await auditoriaDe(esc.A.id, 'autorizacion_rechazada')).filter(
      (f) => f.actor_usuario_id === cajero.id,
    );
    expect(rechazos.length).toBeGreaterThanOrEqual(2);
    const delSupervisor = rechazos.filter((f) =>
      JSON.stringify(f.detalle).includes('FUERA_DE_HORARIO'),
    );
    expect(delSupervisor).toHaveLength(1);
    expect(JSON.stringify(delSupervisor[0])).not.toContain(supervisor.pin);
  });

  it('[C3] el mismo Supervisor autoriza dentro de su horario', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const supervisor = await crearUsuario(esc, esc.A, {
      accesos: [{ sucursal: 0, rol: 'SUPERVISOR' }],
      horario: VIERNES_NOCHE,
      tokenAdmin: admin.token,
    });
    const cajero = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    esc.reloj.fijar(DENTRO);
    const { token } = await ingresarOk(esc.api, cajero.nombreUsuario, cajero.contrasena);
    const res = await esc.api.post('/autorizaciones', {
      token,
      cuerpo: cuerpoAutorizacion(supervisor.pin),
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body.autorizadoPor.id).toBe(supervisor.id);
  });

  it('[C3] el rechazo por horario cuenta como fallo: cinco seguidos bloquean al solicitante', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const supervisor = await crearUsuario(esc, esc.A, {
      accesos: [{ sucursal: 0, rol: 'SUPERVISOR' }],
      horario: VIERNES_NOCHE,
      tokenAdmin: admin.token,
    });
    const cajero = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    esc.reloj.fijar(FUERA);
    const { token } = await ingresarOk(esc.api, cajero.nombreUsuario, cajero.contrasena);
    for (let i = 0; i < 5; i++) {
      const res = await esc.api.post('/autorizaciones', {
        token,
        cuerpo: cuerpoAutorizacion(supervisor.pin),
      });
      esperarError(res, 403, 'CLAVE_INVALIDA');
    }
    const sexto = await esc.api.post('/autorizaciones', {
      token,
      cuerpo: cuerpoAutorizacion(supervisor.pin),
    });
    esperarError(sexto, 429, 'BLOQUEO_TEMPORAL');
  });

  it('[C3] un Supervisor sin horario y el Administrador autorizan a cualquier hora', async () => {
    const esc = await sc.obtener();
    const admin = await sesionAdmin(esc, esc.A);
    const supervisor = await crearUsuarioConRol(esc, esc.A, 'SUPERVISOR', {
      tokenAdmin: admin.token,
    });
    const cajero = await crearUsuarioConRol(esc, esc.A, 'CAJERO', { tokenAdmin: admin.token });
    esc.reloj.fijar('2026-11-03T03:00:00-05:00');
    const { token } = await ingresarOk(esc.api, cajero.nombreUsuario, cajero.contrasena);
    const porSupervisor = await esc.api.post('/autorizaciones', {
      token,
      cuerpo: cuerpoAutorizacion(supervisor.pin),
    });
    expect(porSupervisor.status, porSupervisor.text).toBe(201);
    const porAdministrador = await esc.api.post('/autorizaciones', {
      token,
      cuerpo: cuerpoAutorizacion(esc.A.admin.pin),
    });
    expect(porAdministrador.status, porAdministrador.text).toBe(201);
    expect(porAdministrador.body.autorizadoPor.id).toBe(esc.A.admin.id);
  });
});
