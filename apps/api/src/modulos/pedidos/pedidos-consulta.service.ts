import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { EstadoOrden } from '@restaurante/dominio';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { OrdenesVigentes } from '../impresion';
import { UsoDeMesas } from '../salon';

/** Una orden abierta de una sucursal, para otros módulos. */
export interface OrdenAbiertaResumen {
  id: string;
  estado: Extract<EstadoOrden, 'ABIERTA' | 'EN_PRECUENTA'>;
  mozoId: string | null;
  /** Las mesas vigentes de la orden. */
  mesaIds: string[];
  abiertaEn: Date;
}

interface FilaOrdenAbierta {
  id: string;
  estado: OrdenAbiertaResumen['estado'];
  mozo_id: string | null;
  abierta_en: Date;
  mesa_ids: string[];
}

/**
 * Lecturas de las órdenes para otros módulos (historia 004): `pedidos` es dueño de las tablas y nadie más las
 * consulta. La sección 4 usa `hayOrdenesAbiertas` para impedir el cierre de caja con mesas o pedidos abiertos.
 * Corren en la transacción de la empresa del contexto activo.
 *
 * Al arrancar registra en `UsoDeMesas` (módulo de salón) cómo saber qué mesas tienen una orden abierta, para que
 * desactivar una mesa en uso responda 409 `EN_USO` (criterio 4).
 */
@Injectable()
export class PedidosConsultaService implements OnModuleInit {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(UsoDeMesas) private readonly usos: UsoDeMesas,
    @Inject(OrdenesVigentes) private readonly vigentes: OrdenesVigentes,
  ) {}

  onModuleInit(): void {
    this.usos.registrar((mesaIds, transaccion) => this.mesasConOrdenAbierta(mesaIds, transaccion));
    // 3b: la lista de trabajos de impresión muestra la cuenta principal de las órdenes que se unieron (criterio 128).
    this.vigentes.registrar((ordenIds) => this.ordenesPrincipales(ordenIds));
  }

  /**
   * De cada orden pedida, la orden en la que quedó: ella misma o, si se unió a otra (y esa a otra), la principal
   * al final de la cadena de uniones.
   */
  async ordenesPrincipales(ordenIds: readonly string[]): Promise<Map<string, string>> {
    const filas = await this.conexion.query<{ origen: string; id: string }>(
      `WITH RECURSIVE cadena AS (
         SELECT o.id AS origen, o.id, o.empresa_id, o.unida_a_orden_id
           FROM orden o WHERE o.id = ANY($1::uuid[])
         UNION
         SELECT c.origen, s.id, s.empresa_id, s.unida_a_orden_id
           FROM cadena c JOIN orden s ON s.id = c.unida_a_orden_id AND s.empresa_id = c.empresa_id)
       SELECT origen, id FROM cadena WHERE unida_a_orden_id IS NULL`,
      { bind: [[...ordenIds]], type: QueryTypes.SELECT },
    );
    return new Map(filas.map((f) => [f.origen, f.id]));
  }

  /** `true` si la sucursal tiene alguna orden `ABIERTA` o `EN_PRECUENTA`. */
  async hayOrdenesAbiertas(sucursalId: string, transaccion?: Transaction): Promise<boolean> {
    const filas = await this.conexion.query<{ hay: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM orden
                       WHERE sucursal_id = $1 AND estado IN ('ABIERTA', 'EN_PRECUENTA')) AS hay`,
      { bind: [sucursalId], type: QueryTypes.SELECT, transaction: transaccion },
    );
    return filas[0]?.hay === true;
  }

  /** Las órdenes abiertas de la sucursal, de la más antigua a la más nueva. */
  async ordenesAbiertas(
    sucursalId: string,
    transaccion?: Transaction,
  ): Promise<OrdenAbiertaResumen[]> {
    const filas = await this.conexion.query<FilaOrdenAbierta>(
      `SELECT o.id, o.estado, o.mozo_id, o.abierta_en,
              coalesce(array_agg(om.mesa_id ORDER BY om.desde, om.id)
                         FILTER (WHERE om.mesa_id IS NOT NULL), '{}') AS mesa_ids
         FROM orden o
         LEFT JOIN orden_mesa om
                ON om.orden_id = o.id AND om.empresa_id = o.empresa_id AND om.hasta IS NULL
        WHERE o.sucursal_id = $1 AND o.estado IN ('ABIERTA', 'EN_PRECUENTA')
        GROUP BY o.empresa_id, o.id
        ORDER BY o.abierta_en, o.id`,
      { bind: [sucursalId], type: QueryTypes.SELECT, transaction: transaccion },
    );
    return filas.map((f) => ({
      id: f.id,
      estado: f.estado,
      mozoId: f.mozo_id,
      mesaIds: f.mesa_ids,
      abiertaEn: f.abierta_en,
    }));
  }

  /** De las mesas pedidas, las que están en una orden abierta (relación vigente en `orden_mesa`). */
  private async mesasConOrdenAbierta(
    mesaIds: readonly string[],
    transaccion?: Transaction,
  ): Promise<string[]> {
    const filas = await this.conexion.query<{ mesa_id: string }>(
      `SELECT DISTINCT om.mesa_id
         FROM orden_mesa om
         JOIN orden o ON o.id = om.orden_id AND o.empresa_id = om.empresa_id
        WHERE om.mesa_id = ANY($1::uuid[]) AND om.hasta IS NULL
          AND o.estado IN ('ABIERTA', 'EN_PRECUENTA')`,
      { bind: [[...mesaIds]], type: QueryTypes.SELECT, transaction: transaccion },
    );
    return filas.map((f) => f.mesa_id);
  }
}
