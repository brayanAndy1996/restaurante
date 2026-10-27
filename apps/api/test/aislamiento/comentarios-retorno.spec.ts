// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterios 22b, 22d y 32b (falla BLOQUEANTE de la revisión final). PostgreSQL termina un comentario de
// línea `--` tanto en `\n` como en `\r` (su escáner define `newline [\n\r]`), así que el analizador de la
// guarda no puede terminarlo solo en `\n`: en `SELECT 1; --x\rSELECT set_config(...)` el `\r` cierra el
// comentario y PostgreSQL ejecuta la segunda sentencia. Dentro de `ContextoEmpresa.ejecutar(A, fn)`, por
// `CONEXION_API`, ninguna de esas variantes puede llegar a la base: `set_config`, `COMMIT`, `ROLLBACK`,
// `SET` y `ALTER ROLE` tras un comentario terminado en `\r` (o en `\r\n`) lanzan un error de la guarda,
// no un `DatabaseError`. La conexión de plataforma usa el mismo analizador (32b): `--x\rCOMMIT` dentro de
// `OperacionPlataforma.ejecutar` lanza y no deja un cambio confirmado sin auditoría.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { OperacionPlataforma } from '../../src/modulos/plataforma';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, textoUnico, type EmpresaSql } from './fabrica';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let operacion: OperacionPlataforma;
let admin: Client;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  operacion = app.get(OperacionPlataforma);
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

/** Si un `ALTER ROLE` llegara a la base, no debe quedar un valor por defecto del parámetro de contexto. */
async function limpiarRol(): Promise<void> {
  await admin?.query('ALTER ROLE restaurante_api RESET app.empresa_id').catch(() => undefined);
}

afterEach(async () => {
  await limpiarRol();
});

afterAll(async () => {
  await limpiarRol();
  await app?.close();
  await admin?.end();
  await plataforma?.end();
});

class FinDePrueba extends Error {}

type Fila = { id: string; nombre: string };
const consulta = () =>
  sequelize.query<Fila>('SELECT id, nombre FROM sucursal', { type: QueryTypes.SELECT });
const nombres = (filas: Fila[]) => filas.map((f) => f.nombre).sort();
const nombresDe = (empresa: EmpresaSql) => empresa.sucursales.map((s) => s.nombre).sort();

async function capturar(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error ?? new Error('rechazo sin error');
  }
  return undefined;
}

/** Dirección de una sucursal vista por el administrador (salta la RLS), fuera de la transacción de la API. */
async function direccionPersistida(sucursalId: string): Promise<string> {
  const { rows } = await admin.query<{ direccion: string }>(
    'SELECT direccion FROM sucursal WHERE id = $1',
    [sucursalId],
  );
  return rows[0]!.direccion;
}

async function restablecerDireccion(sucursalId: string): Promise<string> {
  const original = `Calle original ${randomUUID().slice(0, 8)}`;
  await plataforma.query('UPDATE sucursal SET direccion = $1 WHERE id = $2', [
    original,
    sucursalId,
  ]);
  return original;
}

const marcadorNuevo = () => `dir_${randomUUID().replace(/-/g, '')}`;
const actualizar = (sucursalId: string, marcador: string) =>
  `UPDATE sucursal SET direccion = '${marcador}' WHERE id = '${sucursalId}'`;

