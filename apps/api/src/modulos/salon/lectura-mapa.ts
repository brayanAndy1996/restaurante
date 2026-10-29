import type { MesaRespuesta, ZonaRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

interface FilaZona {
  id: string;
  sucursal_id: string;
  nombre: string;
  orden: number;
  columnas: number;
  filas: number;
  activa: boolean;
}

interface FilaMesa {
  id: string;
  zona_id: string;
  nombre: string;
  capacidad: number;
  forma: MesaRespuesta['forma'];
  columna: number;
  fila: number;
  activa: boolean;
}

export const COLUMNAS_ZONA =
  'z.id, z.sucursal_id, z.nombre, z.orden, z.columnas, z.filas, z.activa';
export const COLUMNAS_MESA =
  'm.id, m.zona_id, m.nombre, m.capacidad, m.forma, m.columna, m.fila, m.activa';

export const aMesa = (m: FilaMesa): MesaRespuesta => ({
  id: m.id,
  zonaId: m.zona_id,
  nombre: m.nombre,
  capacidad: m.capacidad,
  forma: m.forma,
  columna: m.columna,
  fila: m.fila,
  activa: m.activa,
});

/**
 * Las zonas de la sucursal en su orden, cada una con todas sus mesas (activas e inactivas), en dos consultas sin
 * importar cuántas mesas haya. Con `zonaId`, solo esa zona. Corre bajo la RLS de la empresa del contexto.
 */
export async function leerZonas(
  conexion: Sequelize,
  sucursalId: string,
  opciones: { zonaId?: string; transaccion?: Transaction } = {},
): Promise<ZonaRespuesta[]> {
  const bind: unknown[] = [sucursalId];
  let filtro = '';
  if (opciones.zonaId !== undefined) {
    bind.push(opciones.zonaId);
    filtro = ' AND z.id = $2';
  }
  const zonas = await conexion.query<FilaZona>(
    `SELECT ${COLUMNAS_ZONA} FROM zona z WHERE z.sucursal_id = $1${filtro} ORDER BY z.orden, z.id`,
    { bind, type: QueryTypes.SELECT, transaction: opciones.transaccion },
  );
  if (zonas.length === 0) return [];
  const mesas = await conexion.query<FilaMesa>(
    `SELECT ${COLUMNAS_MESA} FROM mesa m
      WHERE m.zona_id = ANY($1::uuid[])
      ORDER BY m.fila, m.columna, m.id`,
    { bind: [zonas.map((z) => z.id)], type: QueryTypes.SELECT, transaction: opciones.transaccion },
  );
  const porZona = new Map<string, MesaRespuesta[]>();
  for (const mesa of mesas) {
    const lista = porZona.get(mesa.zona_id) ?? [];
    lista.push(aMesa(mesa));
    porZona.set(mesa.zona_id, lista);
  }
  return zonas.map((z) => ({
    id: z.id,
    sucursalId: z.sucursal_id,
    nombre: z.nombre,
    orden: z.orden,
    columnas: z.columnas,
    filas: z.filas,
    activa: z.activa,
    mesas: porZona.get(z.id) ?? [],
  }));
}
