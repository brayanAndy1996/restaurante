import { Inject, Injectable } from '@nestjs/common';
import type { EstadoLlamado, TipoLlamado } from '@restaurante/dominio';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../nucleo/eventos';

/**
 * Arma y registra los eventos de los llamados (historia 005, criterios 36, 45, 52, 53 y 57) con
 * `ContextoEmpresa.alConfirmar`: se publican solo después de confirmar la transacción, nunca en una reversión, una
 * réplica ni un rechazo. Van en la sala de la sucursal de la mesa y llevan solo ids, el tipo o el estado, el nombre
 * de la mesa y los destinatarios (menos de 4 KB). El evento lleva la empresa del contexto: el publicador corre sin
 * contexto.
 */
@Injectable()
export class EventosLlamados {
  constructor(
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
  ) {}

  /** `llamado.nuevo` (criterio 36): `destinatarios` es el mozo responsable de la mesa o `null` si estaba libre. */
  nuevo(
    sucursalId: string,
    datos: {
      llamadoId: string;
      tipo: TipoLlamado;
      mesaId: string;
      mesaNombre: string;
      destinatarios: string[] | null;
    },
  ): void {
    this.publicar(sucursalId, 'llamado.nuevo', {
      ...datos,
      destinatarios: datos.destinatarios === null ? null : [...datos.destinatarios],
    });
  }

  /** `llamado.cambio` (criterios 45, 52 y 53): el llamado cambió de estado. */
  cambio(
    sucursalId: string,
    datos: { llamadoId: string; mesaId: string; estado: EstadoLlamado },
  ): void {
    this.publicar(sucursalId, 'llamado.cambio', { ...datos });
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
