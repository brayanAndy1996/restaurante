import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { EntornoInvalidoError } from '../../src/config/entorno';
import { PUBLICADOR_EVENTOS, PublicadorEnMemoria, PublicadorNulo } from '../../src/nucleo/eventos';
import { PublicadorSocketIo, ServidorTiempoReal } from '../../src/nucleo/tiempo-real';
import { ClienteTiempoReal } from '../soporte';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';

// Historia 004, T3, T5 y T10: el servidor de Socket.IO vive en `/tiempo-real` y rechaza con `NO_AUTENTICADO` toda
// conexión sin una sesión válida (la autenticación completa, las salas, las desconexiones y los casos de varias
// instancias los prueban las protegidas de `test/salon-critica/`); el rol `restaurante_tiempo_real` lo crea
// `db:preparar` sin privilegios sobre `public`. No es una prueba protegida.

describe('servidor de Socket.IO', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('con NODE_ENV=test está deshabilitado por defecto y no atiende conexiones', async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion();
    await app.listen(0, '127.0.0.1');
    expect(app.get(ServidorTiempoReal).habilitado).toBe(false);
    const { cliente, error } = await ClienteTiempoReal.intentarConectar(app, { token: 'se.x' });
    expect(cliente).toBeNull();
    expect(error).not.toBeNull();
  });

  it('habilitado con crearAplicacion({ tiempoReal }) rechaza con NO_AUTENTICADO la conexión sin una sesión válida', async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion({ tiempoReal: { habilitado: true } });
    await app.listen(0, '127.0.0.1');
    expect(app.get(ServidorTiempoReal).habilitado).toBe(true);
    for (const auth of [{}, { token: 'se.x.y.z' }, { token: 'se.x.y.z', equipo: 'eq.a.b.c' }]) {
      const resultado = await ClienteTiempoReal.intentarConectar(app, auth);
      expect(resultado).toEqual({ cliente: null, error: 'NO_AUTENTICADO' });
    }
  });

  it('habilitado sin DATABASE_TIEMPO_REAL_URL no arranca y lo dice', async () => {
    fijarEntornoDePrueba({ extra: { DATABASE_TIEMPO_REAL_URL: undefined } });
    await expect(crearAplicacion({ tiempoReal: { habilitado: true } })).rejects.toThrow(
      EntornoInvalidoError,
    );
    await expect(crearAplicacion({ tiempoReal: { habilitado: true } })).rejects.toThrow(
      /DATABASE_TIEMPO_REAL_URL es obligatoria/,
    );
    // Con el tiempo real apagado, la variable puede faltar (las pruebas de 001 arman entornos sin ella).
    app = await crearAplicacion({ tiempoReal: { habilitado: false } });
    expect(app.get(ServidorTiempoReal).habilitado).toBe(false);
    fijarEntornoDePrueba();
  });

  it('PublicadorSocketIo reemplaza al PublicadorNulo solo con el tiempo real habilitado, y un publicador explícito manda', async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion({ tiempoReal: { habilitado: true } });
    expect(app.get(PUBLICADOR_EVENTOS)).toBeInstanceOf(PublicadorSocketIo);
    await app.close();
    app = await crearAplicacion({ tiempoReal: { habilitado: false } });
    expect(app.get(PUBLICADOR_EVENTOS)).toBeInstanceOf(PublicadorNulo);
    await app.close();
    const propio = new PublicadorEnMemoria();
    app = await crearAplicacion({ tiempoReal: { habilitado: true }, publicadorEventos: propio });
    expect(app.get(PUBLICADOR_EVENTOS)).toBe(propio);
  });

  it('TIEMPO_REAL=habilitado en el entorno lo enciende sin la opción', async () => {
    fijarEntornoDePrueba({ extra: { TIEMPO_REAL: 'habilitado' } });
    app = await crearAplicacion();
    expect(app.get(ServidorTiempoReal).habilitado).toBe(true);
    fijarEntornoDePrueba();
  });

  it('crearAplicacion({ tiempoReal: { habilitado: false } }) manda sobre el entorno', async () => {
    fijarEntornoDePrueba({ extra: { TIEMPO_REAL: 'habilitado' } });
    app = await crearAplicacion({ tiempoReal: { habilitado: false } });
    expect(app.get(ServidorTiempoReal).habilitado).toBe(false);
    fijarEntornoDePrueba();
  });
});

describe('rol restaurante_tiempo_real (T5)', () => {
  it('existe como rol de aplicación sin privilegios especiales ni acceso a public', async () => {
    const admin = await abrirCliente('admin');
    try {
      const { rows } = await admin.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolcanlogin: boolean;
        rolinherit: boolean;
      }>(
        `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit
           FROM pg_roles WHERE rolname = 'restaurante_tiempo_real'`,
      );
      expect(rows).toEqual([
        {
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolcanlogin: true,
          rolinherit: false,
        },
      ]);
      const { rows: membresias } = await admin.query(
        `SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
          WHERE r.rolname = 'restaurante_tiempo_real'`,
      );
      expect(membresias).toHaveLength(0);
    } finally {
      await admin.end();
    }
  });

  it('se conecta a la base y no puede usar el esquema public', async () => {
    const cliente = await abrirCliente('tiempoReal');
    try {
      const { rows } = await cliente.query<{ uso: boolean; crear: boolean }>(
        `SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS uso,
                has_schema_privilege(current_user, 'public', 'CREATE') AS crear`,
      );
      expect(rows).toEqual([{ uso: false, crear: false }]);
      await expect(cliente.query('SELECT 1 FROM empresa')).rejects.toThrow();
    } finally {
      await cliente.end();
    }
  });
});