describe('criterio 22b/22d · set_config tras un comentario `--` terminado en \\r no cambia el contexto', () => {
  const variantes = () => [
    {
      nombre: 'SELECT 1; --x\\rSELECT set_config(...)',
      sql: `SELECT 1; --x\rSELECT set_config('app.empresa_id','${B.id}',true)`,
    },
    {
      nombre: 'SELECT 1; --x\\r\\nSELECT set_config(...)',
      sql: `SELECT 1; --x\r\nSELECT set_config('app.empresa_id','${B.id}',true)`,
    },
    {
      nombre: '--x\\rSELECT set_config(...) (sin sentencia previa)',
      sql: `--x\rSELECT set_config('app.empresa_id','${B.id}',true)`,
    },
  ];

  it.each([0, 1, 2])('variante %i: lanza un error y el contexto sigue siendo A', async (indice) => {
    const { nombre, sql } = variantes()[indice]!;
    const direccionB = await direccionPersistida(B.sucursales[0]!.id);
    let capturado: unknown;
    let filas: Fila[] = [];
    let afectadasEnB: Fila[] = [];
    let empresaActual: string | undefined;

    await contexto.ejecutar(A.id, async () => {
      capturado = await capturar(sequelize.query(sql));
      // Tras capturar el error, el contexto no pudo cambiar: solo se ven filas de A…
      filas = await consulta();
      // …y una escritura contra una sucursal de B no toca ninguna fila.
      afectadasEnB = await sequelize.query<Fila>(
        `UPDATE sucursal SET direccion = 'tomada_${marcadorNuevo()}' WHERE id = '${B.sucursales[0]!.id}' RETURNING id, nombre`,
        { type: QueryTypes.SELECT },
      );
      empresaActual = contexto.empresaActual();
    });

    expect(capturado, `${nombre}: la sentencia se dejó pasar a la base`).toBeInstanceOf(Error);
    expect(capturado, `${nombre}: la sentencia llegó a la base`).not.toBeInstanceOf(DatabaseError);
    expect(nombres(filas), `${nombre}: el contexto cambió a B`).toEqual(nombresDe(A));
    expect(afectadasEnB, `${nombre}: el UPDATE alcanzó una sucursal de B`).toHaveLength(0);
    expect(empresaActual).toBe(A.id);
    // El administrador (salta la RLS) confirma que B no cambió.
    expect(await direccionPersistida(B.sucursales[0]!.id)).toBe(direccionB);
  });
});

describe('criterio 22b/22d · sentencias prohibidas tras un comentario `--` terminado en \\r lanzan antes de la base', () => {
  const PROHIBIDAS: { nombre: string; sql: () => string }[] = [
    { nombre: 'SELECT 1; --x\\rCOMMIT', sql: () => 'SELECT 1; --x\rCOMMIT' },
    { nombre: 'SELECT 1; --x\\rROLLBACK', sql: () => 'SELECT 1; --x\rROLLBACK' },
    { nombre: 'SELECT 1; --x\\rSET x = 1', sql: () => 'SELECT 1; --x\rSET x = 1' },
    {
      nombre: "SELECT 1; --x\\rALTER ROLE restaurante_api SET app.empresa_id = '<B>'",
      sql: () => `SELECT 1; --x\rALTER ROLE restaurante_api SET app.empresa_id = '${B.id}'`,
    },
    { nombre: 'SELECT 1; --x\\r\\nCOMMIT', sql: () => 'SELECT 1; --x\r\nCOMMIT' },
    { nombre: 'SELECT 1; --x\\r\\nSET x = 1', sql: () => 'SELECT 1; --x\r\nSET x = 1' },
    { nombre: '--x\\rCOMMIT (sin sentencia previa)', sql: () => '--x\rCOMMIT' },
    { nombre: '--x\\rROLLBACK (sin sentencia previa)', sql: () => '--x\rROLLBACK' },
    { nombre: '--x\\r\\nCOMMIT (sin sentencia previa)', sql: () => '--x\r\nCOMMIT' },
    { nombre: 'SELECT 1; --x\\r\\r\\nCOMMIT (\\r doble)', sql: () => 'SELECT 1; --x\r\r\nCOMMIT' },
    { nombre: 'SELECT 1; --x\\r  COMMIT (con espacios)', sql: () => 'SELECT 1; --x\r  COMMIT' },
    { nombre: 'SELECT 1; --\\rCOMMIT (comentario vacío)', sql: () => 'SELECT 1; --\rCOMMIT' },
  ];

  it.each(PROHIBIDAS)('$nombre lanza un error de la guarda, no de la base', async ({ sql }) => {
    let capturado: unknown;
    await contexto
      .ejecutar(A.id, async () => {
        capturado = await capturar(sequelize.query(sql()));
      })
      .catch(() => undefined);
    expect(capturado, 'la sentencia se dejó pasar a la base').toBeInstanceOf(Error);
    // No es un error de PostgreSQL: la guarda la rechazó antes de enviarla.
    expect(capturado, 'la sentencia llegó a la base').not.toBeInstanceOf(DatabaseError);
  });

  it('ALTER ROLE tras `\\r`: no deja un valor por defecto del parámetro de contexto en el rol', async () => {
    await contexto
      .ejecutar(A.id, async () => {
        await capturar(
          sequelize.query(
            `SELECT 1; --x\rALTER ROLE restaurante_api SET app.empresa_id = '${B.id}'`,
          ),
        );
      })
      .catch(() => undefined);
    const { rows } = await admin.query<{ configuracion: string[] | null }>(
      'SELECT rolconfig AS configuracion FROM pg_roles WHERE rolname = $1',
      ['restaurante_api'],
    );
    const configuracion = (rows[0]?.configuracion ?? []).filter((c) =>
      c.startsWith('app.empresa_id='),
    );
    expect(configuracion, 'el ALTER ROLE llegó a la base').toEqual([]);
  });
});

