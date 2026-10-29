import { Injectable } from '@nestjs/common';
import type { MesaRespuesta, ZonaRespuesta } from '@restaurante/contratos';
import type { Transaction } from 'sequelize';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/** Una mesa bloqueada para una operación de pedidos, con la sucursal a la que pertenece. */
export interface MesaBloqueada extends MesaRespuesta {
  sucursalId: string;
}

/**
 * Lecturas de `zona` y `mesa` para el módulo de pedidos (historia 004): `salon` es dueño de las tablas y
 * nadie más las consulta. Corren en la transacción de la empresa del contexto activo, así que la RLS limita
 * todo a la propia empresa: una mesa de otra empresa es indistinguible de una inexistente.
 *
 * Fase A: solo las firmas; lanzan `Error('No implementado')` hasta la tarea T6.
 */
@Injectable()
export class MesasConsultaService {
  /**
   * Las zonas de la sucursal en su orden, cada una con todas sus mesas (activas e inactivas), en una cantidad
   * fija de consultas sin importar cuántas mesas haya.
   */
  listar(sucursalId: string, transaccion?: Transaction): Promise<ZonaRespuesta[]> {
    void sucursalId;
    void transaccion;
    return Promise.reject(noImplementado());
  }

  /**
   * Bloquea las mesas (`FOR UPDATE`, en orden de id) y las devuelve. Lanza 404 `NO_ENCONTRADO` si alguna no
   * existe o no es de la sucursal (con el mismo cuerpo para una de otra empresa). Quien lo llama decide si una
   * mesa inactiva es un error.
   */
  bloquear(
    mesaIds: readonly string[],
    sucursalId: string,
    transaccion?: Transaction,
  ): Promise<MesaBloqueada[]> {
    void mesaIds;
    void sucursalId;
    void transaccion;
    return Promise.reject(noImplementado());
  }
}
