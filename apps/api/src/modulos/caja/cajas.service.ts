import { Injectable } from '@nestjs/common';
import type { CajaEntrada, CajaModificarEntrada, CajaRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Cajas de una sucursal (historia 006, criterios 1, 2 y 7): dueño de la tabla `caja`. Hasta 10 activas por
 * sucursal, nombre único sin distinguir mayúsculas, impresora activa de la misma sucursal o `null`; no se borran y
 * desactivar una con turno abierto responde 409 `EN_USO`. Deja `crear_caja` y `modificar_caja` en la auditoría.
 * FIRMAS de la fase A.
 */
@Injectable()
export class CajasService {
  /** Todas las cajas de la sucursal (también las inactivas). */
  async listar(_sucursalId: string): Promise<CajaRespuesta[]> {
    throw noImplementado();
  }

  /** Una caja de la sucursal; 404 si es de otra sucursal o empresa. */
  async obtener(_sucursalId: string, _cajaId: string): Promise<CajaRespuesta> {
    throw noImplementado();
  }

  async crear(_sucursalId: string, _entrada: CajaEntrada): Promise<CajaRespuesta> {
    throw noImplementado();
  }

  async modificar(
    _sucursalId: string,
    _cajaId: string,
    _entrada: CajaModificarEntrada,
  ): Promise<CajaRespuesta> {
    throw noImplementado();
  }

  /** `GET /cajas` (criterio 27): las cajas activas de la sucursal activa, con su turno abierto y sin montos. */
  async activasDeLaSucursal(): Promise<CajaRespuesta[]> {
    throw noImplementado();
  }
}
