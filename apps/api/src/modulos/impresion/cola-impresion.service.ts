import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { diaOperativo } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import type { DestinoDeEstacion, ImpresionPuerto, TrabajoParaEncolar } from '../pedidos/impresion';
import { SucursalesConsultaService } from '../plataforma';
import { EventosImpresion } from './eventos-impresion';

/**
 * El puerto `IMPRESION` de 3b (historia 004, criterios 99 a 102, 112 y 114; plan "Impresión"): pedidos le pregunta
 * adónde sale cada estación y le pide encolar los trabajos, dentro de su transacción. Lo provee `ImpresionModule`.
 *
 * `destinos` lee `estacion_destino` en la transacción de la petición, bajo la RLS de la empresa: una estación sin
 * fila sale por el `KDS`, y una con destino `IMPRESORA` sale con su `impresoraId`. Pedidos guarda el destino en la
 * comanda al crearla, así cambiarlo después no mueve las comandas ya enviadas (criterio 100).
 *
 * `encolar` inserta los trabajos `PENDIENTE` en esa misma transacción (criterio 101): si el envío, la marcha, la
 * anulación o la pre-cuenta se revierten, no queda ningún trabajo, y una réplica nunca llega hasta aquí. El
 * índice único parcial por comanda es la red de seguridad contra un segundo trabajo de la misma comanda. La
 * fecha de creación es la del reloj de la API (nunca `now()` de la base), el día operativo sale de la hora de
 * corte de la sucursal (criterio 117) y el aviso `trabajo.nuevo` sale solo después de confirmar y solo si la
 * sucursal tiene un puente vinculado (criterio 112).
 */
@Injectable()
export class ColaImpresionService implements ImpresionPuerto {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(EventosImpresion) private readonly eventos: EventosImpresion,
  ) {}

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

  async encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<string[]> {
    if (trabajos.length === 0) return [];
    const ahora = this.reloj.ahora();
    const empresaId = this.contexto.empresaActual();
    const dias = new Map<string, string>();
    for (const sucursalId of new Set(trabajos.map((t) => t.sucursalId))) {
      dias.set(sucursalId, await this.diaOperativoDe(sucursalId, ahora));
    }
    const filas = trabajos.map((t) => ({
      id: randomUUID(),
      sucursal_id: t.sucursalId,
      impresora_id: t.impresoraId,
      estacion_id: t.estacionId,
      tipo: t.tipo,
      documento: t.documento,
      comanda_id: t.comandaId,
      precuenta_id: t.precuentaId,
      mesa: t.mesa,
      orden_id: t.ordenId,
      envio_numero: t.envioNumero,
      dia_operativo: dias.get(t.sucursalId),
    }));
    await this.insertar(empresaId, filas, ahora);
    for (const sucursalId of dias.keys()) {
      await this.avisarTrabajos(
        sucursalId,
        filas.filter((f) => f.sucursal_id === sucursalId).map((f) => f.id),
      );
    }
    return filas.map((f) => f.id);
  }

  /** `trabajo.nuevo` de cada trabajo al puente de la sucursal, después de confirmar (criterio 112). */
  avisarTrabajos(sucursalId: string, trabajoIds: readonly string[]): Promise<void> {
    return this.eventos.trabajosNuevos(sucursalId, trabajoIds);
  }

  /** Inserta filas de `trabajo_impresion` en lote (una sentencia sin importar cuántas). */
  async insertar(
    empresaId: string,
    filas: ReadonlyArray<{
      id: string;
      sucursal_id: string;
      impresora_id: string;
      estacion_id: string | null;
      tipo: string;
      documento: unknown;
      comanda_id: string | null;
      precuenta_id: string | null;
      mesa: string | null;
      orden_id: string | null;
      envio_numero: number | null;
      dia_operativo: string | undefined;
      reimpresion_de_id?: string | null;
    }>,
    ahora: Date,
  ): Promise<void> {
    await this.conexion.query(
      `INSERT INTO trabajo_impresion (id, empresa_id, sucursal_id, impresora_id, estacion_id, tipo, documento,
                                      comanda_id, precuenta_id, reimpresion_de_id, orden_id, envio_numero, mesa, estado, dia_operativo,
                                      creado_en, actualizado_en)
       SELECT x.id, $2::uuid, x.sucursal_id, x.impresora_id, x.estacion_id, x.tipo, x.documento,
              x.comanda_id, x.precuenta_id, x.reimpresion_de_id, x.orden_id, x.envio_numero, x.mesa, 'PENDIENTE', x.dia_operativo,
              $3::timestamptz, $3::timestamptz
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, sucursal_id uuid, impresora_id uuid,
              estacion_id uuid, tipo text, documento jsonb, comanda_id uuid, precuenta_id uuid,
              reimpresion_de_id uuid, orden_id uuid, envio_numero int, mesa text, dia_operativo date)`,
      { bind: [JSON.stringify(filas), empresaId, ahora] },
    );
  }

  /** El día operativo de la sucursal en un instante, con su hora de corte (criterio 117). */
  async diaOperativoDe(sucursalId: string, instante: Date): Promise<string> {
    const horaCorte = await this.sucursales.horaCorte(sucursalId);
    return diaOperativo(instante, horaCorte ?? '00:00');
  }

  async impresoraDeCaja(sucursalId: string): Promise<{ id: string } | null> {
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT i.id FROM impresion_sucursal s
         JOIN impresora i ON i.id = s.impresora_caja_id AND i.empresa_id = s.empresa_id
        WHERE s.sucursal_id = $1 AND i.activa`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return filas[0] ?? null;
  }

  async trabajosDePrecuentas(
    precuentaIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (precuentaIds.length === 0) return new Map();
    // El trabajo de la emisión: los de reimpresión llevan `reimpresion_de_id`.
    const filas = await this.conexion.query<{ precuenta_id: string; id: string }>(
      `SELECT DISTINCT ON (precuenta_id) precuenta_id, id FROM trabajo_impresion
        WHERE precuenta_id = ANY($1::uuid[]) AND reimpresion_de_id IS NULL
        ORDER BY precuenta_id, creado_en, id`,
      { bind: [[...precuentaIds]], type: QueryTypes.SELECT },
    );
    return new Map(filas.map((f) => [f.precuenta_id, f.id]));
  }
}
