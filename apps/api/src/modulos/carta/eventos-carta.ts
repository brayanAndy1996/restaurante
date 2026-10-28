import { Inject, Injectable } from '@nestjs/common';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { estadoActual, type EstadoOperacion } from '../../nucleo/base-de-datos';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from '../../nucleo/eventos';

/**
 * Arma y registra los eventos de la carta con `ContextoEmpresa.alConfirmar`: se publican solo después de
 * confirmar la transacción, nunca en una reversión ni en una escritura que no cambió nada (criterios 46 y
 * 54). El evento lleva la empresa del contexto: el publicador corre sin contexto.
 *
 * Una petición publica un solo `carta.actualizada` por sala aunque varias partes del servicio lo pidan (por
 * ejemplo, un `PATCH` de producto que cambia datos y grupos).
 */
@Injectable()
export class EventosCarta {
  /** Salas ya registradas por operación en curso (se descarta sola cuando termina la operación). */
  private readonly registrados = new WeakMap<EstadoOperacion, Set<string>>();

  constructor(
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
  ) {}

  /**
   * `carta.actualizada` (criterio 54): con `sucursalId` `null`, en la sala de la empresa (el cambio afecta a
   * todas las sucursales: productos, familias, estaciones, grupos); con una sucursal, en la sala de esa
   * sucursal (ajuste por sucursal, menú del día).
   */
  cartaActualizada(sucursalId: string | null): void {
    const empresaId = this.contexto.empresaActual();
    const estado = estadoActual();
    const clave = sucursalId ?? '*';
    if (estado !== undefined) {
      const vistos = this.registrados.get(estado) ?? new Set<string>();
      if (vistos.has(clave)) return;
      vistos.add(clave);
      this.registrados.set(estado, vistos);
    }
    this.contexto.alConfirmar(() =>
      this.publicador.publicar({
        empresaId,
        sala: sucursalId === null ? { tipo: 'empresa' } : { tipo: 'sucursal', sucursalId },
        nombre: 'carta.actualizada',
        datos: { sucursalId },
      }),
    );
  }
}
