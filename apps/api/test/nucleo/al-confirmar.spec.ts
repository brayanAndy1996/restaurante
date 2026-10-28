// Pruebas del desarrollador (no protegidas) de I-1: `ContextoEmpresa.alConfirmar` corre los efectos solo
// después de que el COMMIT propio volvió sin error (no con `afterCommit` de Sequelize, que corre también
// cuando el COMMIT falla), cada efecto aislado, y en contextos anidados al confirmar la transacción externa.
import { Logger, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import {
  ContextoEmpresa,
  ContextoEmpresaAusenteError,
  ContextoEmpresaConflictoError,
} from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba, NOMBRES_DE_ROLES } from '../utilidades';
import { crearEmpresaSql, errorDe, type EmpresaSql } from '../aislamiento/fabrica';

// Esquema propio: `public` solo admite tablas con RLS (catálogo del criterio 38) y la guarda de la API
// no deja crear tablas desde `fn`. La tabla tiene una restricción UNIQUE diferida: se viola al confirmar.
const ESQUEMA = `prueba_efectos_${process.pid}`;
const TABLA = `${ESQUEMA}.diferida`;

let app: INestApplication;
let contexto: ContextoEmpresa;
let sequelize: Sequelize;
let plataforma: Client;
let admin: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ empresaPorHeader: false, poolMax: 2 });
  app = await crearAplicacion({ logger: false });
  contexto = app.get(ContextoEmpresa);
  sequelize = app.get<Sequelize>(CONEXION_API);
  plataforma = await abrirCliente('plataforma');
  admin = await abrirCliente('admin');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
  await admin.query(`CREATE SCHEMA ${ESQUEMA}`);
  await admin.query(
    `CREATE TABLE ${TABLA} (marca text NOT NULL, valor int NOT NULL,
       CONSTRAINT diferida_valor_unico UNIQUE (valor) DEFERRABLE INITIALLY DEFERRED)`,
  );
  await admin.query(`GRANT USAGE ON SCHEMA ${ESQUEMA} TO ${NOMBRES_DE_ROLES.api}`);
  await admin.query(`GRANT SELECT, INSERT ON ${TABLA} TO ${NOMBRES_DE_ROLES.api}`);
});

