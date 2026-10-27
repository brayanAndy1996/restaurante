// spec: 001-base-multitenancy (pruebas protegidas)
//
// Objetivo de la historia, RNF-06 y criterio 38 (falla F3 del adversarial): el texto de las consultas
// en curso de una sesión (por ejemplo, un valor literal de una sucursal de la empresa B) no debe ser
// visible para otra sesión del mismo rol con el contexto de la empresa A, ni para otro rol de
// aplicación, a través de `pg_stat_activity` ni de `pg_stat_get_activity(NULL)`. Es aceptable que la
// consulta falle con 42501 (permiso denegado) o que no devuelva el texto; nunca debe aparecer el
// marcador. Esto debe quedar así en la base que deja la preparación global (migración o db:preparar).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRES_DE_ROLES, abrirCliente } from '../utilidades';
import { crearEmpresaSql, type EmpresaSql } from './fabrica';

const SEGUNDOS_DE_ESPERA = 6;

let admin: Client;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await admin?.end();
  await plataforma?.end();
});

/** Consulta de espionaje: devuelve todas las filas de actividad como texto, o `null` si no se puede leer. */
type Espia = (cliente: Client) => Promise<string[] | 'prohibido' | 'inexistente'>;

const desdeVista: Espia = async (cliente) => {
  try {
    const { rows } = await cliente.query<{ fila: string }>(
      `SELECT to_jsonb(a)::text AS fila FROM pg_stat_activity a
        WHERE a.usename = 'restaurante_api' AND a.pid <> pg_backend_pid()`,
    );
    return rows.map((r) => r.fila);
  } catch (error) {
    if ((error as { code?: string }).code === '42501') return 'prohibido';
    throw error;
  }
};

const desdeFuncion: Espia = async (cliente) => {
  try {
    const { rows } = await cliente.query<{ fila: string }>(
      `SELECT to_jsonb(a)::text AS fila FROM pg_stat_get_activity(NULL) a
        WHERE a.pid <> pg_backend_pid()`,
    );
    return rows.map((r) => r.fila);
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === '42501') return 'prohibido';
    if (codigo === '42883' || codigo === '42P01') return 'inexistente';
    throw error;
  }
};

/**
 * Sesión 1 (restaurante_api, contexto de B) ejecuta una consulta con un marcador único y se queda
 * esperando con `pg_sleep`; mientras tanto, el `espectador` mira la actividad. Un cliente admin
 * comprueba (control) que el marcador sí estaba en la actividad en ese momento.
 */
async function observar(
  espectador: { rol: 'api' | 'plataforma'; conContexto: boolean },
  espia: Espia,
): Promise<{ vistoPorAdmin: boolean; resultado: string[] | 'prohibido' | 'inexistente' }> {
  const marcador = `marcador_${randomUUID().replace(/-/g, '')}`;
  const victima = await abrirCliente('api');
  const vigia = await abrirCliente(espectador.rol);
  let enCurso: Promise<unknown> | undefined;
  try {
    await victima.query('BEGIN');
    await victima.query("SELECT set_config('app.empresa_id', $1, true)", [B.id]);
    // Sin esperar el resultado: la consulta queda en curso durante unos segundos.
    enCurso = victima
      .query(
        `SELECT nombre FROM sucursal WHERE nombre = '${marcador}'; SELECT pg_sleep(${SEGUNDOS_DE_ESPERA})`,
      )
      .catch(() => undefined);

    // Control: un administrador ve el marcador en la actividad (la sesión 1 ya está en curso).
    let vistoPorAdmin = false;
    for (let intento = 0; intento < 30 && !vistoPorAdmin; intento++) {
      const { rows } = await admin.query<{ fila: string }>(
        `SELECT query AS fila FROM pg_stat_activity WHERE query LIKE $1 AND pid <> pg_backend_pid()`,
        [`%${marcador}%`],
      );
      vistoPorAdmin = rows.length > 0;
      if (!vistoPorAdmin) await new Promise((r) => setTimeout(r, 100));
    }

    let resultado: string[] | 'prohibido' | 'inexistente';
    if (espectador.conContexto) {
      await vigia.query('BEGIN');
      await vigia.query("SELECT set_config('app.empresa_id', $1, true)", [A.id]);
      try {
        resultado = await espia(vigia);
      } finally {
        await vigia.query('ROLLBACK').catch(() => undefined);
      }
    } else {
      resultado = await espia(vigia);
    }
    const textoVisto = Array.isArray(resultado) ? resultado.join('\n') : '';
    expect(textoVisto, 'el marcador de otra empresa es visible en la actividad').not.toContain(
      marcador,
    );
    return { vistoPorAdmin, resultado };
  } finally {
    await victima.query('ROLLBACK').catch(() => undefined);
    await enCurso;
    await victima.end();
    await vigia.end();
  }
}

describe('criterio 38 · el catálogo de actividad no filtra consultas de otra empresa', () => {
  it('restaurante_api con contexto de A no ve el texto de la consulta de B en pg_stat_activity', async () => {
    const { vistoPorAdmin } = await observar({ rol: 'api', conContexto: true }, desdeVista);
    expect(vistoPorAdmin).toBe(true);
  });

  it('restaurante_api con contexto de A no ve el texto de la consulta de B en pg_stat_get_activity(NULL)', async () => {
    const { vistoPorAdmin } = await observar({ rol: 'api', conContexto: true }, desdeFuncion);
    expect(vistoPorAdmin).toBe(true);
  });

  it(`${NOMBRES_DE_ROLES.plataforma} no ve el texto de las consultas de ${NOMBRES_DE_ROLES.api} en pg_stat_activity`, async () => {
    const { vistoPorAdmin } = await observar({ rol: 'plataforma', conContexto: false }, desdeVista);
    expect(vistoPorAdmin).toBe(true);
  });

  it(`${NOMBRES_DE_ROLES.plataforma} no ve el texto de las consultas de ${NOMBRES_DE_ROLES.api} en pg_stat_get_activity(NULL)`, async () => {
    const { vistoPorAdmin } = await observar(
      { rol: 'plataforma', conContexto: false },
      desdeFuncion,
    );
    expect(vistoPorAdmin).toBe(true);
  });
});
