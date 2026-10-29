import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/** Una estación de producción vista por otros módulos. */
export interface EstacionVisible {
  id: string;
  nombre: string;
}

/**
 * Lecturas de las estaciones para otros módulos (historia 004): `carta` es dueño de `estacion` y nadie más la
 * consulta. Corren en la transacción de la empresa del contexto activo.
 *
 * Fase A: solo la firma; lanza `Error('No implementado')` hasta la tarea T9.
 */
@Injectable()
export class CartaConsultaService {
  /** Las estaciones activas de la empresa del contexto, por nombre y luego por id (el KDS sin filtro y 3b). */
  estaciones(transaccion?: Transaction): Promise<EstacionVisible[]> {
    void transaccion;
    return Promise.reject(noImplementado());
  }
}
