import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prepararBaseDeDatos } from '../scripts/lib/preparar-bd';
import { abrirCliente } from './utilidades';

// Prueba del desarrollador (no protegida): dos preparaciones a la vez sobre el mismo clúster comparten
// roles y objetos de pg_catalog, y sin el bloqueo asesor de `prepararBaseDeDatos` PostgreSQL responde
// "tuple concurrently updated" a alguna de las dos (criterio 38e, plan: modo sin superusuario).

const sufijo = randomBytes(4).toString('hex');
const bases = [`rest_conc_a_${sufijo}`, `rest_conc_b_${sufijo}`, `rest_conc_c_${sufijo}`];

afterAll(async () => {
  const admin = await abrirCliente('admin');
  try {
    for (const base of bases) await admin.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

describe('prepararBaseDeDatos en paralelo', () => {
  it('tres preparaciones simultáneas terminan bien, sin "tuple concurrently updated"', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test' };
    delete env.DB_PROTECCION_CATALOGO;
    const resultados = await Promise.allSettled(
      bases.map((baseDeDatos) => prepararBaseDeDatos({ baseDeDatos, env })),
    );
    expect(resultados.filter((r) => r.status === 'rejected').map((r) => String(r.reason))).toEqual(
      [],
    );
  });
});
