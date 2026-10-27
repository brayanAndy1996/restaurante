// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 22b (falla F8 del adversarial, ronda 2). Contrato de `ContextoEmpresa.ejecutar`: "Confirma
// si `fn` termina bien y revierte si lanza". Dentro de `ejecutar(A, fn)` una consulta cruda por
// `CONEXION_API` no puede cerrar, abrir ni subdividir la transacción (`COMMIT`, `ROLLBACK`, `END`,
// `ABORT`, `SAVEPOINT`, `RELEASE`, `ROLLBACK TO`, `BEGIN`, `START TRANSACTION`, `PREPARE TRANSACTION`,
// `COMMIT PREPARED`; tampoco en varias sentencias ni precedidas de comentarios): lanza un error dentro
// de `fn` sin llegar a la base. Así, un `UPDATE` hecho antes no queda confirmado si `fn` lanza después,
// ni se pierde si `fn` termina bien. Un literal con ese texto en un valor sí es válido.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { conActor, crearEmpresaSql, type EmpresaSql } from './fabrica';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;

/**
 * Sección 002 (P10): `ContextoEmpresa.ejecutar` con el actor de sistema `prueba`. Toda escritura de una
 * transacción necesita actor (criterio 115); estas pruebas siguen verificando lo mismo que antes.
 */
const ejecutarConActor = <T>(empresaId: string, fn: () => Promise<T>): Promise<T> =>
  contexto.ejecutar(empresaId, fn, { actor: { sistema: 'prueba' } });

let admin: Client;
let plataforma: Client;
let A: EmpresaSql;

/** Identificador de transacciones preparadas de esta ejecución (para limpiar si algo llegara a la base). */
const GID = `gid_${randomUUID().replace(/-/g, '')}`;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
});

afterEach(async () => {
  // Si alguna sentencia llegara a dejar una transacción preparada, no debe estorbar a otras pruebas.
  const { rows } = await admin.query<{ gid: string }>(
    'SELECT gid FROM pg_prepared_xacts WHERE gid LIKE $1',
    [`${GID}%`],
  );
  for (const { gid } of rows)
    await admin.query(`ROLLBACK PREPARED '${gid}'`).catch(() => undefined);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await plataforma?.end();
});

const SUCURSAL = () => A.sucursales[0]!.id;

function marcadorNuevo(): string {
  return `dir_${randomUUID().replace(/-/g, '')}`;
}

/** Dirección de la sucursal vista por el administrador (salta la RLS), fuera de la transacción de la API. */
async function direccionPersistida(): Promise<string> {
  const { rows } = await admin.query<{ direccion: string }>(
    'SELECT direccion FROM sucursal WHERE id = $1',
    [SUCURSAL()],
  );
  return rows[0]!.direccion;
}

async function restablecerDireccion(): Promise<string> {
  const original = `Calle original ${randomUUID().slice(0, 8)}`;
  await conActor(plataforma, () =>
    plataforma.query('UPDATE sucursal SET direccion = $1 WHERE id = $2', [original, SUCURSAL()]),
  );
  return original;
}

const actualizar = (marcador: string) =>
  `UPDATE sucursal SET direccion = '${marcador}' WHERE id = '${SUCURSAL()}'`;

/** Sentencias de control de transacción que `fn` no puede enviar. `{M}` = marcador del UPDATE previo. */
const PROHIBIDAS: { nombre: string; sql: string; antesDelUpdate?: boolean }[] = [
  { nombre: 'COMMIT', sql: 'COMMIT' },
  { nombre: 'commit en minúsculas con punto y coma', sql: 'commit;' },
  { nombre: 'ROLLBACK', sql: 'ROLLBACK' },
  { nombre: 'END', sql: 'END' },
  { nombre: 'ABORT', sql: 'ABORT' },
  { nombre: 'SAVEPOINT x', sql: 'SAVEPOINT x' },
  { nombre: 'RELEASE x', sql: 'RELEASE x' },
  { nombre: 'ROLLBACK TO x', sql: 'ROLLBACK TO x' },
  { nombre: 'BEGIN', sql: 'BEGIN' },
  { nombre: 'START TRANSACTION', sql: 'START TRANSACTION' },
  { nombre: "PREPARE TRANSACTION 'x'", sql: `PREPARE TRANSACTION '${GID}'` },
  { nombre: "COMMIT PREPARED 'x'", sql: `COMMIT PREPARED '${GID}_inexistente'` },
  { nombre: 'comentario de bloque antes de COMMIT', sql: '/* x */ COMMIT' },
  { nombre: 'comentario de línea antes de COMMIT', sql: '-- x\nCOMMIT' },
  { nombre: 'UPDATE; COMMIT (varias sentencias)', sql: '{UPDATE}; COMMIT', antesDelUpdate: true },
  { nombre: 'UPDATE; /* x */ COMMIT', sql: '{UPDATE}; /* x */ COMMIT', antesDelUpdate: true },
];

