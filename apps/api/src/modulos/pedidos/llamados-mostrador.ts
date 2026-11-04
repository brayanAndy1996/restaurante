import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';

/**
 * Número de llamado de las ventas de mostrador (historia 006, criterio 81): el siguiente de la sucursal en su día
 * operativo, desde 1, sin saltos ni repetidos con ventas concurrentes (`contador_llamado`, tabla de pedidos). Una
 * venta revertida no lo consume. FIRMA de la fase A.
 */
@Injectable()
export class LlamadosMostrador {
  async siguiente(_sucursalId: string, _diaOperativo: string): Promise<number> {
    throw noImplementado();
  }
}
