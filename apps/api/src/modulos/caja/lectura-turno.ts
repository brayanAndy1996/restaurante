import type { TurnoRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import type { UsuariosConsultaService } from '../seguridad';

/** Una fila de `turno` con el nombre de su caja, tal como la leen los servicios de caja. */
export interface FilaTurno {
  id: string;
  caja_id: string;
  caja_nombre: string;
  sucursal_id: string;
  responsable_id: string;
  estado: 'ABIERTO' | 'CERRADO';
  abierto_en: Date;
  dia_operativo: string;
  fondo: string;
  cerrado_en: Date | null;
  cerrado_por_id: string | null;
  /** Lo que dijo la apertura de su trabajo `GAVETA` (migración 8); nulos con fondo `0.00`. */
  apertura_impresion: 'EN_COLA' | 'SIN_IMPRESORA' | null;
  apertura_trabajo_id: string | null;
}

export const SQL_TURNO = `SELECT t.id, t.caja_id, c.nombre AS caja_nombre, t.sucursal_id, t.responsable_id, t.estado,
       t.abierto_en, to_char(t.dia_operativo, 'YYYY-MM-DD') AS dia_operativo, t.fondo::text AS fondo,
       t.cerrado_en, t.cerrado_por_id, t.apertura_impresion, t.apertura_trabajo_id
  FROM turno t JOIN caja c ON c.id = t.caja_id AND c.empresa_id = t.empresa_id`;

/** El turno con ese id en la empresa del contexto (la RLS la limita), o `undefined`. */
export async function buscarTurno(conexion: Sequelize, id: string): Promise<FilaTurno | undefined> {
  const filas = await conexion.query<FilaTurno>(`${SQL_TURNO} WHERE t.id = $1`, {
    bind: [id],
    type: QueryTypes.SELECT,
  });
  return filas[0];
}

/** La fila a la forma de `turnoRespuesta`, con los nombres de las personas (una consulta). */
export async function turnoARespuesta(
  usuarios: UsuariosConsultaService,
  fila: FilaTurno,
): Promise<TurnoRespuesta> {
  const ids = [fila.responsable_id, ...(fila.cerrado_por_id === null ? [] : [fila.cerrado_por_id])];
  const nombres = await usuarios.nombres(ids);
  return {
    id: fila.id,
    caja: { id: fila.caja_id, nombre: fila.caja_nombre },
    responsable: { id: fila.responsable_id, nombre: nombres.get(fila.responsable_id) ?? '' },
    estado: fila.estado,
    abiertoEn: fila.abierto_en.toISOString(),
    diaOperativo: fila.dia_operativo,
    fondo: fila.fondo,
    cerradoEn: fila.cerrado_en === null ? null : fila.cerrado_en.toISOString(),
    cerradoPor:
      fila.cerrado_por_id === null
        ? null
        : { id: fila.cerrado_por_id, nombre: nombres.get(fila.cerrado_por_id) ?? '' },
  };
}

/**
 * La respuesta de la apertura (201): el turno y, si el fondo era mayor que cero, lo que dijo su trabajo `GAVETA`
 * (criterio 96). La réplica por `id` devuelve lo mismo, guardado en el turno.
 */
export function conImpresionDeApertura(respuesta: TurnoRespuesta, fila: FilaTurno): TurnoRespuesta {
  return fila.apertura_impresion === null
    ? respuesta
    : {
        ...respuesta,
        impresion: fila.apertura_impresion,
        trabajoId: fila.apertura_trabajo_id,
      };
}

/** Un monto de texto (`"100"`, `"100.5"`) con exactamente 2 decimales. */
export function conDosDecimales(monto: string): string {
  const [enteros = '0', decimales = ''] = monto.split('.');
  return `${enteros.replace(/^0+(?=\d)/, '')}.${decimales.padEnd(2, '0')}`;
}
