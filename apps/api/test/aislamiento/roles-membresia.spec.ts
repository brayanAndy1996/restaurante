// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterios 7 y 10 (falla F1 del adversarial): un rol de conexión que es miembro (directo o
// transitivo, con INHERIT o NOINHERIT) de `restaurante_migrador` (dueño de las tablas) o de un rol
// superusuario o con BYPASSRLS tiene en la práctica esos privilegios (puede `SET ROLE` y apagar la
// RLS). La API no debe arrancar con ese rol ni en DATABASE_URL ni en DATABASE_PLATAFORMA_URL, y el
// error debe nombrar el rol y el motivo (la membresía y el rol o atributo privilegiado).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import {
  BASE_DE_PRUEBA,
  NOMBRES_DE_ROLES,
  abrirCliente,
  fijarEntornoDePrueba,
  urlDeRol,
} from '../utilidades';

const sufijo = () => randomUUID().replace(/-/g, '').slice(0, 10);

interface CasoMembresia {
  nombre: string;
  /** Roles (sin LOGIN) que hay que crear antes del rol de conexión, con su SQL de atributos. */
  preparar: (nombres: { conexion: string; grupo: string; intermedio: string }) => string[];
  /** Texto del rol privilegiado que debe aparecer en el error (o su atributo). */
  privilegiado: (nombres: { grupo: string; intermedio: string }) => RegExp;
}

const casos: CasoMembresia[] = [
  {
    nombre: 'directo INHERIT (migrador)',
    preparar: ({ conexion }) => [
      `CREATE ROLE ${conexion} LOGIN PASSWORD '__PW__' NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE ${NOMBRES_DE_ROLES.migrador}`,
    ],
    privilegiado: () => new RegExp(NOMBRES_DE_ROLES.migrador),
  },
  {
    nombre: 'directo NOINHERIT (migrador)',
    preparar: ({ conexion }) => [
      `CREATE ROLE ${conexion} LOGIN PASSWORD '__PW__' NOSUPERUSER NOBYPASSRLS NOINHERIT IN ROLE ${NOMBRES_DE_ROLES.migrador}`,
    ],
    privilegiado: () => new RegExp(NOMBRES_DE_ROLES.migrador),
  },
  {
    nombre: 'transitivo (migrador)',
    preparar: ({ conexion, intermedio }) => [
      `CREATE ROLE ${intermedio} NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE ${NOMBRES_DE_ROLES.migrador}`,
      `CREATE ROLE ${conexion} LOGIN PASSWORD '__PW__' NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE ${intermedio}`,
    ],
    privilegiado: () => new RegExp(NOMBRES_DE_ROLES.migrador),
  },
  {
    nombre: 'miembro de BYPASSRLS',
    preparar: ({ conexion, grupo }) => [
      `CREATE ROLE ${grupo} NOLOGIN BYPASSRLS`,
      `CREATE ROLE ${conexion} LOGIN PASSWORD '__PW__' NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE ${grupo}`,
    ],
    privilegiado: ({ grupo }) => new RegExp(`${grupo}|bypassrls`, 'i'),
  },
  {
    nombre: 'miembro de superusuario',
    preparar: ({ conexion, grupo }) => [
      `CREATE ROLE ${grupo} NOLOGIN SUPERUSER`,
      `CREATE ROLE ${conexion} LOGIN PASSWORD '__PW__' NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE ${grupo}`,
    ],
    privilegiado: ({ grupo }) => new RegExp(`${grupo}|superusuario|superuser`, 'i'),
  },
];

