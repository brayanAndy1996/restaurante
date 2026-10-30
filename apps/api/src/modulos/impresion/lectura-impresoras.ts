import type { ConexionImpresora, ImpresoraRespuesta } from '@restaurante/contratos';
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

/**
 * El estado y los trabajos pendientes de cada impresora de la sucursal.
 *
 * Mientras no existan el puente ni la cola de trabajos (T40 crea `puente` y `trabajo_impresion`, T44 el latido que
 * llena `estado_impresoras`), ninguna impresora tiene señal ni trabajos: `DESCONOCIDO`, sin fecha y sin
 * pendientes (el estado de una impresora nunca reportada, criterio 121). T40 y T44 reemplazan solo esta función.
 */
export async function estadoDeImpresoras(
  conexion: Sequelize,
  sucursalId: string,
  ids: readonly string[],
): Promise<Map<string, EstadoDeImpresora>> {
  void conexion;
  void sucursalId;
  return new Map(
    ids.map((id) => [id, { estado: 'DESCONOCIDO' as const, estadoDesde: null, pendientes: 0 }]),
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
  );
  return filas.map((fila) => aImpresoraRespuesta(fila, estados.get(fila.id)!));
}
