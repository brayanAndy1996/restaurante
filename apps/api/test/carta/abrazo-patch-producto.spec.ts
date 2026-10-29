// Historia 003 · ronda 2 adversarial, hallazgo F1 (no crítico): pruebas del desarrollador (no protegidas).
//
// Un `PATCH` de producto decidía si bloqueaba la familia (y los grupos al reactivar) con una lectura sin bloqueo
// de `familia_id` y `activo`. Si otro `PATCH` del mismo producto cambiaba esos datos entre esa lectura y el
// bloqueo del producto, el `PATCH` terminaba pidiendo la familia después de tener el producto y sus componentes:
// rompía el orden familia, grupos, productos y formaba un ciclo (`40P01`, traducido a 409) con un alta de combo o
// con el orden de una familia. Una operación legítima recibía 409.
//
// Reproducción determinista: un cliente aparte bloquea la fila de la empresa, así que la auditoría de T (que
// ya tiene el combo C) queda esperando. Entonces X (el segundo `PATCH` de C) y Y (la operación legítima) toman
// lo suyo en el orden que forma el ciclo. Al soltar la fila no debe haber ningún abrazo mortal: ninguna
// operación responde 409 y la base no cuenta ningún `deadlock` nuevo.
import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  crearEscenarioCarta,
  exigirEstado,
  llamar,
  productoSimpleNuevo,
  sembrarCarta,
  unico,
  type AppCarta,
  type DatosCarta,
  type EscenarioCarta,
} from '../carta-critica/fabrica-permisos-carta';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let externo: Client;
let e: EscenarioCarta;
let datos: DatosCarta;
let token: string;

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

beforeAll(async () => {
  // Varias conexiones: las tres peticiones deben estar a la vez dentro de sus transacciones.
  ctx = await arrancarCarta({ poolMax: 6 });
  admin = await abrirCliente('admin');
  externo = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  token = e.A.tokenAdmin;
  datos = await sembrarCarta(ctx, token);
});

afterAll(async () => {
  await externo?.query('ROLLBACK').catch(() => undefined);
  await ctx?.cerrar();
  await admin?.end();
  await externo?.end();
});

const crear = async (ruta: string, cuerpo: unknown): Promise<string> => {
  const res = await llamar(ctx, token, { metodo: 'post', ruta, cuerpo });
  exigirEstado(res, 201, `POST ${ruta}`);
  return res.body.id as string;
};

const abrazos = async (): Promise<number> => {
  const filas = await admin.query<{ n: string }>(
    'SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()',
  );
  return Number(filas.rows[0]!.n);
};

/** Espera a que `pg_stat_database` (que se actualiza con retraso) refleje los abrazos de la corrida. */
const abrazosTrasUnRato = async (): Promise<number> => {
  await dormir(1_500);
  return abrazos();
};

interface Escena {
  f1: string;
  f2: string;
  /** Simple de F1 (componente inicial de C). */
  q: string;
  /** Combo en F2. */
  c: string;
  /** Simple con id menor que C, para que el bloqueo ordenado tome primero P y después C. */
  p: string;
}

/**
 * Cambia el id de un producto recién creado (nadie lo referencia todavía) por uno que, siendo un UUID v4 válido,
 * es menor que cualquier otro UUID v4 aleatorio: así P queda siempre antes que el combo C en el orden de bloqueo
 * por id, sin depender del azar de `gen_random_uuid()`. El resto de la reproducción no cambia.
 */