describe('criterio 22b · atomicidad: `--x\\rCOMMIT` y `--x\\rROLLBACK` no cierran la transacción de ejecutar', () => {
  it('UPDATE de una sucursal de A, `SELECT 1; --x\\rCOMMIT` capturado y fn lanza: el UPDATE no queda', async () => {
    const sucursal = A.sucursales[0]!.id;
    const original = await restablecerDireccion(sucursal);
    const marcador = marcadorNuevo();
    await expect(
      contexto.ejecutar(A.id, async () => {
        await sequelize.query(actualizar(sucursal, marcador));
        await sequelize.query('SELECT 1; --x\rCOMMIT').catch(() => undefined);
        throw new FinDePrueba('fin');
      }),
    ).rejects.toBeInstanceOf(FinDePrueba);
    expect(await direccionPersistida(sucursal)).toBe(original);
  });

  it('UPDATE y `UPDATE …; --x\\rCOMMIT` en una sola sentencia, capturado y fn lanza: el UPDATE no queda', async () => {
    const sucursal = A.sucursales[0]!.id;
    const original = await restablecerDireccion(sucursal);
    const marcador = marcadorNuevo();
    await expect(
      contexto.ejecutar(A.id, async () => {
        await sequelize
          .query(`${actualizar(sucursal, marcador)}; --x\rCOMMIT`)
          .catch(() => undefined);
        throw new FinDePrueba('fin');
      }),
    ).rejects.toBeInstanceOf(FinDePrueba);
    expect(await direccionPersistida(sucursal)).toBe(original);
  });

  it('UPDATE, `SELECT 1; --x\\rROLLBACK` capturado y fn termina bien: el UPDATE queda', async () => {
    const sucursal = A.sucursales[1]!.id;
    await restablecerDireccion(sucursal);
    const marcador = marcadorNuevo();
    await contexto.ejecutar(A.id, async () => {
      await sequelize.query(actualizar(sucursal, marcador));
      await sequelize.query('SELECT 1; --x\rROLLBACK').catch(() => undefined);
    });
    expect(await direccionPersistida(sucursal)).toBe(marcador);
  });
});