describe('criterio 10 · el arranque rechaza roles de conexión que son miembros de un rol privilegiado', () => {
  let admin: Client;
  let escrituras: ReturnType<typeof vi.spyOn>[] = [];
  const creados: { login: string[]; grupos: string[] } = { login: [], grupos: [] };

  beforeAll(async () => {
    admin = await abrirCliente('admin');
  });

  afterAll(async () => {
    try {
      for (const login of creados.login) {
        await admin.query(
          `REVOKE ALL ON DATABASE ${admin.escapeIdentifier(BASE_DE_PRUEBA)} FROM ${admin.escapeIdentifier(login)}`,
        );
        await admin.query(`DROP ROLE IF EXISTS ${admin.escapeIdentifier(login)}`);
      }
      for (const grupo of creados.grupos) {
        await admin.query(`DROP ROLE IF EXISTS ${admin.escapeIdentifier(grupo)}`);
      }
    } finally {
      await admin.end();
    }
  });

  afterEach(() => {
    for (const espia of escrituras) espia.mockRestore();
    escrituras = [];
  });

  /** Crea el rol de conexión del caso (y sus roles auxiliares) con nombres aleatorios. */
  async function crearRoles(caso: CasoMembresia) {
    const s = sufijo();
    const nombres = {
      conexion: `prueba_conn_${s}`,
      grupo: `prueba_grupo_${s}`,
      intermedio: `prueba_inter_${s}`,
    };
    const contrasena = `pw_${randomUUID()}`;
    // El orden de borrado: primero el rol de conexión, después los grupos.
    creados.login.push(nombres.conexion);
    creados.grupos.push(nombres.intermedio, nombres.grupo);
    for (const sql of caso.preparar(nombres)) {
      await admin.query(sql.replace('__PW__', contrasena));
    }
    await admin.query(
      `GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(BASE_DE_PRUEBA)} TO ${nombres.conexion}`,
    );
    const url = new URL(urlDeRol('api'));
    url.username = nombres.conexion;
    url.password = contrasena;
    return { nombres, url: url.toString() };
  }

  /** Intenta arrancar la API; devuelve el texto del error y de lo que Nest escribió en el registro. */
  async function intentarArrancar(
    variable: 'DATABASE_URL' | 'DATABASE_PLATAFORMA_URL',
    url: string,
  ): Promise<string | null> {
    fijarEntornoDePrueba({ extra: { [variable]: url } });
    let registro = '';
    escrituras = [
      vi.spyOn(process.stdout, 'write').mockImplementation(((trozo: string | Uint8Array) => {
        registro += String(trozo);
        return true;
      }) as typeof process.stdout.write),
      vi.spyOn(process.stderr, 'write').mockImplementation(((trozo: string | Uint8Array) => {
        registro += String(trozo);
        return true;
      }) as typeof process.stderr.write),
    ];
    try {
      const app = await crearAplicacion({ logger: ['error', 'warn', 'log'] });
      await app.close();
      return null;
    } catch (error) {
      return `${error instanceof Error ? error.message : String(error)}\n${registro}`;
    } finally {
      for (const espia of escrituras) espia.mockRestore();
      escrituras = [];
      fijarEntornoDePrueba();
    }
  }

  for (const variable of ['DATABASE_URL', 'DATABASE_PLATAFORMA_URL'] as const) {
    it.each(casos)(
      `${variable} con rol $nombre: no arranca y se indica rol y motivo`,
      async (caso) => {
        const { nombres, url } = await crearRoles(caso);
        const texto = await intentarArrancar(variable, url);
        expect(
          texto,
          'la API arrancó con un rol que es miembro de un rol privilegiado',
        ).not.toBeNull();
        expect(texto).toContain(nombres.conexion);
        expect(texto).toMatch(/miembro|member|membres[ií]a/i);
        expect(texto).toMatch(caso.privilegiado(nombres));
      },
    );
  }

  it('control · con restaurante_api (sin membresías) la API sí arranca', async () => {
    const texto = await intentarArrancar('DATABASE_URL', urlDeRol('api'));
    expect(texto).toBeNull();
  });

  it('control · con restaurante_plataforma (sin membresías) como DATABASE_PLATAFORMA_URL la API sí arranca', async () => {
    const texto = await intentarArrancar('DATABASE_PLATAFORMA_URL', urlDeRol('plataforma'));
    expect(texto).toBeNull();
  });
});
