import { QueryTypes, type Sequelize } from 'sequelize';

/** Las mesas vigentes de la orden (relación `orden_mesa` sin fecha de fin), en el orden en que se ocuparon. */
export async function mesasVigentesDeOrden(
  conexion: Sequelize,
  ordenId: string,
): Promise<string[]> {
  const filas = await conexion.query<{ mesa_id: string }>(
    'SELECT mesa_id FROM orden_mesa WHERE orden_id = $1 AND hasta IS NULL ORDER BY desde, id',
    { bind: [ordenId], type: QueryTypes.SELECT },
  );
  return filas.map((f) => f.mesa_id);
}
