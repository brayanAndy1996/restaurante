import {
  SEGUNDOS_PUENTE_CONECTADO,
  type ConexionImpresora,
  type ImpresoraRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';

/** Una fila de `impresora` tal como sale de la base. */
export interface FilaImpresora {
  id: string;
  sucursal_id: string;
  nombre: string;
  conexion_tipo: 'RED' | 'BLUETOOTH';
  host: string | null;
  puerto: number | null;
  mac: string | null;
  ancho_mm: 58 | 80;
  juego_caracteres: ImpresoraRespuesta['juegoCaracteres'];
  gaveta: boolean;
  activa: boolean;
}

export const COLUMNAS_IMPRESORA = `id, sucursal_id, nombre, conexion_tipo, host, puerto, mac, ancho_mm,
  juego_caracteres, gaveta, activa`;

/** La conexión como la devuelve la API: de red con su puerto, o Bluetooth con su dirección. */
export function aConexion(fila: FilaImpresora): ConexionImpresora {
  return fila.conexion_tipo === 'RED'
    ? { tipo: 'RED', host: fila.host ?? '', puerto: fila.puerto ?? 0 }
    : { tipo: 'BLUETOOTH', mac: fila.mac ?? '' };
}

/** Estado y cola de una impresora (criterios 105 y 121). */
export interface EstadoDeImpresora {
  estado: ImpresoraRespuesta['estado'];
  estadoDesde: string | null;
  pendientes: number;
}

/** El instante de la lectura y el día operativo de la sucursal en él (el reloj de la API, criterios 117 y 121). */
export interface MomentoDeLectura {
  ahora: Date;
  diaOperativo: string;
}

/** Sin señal en tantos segundos, el puente está desconectado (criterio 121). */
export const MS_PUENTE_CONECTADO = SEGUNDOS_PUENTE_CONECTADO * 1000;

/** Lo que el latido guarda de cada impresora en `puente.estado_impresoras`. */
export interface EstadoReportado {
  estado: 'LISTA' | 'NO_RESPONDE';
  desde: string;
  error?: string;
}

/** El puente activo de la sucursal con su señal y lo que reportó de sus impresoras (criterio 121). */
export interface PuenteDeEstado {
  id: string;
  nombre: string;
  ultimaSenalEn: Date | null;
  conectado: boolean;
  impresoras: Readonly<Record<string, EstadoReportado>>;
}

export async function puenteDeEstado(
  conexion: Sequelize,
  sucursalId: string,
  ahora: Date,
): Promise<PuenteDeEstado | null> {
  const filas = await conexion.query<{
    id: string;
    nombre: string;
    ultima_senal_en: Date | null;
    estado_impresoras: Record<string, EstadoReportado>;
  }>(
    `SELECT id, nombre, ultima_senal_en, estado_impresoras FROM puente WHERE sucursal_id = $1 AND activo`,
    { bind: [sucursalId], type: QueryTypes.SELECT },
  );
  const fila = filas[0];
  if (fila === undefined) return null;
  const senal = fila.ultima_senal_en === null ? null : new Date(fila.ultima_senal_en);
  return {
    id: fila.id,
    nombre: fila.nombre,
    ultimaSenalEn: senal,
    conectado: senal !== null && ahora.getTime() - senal.getTime() <= MS_PUENTE_CONECTADO,
    impresoras: fila.estado_impresoras,
  };
}

/**
 * El estado y los trabajos pendientes de cada impresora de la sucursal (criterios 105 y 121). El estado es lo que
 * reportó el puente en su último latido, pero solo mientras el puente está conectado: sin puente, o con el puente
 * sin señal, o sin que haya reportado esa impresora, es `DESCONOCIDO`. Un pendiente cuyo día operativo ya pasó
 * está vencido y no cuenta (criterio 117).
 */
export async function estadoDeImpresoras(
  conexion: Sequelize,
  sucursalId: string,
  ids: readonly string[],
  momento: MomentoDeLectura,
  puente?: PuenteDeEstado | null,
): Promise<Map<string, EstadoDeImpresora>> {
  if (ids.length === 0) return new Map();
  const activo =
    puente === undefined ? await puenteDeEstado(conexion, sucursalId, momento.ahora) : puente;
  const pendientes = await conexion.query<{ impresora_id: string; n: number }>(
    `SELECT impresora_id, count(*)::int AS n FROM trabajo_impresion
      WHERE sucursal_id = $1 AND estado = 'PENDIENTE' AND dia_operativo >= $2::date
        AND impresora_id = ANY($3::uuid[])
      GROUP BY impresora_id`,
    { bind: [sucursalId, momento.diaOperativo, [...ids]], type: QueryTypes.SELECT },
  );
  const cola = new Map(pendientes.map((p) => [p.impresora_id, p.n]));
  return new Map(
    ids.map((id) => {
      const reportado = activo?.conectado === true ? activo.impresoras[id] : undefined;
      return [
        id,
        {
          estado: reportado?.estado ?? ('DESCONOCIDO' as const),
          estadoDesde: reportado?.desde ?? null,
          pendientes: cola.get(id) ?? 0,
        },
      ];
    }),
  );
}

export function aImpresoraRespuesta(
  fila: FilaImpresora,
  estado: EstadoDeImpresora,
): ImpresoraRespuesta {
  return {
    id: fila.id,
    sucursalId: fila.sucursal_id,
    nombre: fila.nombre,
    conexion: aConexion(fila),
    anchoMm: fila.ancho_mm,
    juegoCaracteres: fila.juego_caracteres,
    gaveta: fila.gaveta,
    activa: fila.activa,
    estado: estado.estado,
    estadoDesde: estado.estadoDesde,
    pendientes: estado.pendientes,
  };
}

/** Las impresoras de la sucursal (activas e inactivas) por nombre y luego por id, con su estado y su cola. */
export async function leerImpresoras(
  conexion: Sequelize,
  sucursalId: string,
  momento: MomentoDeLectura,
  filtro: { impresoraId?: string } = {},
): Promise<ImpresoraRespuesta[]> {
  const filas = await conexion.query<FilaImpresora>(
    `SELECT ${COLUMNAS_IMPRESORA} FROM impresora
      WHERE sucursal_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
      ORDER BY lower(nombre), id`,
    { bind: [sucursalId, filtro.impresoraId ?? null], type: QueryTypes.SELECT },
  );
  const estados = await estadoDeImpresoras(
    conexion,
    sucursalId,
    filas.map((f) => f.id),
    momento,
  );
  return filas.map((fila) => aImpresoraRespuesta(fila, estados.get(fila.id)!));
}