describe('controles · sentencias permitidas con comentarios `--` terminados en \\r o \\r\\n funcionan', () => {
  it('`SELECT 1 AS x --comentario\\r` (el comentario llega hasta el final) funciona', async () => {
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query<{ x: number }>('SELECT 1 AS x --comentario\r', { type: QueryTypes.SELECT }),
    );
    expect(filas).toEqual([{ x: 1 }]);
  });

  it('`SELECT 1; --x\\r\\nSELECT 2` (sentencia permitida tras el comentario) funciona', async () => {
    const resultado = await contexto.ejecutar(A.id, () =>
      sequelize.query('SELECT 1 AS a; --x\r\nSELECT 2 AS b'),
    );
    expect(resultado).toBeDefined();
  });

  it('`SELECT 1; --x\\rSELECT 2` (sentencia permitida tras `\\r`) funciona', async () => {
    const resultado = await contexto.ejecutar(A.id, () =>
      sequelize.query('SELECT 1 AS a; --x\rSELECT 2 AS b'),
    );
    expect(resultado).toBeDefined();
  });

  it("un literal con `--` y `\\r` dentro no se toma por comentario: `SELECT 'a --x\\rCOMMIT'` funciona", async () => {
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query<{ x: string }>("SELECT 'a --x\rCOMMIT' AS x", { type: QueryTypes.SELECT }),
    );
    expect(filas).toEqual([{ x: 'a --x\rCOMMIT' }]);
  });

  it('el contexto sigue siendo A y solo ve sucursales de A tras los controles', async () => {
    const filas = await contexto.ejecutar(A.id, async () => {
      await sequelize.query('SELECT 1 AS a; --x\r\nSELECT 2 AS b');
      return consulta();
    });
    expect(nombres(filas)).toEqual(nombresDe(A));
  });
});

describe('criterio 32b · la conexión de plataforma interpreta `\\r` como fin de comentario', () => {
  const sequelizeDe = (tx: unknown) => (tx as { sequelize: Sequelize }).sequelize;

  async function nombreActual(empresaId: string): Promise<string> {
    const { rows } = await admin.query<{ nombre: string }>(
      'SELECT nombre FROM empresa WHERE id = $1',
      [empresaId],
    );
    return rows[0]!.nombre;
  }

  async function auditorias(actor: string): Promise<number> {
    const { rows } = await admin.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM auditoria_plataforma WHERE actor = $1',
      [actor],
    );
    return Number(rows[0]!.n);
  }

  it('UPDATE y `SELECT 1; --x\\rCOMMIT` dentro de OperacionPlataforma.ejecutar: lanza y no queda cambio sin auditoría', async () => {
    const empresaId = B.id;
    const nombreOriginal = await nombreActual(empresaId);
    const nombreNuevo = textoUnico('Cambiado-retorno');
    const actor = textoUnico('actor-retorno');

    const rechazo = await capturar(
      operacion.ejecutar(
        { actor, motivo: 'Prueba de comentario con retorno', operacion: 'prueba_retorno' },
        async (tx) => {
          const sql = sequelizeDe(tx);
          await sql.query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
            transaction: tx,
            replacements: { nombre: nombreNuevo, id: empresaId },
          });
          await sql.query('SELECT 1; --x\rCOMMIT', { transaction: tx });
        },
      ),
    );

    const nombre = await nombreActual(empresaId);
    const cantidad = await auditorias(actor);
    const estado = JSON.stringify({ nombre, auditorias: cantidad, rechazo: String(rechazo) });
    expect(rechazo, `ejecutar no rechazó: ${estado}`).toBeDefined();
    // La guarda la rechazó antes de la base.
    expect(rechazo, `la sentencia llegó a la base: ${estado}`).not.toBeInstanceOf(DatabaseError);
    // No queda cambio (ni auditoría): nunca un cambio confirmado sin su fila de auditoría.
    expect(nombre === nombreNuevo && cantidad === 0, `cambio sin auditoría: ${estado}`).toBe(false);
    expect(nombre, `el cambio quedó confirmado: ${estado}`).toBe(nombreOriginal);
    expect(cantidad).toBe(0);
  });

  it('control: `SELECT 1 AS x; --x\\r\\nSELECT 2 AS y` dentro de OperacionPlataforma.ejecutar funciona y deja su auditoría', async () => {
    const actor = textoUnico('actor-retorno-control');
    await operacion.ejecutar(
      { actor, motivo: 'Control de comentario con retorno', operacion: 'prueba_retorno_control' },
      async (tx) => {
        await sequelizeDe(tx).query('SELECT 1 AS x; --x\r\nSELECT 2 AS y', { transaction: tx });
      },
    );
    expect(await auditorias(actor)).toBe(1);
  });
});
