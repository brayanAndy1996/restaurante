import { Inject, Injectable } from '@nestjs/common';
import {
  LIMITE_LLAMADOS_IP,
  LIMITE_LLAMADOS_MESA,
  decidirLimite,
  type LimiteDeLlamados,
  type ResultadoLimite,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';

const MS_POR_MINUTO = 60_000;

/**
 * Los límites de creación de llamados (historia 005, criterios 32 y 33): cuenta las filas de `llamado` de la mesa o de
 * la conexión (cualquier tipo y estado; los rechazados y las réplicas no guardan fila, así que no cuentan) y deja la
 * decisión a `decidirLimite` de `packages/dominio`. Todo con el `ahora` de la API, nunca `now()` de la base. Corre
 * dentro de la transacción de la petición, después de los cerrojos que serializan las creaciones.
 */
@Injectable()
export class LimitesLlamados {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /** Seis llamados en 30 minutos por mesa. */
  porMesa(mesaId: string, ahora: Date): Promise<ResultadoLimite> {
    return this.decidir(
      'SELECT creado_en FROM llamado WHERE mesa_id = $1 AND creado_en > $2',
      mesaId,
      ahora,
      LIMITE_LLAMADOS_MESA,
    );
  }

  /** Veinte llamados en 10 minutos por conexión (huella de la IP) y sucursal. */
  porConexion(sucursalId: string, huellaIp: Buffer, ahora: Date): Promise<ResultadoLimite> {
    return this.decidir(
      'SELECT creado_en FROM llamado WHERE sucursal_id = $1 AND huella_ip = $3 AND creado_en > $2',
      sucursalId,
      ahora,
      LIMITE_LLAMADOS_IP,
      huellaIp,
    );
  }

  private async decidir(
    sql: string,
    clave: string,
    ahora: Date,
    limite: LimiteDeLlamados,
    huella?: Buffer,
  ): Promise<ResultadoLimite> {
    const desde = new Date(ahora.getTime() - limite.ventanaMinutos * MS_POR_MINUTO);
    const filas = await this.conexion.query<{ creado_en: Date }>(sql, {
      bind: huella === undefined ? [clave, desde] : [clave, desde, huella],
      type: QueryTypes.SELECT,
    });
    return decidirLimite(
      filas.map((f) => new Date(f.creado_en)),
      ahora,
      limite,
    );
  }
}
