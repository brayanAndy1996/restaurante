// Pruebas del desarrollador (no protegidas) de T7: el actor de la transacción con `ContextoEmpresa`
// (`ejecutar(…, { actor })` y `fijarActor`), la guarda de la API que solo deja pasar el texto del actor
// cuando lo manda `ContextoEmpresa`, y las consultas fijas marcadas `sinEmpresa` (T9).
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API, ConsultaProhibidaError } from '../../src/nucleo/base-de-datos';
import {
  SQL_EMPRESA_DE_USUARIO,
  buscarEmpresaDeUsuario,
} from '../../src/nucleo/base-de-datos/consultas-sin-empresa';
import {
  ContextoEmpresa,
  ContextoEmpresaAusenteError,
  ContextoEmpresaConflictoError,
} from '../../src/nucleo/contexto-empresa';
import { SQL_FIJAR_ACTOR } from '../../src/nucleo/fijar-contexto';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, errorDe, type EmpresaSql } from '../aislamiento/fabrica';
import { insertarUsuario } from './sembrado';

let app: INestApplication;
let contexto: ContextoEmpresa;
let sequelize: Sequelize;
let plataforma: Client;
let api: Client;
let admin: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ empresaPorHeader: false, poolMax: 2 });
  app = await crearAplicacion({ logger: false });
  contexto = app.get(ContextoEmpresa);
  sequelize = app.get<Sequelize>(CONEXION_API);
  plataforma = await abrirCliente('plataforma');
  api = await abrirCliente('api');
  admin = await abrirCliente('admin');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  for (const c of [plataforma, api, admin]) await c?.end();
});

/** Cambia la dirección de una sucursal con una consulta cruda dentro del contexto activo. */
const cambiarDireccion = (sucursalId: string, direccion: string) =>
  sequelize.query('UPDATE sucursal SET direccion = $2 WHERE id = $1', {
    bind: [sucursalId, direccion],
  });

const filaDe = async (sucursalId: string) =>
  (await admin.query('SELECT * FROM sucursal WHERE id = $1', [sucursalId])).rows[0];

describe('ContextoEmpresa.ejecutar con actor', () => {
  it('sin actor la transacción puede leer pero no escribir (contexto de actor ausente, 42501)', async () => {
    const sucursalId = A.sucursales[0]!.id;
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query('SELECT id FROM sucursal', { type: QueryTypes.SELECT }),
    );
    expect(filas).toHaveLength(2);
    const error = await errorDe(
      contexto.ejecutar(A.id, () => cambiarDireccion(sucursalId, 'sin actor')),
    );
    expect(error.message).toMatch(/contexto de actor ausente/);
    expect((error as { original?: { code?: string } }).original?.code ?? error.code).toBe('42501');
    expect((await filaDe(sucursalId)).direccion).not.toBe('sin actor');
  });

  it('con un actor de sistema la escritura queda a su nombre (creado y cambiado) y creado_por no cambia', async () => {
    const sucursalId = A.sucursales[0]!.id;
    const antes = await filaDe(sucursalId);
    await contexto.ejecutar(A.id, () => cambiarDireccion(sucursalId, 'con actor 1'), {
      actor: { sistema: 'prueba-actor' },
    });
    const despues = await filaDe(sucursalId);
    expect(despues).toMatchObject({
      direccion: 'con actor 1',
      actualizado_por_sistema: 'prueba-actor',
      actualizado_por_usuario_id: null,
      creado_por_sistema: antes.creado_por_sistema,
    });
  });

  it('con un usuario (y equipo) de la empresa de actor, la fila lleva usuario y equipo', async () => {
    const sucursalId = A.sucursales[1]!.id;
    const usuario = await insertarUsuario(api, A.id, { esAdministrador: true });
    const equipoId = randomUUID();
    await contexto.ejecutar(A.id, () => cambiarDireccion(sucursalId, 'con usuario'), {
      actor: { usuarioId: usuario.id, equipoId },
    });
    expect(await filaDe(sucursalId)).toMatchObject({
      actualizado_por_usuario_id: usuario.id,
      actualizado_por_equipo_id: equipoId,
      actualizado_por_sistema: null,
      actualizado_por_superadministrador_id: null,
    });
  });

  it('un usuario de otra empresa como actor falla por la llave compuesta (23503) y no escribe', async () => {
    const sucursalId = A.sucursales[0]!.id;
    const deB = await insertarUsuario(api, B.id, { esAdministrador: true });
    const antes = await filaDe(sucursalId);
    const error = await errorDe(
      contexto.ejecutar(A.id, () => cambiarDireccion(sucursalId, 'cruzada'), {
        actor: { usuarioId: deB.id },
      }),
    );
    expect((error as { original?: { code?: string } }).original?.code ?? error.code).toBe('23503');
    expect((await filaDe(sucursalId)).direccion).toBe(antes.direccion);
  });

  it('rechaza un actor mal formado antes de llegar a la base', async () => {
    for (const actor of [
      {},
      { sistema: '' },
      { sistema: 'x'.repeat(101) },
      { usuarioId: 'no-es-uuid' },
      { usuarioId: randomUUID(), sistema: 'a' },
      { superadministradorId: randomUUID(), usuarioId: randomUUID() },
      { equipoId: randomUUID(), sistema: 'a' },
    ] as unknown as { sistema: string }[]) {
      await expect(
        contexto.ejecutar(A.id, async () => undefined, { actor }),
        JSON.stringify(actor),
      ).rejects.toThrow(TypeError);
    }
  });
});