async function darIdMenorQue(productoId: string): Promise<string> {
  const sufijo = randomBytes(6).toString('hex');
  const nuevo = `00000000-0000-4000-8000-${sufijo}`;
  // Las tablas con trazabilidad exigen un actor fijado en la transacción; aquí, uno de sistema.
  await admin.query('BEGIN');
  try {
    await admin.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', ['prueba-abrazo']);
    await admin.query('UPDATE producto SET id = $1 WHERE id = $2', [nuevo, productoId]);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return nuevo;
}

/** Arma las familias, el combo C y un simple P con id menor que el de C (el orden de bloqueo es por id). */
async function armarEscena(familiaDeP: 'f1' | 'f2'): Promise<Escena> {
  const f1 = await crear('/carta/familias', { nombre: unico('F1') });
  const f2 = await crear('/carta/familias', { nombre: unico('F2') });
  const q = await crear(
    '/carta/productos',
    productoSimpleNuevo({ familiaId: f1, estacionId: datos.estacionId }),
  );
  const c = await crear('/carta/productos', {
    tipo: 'COMBO',
    nombre: unico('Combo'),
    familiaId: f2,
    precio: '20.00',
    tipoControlStock: 'SIN_CONTROL',
    componentes: [{ productoId: q, cantidad: 1 }],
  });
  const candidato = await crear(
    '/carta/productos',
    productoSimpleNuevo({
      familiaId: familiaDeP === 'f1' ? f1 : f2,
      estacionId: datos.estacionId,
    }),
  );
  const p = await darIdMenorQue(candidato);
  expect(p < c, 'P debe tener un id menor que el del combo').toBe(true);
  return { f1, f2, q, c, p };
}

describe('F1 · el PATCH de producto no forma ciclos con una lectura sin bloqueo', () => {
  it.each([
    { nombre: 'X mueve el combo con componentes', conComponentes: true },
    { nombre: 'X mueve el combo sin componentes', conComponentes: false },
  ])('D2 · orden de la familia: $nombre', async ({ conComponentes }) => {
    const { f1, f2, c, p } = await armarEscena('f2');
    const idsF2 = (
      await admin.query<{ id: string }>(
        'SELECT id FROM producto WHERE familia_id = $1 ORDER BY id DESC',
        [f2],
      )
    ).rows.map((f) => f.id);
    const antes = await abrazos();

    await externo.query('BEGIN');
    await externo.query('SELECT id FROM empresa WHERE id = $1 FOR UPDATE', [e.A.empresaId]);
    try {
      // T: saca el combo de F2 hacia F1 y se queda esperando en su auditoría con el combo ya tomado.
      const t = llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/carta/productos/${c}`,
        cuerpo: { familiaId: f1 },
      }).then((r) => r);
      await dormir(500);
      // X: la familia que X lee sin bloqueo es F2 (T no confirmó), pero cuando T confirme el combo estará en F1.
      const x = llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/carta/productos/${c}`,
        cuerpo: conComponentes
          ? { familiaId: f2, componentes: [{ productoId: p, cantidad: 1 }] }
          : { familiaId: f2, precio: '21.00' },
      }).then((r) => r);
      await dormir(500);
      // Y: ordena F2, es decir, toma F2 y después sus productos.
      const y = llamar(ctx, token, {
        metodo: 'put',
        ruta: `/carta/familias/${f2}/productos/orden`,
        cuerpo: { ids: idsF2 },
      }).then((r) => r);
      await dormir(500);
      await externo.query('ROLLBACK');
      const [rt, rx, ry] = await Promise.all([t, x, y]);
      expect(rt.status, rt.text).toBe(200);
      expect(rx.status, rx.text).toBe(200);
      // Y es legítima: 200, o 400 si el combo estaba fuera de F2 cuando le tocó; nunca 409 ni 500.
      expect([200, 400], `${ry.status} ${ry.text}`).toContain(ry.status);
    } finally {
      await externo.query('ROLLBACK').catch(() => undefined);
    }
    expect(await abrazosTrasUnRato()).toBe(antes);
  });

  it.each(['familia', 'reactiva'] as const)(
    'D3 · alta de combo legítima en F2 (%s)',
    async (variante) => {
      const { f1, f2, c, p } = await armarEscena('f1');
      const antes = await abrazos();

      await externo.query('BEGIN');
      await externo.query('SELECT id FROM empresa WHERE id = $1 FOR UPDATE', [e.A.empresaId]);
      try {
        const t = llamar(ctx, token, {
          metodo: 'patch',
          ruta: `/carta/productos/${c}`,
          cuerpo: variante === 'familia' ? { familiaId: f1 } : { activo: false },
        }).then((r) => r);
        await dormir(500);
        const x = llamar(ctx, token, {
          metodo: 'patch',
          ruta: `/carta/productos/${c}`,
          cuerpo:
            variante === 'familia'
              ? { familiaId: f2, componentes: [{ productoId: p, cantidad: 1 }] }
              : { activo: true, componentes: [{ productoId: p, cantidad: 1 }] },
        }).then((r) => r);
        await dormir(500);
        const y = llamar(ctx, token, {
          metodo: 'post',
          ruta: '/carta/productos',
          cuerpo: {
            tipo: 'COMBO',
            nombre: unico('Alta'),
            familiaId: f2,
            precio: '9.00',
            tipoControlStock: 'SIN_CONTROL',
            componentes: [{ productoId: p, cantidad: 1 }],
          },
        }).then((r) => r);
        await dormir(500);
        await externo.query('ROLLBACK');
        const [rt, rx, ry] = await Promise.all([t, x, y]);
        expect(rt.status, rt.text).toBe(200);
        expect(rx.status, rx.text).toBe(200);
        expect(ry.status, ry.text).toBe(201);
      } finally {
        await externo.query('ROLLBACK').catch(() => undefined);
      }
      expect(await abrazosTrasUnRato()).toBe(antes);
    },
  );

  it('el combo queda coherente tras las dos ediciones (la segunda ve lo que dejó la primera)', async () => {
    const { f1, f2, c, p } = await armarEscena('f1');
    const [rt, rx] = await Promise.all([
      llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/carta/productos/${c}`,
        cuerpo: { familiaId: f1 },
      }),
      llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/carta/productos/${c}`,
        cuerpo: { familiaId: f2, componentes: [{ productoId: p, cantidad: 1 }] },
      }),
    ]);
    expect([rt.status, rx.status]).toEqual([200, 200]);
    const fila = (
      await admin.query<{ familia_id: string; activo: boolean }>(
        'SELECT familia_id, activo FROM producto WHERE id = $1',
        [c],
      )
    ).rows[0]!;
    expect(fila.activo).toBe(true);
    expect([f1, f2]).toContain(fila.familia_id);
  });
});