afterAll(async () => {
  await admin?.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  await app?.close();
  for (const c of [plataforma, admin]) await c?.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Inserta una fila dentro del contexto activo. */
const insertar = (marca: string, valor: number) =>
  sequelize.query(`INSERT INTO ${TABLA} (marca, valor) VALUES ($1, $2)`, { bind: [marca, valor] });

/** Valor único por prueba (la tabla es compartida por todas). */
let siguiente = 1_000;
const valorNuevo = () => ++siguiente;

const hayFila = async (marca: string) =>
  (await admin.query(`SELECT 1 FROM ${TABLA} WHERE marca = $1`, [marca])).rowCount;

describe('alConfirmar: confirmación y reversión', () => {
  it('con COMMIT exitoso el efecto corre una vez, con la fila ya confirmada y fuera de la transacción', async () => {
    const marca = randomUUID();
    const efecto = vi.fn(async () => {
      // La fila ya es visible desde otra conexión: el efecto corre después del COMMIT.
      expect(await hayFila(marca)).toBe(1);
    });
    const resultado = await contexto.ejecutar(A.id, async () => {
      await insertar(marca, valorNuevo());
      contexto.alConfirmar(efecto);
      expect(efecto).not.toHaveBeenCalled(); // todavía dentro de la transacción
      return 'listo';
    });
    expect(resultado).toBe('listo');
    expect(efecto).toHaveBeenCalledTimes(1);
    // Los efectos corren sin contexto: no se pueden hacer consultas con la empresa de la operación.
    await contexto.ejecutar(A.id, async () => undefined);
    expect(efecto).toHaveBeenCalledTimes(1);
  });

  it('los efectos corren en orden de registro y `ejecutar` espera a los asíncronos', async () => {
    const orden: string[] = [];
    await contexto.ejecutar(A.id, async () => {
      contexto.alConfirmar(async () => {
        await new Promise((r) => setTimeout(r, 20));
        orden.push('uno');
      });
      contexto.alConfirmar(() => {
        orden.push('dos');
      });
    });
    expect(orden).toEqual(['uno', 'dos']);
  });

  it('si fn lanza (ROLLBACK) el efecto no corre y la fila no queda', async () => {
    const marca = randomUUID();
    const efecto = vi.fn();
    const error = await errorDe(
      contexto.ejecutar(A.id, async () => {
        await insertar(marca, valorNuevo());
        contexto.alConfirmar(efecto);
        throw new Error('fallo de fn');
      }),
    );
    expect(error.message).toBe('fallo de fn');
    expect(efecto).not.toHaveBeenCalled();
    expect(await hayFila(marca)).toBe(0);
  });

  it('si el COMMIT falla (restricción diferida) el efecto no corre, el error se propaga y no queda nada', async () => {
    const marca = randomUUID();
    const valor = valorNuevo();
    const efecto = vi.fn();
    const error = await errorDe(
      contexto.ejecutar(A.id, async () => {
        // Cada INSERT pasa porque la restricción es diferida; el duplicado se detecta al confirmar.
        await insertar(marca, valor);
        await insertar(marca, valor);
        contexto.alConfirmar(efecto);
      }),
    );
    expect((error as { original?: { code?: string } }).original?.code ?? error.code).toBe('23505');
    expect(efecto).not.toHaveBeenCalled();
    expect(await hayFila(marca)).toBe(0);
    // La conexión quedó sana: una operación siguiente confirma y corre su efecto.
    const despues = vi.fn();
    await contexto.ejecutar(A.id, async () => contexto.alConfirmar(despues));
    expect(despues).toHaveBeenCalledTimes(1);
  });

  it('el efecto registrado en una operación no corre con la confirmación de otra', async () => {
    const deA = vi.fn();
    const deB = vi.fn();
    await Promise.all([
      contexto.ejecutar(A.id, async () => contexto.alConfirmar(deA)),
      contexto.ejecutar(B.id, async () => contexto.alConfirmar(deB)),
    ]);
    expect(deA).toHaveBeenCalledTimes(1);
    expect(deB).toHaveBeenCalledTimes(1);
  });
});

describe('alConfirmar: aislamiento de los efectos', () => {
  it('un efecto que lanza se registra en el log, no se propaga y no impide a los demás ni el resultado', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const antes = vi.fn();
    const despues = vi.fn();
    const resultado = await contexto.ejecutar(A.id, async () => {
      contexto.alConfirmar(antes);
      contexto.alConfirmar(() => {
        throw new Error('efecto roto');
      });
      contexto.alConfirmar(despues);
      return 42;
    });
    expect(resultado).toBe(42);
    expect(antes).toHaveBeenCalledTimes(1);
    expect(despues).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[1])).toContain('efecto roto');
  });

  it('un efecto asíncrono que rechaza también se registra y no se propaga', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const despues = vi.fn();
    await contexto.ejecutar(A.id, async () => {
      contexto.alConfirmar(async () => {
        throw new Error('rechazo asíncrono');
      });
      contexto.alConfirmar(despues);
    });
    expect(despues).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('un efecto que rechaza con algo que no es un Error también se registra', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await contexto.ejecutar(A.id, async () => {
      contexto.alConfirmar(() => Promise.reject('texto suelto'));
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toBe('texto suelto');
  });

  it('el efecto que intenta usar el contexto después de confirmar recibe ContextoEmpresaAusenteError (registrado, no propagado)', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let capturado: unknown;
    await contexto.ejecutar(A.id, async () => {
      contexto.alConfirmar(() => {
        try {
          contexto.empresaActual();
        } catch (error) {
          capturado = error;
        }
      });
    });
    expect(capturado).toBeInstanceOf(ContextoEmpresaAusenteError);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('alConfirmar: contexto', () => {
  it('fuera de un contexto lanza ContextoEmpresaAusenteError', () => {
    expect(() => contexto.alConfirmar(() => undefined)).toThrow(ContextoEmpresaAusenteError);
  });

  it('un efecto registrado tras terminar el contexto (promesa diferida) lanza y no corre', async () => {
    const efecto = vi.fn();
    let diferida: Promise<unknown> = Promise.resolve();
    await contexto.ejecutar(A.id, async () => {
      diferida = new Promise((resolver) =>
        setTimeout(() => {
          try {
            contexto.alConfirmar(efecto);
            resolver('registró');
          } catch (error) {
            resolver(error);
          }
        }, 30),
      );
    });
    expect(await diferida).toBeInstanceOf(ContextoEmpresaAusenteError);
    expect(efecto).not.toHaveBeenCalled();
  });

  it('contexto anidado (misma empresa): el efecto corre al confirmar la transacción externa, no la interna', async () => {
    const marca = randomUUID();
    const efecto = vi.fn(async () => {
      expect(await hayFila(marca)).toBe(1);
    });
    let tras: number | undefined;
    await contexto.ejecutar(A.id, async () => {
      await contexto.ejecutar(A.id, async () => {
        await insertar(marca, valorNuevo());
        contexto.alConfirmar(efecto);
      });
      tras = efecto.mock.calls.length; // la interna terminó pero la externa sigue abierta
      expect(await hayFila(marca)).toBe(0);
    });
    expect(tras).toBe(0);
    expect(efecto).toHaveBeenCalledTimes(1);
  });

  it('contexto anidado: si la externa revierte, el efecto de la interna no corre', async () => {
    const efecto = vi.fn();
    await errorDe(
      contexto.ejecutar(A.id, async () => {
        await contexto.ejecutar(A.id, async () => contexto.alConfirmar(efecto));
        throw new Error('la externa falla');
      }),
    );
    expect(efecto).not.toHaveBeenCalled();
  });

  it('contexto anidado: si el COMMIT de la externa falla, el efecto de la interna no corre', async () => {
    const efecto = vi.fn();
    const valor = valorNuevo();
    await errorDe(
      contexto.ejecutar(A.id, async () => {
        await contexto.ejecutar(A.id, async () => {
          await insertar('anidado', valor);
          await insertar('anidado', valor);
          contexto.alConfirmar(efecto);
        });
      }),
    );
    expect(efecto).not.toHaveBeenCalled();
  });

  it('otra empresa dentro del contexto sigue siendo un conflicto y no deja efectos', async () => {
    const efecto = vi.fn();
    const error = await errorDe(
      contexto.ejecutar(A.id, async () => {
        await contexto.ejecutar(B.id, async () => contexto.alConfirmar(efecto));
      }),
    );
    expect(error).toBeInstanceOf(ContextoEmpresaConflictoError);
    expect(efecto).not.toHaveBeenCalled();
  });
});
