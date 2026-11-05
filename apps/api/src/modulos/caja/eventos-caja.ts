import { Inject, Injectable } from '@nestjs/common';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../nucleo/eventos';

/**
 * Eventos de la caja (historia 006, criterio 97) con `ContextoEmpresa.alConfirmar`: se publican solo después de
 * confirmar la transacción, nunca en una reversión, una réplica ni una escritura que no cambió nada. Van en la sala de
 * la sucursal y llevan solo ids.
 */
@Injectable()
export class EventosCaja {
  constructor(
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
  ) {}

  /** `turno.cambio`: se abrió o se cerró un turno, o entró un movimiento o un cobro. */
  turnoCambio(sucursalId: string, turnoId: string, cajaId: string): void {
    const empresaId = this.contexto.empresaActual();
    this.contexto.alConfirmar(() =>
      this.publicador.publicar({
        empresaId,
        sala: { tipo: 'sucursal', sucursalId },
        nombre: 'turno.cambio',
        datos: { turnoId, cajaId },
      }),
    );
  }
}
