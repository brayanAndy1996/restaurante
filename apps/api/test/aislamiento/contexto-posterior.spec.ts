// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 27b (falla de la ronda 3 del adversarial): después de que `ContextoEmpresa.ejecutar`
// (confirmado o revertido) o `OperacionPlataforma.ejecutar` terminó, el código que sigue corriendo con
// su almacén asíncrono (una promesa o un temporizador que sobrevive a `fn`, como un efecto secundario
// lanzado desde `fn` que corre después de confirmar) no está dentro de ningún contexto:
// - `empresaActual()` lanza `ContextoEmpresaAusenteError`;
// - una consulta cruda por la conexión de la API sin abrir contexto lanza `ContextoEmpresaAusenteError`;
// - `ContextoEmpresa.ejecutar` (misma empresa u otra) abre una transacción nueva y funciona, y solo ve
//   filas de la empresa pedida (sin `ContextoEmpresaConflictoError`);
// - `OperacionPlataforma.ejecutar` funciona y deja su auditoría (sin `OperacionPlataformaAnidadaError`).
// Lo mismo vale tras una `OperacionPlataforma.ejecutar` terminada.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { OperacionPlataforma } from '../../src/modulos/plataforma';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa, ContextoEmpresaAusenteError } from '../../src/nucleo/contexto-empresa';
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

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await plataforma?.end();
});

type Fila = { id: string; nombre: string };
const consulta = () =>
  sequelize.query<Fila>('SELECT id, nombre FROM sucursal', { type: QueryTypes.SELECT });
const nombres = (filas: Fila[]) => filas.map((f) => f.nombre).sort();
const nombresDe = (empresa: EmpresaSql) => empresa.sucursales.map((s) => s.nombre).sort();

/** Cómo termina el contexto que origina la promesa derivada. */
type Origen =
  'ejecutar confirmado' | 'ejecutar revertido' | 'plataforma ejecutar' | 'plataforma consultar';
const ORIGENES: Origen[] = [
  'ejecutar confirmado',
  'ejecutar revertido',
  'plataforma ejecutar',
  'plataforma consultar',
];

/**
 * Lanza `trabajo` desde dentro de un contexto (`origen`), lo deja esperando una señal y la libera solo
 * cuando el contexto ya terminó. `trabajo` corre con el almacén asíncrono del contexto terminado.
 */
async function despuesDe<T>(origen: Origen, trabajo: () => Promise<T>): Promise<T> {
  let liberar!: () => void;
  const senal = new Promise<void>((resolver) => (liberar = resolver));
  let derivada!: Promise<T>;
  const lanzar = () => {
    derivada = (async () => {
      await senal;
      return trabajo();
    })();
    derivada.catch(() => undefined); // evita un rechazo sin atender mientras el origen termina
  };

  if (origen === 'ejecutar confirmado') {
    await contexto.ejecutar(A.id, async () => {
      lanzar();
      await consulta(); // el contexto estuvo vivo y se usó
    });
  } else if (origen === 'ejecutar revertido') {
    await expect(
      contexto.ejecutar(A.id, async () => {
        lanzar();
        await consulta();
        throw new Error('fn revierte');
      }),
    ).rejects.toThrow('fn revierte');
  } else if (origen === 'plataforma ejecutar') {
    await operacion.ejecutar(
      { actor: textoUnico('actor'), motivo: 'origen de promesa derivada', operacion: 'prueba_27b' },
      async () => {
        lanzar();
      },
    );
  } else {
    await operacion.consultar(async () => {
      lanzar();
    });
  }
  liberar();
  return derivada;
}

