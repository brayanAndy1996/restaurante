import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { OperacionPlataforma } from './operacion-plataforma';

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

/**
 * La lista de empresas para el barrido de envíos (historia 006, entrega 6b, criterio 126): la conexión de la API no puede
 * listar empresas, así que el worker pide los ids a plataforma con una operación de solo lectura
 * (`OperacionPlataforma.consultar`). Solo ids: ningún dato de las empresas.
 */
@Injectable()
export class EmpresasConsulta {
  constructor(@Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma) {}

  /** Los ids de todas las empresas, en orden. */
  ids(): Promise<string[]> {
    return this.operacion.consultar(async (transaccion) => {
      const filas = await sequelizeDe(transaccion).query<{ id: string }>(
        'SELECT id FROM empresa ORDER BY id',
        { transaction: transaccion, type: QueryTypes.SELECT },
      );
      return filas.map((fila) => fila.id);
    });
  }
}
