import { Inject, Injectable } from '@nestjs/common';
import type { EventoPublicable, PublicadorEventos } from '../eventos';
import { ServidorTiempoReal } from './servidor-tiempo-real';

/**
 * Publicador de eventos de la API cuando el tiempo real está habilitado (historia 004, criterio 67): reemplaza al
 * `PublicadorNulo`. Un evento de sala empresa llega solo a las conexiones de esa empresa; uno de sala sucursal,
 * solo a las de esa sucursal de esa empresa. Las operaciones lo llaman con `ContextoEmpresa.alConfirmar`, es decir,
 * después de confirmar la transacción.
 */
@Injectable()
export class PublicadorSocketIo implements PublicadorEventos {
  constructor(@Inject(ServidorTiempoReal) private readonly servidor: ServidorTiempoReal) {}

  publicar(evento: EventoPublicable): void {
    this.servidor.publicar(evento);
  }
}
