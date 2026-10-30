import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import type { DestinoDeEstacion, ImpresionPuerto, TrabajoParaEncolar } from '../pedidos/impresion';

/**
 * El puerto `IMPRESION` de 3b (historia 004, criterios 99 a 102 y 114; plan "Impresión"): pedidos le pregunta
 * adónde sale cada estación y le pide encolar los trabajos, dentro de su transacción. Lo provee `ImpresionModule`.
 *
 * `destinos` (T37) lee `estacion_destino` en la transacción de la petición, bajo la RLS de la empresa: una
 * estación sin fila sale por el `KDS`, y una con destino `IMPRESORA` sale con su `impresoraId`. Pedidos guarda el
 * destino en la comanda al crearla, así cambiarlo después no mueve las comandas ya enviadas (criterio 100).
 *
 * `encolar` todavía no tiene dónde escribir: la tabla `trabajo_impresion` llega con la migración de T40. Hasta
 * entonces recibe los trabajos y no hace nada, para que enviar a una estación con impresora no falle (la comanda
 * queda con `destino = 'IMPRESORA'`, sin trabajo). Pedidos aún no llama a `encolar`; T40 lo implementa y agrega las
 * llamadas del envío, la marcha, la anulación y la pre-cuenta.
 */
@Injectable()
export class ColaImpresionService implements ImpresionPuerto {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  async destinos(
    sucursalId: string,
    estacionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DestinoDeEstacion>> {
    const kds = { destino: 'KDS' } as const;
    if (estacionIds.length === 0) return new Map();
    const filas = await this.conexion.query<{ estacion_id: string; impresora_id: string }>(
      `SELECT estacion_id, impresora_id FROM estacion_destino
        WHERE sucursal_id = $1 AND estacion_id = ANY($2::uuid[])
          AND destino = 'IMPRESORA' AND impresora_id IS NOT NULL`,
      {
        bind: [sucursalId, [...new Set(estacionIds.map((id) => id.toLowerCase()))]],
        type: QueryTypes.SELECT,
      },
    );
    const impresoraDe = new Map(filas.map((f) => [f.estacion_id, f.impresora_id]));
    return new Map(
      estacionIds.map((id): [string, DestinoDeEstacion] => {
        const impresoraId = impresoraDe.get(id.toLowerCase());
        return [id, impresoraId === undefined ? kds : { destino: 'IMPRESORA', impresoraId }];
      }),
    );
  }

  async encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<void> {
    void trabajos;
  }
}
