// spec: 001-base-multitenancy (pruebas protegidas)
//
// P4 · Criterios 22, 24, 25, 27 y 28: `ContextoEmpresa` sin contexto, pool de una conexión tras commit
// y tras rollback, anidamiento con la misma y con otra empresa, y mezcla con `OperacionPlataforma`.
// La app usa un pool de UNA conexión: una fuga de contexto o una transacción anidada que pidiera otra
// conexión se notaría de inmediato (resultado ajeno o bloqueo).
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import {
  ContextoEmpresa,
  ContextoEmpresaAusenteError,
  ContextoEmpresaConflictoError,
} from '../../src/nucleo/contexto-empresa';
import {
  OperacionPlataforma,
  OperacionPlataformaAnidadaError,
  SucursalService,
} from '../../src/modulos/plataforma';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, textoUnico, type EmpresaSql } from './fabrica';

let app: INestApplication;
let contexto: ContextoEmpresa;

/**
 * Sección 002 (P10): `ContextoEmpresa.ejecutar` con el actor de sistema `prueba`, para las pruebas que
 * escriben (criterio 115: sin actor, una transacción no escribe en tablas trazadas).
 */
const ejecutarConActor = <T>(empresaId: string, fn: () => Promise<T>): Promise<T> =>
  contexto.ejecutar(empresaId, fn, { actor: { sistema: 'prueba' } });
let sucursales: SucursalService;
let operacion: OperacionPlataforma;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 1 });
  app = await crearAplicacion();
  contexto = app.get(ContextoEmpresa);
  sucursales = app.get(SucursalService);
  operacion = app.get(OperacionPlataforma);
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await plataforma?.end();
});

const ids = (filas: { id: string }[]) => filas.map((f) => f.id).sort();