/** Reemplaza `{UPDATE}` por el UPDATE con el marcador dado. */
const armar = (sql: string, marcador: string) => sql.replace('{UPDATE}', actualizar(marcador));

class FinDePrueba extends Error {}

describe('criterio 22b · fn no puede cerrar ni subdividir la transacción de ContextoEmpresa.ejecutar', () => {
  describe('la sentencia lanza un error dentro de fn sin llegar a la base', () => {
    it.each(PROHIBIDAS)('$nombre', async ({ sql }) => {
      await restablecerDireccion();
      let capturado: unknown;
      await contexto
        .ejecutar(A.id, async () => {
          try {
            await sequelize.query(armar(sql, marcadorNuevo()));
          } catch (error) {
            capturado = error;
          }
        })
        .catch(() => undefined);
      expect(capturado, 'la sentencia se dejó pasar').toBeInstanceOf(Error);
      // No es un error de PostgreSQL: la guarda la rechazó antes de enviarla.
      expect(capturado, 'la sentencia llegó a la base').not.toBeInstanceOf(DatabaseError);
    });
  });

  describe('si fn hace un UPDATE, intenta la sentencia (capturando el error) y luego lanza, el UPDATE no queda', () => {
    it.each(PROHIBIDAS)('$nombre', async ({ sql, antesDelUpdate }) => {
      const original = await restablecerDireccion();
      const marcador = marcadorNuevo();
      await expect(
        ejecutarConActor(A.id, async () => {
          if (!antesDelUpdate) await sequelize.query(actualizar(marcador));
          await sequelize.query(armar(sql, marcador)).catch(() => undefined);
          throw new FinDePrueba('fin');
        }),
      ).rejects.toBeInstanceOf(FinDePrueba);
      expect(await direccionPersistida()).toBe(original);
    });
  });

  describe('si fn hace un UPDATE, intenta revertir con SQL crudo (capturando el error) y termina bien, el UPDATE queda', () => {
    it.each([
      { nombre: 'ROLLBACK', sql: 'ROLLBACK' },
      { nombre: 'ABORT', sql: 'ABORT' },
      { nombre: '/* x */ ROLLBACK', sql: '/* x */ ROLLBACK' },
    ])('$nombre', async ({ sql }) => {
      await restablecerDireccion();
      const marcador = marcadorNuevo();
      await ejecutarConActor(A.id, async () => {
        await sequelize.query(actualizar(marcador));
        await sequelize.query(sql).catch(() => undefined);
      });
      expect(await direccionPersistida()).toBe(marcador);
    });
  });

  describe('controles: un literal con el texto de la sentencia en un valor funciona dentro del contexto', () => {
    it("SELECT 'COMMIT' AS x devuelve el literal", async () => {
      const filas = await ejecutarConActor(A.id, () =>
        sequelize.query<{ x: string }>("SELECT 'COMMIT' AS x", { type: QueryTypes.SELECT }),
      );
      expect(filas).toEqual([{ x: 'COMMIT' }]);
    });

    it("un literal con ';' y varias palabras de control de transacción funciona", async () => {
      const filas = await ejecutarConActor(A.id, () =>
        sequelize.query<{ x: string }>("SELECT 'a; ROLLBACK; COMMIT -- /* y */' AS x", {
          type: QueryTypes.SELECT,
        }),
      );
      expect(filas).toEqual([{ x: 'a; ROLLBACK; COMMIT -- /* y */' }]);
    });

    it("un UPDATE con el literal 'COMMIT' como valor se confirma al terminar bien fn", async () => {
      await restablecerDireccion();
      await ejecutarConActor(A.id, () =>
        sequelize.query(`UPDATE sucursal SET direccion = 'COMMIT' WHERE id = '${SUCURSAL()}'`),
      );
      expect(await direccionPersistida()).toBe('COMMIT');
    });

    it('el cierre normal de ejecutar sigue confirmando si fn termina bien y revirtiendo si lanza', async () => {
      const original = await restablecerDireccion();
      const confirmado = marcadorNuevo();
      await ejecutarConActor(A.id, () => sequelize.query(actualizar(confirmado)));
      expect(await direccionPersistida()).toBe(confirmado);

      await expect(
        ejecutarConActor(A.id, async () => {
          await sequelize.query(actualizar(marcadorNuevo()));
          throw new FinDePrueba('fin');
        }),
      ).rejects.toBeInstanceOf(FinDePrueba);
      expect(await direccionPersistida()).toBe(confirmado);
      expect(original).not.toBe(confirmado);
    });
  });
});
