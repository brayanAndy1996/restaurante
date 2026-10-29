import { Inject, Injectable } from '@nestjs/common';
import type { TipoComanda } from '@restaurante/dominio';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../nucleo/eventos';

/**
 * Arma y registra los eventos de los pedidos (historia 004, "Eventos en tiempo real") con
 * `ContextoEmpresa.alConfirmar`: se publican solo después de confirmar la transacción, nunca en una reversión,
 * una réplica ni una escritura que no cambió nada. Todos van en la sala de la sucursal y llevan solo ids. El
 * evento lleva la empresa del contexto: el publicador corre sin contexto.
 */
@Injectable()
export class EventosPedidos {
  constructor(
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
  ) {}

  /** `salon.cambio` (criterio 14): cambió el estado o el grupo de las mesas de una orden. */
  salonCambio(sucursalId: string, ordenId: string, mesaIds: readonly string[]): void {
    this.publicar(sucursalId, 'salon.cambio', { mesaIds: [...mesaIds], ordenId });
  }

  /** `orden.cambio`: toda escritura de una orden. */
  ordenCambio(sucursalId: string, ordenId: string): void {
    this.publicar(sucursalId, 'orden.cambio', { ordenId });
  }

  /** `cocina.comanda` (criterios 31, 32, 38 y 42): llegó una comanda a una estación. */
  cocinaComanda(
    sucursalId: string,
    comanda: { comandaId: string; estacionId: string; tipo: TipoComanda },
  ): void {
    this.publicar(sucursalId, 'cocina.comanda', { ...comanda });
  }

  private publicar(sucursalId: string, nombre: string, datos: Record<string, unknown>): void {
    const empresaId = this.contexto.empresaActual();
    this.contexto.alConfirmar(() =>
      this.publicador.publicar({
        empresaId,
        sala: { tipo: 'sucursal', sucursalId },
        nombre,
        datos,
      }),
    );
  }
}
