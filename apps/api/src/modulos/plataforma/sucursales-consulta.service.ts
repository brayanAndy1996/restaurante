import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';

/** Sucursal vista por otros módulos: solo su identidad. */
export interface SucursalVisible {
  id: string;
  nombre: string;
}

/**
 * Lecturas de `sucursal` para los demás módulos (el de seguridad las usa para validar accesos y para armar
 * las sucursales elegibles): `plataforma` es dueño de la tabla y nadie más la consulta. Sin dependencias de
 * otros módulos —como `SuscripcionService`—, para que el módulo de seguridad lo use sin un ciclo con
 * `PlataformaModule`.
 *
 * Todas corren en la transacción de la empresa del contexto activo (la de `ContextoEmpresa.ejecutar`), así que
 * la RLS limita todo a la propia empresa: una sucursal de otra empresa es indistinguible de una inexistente.
 * Pasar `transaccion` es opcional y solo vale para la misma transacción del contexto.
 */
@Injectable()
export class SucursalesConsultaService {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /** `true` si todas las sucursales (sin contar repetidas) existen en la empresa del contexto. */
  async existen(ids: readonly string[], transaccion?: Transaction): Promise<boolean> {
    const unicas = [...new Set(ids)];
    if (unicas.length === 0) return true;
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM sucursal WHERE id = ANY($1::uuid[])',
      { bind: [unicas], type: QueryTypes.SELECT, transaction: transaccion },
    );
    return filas.length === unicas.length;
  }

  /**
   * Sucursales de la empresa del contexto, ordenadas por nombre y luego por id: todas si `ids` es `null`, o
   * solo las que estén en `ids` (las que no existan no aparecen).
   */
  async listar(
    ids: readonly string[] | null,
    transaccion?: Transaction,
  ): Promise<SucursalVisible[]> {
    if (ids === null) {
      return this.conexion.query<SucursalVisible>(
        'SELECT id, nombre FROM sucursal ORDER BY nombre, id',
        { type: QueryTypes.SELECT, transaction: transaccion },
      );
    }
    if (ids.length === 0) return [];
    return this.conexion.query<SucursalVisible>(
      'SELECT id, nombre FROM sucursal WHERE id = ANY($1::uuid[]) ORDER BY nombre, id',
      { bind: [[...new Set(ids)]], type: QueryTypes.SELECT, transaction: transaccion },
    );
  }

  /**
   * Hora de corte (`HH:MM`) de una sucursal de la empresa del contexto, o `null` si no existe (una sucursal
   * de otra empresa es indistinguible de una inexistente). La usan la carta (agotados y menú del día) para
   * calcular el día operativo con el reloj de la API, nunca con `now()` de la base (historia 003).
   */
  async horaCorte(sucursalId: string, transaccion?: Transaction): Promise<string | null> {
    const filas = await this.conexion.query<{ hora: string }>(
      `SELECT to_char(hora_corte, 'HH24:MI') AS hora FROM sucursal WHERE id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT, transaction: transaccion },
    );
    return filas[0]?.hora ?? null;
  }
}