describe.each(ORIGENES)('criterio 27b · código que sobrevive a: %s', (origen) => {
  it('(a) empresaActual() lanza ContextoEmpresaAusenteError', async () => {
    const resultado = await despuesDe(origen, async () => {
      try {
        return { empresa: contexto.empresaActual() };
      } catch (error) {
        return { error };
      }
    });
    expect(resultado.error, `empresaActual() devolvió ${JSON.stringify(resultado)}`).toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
  });

  it('(a2) una consulta cruda sin abrir contexto lanza ContextoEmpresaAusenteError', async () => {
    const resultado = await despuesDe(origen, async () => {
      try {
        return { filas: await consulta() };
      } catch (error) {
        return { error };
      }
    });
    expect(resultado.error, `la consulta devolvió ${JSON.stringify(resultado)}`).toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
  });

  it('(b) ejecutar(A) abre una transacción nueva y solo ve sucursales de A', async () => {
    const filas = await despuesDe(origen, () => contexto.ejecutar(A.id, () => consulta()));
    expect(nombres(filas)).toEqual(nombresDe(A));
  });

  it('(c) ejecutar(B) abre una transacción nueva y solo ve sucursales de B', async () => {
    const filas = await despuesDe(origen, () => contexto.ejecutar(B.id, () => consulta()));
    expect(nombres(filas)).toEqual(nombresDe(B));
  });

  it('(d) OperacionPlataforma.ejecutar funciona y deja su auditoría', async () => {
    const actor = textoUnico('actor-derivado');
    const resultado = await despuesDe(origen, () =>
      operacion.ejecutar(
        { actor, motivo: 'desde una promesa derivada', operacion: 'prueba_27b_derivada' },
        async () => 'hecho',
      ),
    );
    expect(resultado).toBe('hecho');
    const { rows } = await admin.query('SELECT 1 FROM auditoria_plataforma WHERE actor = $1', [
      actor,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('(d2) OperacionPlataforma.consultar funciona', async () => {
    const resultado = await despuesDe(origen, () => operacion.consultar(async () => 'leído'));
    expect(resultado).toBe('leído');
  });

  it('(e) después de usar el contexto nuevo, la promesa derivada sigue sin contexto propio', async () => {
    const resultado = await despuesDe(origen, async () => {
      await contexto.ejecutar(B.id, () => consulta());
      try {
        return { empresa: contexto.empresaActual() };
      } catch (error) {
        return { error };
      }
    });
    expect(resultado.error).toBeInstanceOf(ContextoEmpresaAusenteError);
  });
});

describe('criterio 27b · un temporizador que sigue vivo tras ejecutar', () => {
  it('un setTimeout lanzado desde fn puede abrir ejecutar(A) y ejecutar(B) cuando fn ya terminó', async () => {
    const resultado = new Promise<{ a: string[]; b: string[] }>((resolver, rechazar) => {
      void contexto.ejecutar(A.id, async () => {
        setTimeout(() => {
          void (async () => {
            const a = await contexto.ejecutar(A.id, () => consulta());
            const b = await contexto.ejecutar(B.id, () => consulta());
            return { a: nombres(a), b: nombres(b) };
          })().then(resolver, rechazar);
        }, 50);
      });
    });
    expect(await resultado).toEqual({ a: nombresDe(A), b: nombresDe(B) });
  });

  it('un setTimeout lanzado desde fn puede abrir OperacionPlataforma.ejecutar cuando fn ya terminó', async () => {
    const actor = textoUnico('actor-temporizador');
    const resultado = new Promise<string>((resolver, rechazar) => {
      void contexto.ejecutar(A.id, async () => {
        setTimeout(() => {
          operacion
            .ejecutar(
              { actor, motivo: 'temporizador', operacion: 'prueba_27b_timer' },
              async () => 'ok',
            )
            .then(resolver, rechazar);
        }, 50);
      });
    });
    expect(await resultado).toBe('ok');
    const { rows } = await admin.query('SELECT 1 FROM auditoria_plataforma WHERE actor = $1', [
      actor,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe('criterio 27b · controles: dentro del contexto vivo la regla de anidamiento no cambia', () => {
  it('dentro de ejecutar(A), empresaActual() es A y OperacionPlataforma.ejecutar sigue prohibido', async () => {
    await contexto.ejecutar(A.id, async () => {
      expect(contexto.empresaActual()).toBe(A.id);
      await expect(
        operacion.ejecutar({ actor: 'x', motivo: 'y', operacion: 'z' }, async () => undefined),
      ).rejects.toThrow();
      await expect(contexto.ejecutar(B.id, async () => undefined)).rejects.toThrow();
    });
  });
});
