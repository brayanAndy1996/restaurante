import type { EstadoLlamado, TipoLlamado } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import type { LineaGuardada } from './creacion-llamados.service';

/**
 * La fila de `llamado` tal como la leen la lista, el detalle y las acciones del mozo (historia 005, criterios 39 a
 * 55). Sin las huellas ni las respuestas guardadas, que solo usan la creación y el paso a la cuenta.
 */
export interface FilaLlamado {
  id: string;
  sucursal_id: string;
  mesa_id: string;
  tipo: TipoLlamado;
  estado: EstadoLlamado;
  lineas: LineaGuardada[];
  nota: string | null;
  total: string | null;
  vence_en: Date;
  destinatario_mozo_id: string | null;
  orden_id: string | null;
  atendido_por_usuario_id: string | null;
  atendido_por_equipo_id: string | null;
  atendido_por_sesion_id: string | null;
  atendido_en: Date | null;
  cerrado_por_usuario_id: string | null;
  cerrado_por_equipo_id: string | null;
  cerrado_por_sesion_id: string | null;
  cerrado_en: Date | null;
  motivo_descarte: string | null;
  lineas_pasadas: { posicion: number; cantidad: number }[] | null;
  vencido_en: Date | null;
  creado_en: Date;
}

export const COLUMNAS_LLAMADO = `l.id, l.sucursal_id, l.mesa_id, l.tipo, l.estado, l.lineas, l.nota, l.total,
  l.vence_en, l.destinatario_mozo_id, l.orden_id, l.atendido_por_usuario_id, l.atendido_por_equipo_id,
  l.atendido_por_sesion_id, l.atendido_en, l.cerrado_por_usuario_id, l.cerrado_por_equipo_id,
  l.cerrado_por_sesion_id, l.cerrado_en, l.motivo_descarte,
  l.lineas_pasadas, l.vencido_en, l.creado_en`;

/**
 * El llamado de la sucursal con ese id, o `undefined` si no existe, es de otra sucursal o de otra empresa (la RLS
 * ya limita a la empresa). Con `bloquear`, `FOR UPDATE`: toda escritura de un llamado empieza así, y dos acciones
 * simultáneas sobre el mismo llamado se turnan (criterios 43 y 51).
 */
export async function leerLlamado(
  conexion: Sequelize,
  llamadoId: string,
  sucursalId: string,
  bloquear: boolean,
): Promise<FilaLlamado | undefined> {
  const filas = await conexion.query<FilaLlamado>(
    `SELECT ${COLUMNAS_LLAMADO} FROM llamado l
      WHERE l.id = $1 AND l.sucursal_id = $2${bloquear ? ' FOR UPDATE OF l' : ''}`,
    { bind: [llamadoId.toLowerCase(), sucursalId], type: QueryTypes.SELECT },
  );
  return filas[0];
}

/** Guarda un llamado pendiente cuyo `venceEn` ya pasó como `VENCIDO` (criterio 54): `vencido_en` es su `vence_en`. */
export async function guardarVencido(
  conexion: Sequelize,
  llamadoId: string,
  ahora: Date,
): Promise<void> {
  await conexion.query(
    `UPDATE llamado SET estado = 'VENCIDO', vencido_en = vence_en, actualizado_en = $2
      WHERE id = $1 AND estado = 'PENDIENTE'`,
    { bind: [llamadoId, ahora], type: QueryTypes.UPDATE },
  );
}
