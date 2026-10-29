import { Injectable } from '@nestjs/common';
import type { EstadoOrden } from '@restaurante/dominio';
import type { Transaction } from 'sequelize';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/** Una orden abierta de una sucursal, para otros módulos. */
export interface OrdenAbiertaResumen {
  id: string;
  estado: Extract<EstadoOrden, 'ABIERTA' | 'EN_PRECUENTA'>;
  mozoId: string | null;
  /** Las mesas vigentes de la orden. */
  mesaIds: string[];
  abiertaEn: Date;
}

/**
 * Lecturas de las órdenes para otros módulos (historia 004): `pedidos` es dueño de las tablas y nadie más las
 * consulta. La sección 4 usa `hayOrdenesAbiertas` para impedir el cierre de caja con mesas o pedidos abiertos.
 * Corren en la transacción de la empresa del contexto activo.
 *
 * Fase A: solo las firmas; lanzan `Error('No implementado')` hasta la tarea T9.
 */
@Injectable()
export class PedidosConsultaService {
  /** `true` si la sucursal tiene alguna orden `ABIERTA` o `EN_PRECUENTA`. */
  hayOrdenesAbiertas(sucursalId: string, transaccion?: Transaction): Promise<boolean> {
    void sucursalId;
    void transaccion;
    return Promise.reject(noImplementado());
  }

  /** Las órdenes abiertas de la sucursal, de la más antigua a la más nueva. */
  ordenesAbiertas(sucursalId: string, transaccion?: Transaction): Promise<OrdenAbiertaResumen[]> {
    void sucursalId;
    void transaccion;
    return Promise.reject(noImplementado());
  }
}
