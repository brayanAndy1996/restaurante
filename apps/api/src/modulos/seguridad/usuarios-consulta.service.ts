import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Lecturas de `usuario` y `acceso_sucursal` para otros módulos (historia 004): `seguridad` es dueño de las
 * tablas y nadie más las consulta. Corren en la transacción de la empresa del contexto activo, así que un
 * usuario de otra empresa es indistinguible de uno inexistente.
 *
 * Fase A: solo la firma; lanza `Error('No implementado')` hasta la tarea T9.
 */
@Injectable()
export class UsuariosConsultaService {
  /**
   * De los `usuarioIds`, los que son usuarios activos de la empresa y pueden atender mesas en la sucursal
   * (criterio 10): Administrador, o con `ATENDER_MESA` como `permitido` con su rol en esa sucursal según la matriz
   * de `packages/dominio`. Los ids vienen y se devuelven en minúsculas; los demás (Cocina/Barra, sin acceso a la
   * sucursal, inactivos, de otra empresa o inexistentes) no aparecen.
   */
  puedenAtenderMesa(
    sucursalId: string,
    usuarioIds: readonly string[],
    transaccion?: Transaction,
  ): Promise<Set<string>> {
    void sucursalId;
    void usuarioIds;
    void transaccion;
    return Promise.reject(noImplementado());
  }
}
