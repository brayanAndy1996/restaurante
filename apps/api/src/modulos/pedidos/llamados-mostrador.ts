import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';

/**
 * Número de llamado de las ventas de mostrador (historia 006, criterio 81): el siguiente de la sucursal en su día
 * operativo, desde 1, sin saltos ni repetidos con ventas concurrentes (`contador_llamado`, tabla de pedidos). Una
 * venta revertida no lo consume: el número se toma en la transacción de la venta y vuelve con ella.
 *
 * Una sola sentencia atómica: crea la fila del día con 1 o suma 1 a la que ya existe y devuelve el resultado. La fila
 * queda bloqueada hasta que la transacción termina, así dos ventas de la misma sucursal y día se turnan y cada una ve
 * el número que dejó la anterior confirmada.
 */
@Injectable()
export class LlamadosMostrador {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** El siguiente número de llamado de la sucursal en ese día operativo (`AAAA-MM-DD`). */
  async siguiente(sucursalId: string, diaOperativo: string): Promise<number> {
    const ahora = this.reloj.ahora();
    const [fila] = await this.conexion.query<{ ultimo: number }>(
      `INSERT INTO contador_llamado (empresa_id, sucursal_id, dia_operativo, ultimo, creado_en, actualizado_en)
       VALUES ($1, $2, $3::date, 1, $4, $4)
       ON CONFLICT (empresa_id, sucursal_id, dia_operativo)
       DO UPDATE SET ultimo = contador_llamado.ultimo + 1, actualizado_en = EXCLUDED.actualizado_en
       RETURNING ultimo`,
      {
        bind: [this.contexto.empresaActual(), sucursalId, diaOperativo, ahora],
        type: QueryTypes.SELECT,
      },
    );
    return fila!.ultimo;
  }
}
