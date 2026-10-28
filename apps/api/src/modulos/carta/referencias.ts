import type { CampoError } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';

/**
 * Validación de los ids que una escritura recibe en el cuerpo (criterios 9 y 67). Cada lectura es una sola
 * consulta por tipo de entidad, bajo RLS: un id de otra empresa no aparece y se trata exactamente igual
 * que uno inexistente (422 `REFERENCIA_INVALIDA`, mismo cuerpo). Las filas referidas se leen con el
 * bloqueo que pide quien llama, para serializarse con una desactivación concurrente: quien desactiva una
 * estación o una familia las bloquea `FOR UPDATE` y cuenta los productos activos; quien las asigna las lee
 * `FOR SHARE` (o `FOR UPDATE` si además toma el orden de la familia), y al volver a leer ve el estado nuevo.
 */

/** Bloqueo de las filas referidas. */
export type Bloqueo = 'SHARE' | 'UPDATE';

const CLAUSULA: Record<Bloqueo, string> = { SHARE: 'FOR SHARE', UPDATE: 'FOR UPDATE' };

/** Mensaje de cada campo en el 422 (nunca lleva el id). */
const MENSAJES = {
  familiaId: 'La familia no existe o está inactiva',
  estacionId: 'La estación no existe o está inactiva',
} as const;

const SQL_FAMILIAS = (bloqueo: Bloqueo) =>
  `SELECT id, activa FROM familia WHERE id = ANY($1::uuid[]) ORDER BY id ${CLAUSULA[bloqueo]}`;
const SQL_ESTACIONES = (bloqueo: Bloqueo) =>
  `SELECT id, activa FROM estacion WHERE id = ANY($1::uuid[]) ORDER BY id ${CLAUSULA[bloqueo]}`;

async function activasDe(
  conexion: Sequelize,
  sql: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const filas = await conexion.query<{ id: string; activa: boolean }>(sql, {
    bind: [[...new Set(ids.map((id) => id.toLowerCase()))]],
    type: QueryTypes.SELECT,
  });
  return new Set(filas.filter((f) => f.activa).map((f) => f.id));
}

/** Los ids de familias de la empresa que existen y están activas (las filas quedan bloqueadas). */
export function familiasActivas(
  conexion: Sequelize,
  ids: readonly string[],
  bloqueo: Bloqueo,
): Promise<Set<string>> {
  return activasDe(conexion, SQL_FAMILIAS(bloqueo), ids);
}

/** Los ids de estaciones de la empresa que existen y están activas (las filas quedan bloqueadas). */
export function estacionesActivas(
  conexion: Sequelize,
  ids: readonly string[],
  bloqueo: Bloqueo,
): Promise<Set<string>> {
  return activasDe(conexion, SQL_ESTACIONES(bloqueo), ids);
}

/**
 * Comprueba la familia y la estación de un producto (los que no se piden no se miran). Devuelve los campos
 * que fallan, para armar un solo 422; vacío si todo está bien. La familia se bloquea `FOR UPDATE`: quien
 * crea un producto o lo mueve a una familia toma su orden (`max(orden) + 1`) y debe serializarse con otro
 * que haga lo mismo.
 */
export async function validarFamiliaYEstacion(
  conexion: Sequelize,
  pedidas: { familiaId?: string; estacionId?: string | null },
): Promise<CampoError[]> {
  const fallan: CampoError[] = [];
  if (pedidas.familiaId !== undefined) {
    const activas = await familiasActivas(conexion, [pedidas.familiaId], 'UPDATE');
    if (!activas.has(pedidas.familiaId.toLowerCase())) {
      fallan.push({ campo: 'familiaId', mensaje: MENSAJES.familiaId });
    }
  }
  if (pedidas.estacionId !== undefined && pedidas.estacionId !== null) {
    const activas = await estacionesActivas(conexion, [pedidas.estacionId], 'SHARE');
    if (!activas.has(pedidas.estacionId.toLowerCase())) {
      fallan.push({ campo: 'estacionId', mensaje: MENSAJES.estacionId });
    }
  }
  return fallan;
}