describe('ContextoEmpresa.fijarActor', () => {
  it('fija el actor después de abrir el contexto, una sola vez', async () => {
    const sucursalId = A.sucursales[0]!.id;
    await contexto.ejecutar(A.id, async () => {
      await contexto.fijarActor({ sistema: 'autenticacion' });
      await cambiarDireccion(sucursalId, 'actor tardío');
    });
    expect((await filaDe(sucursalId)).actualizado_por_sistema).toBe('autenticacion');
    await contexto.ejecutar(A.id, async () => {
      await contexto.fijarActor({ sistema: 'primero' });
      await expect(contexto.fijarActor({ sistema: 'primero' })).rejects.toBeInstanceOf(
        ContextoEmpresaConflictoError,
      );
      await expect(contexto.fijarActor({ sistema: 'segundo' })).rejects.toBeInstanceOf(
        ContextoEmpresaConflictoError,
      );
    });
  });

  it('con el actor ya fijado al abrir el contexto, un segundo actor se rechaza', async () => {
    await contexto.ejecutar(
      A.id,
      async () => {
        await expect(contexto.fijarActor({ sistema: 'otro' })).rejects.toBeInstanceOf(
          ContextoEmpresaConflictoError,
        );
      },
      { actor: { sistema: 'inicial' } },
    );
  });

  it('fuera de un contexto lanza ContextoEmpresaAusenteError', async () => {
    await expect(contexto.fijarActor({ sistema: 'x' })).rejects.toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
  });

  it('el actor muere con la transacción: el contexto siguiente empieza sin actor', async () => {
    await contexto.ejecutar(A.id, () => contexto.fijarActor({ sistema: 'efimero' }));
    const error = await errorDe(
      contexto.ejecutar(A.id, () => cambiarDireccion(A.sucursales[0]!.id, 'sin actor otra vez')),
    );
    expect(error.message).toMatch(/contexto de actor ausente/);
  });
});

describe('la guarda de la API y la función que fija el actor', () => {
  it('el texto exacto de SQL_FIJAR_ACTOR escrito por el código de fn se rechaza (no es el de ContextoEmpresa)', async () => {
    await contexto.ejecutar(A.id, async () => {
      const error = await sequelize
        .query(SQL_FIJAR_ACTOR, { bind: [null, null, null, 'suplantacion'] })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(ConsultaProhibidaError);
    });
  });

  it.each([
    "SELECT fijar_contexto_actor(NULL, NULL, NULL, 'x')",
    'SELECT public.FIJAR_CONTEXTO_ACTOR(NULL, NULL, NULL, NULL)',
    'SELECT "fijar_contexto_actor"(NULL, NULL, NULL, NULL)',
    'SELECT empresa_de_usuario($1)',
  ])('«%s» dentro de un contexto se rechaza antes de la base', async (sql) => {
    await contexto.ejecutar(A.id, async () => {
      const error = await sequelize.query(sql, { bind: sql.includes('$1') ? ['x'] : [] }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ConsultaProhibidaError);
    });
  });

  it('un valor de texto que contiene el nombre de la función no cuenta como mención', async () => {
    await contexto.ejecutar(A.id, async () => {
      const filas = await sequelize.query("SELECT 'fijar_contexto_actor' AS texto", {
        type: QueryTypes.SELECT,
      });
      expect(filas).toEqual([{ texto: 'fijar_contexto_actor' }]);
    });
  });
});

