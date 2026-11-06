import { Injectable, StreamableFile } from '@nestjs/common';
import type {
  AlertasRespuesta,
  ComprobanteDetalle,
  EnlaceComprobanteRespuesta,
  EnvioPseRespuesta,
  PanelComprobantes,
  PanelConsultaValidada,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * El panel de comprobantes y sus acciones (historia 006, entrega 6b, criterios 132, 133, 135, 159 y 160): lista con
 * filtros y conteos, detalle con el envío y los intentos, reintento manual, alertas, PDF y enlace. El alcance es el del
 * criterio 169 (Cajero: sus turnos; Supervisor: la sucursal activa; Administrador: sus sucursales).
 *
 * Fase A (T29): solo las firmas; lanzan `Error('No implementado')` hasta T32 y T43.
 */
@Injectable()
export class PanelService {
  listar(consulta: PanelConsultaValidada): Promise<PanelComprobantes> {
    void consulta;
    return Promise.reject(noImplementado());
  }

  detalle(id: string): Promise<ComprobanteDetalle> {
    void id;
    return Promise.reject(noImplementado());
  }

  reintentar(id: string): Promise<EnvioPseRespuesta> {
    void id;
    return Promise.reject(noImplementado());
  }

  alertas(sucursalId: string | undefined): Promise<AlertasRespuesta> {
    void sucursalId;
    return Promise.reject(noImplementado());
  }

  /** El PDF como `StreamableFile` con su tipo y `Content-Disposition: inline; filename="B001-00000124.pdf"`. */
  pdf(id: string): Promise<StreamableFile> {
    void id;
    return Promise.reject(noImplementado());
  }

  enlace(id: string): Promise<EnlaceComprobanteRespuesta> {
    void id;
    return Promise.reject(noImplementado());
  }
}
