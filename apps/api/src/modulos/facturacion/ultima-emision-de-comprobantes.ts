import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';
import { UltimaEmisionDeEmisor } from '../plataforma';

/**
 * Registra en plataforma la fecha del último comprobante de un emisor (historia 006, criterio 6): `max(fecha_emision)`
 * de `comprobante` del emisor, o `null` si no emitió ninguno. Plataforma no lee `comprobante`. FIRMAS de la fase A.
 */
@Injectable()
export class UltimaEmisionDeComprobantes implements OnModuleInit {
  constructor(@Inject(UltimaEmisionDeEmisor) private readonly registro: UltimaEmisionDeEmisor) {}

  onModuleInit(): void {
    this.registro.registrar((emisorId) => this.fecha(emisorId));
  }

  async fecha(_emisorId: string): Promise<string | null> {
    throw noImplementado();
  }
}
