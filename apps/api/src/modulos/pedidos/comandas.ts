import { randomUUID } from 'node:crypto';
import type { DestinoComanda, ParteDeComanda, TipoComanda } from '@restaurante/dominio';
import { type Sequelize } from 'sequelize';
import type { ImpresionPuerto } from './impresion';

/**
 * Arma y guarda las comandas de estación de un envío o de una marcha (historia 004, criterio 22; plan,
 * "Enviar" paso 8): una comanda por estación con al menos una parte, con las partes de todos los ítems en el
 * orden de los ítems, y sus líneas, en lote (una sentencia por tabla sin importar cuántas partes haya). Cada
 * comanda guarda el destino de su estación al crearse (`IMPRESION.destinos`; sin configurar, `KDS`): cambiar el
 * destino después no mueve comandas ya enviadas.
 */

/** Una parte de comanda de un ítem lista para guardarse como línea. */
export interface ParteParaGuardar {
  itemId: string;
  parte: ParteDeComanda;
  /** `cantidad_por_item`: 1 para el producto y los ligados; la cantidad del componente para un componente. */
  cantidadPorItem: number;
  /** La cantidad fija de la línea (comandas `MARCHAR` y `ANULACION`); `null` en las de un envío. */
  cantidadFija: number | null;
  /** La parte espera la marcha (ítem de segundo tiempo que todavía no se marchó). */
  esperar: boolean;
}

export interface ComandasPorGuardar {
  empresaId: string;
  sucursalId: string;
  ordenId: string;
  /** El envío de origen, o `null` en una marcha o una anulación. */
  envioId: string | null;
  tipo: TipoComanda;
  /** El id de la marcha o de la anulación de la que sale la comanda. */
  origenId: string | null;
  ahora: Date;
  partes: readonly ParteParaGuardar[];
}

export interface ComandaGuardada {
  id: string;
  estacionId: string;
  tipo: TipoComanda;
  destino: DestinoComanda;
  /** La impresora de la estación cuando el destino es `IMPRESORA` (3b encola con ella su trabajo); si no, `null`. */
  impresoraId: string | null;
}

export async function guardarComandas(
  conexion: Sequelize,
  impresion: ImpresionPuerto,
  entrada: ComandasPorGuardar,
): Promise<ComandaGuardada[]> {
  if (entrada.partes.length === 0) return [];

  // Una comanda por estación, en el orden en que aparece la primera parte de cada una.
  const porEstacion = new Map<string, ParteParaGuardar[]>();
  for (const parte of entrada.partes) {
    const lista = porEstacion.get(parte.parte.estacionId) ?? [];
    lista.push(parte);
    porEstacion.set(parte.parte.estacionId, lista);
  }
  const destinos = await impresion.destinos(entrada.sucursalId, [...porEstacion.keys()]);

  const comandas: ComandaGuardada[] = [...porEstacion.keys()].map((estacionId) => {
    const destino = destinos.get(estacionId) ?? { destino: 'KDS' as const };
    return {
      id: randomUUID(),
      estacionId,
      tipo: entrada.tipo,
      destino: destino.destino,
      impresoraId: destino.destino === 'IMPRESORA' ? destino.impresoraId : null,
    };
  });
  await conexion.query(
    `INSERT INTO comanda (id, empresa_id, sucursal_id, orden_id, estacion_id, envio_id, tipo, destino,
                          origen_id, creado_en, actualizado_en)
     SELECT x.id, $2::uuid, $3::uuid, $4::uuid, x.estacion_id, $5::uuid, $6::text, x.destino, $7::uuid, $8::timestamptz, $8::timestamptz
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, estacion_id uuid, destino text)`,
    {
      bind: [
        JSON.stringify(
          comandas.map((c) => ({ id: c.id, estacion_id: c.estacionId, destino: c.destino })),
        ),
        entrada.empresaId,
        entrada.sucursalId,
        entrada.ordenId,
        entrada.envioId,
        entrada.tipo,
        entrada.origenId,
        entrada.ahora,
      ],
    },
  );

  const comandaDe = new Map(comandas.map((c) => [c.estacionId, c.id]));
  const lineas = entrada.partes.map((p) => ({
    comanda_id: comandaDe.get(p.parte.estacionId),
    item_id: p.itemId,
    rol: p.parte.rol,
    producto_id: p.parte.productoId,
    nombre: p.parte.nombre,
    contexto: p.parte.contexto,
    cantidad_por_item: p.cantidadPorItem,
    cantidad: p.cantidadFija,
    modificadores: p.parte.modificadores,
    observacion: p.parte.observacion,
    tiempo: p.parte.tiempo,
    para_llevar: p.parte.paraLlevar,
    esperar: p.esperar,
  }));
  await conexion.query(
    `INSERT INTO comanda_linea (empresa_id, comanda_id, item_id, rol, producto_id, nombre, contexto,
                                cantidad_por_item, cantidad, modificadores, observacion, tiempo, para_llevar,
                                esperar, estado, estado_en, creado_en, actualizado_en)
     SELECT $2::uuid, x.comanda_id, x.item_id, x.rol, x.producto_id, x.nombre, x.contexto,
            x.cantidad_por_item, x.cantidad, x.modificadores, x.observacion, x.tiempo, x.para_llevar,
            x.esperar, 'ENVIADO', $3::timestamptz, $3::timestamptz, $3::timestamptz
       FROM jsonb_to_recordset($1::jsonb) AS x(comanda_id uuid, item_id uuid, rol text, producto_id uuid,
            nombre text, contexto text, cantidad_por_item int, cantidad int, modificadores jsonb,
            observacion text, tiempo int, para_llevar boolean, esperar boolean)`,
    { bind: [JSON.stringify(lineas), entrada.empresaId, entrada.ahora] },
  );
  return comandas;
}
