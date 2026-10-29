// Ayudantes de las pruebas de pedidos del grupo C2 (historia 004; no protegidas). Se apoyan en los ayudantes de
// las pruebas protegidas (`salon-critica/fabrica-p3.ts`): la API real con `RelojManual`, `PublicadorEnMemoria` e
// `InventarioDePrueba`, las empresas A y B con sus personas y las mesas por la API. Para dejar una orden en un
// estado que todavía no tiene ruta (anulada, en pre-cuenta, con ítems) escriben por SQL como `restaurante_api`
// con el contexto y el actor de prueba fijados.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { enTransaccion } from '../aislamiento/fabrica';
import type { AppP3 } from '../salon-critica/fabrica-p3';

/** Corre `fn` con el contexto de la empresa y el actor de prueba, y confirma (escritura suelta por SQL). */
export const escribir = <T>(api: Client, empresaId: string, fn: () => Promise<T>): Promise<T> =>
  enTransaccion(api, empresaId, fn, { confirmar: true });

/** Cuántas consultas hace la aplicación mientras corre `fn` (todas las que pasan por `CONEXION_API`). */
export async function contarConsultas<T>(
  ctx: AppP3,
  fn: () => Promise<T>,
): Promise<{ consultas: number; resultado: T }> {
  const conexion = ctx.app.get<Sequelize>(CONEXION_API);
  const original = conexion.query.bind(conexion);
  let consultas = 0;
  conexion.query = ((...argumentos: Parameters<Sequelize['query']>) => {
    consultas++;
    return original(...argumentos);
  }) as Sequelize['query'];
  try {
    const resultado = await fn();
    return { consultas, resultado };
  } finally {
    conexion.query = original;
  }
}

/** Deja la orden `ANULADA` y libera su mesa, como lo hará la anulación de la sección de anulaciones. */
export async function anularPorSql(api: Client, empresaId: string, ordenId: string): Promise<void> {
  await escribir(api, empresaId, async () => {
    await api.query(
      `UPDATE orden SET estado = 'ANULADA', anulada_en = now(), actualizado_en = now() WHERE id = $1`,
      [ordenId],
    );
    await api.query(
      `UPDATE orden_mesa SET hasta = greatest(now(), desde), actualizado_en = now()
        WHERE orden_id = $1 AND hasta IS NULL`,
      [ordenId],
    );
  });
}

/** Pone la orden en `estado` (por ejemplo `EN_PRECUENTA`). */
export async function ponerEstado(
  api: Client,
  empresaId: string,
  ordenId: string,
  estado: 'ABIERTA' | 'EN_PRECUENTA',
): Promise<void> {
  await escribir(api, empresaId, async () => {
    await api.query(`UPDATE orden SET estado = $2, actualizado_en = now() WHERE id = $1`, [
      ordenId,
      estado,
    ]);
  });
}

export interface ItemSembrado {
  productoId: string;
  nombre?: string;
  precio: string;
  cantidad: number;
  cantidadAnulada?: number;
  tiempo?: 1 | 2;
}

/**
 * Siembra por SQL un envío con sus ítems y una comanda de `estacionId` con una línea por ítem (la primera en
 * `ENVIADO`, las demás en `LISTO`) y una comanda `ANULACION` con una línea más, que la vista no cuenta.
 */
export async function sembrarEnvio(
  api: Client,
  empresaId: string,
  datos: { sucursalId: string; ordenId: string; estacionId: string; numero?: number },
  items: readonly ItemSembrado[],
): Promise<{ envioId: string; itemIds: string[] }> {
  const envioId = randomUUID();
  const itemIds: string[] = [];
  await escribir(api, empresaId, async () => {
    await api.query(
      `INSERT INTO envio (id, empresa_id, orden_id, numero, es_adicion, huella_entrada, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, decode('00', 'hex'), now(), now())`,
      [envioId, empresaId, datos.ordenId, datos.numero ?? 1, (datos.numero ?? 1) > 1],
    );
    const comandaId = randomUUID();
    const anulacionId = randomUUID();
    for (const [i, item] of items.entries()) {
      const itemId = randomUUID();
      itemIds.push(itemId);
      const total = (Number(item.precio) * item.cantidad).toFixed(2);
      const anulada = item.cantidadAnulada ?? 0;
      await api.query(
        `INSERT INTO item (id, empresa_id, orden_id, envio_id, producto_id, nombre, tipo_producto, cantidad,
                           cantidad_anulada, precio_unitario, total, afectacion_igv, aplica_icbper, linea,
                           observacion, tiempo, para_llevar, es_adicion, marchado_en, estado, posicion,
                           creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, 'SIMPLE', $7, $8, $9, $10, 'GRAVADO', false, $11::jsonb,
                 NULL, $12, false, $13, NULL, $14, $15, now(), now())`,
        [
          itemId,
          empresaId,
          datos.ordenId,
          envioId,
          item.productoId,
          item.nombre ?? `Producto ${i + 1}`,
          item.cantidad,
          anulada,
          item.precio,
          total,
          JSON.stringify({
            modificadores: [{ nombre: 'Jugoso', precioExtra: '0.00' }],
            componentes: [],
          }),
          item.tiempo ?? 1,
          (datos.numero ?? 1) > 1,
          anulada === item.cantidad ? 'ANULADO' : 'ENVIADO',
          i + 1,
        ],
      );
    }
    for (const [id, tipo] of [
      [comandaId, (datos.numero ?? 1) > 1 ? 'ADICION' : 'COMANDA'],
      [anulacionId, 'ANULACION'],
    ] as const) {
      await api.query(
        `INSERT INTO comanda (id, empresa_id, sucursal_id, orden_id, estacion_id, envio_id, tipo, destino,
                              origen_id, vista_en, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $7, $6, 'KDS', NULL, NULL, now(), now())`,
        [
          id,
          empresaId,
          datos.sucursalId,
          datos.ordenId,
          datos.estacionId,
          tipo,
          tipo === 'ANULACION' ? null : envioId,
        ],
      );
    }
    const insertarLinea = (comanda: string, itemId: string, productoId: string, estado: string) =>
      api.query(
        `INSERT INTO comanda_linea (id, empresa_id, comanda_id, item_id, rol, producto_id, nombre, contexto,
                                    cantidad_por_item, cantidad, modificadores, observacion, tiempo, para_llevar,
                                    esperar, estado, estado_en, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 'PRODUCTO', $5, 'Línea', NULL, 1, NULL, '[]'::jsonb, NULL, 1, false, false,
                 $6, now(), now(), now())`,
        [randomUUID(), empresaId, comanda, itemId, productoId, estado],
      );
    for (const [i, itemId] of itemIds.entries()) {
      await insertarLinea(comandaId, itemId, items[i]!.productoId, i === 0 ? 'ENVIADO' : 'LISTO');
    }
    // La línea de una comanda ANULACION repite una parte del primer ítem: la vista de la orden no la cuenta.
    await insertarLinea(anulacionId, itemIds[0]!, items[0]!.productoId, 'ENVIADO');
  });
  return { envioId, itemIds };
}
