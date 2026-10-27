// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 38c (falla F7 del adversarial, ronda 2): todas las conexiones de la API comparten el rol
// `restaurante_api` (y las de plataforma, `restaurante_plataforma`). PostgreSQL deja que un backend
// señale a otro del mismo rol (`pg_terminate_backend`, `pg_cancel_backend`), así que una sesión con el
// contexto de la empresa A podría cortar la consulta o la conexión de una sesión con el contexto de B.
// Esperado: ambas funciones fallan con permiso denegado (42501) y la sesión víctima sigue viva.
// Además, el catálogo de estadísticas por backend (`pg_stat_get_backend_*`) no debe revelar las
// sesiones de otras conexiones. Debe quedar así en la base que deja la preparación global.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirCliente, type RolDePrueba } from '../utilidades';
import { crearEmpresaSql, errorDe, type EmpresaSql } from './fabrica';

const SEGUNDOS_DE_ESPERA = 10;

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

/** Sesión que se queda ejecutando `pg_sleep` (sin esperarla) y sus ayudantes de limpieza. */
interface Victima {
  cliente: Client;
  pid: number;
  /** Marcador único en el texto de la consulta en curso, para localizarla en el catálogo. */
  marcador: string;
  /** Resultado de la consulta en curso (nunca rechaza). */
  enCurso: Promise<{ error?: { code?: string } }>;
}

async function abrirVictima(rol: 'api' | 'plataforma', empresaId: string | null): Promise<Victima> {
  const cliente = await abrirCliente(rol);
  const { rows } = await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const pid = rows[0]!.pid;
  const marcador = `senal_${randomUUID().replace(/-/g, '')}`;
  if (empresaId !== null) {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId]);
  }
  // Sin esperar el resultado: la consulta queda en curso unos segundos.
  const enCurso = cliente
    .query(`SELECT '${marcador}' AS m, pg_sleep(${SEGUNDOS_DE_ESPERA})`)
    .then(() => ({}) as { error?: { code?: string } })
    .catch((error: { code?: string }) => ({ error }));
  // Espera a que el administrador la vea activa.
  for (let intento = 0; intento < 50; intento++) {
    const { rowCount } = await admin.query(
      `SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND state = 'active' AND query LIKE $2`,
      [pid, `%${marcador}%`],
    );
    if (rowCount) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { cliente, pid, marcador, enCurso };
}

/** Cierra la víctima: el administrador cancela el sleep si sigue en curso y cierra la conexión. */
async function cerrarVictima(victima: Victima): Promise<void> {
  await admin.query('SELECT pg_cancel_backend($1)', [victima.pid]).catch(() => undefined);
  await victima.enCurso;
  await victima.cliente.query('ROLLBACK').catch(() => undefined);
  await victima.cliente.end().catch(() => undefined);
}

/** Confirma, desde el administrador, que la sesión víctima sigue conectada y con su sleep en curso. */
async function victimaSigueViva(victima: Victima): Promise<boolean> {
  const { rows } = await admin.query<{ state: string; query: string }>(
    'SELECT state, query FROM pg_stat_activity WHERE pid = $1',
    [victima.pid],
  );
  return (
    rows.length === 1 && rows[0]!.state === 'active' && rows[0]!.query.includes(victima.marcador)
  );
}

const escenarios: {
  nombre: string;
  atacante: 'api' | 'plataforma';
  atacanteConContexto: boolean;
  victima: 'api' | 'plataforma';
}[] = [
  {
    nombre:
      'restaurante_api con contexto de A contra una sesión de restaurante_api con contexto de B',
    atacante: 'api',
    atacanteConContexto: true,
    victima: 'api',
  },
  {
    nombre: 'restaurante_plataforma contra una sesión de restaurante_api con contexto de B',
    atacante: 'plataforma',
    atacanteConContexto: false,
    victima: 'api',
  },
  {
    nombre: 'restaurante_plataforma contra otra sesión de restaurante_plataforma',
    atacante: 'plataforma',
    atacanteConContexto: false,
    victima: 'plataforma',
  },
];

async function abrirAtacante(rol: RolDePrueba, conContexto: boolean): Promise<Client> {
  const atacante = await abrirCliente(rol);
  if (conContexto) {
    await atacante.query('BEGIN');
    await atacante.query("SELECT set_config('app.empresa_id', $1, true)", [A.id]);
  }
  return atacante;
}