describe('consulta fija de ingreso (sinEmpresa: autenticacion)', () => {
  it('devuelve la empresa del usuario con el nombre exacto, sin distinguir mayúsculas, y null si no existe', async () => {
    const usuario = await insertarUsuario(api, A.id, { esAdministrador: true });
    expect(await buscarEmpresaDeUsuario(sequelize, usuario.nombreUsuario)).toBe(A.id);
    expect(await buscarEmpresaDeUsuario(sequelize, usuario.nombreUsuario.toUpperCase())).toBe(A.id);
    for (const texto of [
      '',
      '%',
      '_',
      `${usuario.nombreUsuario}x`,
      usuario.nombreUsuario.slice(0, -1),
    ]) {
      expect(await buscarEmpresaDeUsuario(sequelize, texto), texto).toBeNull();
    }
  });

  it('un nombre con guion, punto y guion bajo solo coincide exacto: ni comodines ni textos parecidos', async () => {
    const nombre = `ab_c-d.${randomUUID().slice(0, 8)}`;
    const usuario = await insertarUsuario(api, A.id, { nombreUsuario: nombre });
    expect(await buscarEmpresaDeUsuario(sequelize, nombre)).toBe(A.id);
    expect(await buscarEmpresaDeUsuario(sequelize, nombre.toUpperCase())).toBe(A.id);
    const filaNombre = await admin.query(
      'SELECT nombre, empresa_id, usuario_id FROM autenticacion.nombre_usuario WHERE usuario_id = $1',
      [usuario.id],
    );
    expect(filaNombre.rows).toEqual([{ nombre, empresa_id: A.id, usuario_id: usuario.id }]);
    const parecidos = [
      nombre.replace('_', '%'),
      nombre.replace('-', '_'), // `_` coincidiría con `-` si fuera un LIKE
      nombre.replace('b', '_'),
      `${nombre.slice(0, 5)}%`,
      ` ${nombre}`,
      `${nombre} `,
      `${nombre}\n`,
      nombre.replace(/[a-z]/, (c) => c.toUpperCase().normalize('NFD') + '\u0301'),
      'x'.repeat(10_000),
    ];
    for (const texto of parecidos) {
      expect(
        await buscarEmpresaDeUsuario(sequelize, texto),
        JSON.stringify(texto.slice(0, 60)),
      ).toBeNull();
    }
  });

  it('el signo Kelvin (K, U+212A) no equivale a una k ASCII', async () => {
    const sufijo = randomUUID().slice(0, 8);
    await insertarUsuario(api, A.id, { nombreUsuario: `kelvin-${sufijo}` });
    expect(await buscarEmpresaDeUsuario(sequelize, `kelvin-${sufijo}`)).toBe(A.id);
    expect(await buscarEmpresaDeUsuario(sequelize, `\u212aelvin-${sufijo}`)).toBeNull();
    expect(await buscarEmpresaDeUsuario(sequelize, `\u212aELVIN-${sufijo}`)).toBeNull();
  });

  it('el nombre global es único: repetirlo (aunque sea en otra empresa) falla con 23505 sin nombrar la otra empresa', async () => {
    const nombre = `unico-${randomUUID().slice(0, 8)}`;
    await insertarUsuario(api, A.id, { nombreUsuario: nombre });
    for (const empresa of [A, B]) {
      const error = await errorDe(insertarUsuario(api, empresa.id, { nombreUsuario: nombre }));
      expect(error.code, error.message).toBe('23505');
      expect(JSON.stringify([error.message, error.detail])).not.toContain(A.id);
    }
  });

  it('renombrar actualiza la relación en la misma transacción y libera el nombre viejo', async () => {
    const viejo = `viejo-${randomUUID().slice(0, 8)}`;
    const nuevo = `nuevo-${randomUUID().slice(0, 8)}`;
    const usuario = await insertarUsuario(api, A.id, { nombreUsuario: viejo });
    await contexto.ejecutar(
      A.id,
      async () => {
        await sequelize.query('UPDATE usuario SET nombre_usuario = $2 WHERE id = $1', {
          bind: [usuario.id, nuevo],
        });
        const dentro = await admin.query('SELECT 1');
        expect(dentro.rows).toHaveLength(1);
      },
      { actor: { sistema: 'prueba' } },
    );
    expect(await buscarEmpresaDeUsuario(sequelize, nuevo)).toBe(A.id);
    expect(await buscarEmpresaDeUsuario(sequelize, viejo)).toBeNull();
    const reutilizado = await insertarUsuario(api, B.id, { nombreUsuario: viejo });
    expect(await buscarEmpresaDeUsuario(sequelize, viejo)).toBe(B.id);
    expect(reutilizado.id).not.toBe(usuario.id);
  });

  it('la marca solo vale para su texto exacto, con un parámetro, fuera de todo contexto', async () => {
    const marcada = (sql: string, opciones: Record<string, unknown>) =>
      sequelize.query(sql, { sinEmpresa: 'autenticacion', ...opciones } as never).then(
        () => undefined,
        (e: unknown) => e,
      );
    // Otro texto con la marca.
    expect(await marcada('SELECT nombre FROM sucursal', { bind: ['x'] })).toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    // El texto correcto sin parámetro, con dos o que no es de texto.
    expect(await marcada(SQL_EMPRESA_DE_USUARIO, {})).toBeInstanceOf(ContextoEmpresaAusenteError);
    expect(await marcada(SQL_EMPRESA_DE_USUARIO, { bind: ['a', 'b'] })).toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    expect(await marcada(SQL_EMPRESA_DE_USUARIO, { bind: [1] })).toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    expect(await marcada(SQL_EMPRESA_DE_USUARIO, { replacements: ['a'] })).toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    // Dentro de un contexto de empresa la marca no vale.
    await contexto.ejecutar(A.id, async () => {
      expect(await marcada(SQL_EMPRESA_DE_USUARIO, { bind: ['x'] })).toBeInstanceOf(
        ContextoEmpresaAusenteError,
      );
    });
    // Los otros motivos no aceptan parámetros ni el texto de ingreso.
    const salud = await sequelize
      .query(SQL_EMPRESA_DE_USUARIO, { bind: ['x'], sinEmpresa: 'salud' } as never)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(salud).toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('sin la marca, la misma consulta fuera de un contexto no sale a la base', async () => {
    const error = await sequelize.query(SQL_EMPRESA_DE_USUARIO, { bind: ['x'] }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ContextoEmpresaAusenteError);
  });
});