/** Falla si `trabajo` no termina a tiempo (con un pool de 1, una conexión extra se queda esperando). */
async function conLimite<T>(trabajo: Promise<T>, ms = 5000): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error(`Sin terminar tras ${ms} ms (¿bloqueo?)`)),
      ms,
    );
  });
  try {
    return await Promise.race([trabajo, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}

describe('criterio 22 · usar un servicio de empresa fuera de ContextoEmpresa.ejecutar', () => {
  it('SucursalService lanza ContextoEmpresaAusenteError (no un error de la base)', async () => {
    await expect(sucursales.listar()).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    await expect(sucursales.obtener(A.sucursales[0]!.id)).rejects.toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    await expect(
      sucursales.configurar(A.sucursales[0]!.id, { direccion: 'Nueva' }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('empresaActual() lanza ContextoEmpresaAusenteError sin contexto', () => {
    expect(() => contexto.empresaActual()).toThrow(ContextoEmpresaAusenteError);
  });

  it('dentro de ejecutar, empresaActual() devuelve la empresa y el contexto desaparece al terminar', async () => {
    const dentro = await contexto.ejecutar(A.id, async () => contexto.empresaActual());
    expect(dentro).toBe(A.id);
    expect(() => contexto.empresaActual()).toThrow(ContextoEmpresaAusenteError);
    await expect(sucursales.listar()).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('ejecutar rechaza un identificador que no es UUID sin correr la función', async () => {
    let corrio = false;
    await expect(
      contexto.ejecutar('no-es-uuid', async () => {
        corrio = true;
      }),
    ).rejects.toThrow();
    expect(corrio).toBe(false);
  });
});

describe('criterio 24 · pool de una conexión: el contexto no se filtra tras confirmar', () => {
  it('commit de A, consulta sin contexto falla y luego B solo ve filas de B', async () => {
    const deA = await contexto.ejecutar(A.id, () => sucursales.listar());
    expect(ids(deA)).toEqual(ids(A.sucursales));
    expect(deA.every((s) => s.empresaId === A.id)).toBe(true);

    await expect(sucursales.listar()).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);

    const deB = await contexto.ejecutar(B.id, () => sucursales.listar());
    expect(ids(deB)).toEqual(ids(B.sucursales));
    expect(deB.every((s) => s.empresaId === B.id)).toBe(true);
  });

  it('una escritura confirmada con el contexto de A no la ve B', async () => {
    const id = A.sucursales[0]!.id;
    const direccion = textoUnico('Dirección confirmada');
    await ejecutarConActor(A.id, () => sucursales.configurar(id, { direccion }));
    expect(await contexto.ejecutar(A.id, () => sucursales.obtener(id))).toMatchObject({
      direccion,
    });
    expect(await contexto.ejecutar(B.id, () => sucursales.obtener(id))).toBeNull();
  });
});

describe('criterio 25 · pool de una conexión: el contexto no se filtra tras revertir', () => {
  it('una excepción revierte la transacción, la consulta sin contexto falla y B solo ve filas de B', async () => {
    const id = A.sucursales[1]!.id;
    const original = await contexto.ejecutar(A.id, () => sucursales.obtener(id));
    expect(original).not.toBeNull();

    const fallo = new Error(`fallo-${randomUUID()}`);
    await expect(
      ejecutarConActor(A.id, async () => {
        const lista = await sucursales.listar();
        expect(ids(lista)).toEqual(ids(A.sucursales));
        await sucursales.configurar(id, { direccion: 'No debe persistir' });
        throw fallo;
      }),
    ).rejects.toBe(fallo);

    // Lo escrito dentro de la transacción revertida no persiste.
    const { rows } = await plataforma.query('SELECT direccion FROM sucursal WHERE id = $1', [id]);
    expect(rows[0].direccion).toBe(original!.direccion);

    await expect(sucursales.listar()).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    expect(() => contexto.empresaActual()).toThrow(ContextoEmpresaAusenteError);

    const deB = await contexto.ejecutar(B.id, () => sucursales.listar());
    expect(ids(deB)).toEqual(ids(B.sucursales));
  });
});

describe('criterio 27 · anidamiento de ContextoEmpresa.ejecutar', () => {
  it('con otra empresa lanza ContextoEmpresaConflictoError y no cambia el contexto activo', async () => {
    await contexto.ejecutar(A.id, async () => {
      let corrio = false;
      await expect(
        contexto.ejecutar(B.id, async () => {
          corrio = true;
        }),
      ).rejects.toBeInstanceOf(ContextoEmpresaConflictoError);
      expect(corrio).toBe(false);
      expect(contexto.empresaActual()).toBe(A.id);
      expect(ids(await sucursales.listar())).toEqual(ids(A.sucursales));
    });
  });

  it('con la misma empresa corre dentro de la transacción existente', async () => {
    const id = A.sucursales[0]!.id;
    const direccion = textoUnico('Visible solo dentro');
    const vistaAnidada = await conLimite(
      ejecutarConActor(A.id, async () => {
        await sucursales.configurar(id, { direccion });
        // Con un pool de 1 conexión, una transacción distinta quedaría esperando; y además no vería lo no confirmado.
        return contexto.ejecutar(A.id, () => sucursales.obtener(id));
      }),
    );
    expect(vistaAnidada).toMatchObject({ id, direccion });
  });

  it('las consultas concurrentes con Promise.all dentro de un contexto comparten transacción y contexto', async () => {
    const resultado = await conLimite(
      contexto.ejecutar(A.id, async () => {
        const [lista, primera, segunda] = await Promise.all([
          sucursales.listar(),
          sucursales.obtener(A.sucursales[0]!.id),
          sucursales.obtener(A.sucursales[1]!.id),
        ]);
        return { lista, primera, segunda, actual: contexto.empresaActual() };
      }),
    );
    expect(ids(resultado.lista)).toEqual(ids(A.sucursales));
    expect(resultado.primera?.id).toBe(A.sucursales[0]!.id);
    expect(resultado.segunda?.id).toBe(A.sucursales[1]!.id);
    expect(resultado.actual).toBe(A.id);
  });
});

describe('criterio 28 · el contexto de empresa y la operación de plataforma no se mezclan', () => {
  const opciones = () => ({
    actor: textoUnico('actor-contexto'),
    motivo: 'prueba de aislamiento de contextos',
    operacion: textoUnico('operacion_prueba'),
  });

  it('OperacionPlataforma.ejecutar dentro de un contexto de empresa lanza OperacionPlataformaAnidadaError', async () => {
    const datos = opciones();
    let corrio = false;
    await contexto.ejecutar(A.id, async () => {
      await expect(
        operacion.ejecutar(datos, async () => {
          corrio = true;
        }),
      ).rejects.toBeInstanceOf(OperacionPlataformaAnidadaError);
    });
    expect(corrio).toBe(false);
    const { rows } = await plataforma.query(
      "SELECT 1 FROM auditoria WHERE origen = 'plataforma' AND accion = $1",
      [datos.operacion],
    );
    expect(rows).toEqual([]);
  });

  it('dentro de una operación de plataforma, un servicio de empresa lanza ContextoEmpresaAusenteError y no queda nada auditado', async () => {
    const datos = opciones();
    await expect(
      operacion.ejecutar(datos, async () => {
        expect(() => contexto.empresaActual()).toThrow(ContextoEmpresaAusenteError);
        return sucursales.listar();
      }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    const { rows } = await plataforma.query(
      "SELECT 1 FROM auditoria WHERE origen = 'plataforma' AND accion = $1",
      [datos.operacion],
    );
    expect(rows).toEqual([]);
  });

  it('tras una operación de plataforma el pool de la API sigue limpio: sin contexto falla y con contexto funciona', async () => {
    const datos = opciones();
    await operacion.ejecutar(datos, async () => undefined);
    await expect(sucursales.listar()).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    const lista = await contexto.ejecutar(B.id, () => sucursales.listar());
    expect(ids(lista)).toEqual(ids(B.sucursales));
  });
});
