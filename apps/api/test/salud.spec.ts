import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import { comprobarConexion } from '../src/nucleo/base-de-datos';
import { crearSequelize } from '../src/nucleo/base-de-datos/crear-sequelize';
import { BASE_DE_PRUEBA, abrirCliente, fijarEntornoDePrueba, urlDeRol } from './utilidades';

// Criterios 5 y 6 de la historia 001 (GET /health). No es una prueba protegida.

describe('criterio 5 · GET /health con la base disponible', () => {
  let app: INestApplication;
  beforeAll(async () => {
    // Sin cabecera de empresa ni resolutor: /health no pertenece a ninguna empresa.
    fijarEntornoDePrueba({ empresaPorHeader: false });
    app = await crearAplicacion();
    await app.listen(0);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('responde 200 { estado: ok, baseDeDatos: ok } sin cabeceras ni contexto', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'ok', baseDeDatos: 'ok' });
  });

  it('sigue respondiendo bajo carga de peticiones de empresa en paralelo', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 20 }, () => request(app.getHttpServer()).get('/health')),
    );
    expect(respuestas.map((r) => r.status)).toEqual(Array(20).fill(200));
  });
});

describe('criterio 6 · GET /health con la base inaccesible', () => {
  const rol = `prueba_salud_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const contrasena = `pw_${randomUUID()}`;
  let admin: Client;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    admin = await abrirCliente('admin');
    const nombre = admin.escapeIdentifier(rol);
    await admin.query(`CREATE ROLE ${nombre} LOGIN PASSWORD ${admin.escapeLiteral(contrasena)}`);
    await admin.query(
      `GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(BASE_DE_PRUEBA)} TO ${nombre}`,
    );
  });
  afterAll(async () => {
    await app?.close();
    const nombre = admin.escapeIdentifier(rol);
    try {
      await admin.query(
        `REVOKE ALL ON DATABASE ${admin.escapeIdentifier(BASE_DE_PRUEBA)} FROM ${nombre}`,
      );
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${nombre}`);
      await admin.end();
    }
  });

  it('si la base deja de aceptar la conexión, responde 503 sin detalles en menos de 3 s', async () => {
    // La API arranca con un rol de pruebas (sin privilegios) al que luego se le quita el acceso.
    const url = new URL(urlDeRol('api'));
    url.username = rol;
    url.password = contrasena;
    fijarEntornoDePrueba({ empresaPorHeader: false, extra: { DATABASE_URL: url.toString() } });
    app = await crearAplicacion();
    await app.listen(0);
    const antes = await request(app.getHttpServer()).get('/health');
    expect(antes.status).toBe(200);

    await admin.query(`ALTER ROLE ${admin.escapeIdentifier(rol)} NOLOGIN`);
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1', [
      rol,
    ]);

    const inicio = Date.now();
    const res = await request(app.getHttpServer()).get('/health');
    expect(Date.now() - inicio).toBeLessThan(3000);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ estado: 'error', baseDeDatos: 'error' });
    const texto = JSON.stringify(res.body) + JSON.stringify(res.headers);
    for (const secreto of [rol, contrasena, 'localhost', '5432', 'password', 'FATAL', 'ECONN']) {
      expect(texto).not.toContain(secreto);
    }
  });

  it('con credenciales inválidas, comprobarConexion devuelve false en menos de 3 s', async () => {
    const url = new URL(urlDeRol('api'));
    url.password = 'contrasena-incorrecta';
    const conexion = crearSequelize({
      url: url.toString(),
      poolMax: 1,
      aplicacion: 'prueba-salud',
    });
    try {
      const inicio = Date.now();
      expect(await comprobarConexion(conexion)).toBe(false);
      expect(Date.now() - inicio).toBeLessThan(3000);
    } finally {
      await conexion.close();
    }
  });

  it('con el puerto cerrado, comprobarConexion devuelve false en menos de 3 s', async () => {
    const url = new URL(urlDeRol('api'));
    url.port = '1';
    const conexion = crearSequelize({
      url: url.toString(),
      poolMax: 1,
      aplicacion: 'prueba-salud',
    });
    try {
      const inicio = Date.now();
      expect(await comprobarConexion(conexion)).toBe(false);
      expect(Date.now() - inicio).toBeLessThan(3000);
    } finally {
      await conexion.close();
    }
  });

  it('si la base no responde, el tiempo límite corta la comprobación', async () => {
    // pg_sleep no está permitido por la lista de consultas, así que se simula con un host que no contesta.
    const url = new URL(urlDeRol('api'));
    url.hostname = '10.255.255.1'; // dirección no enrutable: la conexión se queda esperando
    const conexion = crearSequelize({
      url: url.toString(),
      poolMax: 1,
      aplicacion: 'prueba-salud',
    });
    try {
      const inicio = Date.now();
      expect(await comprobarConexion(conexion, 500)).toBe(false);
      expect(Date.now() - inicio).toBeLessThan(1500);
    } finally {
      await conexion.close().catch(() => undefined);
    }
  });
});