describe('criterio 38c · una sesión no puede señalar (terminar ni cancelar) a otra del mismo rol', () => {
  for (const escenario of escenarios) {
    describe(escenario.nombre, () => {
      let victima: Victima;
      let atacante: Client;

      beforeAll(async () => {
        victima = await abrirVictima(escenario.victima, escenario.victima === 'api' ? B.id : null);
        atacante = await abrirAtacante(escenario.atacante, escenario.atacanteConContexto);
      });

      afterAll(async () => {
        await atacante?.query('ROLLBACK').catch(() => undefined);
        await atacante?.end().catch(() => undefined);
        if (victima) await cerrarVictima(victima);
      });

      it('control: el administrador ve a la víctima activa con el sleep en curso', async () => {
        expect(await victimaSigueViva(victima)).toBe(true);
      });

      it('pg_cancel_backend(pid) falla con permiso denegado (42501)', async () => {
        const error = await errorDe(atacante.query('SELECT pg_cancel_backend($1)', [victima.pid]));
        expect(error.code).toBe('42501');
      });

      it('pg_terminate_backend(pid) falla con permiso denegado (42501)', async () => {
        // El primer intento fallido deja la transacción del atacante abortada: se reinicia.
        await atacante.query('ROLLBACK');
        if (escenario.atacanteConContexto) {
          await atacante.query('BEGIN');
          await atacante.query("SELECT set_config('app.empresa_id', $1, true)", [A.id]);
        }
        const error = await errorDe(
          atacante.query('SELECT pg_terminate_backend($1)', [victima.pid]),
        );
        expect(error.code).toBe('42501');
      });

      it('la víctima sigue conectada y su consulta sigue en curso', async () => {
        expect(await victimaSigueViva(victima)).toBe(true);
      });

      it('la víctima termina su consulta con normalidad: sin cancelación ni cierre de conexión', async () => {
        // Cierra la espera sin cortar la conexión: la propia consulta termina cuando el administrador
        // la cancela, y la conexión queda usable (un terminate la habría cerrado).
        await admin.query('SELECT pg_cancel_backend($1)', [victima.pid]);
        const resultado = await victima.enCurso;
        expect(resultado.error?.code).toBe('57014');
        await victima.cliente.query('ROLLBACK');
        const { rows } = await victima.cliente.query<{ ok: number }>('SELECT 1 AS ok');
        expect(rows[0]!.ok).toBe(1);
      });
    });
  }

  it('control: restaurante_api no puede señalar a una sesión de restaurante_plataforma (otro rol)', async () => {
    const victima = await abrirVictima('plataforma', null);
    const atacante = await abrirCliente('api');
    try {
      const cancelar = await errorDe(atacante.query('SELECT pg_cancel_backend($1)', [victima.pid]));
      expect(cancelar.code).toBe('42501');
      const terminar = await errorDe(
        atacante.query('SELECT pg_terminate_backend($1)', [victima.pid]),
      );
      expect(terminar.code).toBe('42501');
      expect(await victimaSigueViva(victima)).toBe(true);
    } finally {
      await atacante.end().catch(() => undefined);
      await cerrarVictima(victima);
    }
  });
});

describe('criterio 38c · pg_stat_get_backend_* no revela las sesiones de otras conexiones', () => {
  const CONSULTA_BACKENDS = `
    SELECT pg_stat_get_backend_pid(id) AS pid,
           pg_stat_get_backend_userid(id) AS userid,
           pg_stat_get_backend_activity_start(id) AS inicio,
           pg_stat_get_backend_xact_start(id) AS inicio_xact
      FROM pg_stat_get_backend_idset() id`;

  const espectadores: { nombre: string; rol: 'api' | 'plataforma'; conContexto: boolean }[] = [
    { nombre: 'restaurante_api con contexto de A', rol: 'api', conContexto: true },
    { nombre: 'restaurante_plataforma', rol: 'plataforma', conContexto: false },
  ];

  let victima: Victima;

  beforeAll(async () => {
    victima = await abrirVictima('api', B.id);
  });

  afterAll(async () => {
    if (victima) await cerrarVictima(victima);
  });

  it('control: el administrador sí ve el pid de la víctima', async () => {
    const { rows } = await admin.query<{ pid: number | null }>(CONSULTA_BACKENDS);
    expect(rows.map((r) => Number(r.pid))).toContain(victima.pid);
  });

  for (const espectador of espectadores) {
    it(`${espectador.nombre}: la consulta falla con 42501 o no devuelve el pid de otra sesión`, async () => {
      const cliente = await abrirAtacante(espectador.rol, espectador.conContexto);
      try {
        let pidsVistos: number[];
        try {
          const { rows } = await cliente.query<{ pid: number | null }>(CONSULTA_BACKENDS);
          pidsVistos = rows.filter((r) => r.pid !== null).map((r) => Number(r.pid));
        } catch (error) {
          expect((error as { code?: string }).code).toBe('42501');
          return;
        }
        expect(pidsVistos, 'el pid de otra sesión es visible').not.toContain(victima.pid);
      } finally {
        await cliente.query('ROLLBACK').catch(() => undefined);
        await cliente.end().catch(() => undefined);
      }
    });
  }
});
