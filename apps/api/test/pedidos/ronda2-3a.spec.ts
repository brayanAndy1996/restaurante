// Historia 004 · salón y cocina, ronda 2 del ataque adversarial a la 3a · pruebas del desarrollador (no protegidas)
// de los contadores enteros (hallazgo 3), los pendientes del KDS (hallazgo 5) y, como respaldo de las pruebas
// protegidas de `salon-critica/ataque-ronda2.spec.ts`, de la réplica de una anulación después de unir mesas
// (FA1) y de anular en una orden `UNIDA` (decisión 2).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { enTransaccion } from '../aislamiento/fabrica';
import {
  abrirOrden,
  anularItemOk,
  arrancarP2,
  clave,
  enviarOk,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  llamar,
  prepararEscenarioP2,
  unirMesasOk,
  type AppP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let api: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;

const t = () => esc.token;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

describe('3 · los contadores por orden son integer', () => {
  it('envio.numero y precuenta.numero son integer y conservan sus índices únicos', async () => {
    const { rows } = await admin.query<{ tabla: string; tipo: string }>(
      `SELECT table_name AS tabla, data_type AS tipo FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'numero' AND table_name IN ('envio', 'precuenta')`,
    );
    expect(rows).toHaveLength(2);
    for (const fila of rows) expect(fila.tipo, fila.tabla).toBe('integer');
    const { rows: indices } = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE indexname IN ('envio_numero_unico', 'precuenta_numero_unico')`,
    );
    expect(indices).toHaveLength(2);
  });

  it('ninguna otra columna smallint de pedidos es un contador sin tope', async () => {
    // Las columnas smallint que quedan tienen un CHECK con tope pequeño o son el índice dentro de un envío.
    const { rows } = await admin.query<{ tabla: string; columna: string }>(
      `SELECT c.table_name AS tabla, c.column_name AS columna
         FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.data_type = 'smallint'
          AND c.table_name IN ('envio', 'item', 'comanda', 'comanda_linea', 'marcha', 'precuenta',
                               'anulacion_item', 'orden')
        ORDER BY 1, 2`,
    );
    expect(rows.map((r) => `${r.tabla}.${r.columna}`)).toEqual([
      'comanda_linea.tiempo',
      'item.posicion',
      'item.tiempo',
      'orden.comensales',
    ]);
  });

  it('el envío 32 768 de una orden se guarda (con smallint desbordaba)', async () => {
    const orden = await abrirOrden(ctx, esc.salon, t().mozo);
    await enviarOk(ctx, t().mozo, orden.id, [L.lomo(['3/4'], 1)]);
    await enTransaccion(
      admin,
      null,
      () => admin.query(`UPDATE envio SET numero = 32767 WHERE orden_id = $1`, [orden.id]),
      { confirmar: true },
    );
    const segundo = await enviarOk(ctx, t().mozo, orden.id, [L.lomo(['3/4'], 1)]);
    expect(segundo.numero).toBe(32768);
    const tercero = await enviarOk(ctx, t().mozo, orden.id, [L.lomo(['3/4'], 1)]);
    expect(tercero.numero).toBe(32769);
  });
});

describe('5 · pendientes del KDS: el índice se acota por empresa y deja fuera marcha y anulación', () => {
  const INDEX = 'comanda_linea_pendiente_idx';

  it('el índice es (empresa_id, comanda_id) y excluye las líneas de cantidad fija', async () => {
    const { rows } = await admin.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
      [INDEX],
    );
    expect(rows[0]?.indexdef).toMatch(
      /\(empresa_id, comanda_id\) WHERE .*ENVIADO.*EN_PREPARACION.*cantidad IS NULL/,
    );
  });

  it('las líneas de una marcha y de una anulación quedan fuera del índice parcial', async () => {
    const orden = await abrirOrden(ctx, esc.salon, t().mozo);
    const envio = await enviarOk(ctx, t().mozo, orden.id, [
      L.lomo(['3/4'], 2, { tiempo: 2 }),
    ]);
    exigirEstado(
      await llamar(ctx, t().mozo, {
        metodo: 'post',
        ruta: `/ordenes/${orden.id}/marchas`,
        cuerpo: { id: randomUUID() },
        cabeceras: clave(),
      }),
      201,
      'marchar',
    );
    await anularItemOk(ctx, t().supervisor, orden.id, envio.items[0]!.id, 1);
    const { rows } = await admin.query<{ tipo: string; n: number; sin_cantidad: number }>(
      `SELECT c.tipo, count(*)::int AS n, count(*) FILTER (WHERE l.cantidad IS NULL)::int AS sin_cantidad
         FROM comanda_linea l JOIN comanda c ON c.id = l.comanda_id
        WHERE c.orden_id = $1 AND l.estado IN ('ENVIADO', 'EN_PREPARACION') GROUP BY c.tipo`,
      [orden.id],
    );
    const porTipo = Object.fromEntries(rows.map((r) => [r.tipo, r]));
    // Las de COMANDA no tienen cantidad fija y entran al índice; las de ANULACION la tienen y no entran.
    expect(porTipo['COMANDA']?.sin_cantidad).toBe(porTipo['COMANDA']?.n);
    expect(porTipo['ANULACION']?.n).toBeGreaterThan(0);
    expect(porTipo['ANULACION']?.sin_cantidad).toBe(0);
  });

  it('la subconsulta de pendientes entra por la empresa y no recorre el historial ni las líneas de otras empresas', async () => {
    const A = esc.e.A.empresaId;
    const B = esc.e.B.empresaId;
    // Una orden real de A con una línea pendiente.
    const orden = await abrirOrden(ctx, esc.salon, t().mozo);
    await enviarOk(ctx, t().mozo, orden.id, [L.lomo(['3/4'], 1)]);

    // Un historial grande de B y de A, sin llaves foráneas (solo cuenta el costo de recorrer líneas): pendientes
    // (cantidad nula), de marcha y anulación (cantidad fija, `ENVIADO` para siempre) y terminadas.
    const marca = randomUUID();
    await enTransaccion(
      admin,
      null,
      async () => {
        await admin.query(`SET LOCAL session_replication_role = replica`);
        for (const empresa of [A, B]) {
          await admin.query(
            `INSERT INTO comanda_linea (empresa_id, comanda_id, item_id, rol, producto_id, nombre,
                                        cantidad_por_item, cantidad, tiempo, para_llevar, esperar, estado,
                                        estado_en, observacion, creado_por_sistema,
                                        actualizado_por_sistema)
             SELECT $1::uuid, gen_random_uuid(), gen_random_uuid(), 'PRODUCTO', gen_random_uuid(), 'x',
                    1, CASE WHEN g % 3 = 0 THEN 1 END, 1, false, false,
                    CASE WHEN g % 3 = 2 THEN 'LISTO' ELSE 'ENVIADO' END, now() - interval '3 days', $2, 'prueba', 'prueba'
               FROM generate_series(1, 6000) g`,
            [empresa, marca],
          );
        }
      },
      { confirmar: true },
    );
    try {
      await admin.query('ANALYZE comanda_linea');
      const sucursalId = esc.e.A.S1;
      const plan = await enTransaccion(api, A, async () => {
        const { rows } = await api.query<{ 'QUERY PLAN': unknown[] }>(
          `EXPLAIN (ANALYZE, FORMAT JSON)
           SELECT c.id FROM comanda c
            WHERE c.sucursal_id = $1 AND c.destino = 'KDS' AND c.tipo IN ('COMANDA', 'ADICION')
              AND c.id IN (SELECT l.comanda_id FROM comanda_linea l
                            WHERE l.empresa_id = $2
                              AND l.estado IN ('ENVIADO', 'EN_PREPARACION') AND l.cantidad IS NULL)`,
          [sucursalId, A],
        );
        return rows[0]!['QUERY PLAN'][0] as { Plan: Nodo };
      });
      const nodos = recorrer(plan.Plan).filter((n) => n['Relation Name'] === 'comanda_linea');
      expect(nodos.length).toBeGreaterThan(0);
      for (const n of nodos) {
        expect(n['Node Type'], 'sin recorrido secuencial de comanda_linea').not.toBe('Seq Scan');
        expect(n['Index Name']).toBe(INDEX);
        expect(String(n['Index Cond'])).toContain('empresa_id');
        // Solo líneas pendientes de la empresa: ni las de B ni las de marcha y anulación ni las terminadas.
        expect(n['Rows Removed by Filter'] ?? 0).toBe(0);
        expect(n['Actual Rows'] as number).toBeLessThanOrEqual(2100);
      }
    } finally {
      await enTransaccion(
        admin,
        null,
        async () => {
          await admin.query(`SET LOCAL session_replication_role = replica`);
          await admin.query(`DELETE FROM comanda_linea WHERE observacion = $1`, [marca]);
        },
        { confirmar: true },
      );
    }
  });
});

type Nodo = Record<string, unknown> & { Plans?: Nodo[] };

function recorrer(nodo: Nodo): Nodo[] {
  return [nodo, ...(nodo.Plans ?? []).flatMap(recorrer)];
}

describe('FA1 y decisión 2 · anular después de unir mesas', () => {
  /** Dos órdenes con un ítem enviado cada una; la principal une la mesa de la otra. */
  async function dosOrdenes() {
    const principal = await abrirOrden(ctx, esc.salon, t().mozo);
    const absorbida = await abrirOrden(ctx, esc.salon, t().mozo);
    await enviarOk(ctx, t().mozo, principal.id, [L.lomo(['3/4'], 1)]);
    const envio = await enviarOk(ctx, t().mozo, absorbida.id, [L.lomo(['3/4'], 3)]);
    return { principal, absorbida, itemId: envio.items[0]!.id };
  }

  const anular = (ordenId: string, itemId: string, id: string, cantidad = 1) =>
    llamar(ctx, t().supervisor, {
      metodo: 'post',
      ruta: `/ordenes/${ordenId}/items/${itemId}/anulaciones`,
      cuerpo: { id, cantidad, motivo: 'Prueba', destinoStock: 'VUELVE' },
      cabeceras: clave(),
    });

  const filas = async (id: string) =>
    (await admin.query(`SELECT 1 FROM anulacion_item WHERE id = $1`, [id])).rowCount;

  it('la réplica por el id se reconoce por la ruta de la orden original y por la de la principal', async () => {
    const { principal, absorbida, itemId } = await dosOrdenes();
    const id = randomUUID();
    exigirEstado(await anular(absorbida.id, itemId, id), 201, 'anular antes de unir');
    await unirMesasOk(ctx, t().supervisor, principal.id, [absorbida.mesaId]);

    const porLaAbsorbida = await anular(absorbida.id, itemId, id);
    exigirEstado(porLaAbsorbida, 201, 'réplica por la ruta de la absorbida');
    const porLaPrincipal = await anular(principal.id, itemId, id);
    exigirEstado(porLaPrincipal, 201, 'réplica por la ruta de la principal');
    expect(porLaAbsorbida.body.id).toBe(id);
    expect(await filas(id)).toBe(1);
  });

  it('funciona igual con una cadena de uniones', async () => {
    const { principal, absorbida, itemId } = await dosOrdenes();
    const raiz = await abrirOrden(ctx, esc.salon, t().mozo);
    const id = randomUUID();
    exigirEstado(await anular(absorbida.id, itemId, id), 201, 'anular antes de unir');
    await unirMesasOk(ctx, t().supervisor, principal.id, [absorbida.mesaId]);
    await unirMesasOk(ctx, t().supervisor, raiz.id, [principal.mesaId]);

    for (const ruta of [absorbida.id, principal.id, raiz.id]) {
      exigirEstado(await anular(ruta, itemId, id), 201, `réplica por ${ruta}`);
    }
    expect(await filas(id)).toBe(1);
    // Una orden ajena a la cadena sigue sin ver el ítem.
    const ajena = await abrirOrden(ctx, esc.salon, t().mozo);
    esperarError(await anular(ajena.id, itemId, id), 404, 'NO_ENCONTRADO');
  });

  it('una anulación nueva por la ruta de una orden UNIDA responde 409 con la principal y no anula', async () => {
    const { principal, absorbida, itemId } = await dosOrdenes();
    await unirMesasOk(ctx, t().supervisor, principal.id, [absorbida.mesaId]);
    const id = randomUUID();
    const res = await anular(absorbida.id, itemId, id);
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(principal.id);
    expect(await filas(id)).toBe(0);
  });

  it('POST /ordenes/:id/anulacion sobre una orden UNIDA responde 409 con la principal', async () => {
    const { principal, absorbida } = await dosOrdenes();
    await unirMesasOk(ctx, t().supervisor, principal.id, [absorbida.mesaId]);
    const res = await llamar(ctx, t().supervisor, {
      metodo: 'post',
      ruta: `/ordenes/${absorbida.id}/anulacion`,
      cuerpo: { motivo: 'Prueba', destinoStock: 'VUELVE' },
      cabeceras: clave(),
    });
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(principal.id);
  });

  it('la anulación por la ruta de la principal de un ítem que llegó al unir sigue funcionando', async () => {
    const { principal, absorbida, itemId } = await dosOrdenes();
    await unirMesasOk(ctx, t().supervisor, principal.id, [absorbida.mesaId]);
    const res = await anularItemOk(ctx, t().supervisor, principal.id, itemId, 1);
    expect(res.body.itemId).toBe(itemId);
  });
});
