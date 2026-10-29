import { Inject, Injectable } from '@nestjs/common';
import { ROLES_DE_ACCESO, requisitoPermiso } from '@restaurante/dominio';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';

/** Los roles de acceso por sucursal que tienen `ATENDER_MESA` como `permitido` en la matriz (criterio 10). */
const ROLES_QUE_ATIENDEN_MESA = ROLES_DE_ACCESO.filter(
  (rol) => requisitoPermiso(rol, 'ATENDER_MESA') === 'permitido',
);

/**
 * Lecturas de `usuario` y `acceso_sucursal` para otros módulos (historia 004): `seguridad` es dueño de las
 * tablas y nadie más las consulta. Corren en la transacción de la empresa del contexto activo, así que un
 * usuario de otra empresa es indistinguible de uno inexistente (la RLS no lo deja ver).
 */
@Injectable()
export class UsuariosConsultaService {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /**
   * De los `usuarioIds`, los que son usuarios activos de la empresa y pueden atender mesas en la sucursal
   * (criterio 10): Administrador, o con `ATENDER_MESA` como `permitido` con su rol en esa sucursal según la matriz
   * de `packages/dominio`. Los ids vienen y se devuelven en minúsculas; los demás (Cocina/Barra, sin acceso a la
   * sucursal, inactivos, de otra empresa o inexistentes) no aparecen.
   */
  async puedenAtenderMesa(
    sucursalId: string,
    usuarioIds: readonly string[],
    transaccion?: Transaction,
  ): Promise<Set<string>> {
    const ids = [...new Set(usuarioIds.map((id) => id.toLowerCase()))];
    if (ids.length === 0) return new Set();
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT u.id FROM usuario u
        WHERE u.id = ANY($1::uuid[]) AND u.activo
          AND (u.es_administrador
               OR EXISTS (SELECT 1 FROM acceso_sucursal a
                           WHERE a.usuario_id = u.id AND a.sucursal_id = $2 AND a.rol = ANY($3::text[])))`,
      {
        bind: [ids, sucursalId, [...ROLES_QUE_ATIENDEN_MESA]],
        type: QueryTypes.SELECT,
        transaction: transaccion,
      },
    );
    return new Set(filas.map((f) => f.id));
  }

  /**
   * El nombre de cada usuario de la empresa pedido (para mostrar al mozo responsable y a quien comandó). Un id
   * de otra empresa o inexistente no aparece. Una sola consulta sin importar cuántos ids.
   */
  async nombres(
    usuarioIds: readonly string[],
    transaccion?: Transaction,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(usuarioIds.map((id) => id.toLowerCase()))];
    // Sin ids igual consulta: el mapa del salón cuenta sus consultas y no varían con los datos.
    const filas = await this.conexion.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM usuario WHERE id = ANY($1::uuid[])`,
      { bind: [ids], type: QueryTypes.SELECT, transaction: transaccion },
    );
    return new Map(filas.map((f) => [f.id, f.nombre]));
  }
}
